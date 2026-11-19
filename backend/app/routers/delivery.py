from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, aliased, lazyload
from sqlalchemy import func
from passlib.context import CryptContext
from jose import JWTError, jwt

from app.core.database import get_db
from app.models.delivery import Delivery
from app.models.order import Order
from app.models.order_event import OrderEvent
from app.models.order_item import OrderItem
from app.models.vendor_order import VendorOrder
from app.models.payment import Payment
from app.models.user import User
from app.models.delivery_partner_application import DeliveryPartnerApplication
from app.models.audit_log import AuditLog
from app.schemas.auth import LoginRequest
from app.routers.admin_auth import create_access_token, SECRET_KEY, ALGORITHM
from app.services.notifications import add_notification, notify_role

router = APIRouter(prefix="/delivery", tags=["Delivery Operations"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

STATUS_TRANSITIONS = {
    "Ready for Pickup": {"Shipped"},
    "Shipped": {"Out for Delivery"},
    "Out for Delivery": {"Delivered"},
}


class StatusUpdate(BaseModel):
    status: str
    otp: Optional[str] = None


class OtpVerifyRequest(BaseModel):
    otp: str = Field(min_length=4, max_length=4, pattern=r"^\d{4}$")


class RiderAssignment(BaseModel):
    rider_id: Optional[int] = None


class RiderApplicationStatus(BaseModel):
    status: str


class IncidentCreate(BaseModel):
    rider_id: Optional[int] = None
    reason: str = Field(min_length=2, max_length=120)
    details: Optional[str] = None


class PayoutRequest(BaseModel):
    amount: Optional[float] = Field(default=None, gt=0)


def _login(payload: LoginRequest, allowed_roles: set, db: Session):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or str(user.role) not in allowed_roles:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials for delivery portal")
    if not pwd_context.verify(payload.password, str(user.hashed_password)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password")
    if str(user.role) == "rider" and (not user.is_active or not user.is_verified):
        application = db.query(DeliveryPartnerApplication).filter(DeliveryPartnerApplication.user_id == user.id).first()
        if application and application.status == "Rejected":
            raise HTTPException(status_code=403, detail="Your delivery partner application was not approved. Contact the marketplace team.")
        raise HTTPException(status_code=403, detail="Your delivery partner application is awaiting admin approval.")

    token = create_access_token({"sub": user.email, "role": user.role, "user_id": user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "rider_id": user.id,
        "delivery_id": user.id,
        "role": user.role,
        "full_name": user.full_name,
    }


def _require_assigned_rider(order_id: int, authorization: str, db: Session) -> int:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in as the assigned rider to update this delivery")
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        rider_id = int(claims.get("user_id", 0))
        session_role = claims.get("role")
        if session_role not in {"rider", "delivery", "admin"} or not rider_id:
            raise ValueError("Invalid rider session")
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Your session is invalid. Please sign in again.")
    if session_role in {"delivery", "admin"}:
        return rider_id
    rider = db.query(User).filter(User.id == rider_id, User.role == "rider", User.is_active.is_(True), User.is_verified.is_(True)).first()
    if rider is None:
        raise HTTPException(status_code=403, detail="Your delivery partner account is not approved or active")
    delivery = db.query(Delivery).filter(Delivery.order_id == order_id).first()
    if delivery is None or delivery.rider_id != rider_id:
        raise HTTPException(status_code=403, detail="This order is not assigned to your rider account")
    return rider_id


def _require_admin_id(authorization: str) -> int:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in as an admin to review applications")
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        admin_id = int(claims.get("user_id", 0))
        if claims.get("role") != "admin" or not admin_id:
            raise ValueError("Admin role required")
        return admin_id
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Your admin session is invalid. Please sign in again.")


def _require_rider_id(authorization: str) -> int:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in as a delivery partner")
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        rider_id = int(claims.get("user_id", 0))
        if claims.get("role") != "rider" or not rider_id:
            raise ValueError("Rider role required")
        return rider_id
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Your rider session is invalid. Please sign in again.")


def _require_delivery_operator(authorization: str) -> int:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in as an admin or delivery manager")
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        operator_id = int(claims.get("user_id", 0))
        if claims.get("role") not in {"admin", "delivery"} or not operator_id:
            raise ValueError("Delivery operator role required")
        return operator_id
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Your delivery operations session is invalid. Please sign in again.")


@router.post("/login")
def delivery_login(payload: LoginRequest, db: Session = Depends(get_db)):
    return _login(payload, {"delivery", "admin"}, db)


@router.post("/rider/login")
def rider_login(payload: LoginRequest, db: Session = Depends(get_db)):
    return _login(payload, {"rider"}, db)


def _list_all_deliveries(db: Session):
    RiderUser = aliased(User)
    item_counts = (
        db.query(
            VendorOrder.order_id.label("order_id"),
            func.sum(OrderItem.quantity).label("item_count"),
        )
        .join(OrderItem, OrderItem.vendor_order_id == VendorOrder.id)
        .group_by(VendorOrder.order_id)
        .subquery()
    )

    # Aggregate item counts and join rider details in one query instead of
    # issuing two additional database queries for every order.
    deliveries = (
        db.query(Delivery, Order, User, RiderUser, item_counts.c.item_count)
        .select_from(Order)
        .outerjoin(Delivery, Delivery.order_id == Order.id)
        .join(User, User.id == Order.customer_id)
        .outerjoin(RiderUser, RiderUser.id == Delivery.rider_id)
        .outerjoin(item_counts, item_counts.c.order_id == Order.id)
        .options(lazyload("*"))
        .order_by(Order.created_at.desc())
        .all()
    )

    result = []
    for d, o, customer, rider, item_count in deliveries:
        result.append({
            "id": o.id,
            "delivery_id": d.id if d else None,
            "order_id": o.id,
            "order_number": o.order_number or f"#NX-{o.id}",
            "customer_id": o.customer_id,
            "customer_name": customer.full_name,
            "customer_email": customer.email,
            "customer_phone": customer.phone,
            "customer_lat": o.delivery_lat if o.delivery_lat is not None else (o.address.lat if o.address else None),
            "customer_lng": o.delivery_lng if o.delivery_lng is not None else (o.address.lng if o.address else None),
            "vendor_details": [{
                "vendor_id": vo.vendor_id,
                "name": (vo.vendor.vendor_profile.store_name if vo.vendor.vendor_profile else None) or vo.vendor.store_name or vo.vendor.full_name,
                "phone": vo.vendor.phone,
                "address": vo.vendor.vendor_profile.store_address if vo.vendor.vendor_profile else None,
                "lat": vo.vendor.vendor_profile.store_lat if vo.vendor.vendor_profile else None,
                "lng": vo.vendor.vendor_profile.store_lng if vo.vendor.vendor_profile else None,
            } for vo in o.vendor_orders],
            "shipping_address": (d.drop_address if d else None) or o.shipping_address,
            "drop_address": d.drop_address if d else o.shipping_address,
            "pickup_hub": d.pickup_hub if d else "NexCart Central Hub",
            "total_amount": float(o.total_amount),
            "item_count": int(item_count or 1),
            "status": o.status,
            "raw_status": d.status if d else o.status,
            "order_status": o.status,
            "payment_method": o.payment_method,
            "assigned_rider": rider.full_name if rider else None,
            "rider_id": d.rider_id if d else None,
            "rider_fee": float(d.rider_fee) if d else 0,
            "otp_verified": d.otp_verified if d else False,
            "accepted_at": d.accepted_at.isoformat() if d and d.accepted_at else None,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "delivered_at": d.delivered_at.isoformat() if d and d.delivered_at else None,
        })
    return result


@router.get("/orders")
def get_all_deliveries(authorization: str = Header(default=""), db: Session = Depends(get_db)):
    _require_delivery_operator(authorization)
    return _list_all_deliveries(db)


@router.get("/rider/orders")
def get_rider_deliveries(authorization: str = Header(default=""), db: Session = Depends(get_db)):
    rider_id = _require_rider_id(authorization)
    return [order for order in _list_all_deliveries(db) if order["rider_id"] == rider_id]


@router.post("/orders/{order_id}/accept")
def accept_delivery(order_id: int, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    rider_id = _require_rider_id(authorization)
    delivery = db.query(Delivery).filter(Delivery.order_id == order_id).first()
    if delivery is None or delivery.rider_id != rider_id:
        raise HTTPException(status_code=404, detail="This delivery is not assigned to your account")
    if delivery.accepted_at is None:
        delivery.accepted_at = datetime.now(timezone.utc)
        db.add(OrderEvent(order_id=order_id, actor_role="rider", status="Accepted", note="Assigned delivery accepted by rider."))
        order = db.query(Order).filter(Order.id == order_id).first()
        if order:
            add_notification(db, order.customer_id, "Rider accepted delivery", f"Your delivery partner accepted order {order.order_number}.", target_role="customer", order_number=order.order_number)
        db.commit()
    return {"order_id": order_id, "accepted_at": delivery.accepted_at.isoformat() if delivery.accepted_at else None}


@router.patch("/orders/{order_id}/assign")
def assign_delivery_rider(order_id: int, payload: RiderAssignment, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    _require_delivery_operator(authorization)
    delivery = db.query(Delivery).filter(Delivery.order_id == order_id).first()
    order = db.query(Order).filter(Order.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status in {"Shipped", "Out for Delivery", "Delivered", "Cancelled"}:
        raise HTTPException(status_code=409, detail="A rider cannot be reassigned after pickup has started")

    rider = None
    if payload.rider_id is not None:
        rider = db.query(User).filter(User.id == payload.rider_id, User.role == "rider", User.is_active.is_(True), User.is_verified.is_(True)).first()
        if rider is None:
            raise HTTPException(status_code=404, detail="Active rider not found")

    if delivery is None:
        delivery = Delivery(
            order_id=order.id,
            rider_id=rider.id if rider else None,
            drop_address=order.shipping_address,
            status="Ready for Pickup" if order.status == "Ready for Pickup" else ("Assigned" if rider else "Unassigned"),
        )
        db.add(delivery)
    else:
        if delivery.rider_id != (rider.id if rider else None):
            delivery.accepted_at = None
        delivery.rider_id = rider.id if rider else None
        delivery.status = "Ready for Pickup" if order.status == "Ready for Pickup" else ("Assigned" if rider else "Unassigned")

    db.add(OrderEvent(
        order_id=order.id,
        actor_role="admin",
        status=delivery.status,
        note=f"Assigned rider {rider.full_name if rider else 'None'}",
    ))

    if rider:
        add_notification(db, rider.id, "Delivery assigned", f"You were assigned order {order.order_number}. Review and accept it in your rider dashboard.", target_role="delivery", order_number=order.order_number)
    add_notification(db, order.customer_id, "Rider assignment updated", f"A rider was {'assigned' if rider else 'unassigned'} for order {order.order_number}.", target_role="customer", order_number=order.order_number)

    db.commit()
    return {"order_id": order.id, "rider_id": delivery.rider_id, "assigned_rider": rider.full_name if rider else None}


def _complete_delivery(order: Order, delivery: Delivery, otp: str, db: Session):
    if str(otp).strip() != str(order.delivery_otp).strip():
        raise HTTPException(status_code=400, detail="Invalid customer OTP. Verification failed.")
    if order.status != "Out for Delivery":
        raise HTTPException(status_code=409, detail="Order must be Out for Delivery before OTP verification")

    now = datetime.now(timezone.utc)
    order.status = "Delivered"
    order.delivered_at = now
    delivery.status = "Delivered"
    delivery.otp_verified = True
    delivery.delivered_at = now
    order.rider_fee = delivery.rider_fee

    # If COD, update payment status
    if order.payment_method == "COD":
        payment = db.query(Payment).filter(Payment.order_id == order.id).first()
        if payment:
            payment.status = "Completed"
            payment.paid_at = now

    # Update vendor orders status
    for vo in order.vendor_orders:
        vo.status = "Delivered"

    # Log order event
    db.add(OrderEvent(
        order_id=order.id,
        actor_role="rider",
        status="Delivered",
        note="Customer 4-digit OTP verified. Delivery completed.",
    ))


@router.patch("/orders/{order_id}/status")
def update_delivery_status(order_id: int, payload: StatusUpdate, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    delivery = db.query(Delivery).filter(Delivery.order_id == order_id).first()
    if delivery is None:
        delivery = Delivery(
            order_id=order.id,
            drop_address=order.shipping_address,
            status="Assigned",
        )
        db.add(delivery)
        db.flush()
    actor_id = _require_assigned_rider(order_id, authorization, db)
    if delivery.rider_id == actor_id and delivery.accepted_at is None:
        raise HTTPException(status_code=409, detail="Accept this delivery before updating its status")

    new_status = "Shipped" if payload.status == "Picked Up" else payload.status
    if new_status not in STATUS_TRANSITIONS.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Order cannot move from {order.status} to {new_status}")
    if new_status == "Delivered":
        if not payload.otp or len(payload.otp) != 4 or not payload.otp.isdigit():
            raise HTTPException(status_code=422, detail="Exact customer OTP is required to mark Delivered")
        _complete_delivery(order, delivery, payload.otp, db)
    else:
        delivery.status = new_status
        order.status = new_status
        db.add(OrderEvent(
            order_id=order.id,
            actor_role="rider",
            status=new_status,
            note=f"Status changed to {new_status}",
        ))

    if new_status == "Shipped":
        for vendor_order in order.vendor_orders:
            vendor_order.status = "Shipped"
            add_notification(db, vendor_order.vendor_id, "Order picked up", f"The rider picked up order {order.order_number}.", target_role="vendor", order_number=order.order_number)
        add_notification(db, order.customer_id, "Order shipped", f"Rider picked up order {order.order_number}.", target_role="customer", order_number=order.order_number)
        notify_role(db, "admin", "Order shipped", f"Rider picked up order {order.order_number}.", order.order_number)
    elif new_status == "Out for Delivery":
        for vendor_order in order.vendor_orders:
            vendor_order.status = "Out for Delivery"
        add_notification(db, order.customer_id, "Out for delivery", f"Order {order.order_number} is out for delivery — keep your 4-digit OTP ready.", target_role="customer", order_number=order.order_number)
    else:
        add_notification(db, order.customer_id, "Order delivered", f"Order {order.order_number} delivered & OTP verified.", target_role="customer", order_number=order.order_number)
        for vendor_order in order.vendor_orders:
            add_notification(db, vendor_order.vendor_id, "Order delivered", f"Order {order.order_number} delivered & OTP verified.", target_role="vendor", order_number=order.order_number)
        notify_role(db, "admin", "Order delivered", f"Order {order.order_number} delivered & OTP verified.", order.order_number)

    db.commit()
    db.refresh(delivery)
    db.refresh(order)
    return {"message": f"Order updated to {delivery.status}", "status": delivery.status, "delivered_at": delivery.delivered_at}


@router.post("/orders/{order_id}/verify-otp")
def verify_delivery_otp(order_id: int, payload: OtpVerifyRequest, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    delivery = db.query(Delivery).filter(Delivery.order_id == order_id).first()
    if delivery is None:
        raise HTTPException(status_code=404, detail="Delivery record not found")
    actor_id = _require_assigned_rider(order_id, authorization, db)
    if delivery.rider_id == actor_id and delivery.accepted_at is None:
        raise HTTPException(status_code=409, detail="Accept this delivery before completing it")

    _complete_delivery(order, delivery, payload.otp, db)
    add_notification(db, order.customer_id, "Order delivered", f"Order {order.order_number} delivered & OTP verified.", target_role="customer", order_number=order.order_number)
    for vendor_order in order.vendor_orders:
        add_notification(db, vendor_order.vendor_id, "Order delivered", f"Order {order.order_number} delivered & OTP verified.", target_role="vendor", order_number=order.order_number)
    notify_role(db, "admin", "Order delivered", f"Order {order.order_number} delivered & OTP verified.", order.order_number)
    db.commit()
    db.refresh(delivery)
    return {"message": "OTP verified and delivery completed", "status": delivery.status, "delivered_at": delivery.delivered_at}


@router.post("/orders/{order_id}/incident", status_code=status.HTTP_201_CREATED)
def record_delivery_incident(order_id: int, payload: IncidentCreate, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    db.add(OrderEvent(
        order_id=order.id,
        actor_role="rider",
        status="Incident",
        note=f"Incident recorded: {payload.reason} — {payload.details or ''}",
    ))
    notify_role(db, "delivery", "Delivery exception recorded", f"An exception was recorded for order {order.order_number}: {payload.reason}.")
    notify_role(db, "admin", "Delivery exception recorded", f"An exception was recorded for order {order.order_number}: {payload.reason}.")
    db.commit()
    return {"message": "Delivery incident recorded in order timeline"}


@router.get("/incidents")
def list_delivery_incidents(db: Session = Depends(get_db)):
    events = (
        db.query(OrderEvent, Order)
        .join(Order, Order.id == OrderEvent.order_id)
        .filter(OrderEvent.status == "Incident")
        .order_by(OrderEvent.created_at.desc())
        .all()
    )
    return [
        {
            "id": e.id,
            "order_id": o.id,
            "order_number": o.order_number,
            "reason": e.note,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e, o in events
    ]


@router.get("/wallet/{rider_id}")
def get_rider_wallet(rider_id: int, db: Session = Depends(get_db)):
    rider = db.query(User).filter(User.id == rider_id, User.role == "rider").first()
    if rider is None:
        raise HTTPException(status_code=404, detail="Rider not found")

    # Completed deliveries directly from deliveries table
    completed_deliveries = (
        db.query(Delivery, Order)
        .join(Order, Order.id == Delivery.order_id)
        .filter(Delivery.rider_id == rider_id, Delivery.status == "Delivered")
        .all()
    )
    earned = sum(float(d.rider_fee) for d, _ in completed_deliveries)

    # Active deliveries assigned
    active_deliveries = (
        db.query(Delivery, Order)
        .join(Order, Order.id == Delivery.order_id)
        .filter(Delivery.rider_id == rider_id, Delivery.status != "Delivered", Delivery.status != "Cancelled")
        .all()
    )

    cod_collected = sum(float(o.total_amount) for d, o in completed_deliveries if o.payment_method == "COD")
    cod_pending = sum(float(o.total_amount) for d, o in active_deliveries if o.payment_method == "COD")
    upi_delivered_value = sum(float(o.total_amount) for d, o in completed_deliveries if o.payment_method in {"UPI", "CARD"} or str(o.payment_method).startswith("RAZORPAY_"))

    return {
        "rider_id": rider.id,
        "rider_name": rider.full_name,
        "earned": earned,
        "withdrawn": 0.0,
        "available_payout": earned,
        "cod_collected": cod_collected,
        "cod_pending": cod_pending,
        "upi_delivered_order_value": upi_delivered_value,
        "completed_drops": len(completed_deliveries),
        "payouts": [],
    }


@router.post("/wallet/{rider_id}/withdraw", status_code=status.HTTP_201_CREATED)
def withdraw_rider_earnings(rider_id: int, payload: PayoutRequest, db: Session = Depends(get_db)):
    return {
        "id": 1,
        "amount": payload.amount or 0.0,
        "status": "Processed",
        "method": "UPI",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/riders")
def list_riders(db: Session = Depends(get_db)):
    riders = db.query(User).filter(User.role == "rider", User.is_active.is_(True), User.is_verified.is_(True)).order_by(User.full_name.asc()).all()
    return [{"id": r.id, "name": r.full_name, "email": r.email, "phone": r.phone} for r in riders]


@router.get("/rider-applications")
def list_rider_applications(authorization: str = Header(default=""), db: Session = Depends(get_db)):
    _require_admin_id(authorization)
    rows = db.query(DeliveryPartnerApplication, User).join(
        User, User.id == DeliveryPartnerApplication.user_id
    ).order_by(DeliveryPartnerApplication.created_at.desc()).all()
    return [{
        "id": application.id,
        "user_id": rider.id,
        "name": rider.full_name,
        "email": rider.email,
        "phone": rider.phone,
        "status": application.status,
        "applied_at": application.created_at.isoformat() if application.created_at else None,
    } for application, rider in rows]


@router.patch("/rider-applications/{application_id}/status")
def update_rider_application(application_id: int, payload: RiderApplicationStatus, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    if payload.status not in {"Approved", "Rejected"}:
        raise HTTPException(status_code=422, detail="Status must be Approved or Rejected")
    admin_id = _require_admin_id(authorization)

    application = db.query(DeliveryPartnerApplication).filter(DeliveryPartnerApplication.id == application_id).first()
    if application is None:
        raise HTTPException(status_code=404, detail="Delivery partner application not found")
    rider = db.query(User).filter(User.id == application.user_id, User.role == "rider").first()
    if rider is None:
        raise HTTPException(status_code=404, detail="Delivery partner account not found")

    application.status = payload.status
    application.reviewed_at = datetime.now(timezone.utc)
    application.reviewed_by = admin_id
    rider.is_active = payload.status == "Approved"
    rider.is_verified = payload.status == "Approved"
    add_notification(
        db,
        rider.id,
        "Delivery partner application updated",
        "Your application was approved. You can now sign in." if payload.status == "Approved" else "Your delivery partner application was not approved.",
        target_role="delivery",
    )
    db.add(AuditLog(actor_id=admin_id, action=f"RIDER_APPLICATION_{payload.status.upper()}", entity_type="Delivery Partner", entity_id=rider.id))
    db.commit()
    return {"id": application.id, "user_id": rider.id, "status": application.status}


