import uuid
import secrets
import os
import json
import hmac
import hashlib
import base64
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session
from sqlalchemy import func
from passlib.context import CryptContext
from jose import JWTError, jwt

from app.core.database import get_db
from app.models.user import User
from app.models.vendor_profile import VendorProfile
from app.models.address import Address
from app.models.categories import Category
from app.models.product import Product
from app.models.product_image import ProductImage
from app.models.inventory import Inventory
from app.models.cart_item import CartItem
from app.models.wishlist_item import WishlistItem
from app.models.order import Order
from app.models.vendor_order import VendorOrder
from app.models.order_item import OrderItem
from app.models.payment import Payment
from app.models.razorpay_checkout import RazorpayCheckout
from app.models.delivery import Delivery
from app.models.order_event import OrderEvent
from app.models.review import Review
from app.models.system_setting import SystemSetting
from app.services.notifications import add_notification, notify_role
from app.services.product_options import validate_product_options, selected_variant_image, selected_variant_price, find_variant_configuration
from app.schemas.auth import LoginRequest
from app.routers.admin_auth import create_access_token, SECRET_KEY, ALGORITHM

router = APIRouter(prefix="/store", tags=["Customer Storefront"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class CustomerRegister(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    phone: str = ""


class CustomerProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(default="", max_length=30)


class CartCheckoutItem(BaseModel):
    product_id: int
    quantity: int = Field(ge=1)
    variant_options: dict[str, str] = Field(default_factory=dict)


class AddressCreate(BaseModel):
    label: str = "Home"
    street: str
    city: str
    state: str
    pincode: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    is_default: bool = False


class CheckoutRequest(BaseModel):
    customer_id: int
    shipping_address: str = Field(min_length=10, max_length=500)
    address_id: Optional[int] = None
    payment_method: str = "COD"
    items: List[CartCheckoutItem]
    coupon_code: str = ""


class RazorpayOrderRequest(BaseModel):
    shipping_address: str = Field(min_length=10, max_length=500)
    items: List[CartCheckoutItem]
    coupon_code: str = ""


class RazorpayVerifyRequest(BaseModel):
    checkout_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = Field(default=None, max_length=1200)


class OrderAddressUpdate(BaseModel):
    shipping_address: str = Field(min_length=5, max_length=500)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)


def _customer_id_from_token(authorization: str, db: Session) -> int:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in as a customer to manage your order")
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        customer_id = int(claims.get("user_id", 0))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Your session expired. Please sign in again.")
    customer = db.query(User).filter(User.id == customer_id, User.role == "customer", User.is_active.is_(True)).first()
    if customer is None:
        raise HTTPException(status_code=403, detail="Customer account is not active")
    return customer_id


@router.post("/register")
def register_customer(payload: CustomerRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    customer = User(
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone.strip() or None,
        hashed_password=pwd_context.hash(payload.password),
        role="customer",
        is_active=True,
        is_verified=True,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    add_notification(db, customer.id, "Welcome to NexCart", "Your account is ready. We'll keep important updates here.")
    db.commit()

    token = create_access_token({"sub": customer.email, "role": "customer", "user_id": customer.id})
    return {"access_token": token, "customer_id": customer.id, "full_name": customer.full_name, "email": customer.email}


@router.post("/login")
def customer_login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or str(user.role) != "customer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid customer credentials")
    if not pwd_context.verify(payload.password, str(user.hashed_password)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password")

    token = create_access_token({"sub": user.email, "role": "customer", "user_id": user.id})
    return {"access_token": token, "customer_id": user.id, "full_name": str(user.full_name), "email": user.email}


@router.get("/categories")
def list_store_categories(db: Session = Depends(get_db)):
    cats = db.query(Category).filter(Category.is_active.is_(True)).order_by(Category.name.asc()).all()
    return [{"id": c.id, "name": c.name, "slug": c.slug, "specifications": c.specifications or []} for c in cats]


@router.get("/profile")
def get_customer_profile(authorization: str = Header(default=""), db: Session = Depends(get_db)):
    customer_id = _customer_id_from_token(authorization, db)
    customer = db.query(User).filter(User.id == customer_id).first()
    return {"id": customer.id, "full_name": customer.full_name, "email": customer.email, "phone": customer.phone or ""}


@router.put("/profile")
def update_customer_profile(payload: CustomerProfileUpdate, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    customer_id = _customer_id_from_token(authorization, db)
    customer = db.query(User).filter(User.id == customer_id).first()
    full_name = payload.full_name.strip()
    if len(full_name) < 2:
        raise HTTPException(status_code=422, detail="Name must contain at least 2 characters")
    customer.full_name = full_name
    customer.phone = payload.phone.strip() or None
    db.commit()
    return {"id": customer.id, "full_name": customer.full_name, "email": customer.email, "phone": customer.phone or ""}


@router.get("/products")
def list_approved_products(db: Session = Depends(get_db)):
    products = (
        db.query(Product)
        .filter(Product.status == "Approved")
        .order_by(Product.id.desc())
        .all()
    )

    result = []
    for p in products:
        cat = db.query(Category).filter(Category.id == p.category_id).first()
        vendor_user = db.query(User).filter(User.id == p.vendor_id).first()
        v_profile = db.query(VendorProfile).filter(VendorProfile.user_id == p.vendor_id).first() if vendor_user else None

        img = db.query(ProductImage).filter(ProductImage.product_id == p.id, ProductImage.is_primary.is_(True)).first()
        if not img:
            img = db.query(ProductImage).filter(ProductImage.product_id == p.id).first()

        inv = db.query(Inventory).filter(Inventory.product_id == p.id).first()
        stock = inv.stock_qty if inv else 0

        # Reviews summary
        review_stats = (
            db.query(func.coalesce(func.avg(Review.rating), 5.0), func.count(Review.id))
            .filter(Review.product_id == p.id)
            .first()
        )
        avg_rating = round(float(review_stats[0] or 5.0), 1)
        review_count = int(review_stats[1] or 0)

        result.append({
            "id": p.id,
            "name": p.name,
            "description": p.description or "",
            "brand": p.brand,
            "sku": p.sku,
            "specifications": p.specifications or {},
            "variant_images": p.variant_images or {},
            "variant_configurations": p.variant_configurations or [],
            "highlights": p.highlights or [],
            "admin_terms": p.admin_terms or {},
            "gallery_images": [image.image_url for image in p.images],
            "price": float(p.price),
            "discount_price": float(p.discount_price) if p.discount_price else None,
            "stock": stock,
            "category": cat.name if cat else "Uncategorized",
            "category_id": p.category_id,
            "image_url": img.image_url if img else None,
            "vendor_id": p.vendor_id,
            "vendor": v_profile.store_name if v_profile else (vendor_user.store_name or vendor_user.full_name if vendor_user else "NexCart Seller"),
            "vendor_rating": v_profile.rating if v_profile else 5.0,
            "rating": avg_rating,
            "review_count": review_count,
        })
    return result


@router.get("/addresses/{customer_id}")
def get_customer_addresses(customer_id: int, db: Session = Depends(get_db)):
    addresses = db.query(Address).filter(Address.user_id == customer_id).order_by(Address.is_default.desc(), Address.id.desc()).all()
    return [
        {
            "id": a.id,
            "label": a.label,
            "street": a.street,
            "city": a.city,
            "state": a.state,
            "pincode": a.pincode,
            "lat": a.lat,
            "lng": a.lng,
            "is_default": a.is_default,
        }
        for a in addresses
    ]


@router.post("/addresses/{customer_id}")
def add_customer_address(customer_id: int, payload: AddressCreate, db: Session = Depends(get_db)):
    if payload.is_default:
        db.query(Address).filter(Address.user_id == customer_id).update({"is_default": False})

    addr = Address(
        user_id=customer_id,
        label=payload.label,
        street=payload.street.strip(),
        city=payload.city.strip(),
        state=payload.state.strip(),
        pincode=payload.pincode.strip(),
        lat=payload.lat,
        lng=payload.lng,
        is_default=payload.is_default,
    )
    db.add(addr)
    db.commit()
    db.refresh(addr)
    return {"id": addr.id, "message": "Address added successfully"}


@router.get("/wishlist/{customer_id}")
def get_wishlist(customer_id: int, db: Session = Depends(get_db)):
    items = (
        db.query(WishlistItem, Product)
        .join(Product, Product.id == WishlistItem.product_id)
        .filter(WishlistItem.user_id == customer_id)
        .order_by(WishlistItem.created_at.desc())
        .all()
    )
    result = []
    for w, p in items:
        inv = db.query(Inventory).filter(Inventory.product_id == p.id).first()
        img = db.query(ProductImage).filter(ProductImage.product_id == p.id).first()
        result.append({
            "id": p.id,
            "wishlist_id": w.id,
            "name": p.name,
            "price": float(p.price),
            "stock": inv.stock_qty if inv else 0,
            "image_url": img.image_url if img else None,
        })
    return result


@router.post("/wishlist/{customer_id}/{product_id}")
def toggle_wishlist(customer_id: int, product_id: int, db: Session = Depends(get_db)):
    existing = db.query(WishlistItem).filter(WishlistItem.user_id == customer_id, WishlistItem.product_id == product_id).first()
    if existing:
        db.delete(existing)
        db.commit()
        return {"action": "removed", "message": "Removed from wishlist"}

    db.add(WishlistItem(user_id=customer_id, product_id=product_id))
    db.commit()
    return {"action": "added", "message": "Added to wishlist"}


def _place_order(payload: CheckoutRequest, db: Session, payment_method_override: Optional[str] = None, transaction_ref_override: Optional[str] = None, locked_items: Optional[list] = None):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    payment_method = (payment_method_override or payload.payment_method).strip().upper()
    if payment_method not in {"COD", "RAZORPAY_UPI", "RAZORPAY_CARD", "RAZORPAY_EMI", "RAZORPAY_NETBANKING", "RAZORPAY_WALLET", "RAZORPAY_PAYLATER"}:
        raise HTTPException(status_code=422, detail="Unsupported payment method")

    customer = db.query(User).filter(User.id == payload.customer_id).first()
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")

    # 1. Validate all items and stock
    vendor_buckets = {}  # vendor_id: list of (product, qty, subtotal)
    total_amount = 0.0
    coupon_code = payload.coupon_code.strip().upper()
    coupon_matched = bool(coupon_code and locked_items)

    for item_index, item in enumerate(payload.items):
        product = db.query(Product).filter(Product.id == item.product_id, Product.status == "Approved").first()
        if product is None:
            raise HTTPException(status_code=400, detail=f"Product ID {item.product_id} is unavailable")

        try:
            validate_product_options(product.specifications, item.variant_options, product.variant_configurations)
            if product.variant_configurations and not find_variant_configuration(product.variant_configurations, item.variant_options):
                raise ValueError("This product combination is unavailable")
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

        inv = db.query(Inventory).filter(Inventory.product_id == product.id).with_for_update().first()
        if inv is None or inv.stock_qty < item.quantity:
            available = inv.stock_qty if inv else 0
            raise HTTPException(status_code=400, detail=f"Insufficient stock for {product.name} (available: {available})")

        fallback_price = float(product.discount_price if product.discount_price else product.price)
        unit_price = locked_items[item_index]["unit_price"] if locked_items else selected_variant_price(product.variant_configurations, item.variant_options, fallback_price)
        product_terms = product.admin_terms or {}
        if coupon_code and product_terms.get("coupon_code", "").strip().upper() == coupon_code:
            coupon_percent = max(0.0, min(99.0, float(product_terms.get("coupon_percent") or 0)))
            if coupon_percent > 0:
                coupon_matched = True
                if not locked_items:
                    unit_price = round(unit_price * (1 - coupon_percent / 100), 2)
        subtotal = unit_price * item.quantity
        total_amount += subtotal

        vendor_id = product.vendor_id
        if vendor_id not in vendor_buckets:
            vendor_buckets[vendor_id] = []
        vendor_buckets[vendor_id].append((product, item.quantity, unit_price, inv, item.variant_options))

    if coupon_code and not coupon_matched:
        raise HTTPException(status_code=422, detail="This coupon is invalid or does not apply to items in your bag")

    order_num = f"#NX-{uuid.uuid4().hex[:6].upper()}"
    otp_code = f"{secrets.randbelow(10000):04d}"

    # Determine the delivery fee; operations assigns an approved rider later.
    rider_fee_setting = db.query(SystemSetting).filter(SystemSetting.key == "base_rider_fee").first()
    rider_fee = float(rider_fee_setting.value) if rider_fee_setting else 65.0
    # Create Order
    new_order = Order(
        order_number=order_num,
        customer_id=payload.customer_id,
        address_id=payload.address_id,
        shipping_address=payload.shipping_address,
        total_amount=total_amount,
        payment_method=payment_method,
        status="Processing",
        delivery_otp=otp_code,
        rider_fee=rider_fee,
    )
    db.add(new_order)
    db.flush()

    # Create VendorOrders and OrderItems
    for v_id, items_list in vendor_buckets.items():
        v_profile = db.query(VendorProfile).filter(VendorProfile.user_id == v_id).first()
        comm_rate = v_profile.commission_rate if v_profile else 10.0
        v_subtotal = sum(unit_price * qty for _, qty, unit_price, _, _ in items_list)
        v_commission = round(v_subtotal * (comm_rate / 100.0), 2)

        v_order = VendorOrder(
            order_id=new_order.id,
            vendor_id=v_id,
            subtotal=v_subtotal,
            commission_amount=v_commission,
            payout_status="Pending",
            status="Processing",
        )
        db.add(v_order)
        db.flush()

        for product, qty, unit_price, inv, variant_options in items_list:
            db.add(OrderItem(
                vendor_order_id=v_order.id,
                product_id=product.id,
                quantity=qty,
                unit_price=unit_price,
                variant_options=variant_options,
            ))
            # Deduct stock
            inv.stock_qty -= qty

    # Create Payment
    txn_ref = transaction_ref_override or f"TXN-{uuid.uuid4().hex[:10].upper()}"
    payment_status = "Pending" if payment_method == "COD" else "Completed"
    db.add(Payment(
        order_id=new_order.id,
        transaction_ref=txn_ref,
        method=payment_method,
        amount=total_amount,
        status=payment_status,
        paid_at=datetime.now(timezone.utc) if payment_status == "Completed" else None,
    ))

    # Create Delivery
    db.add(Delivery(
        order_id=new_order.id,
        rider_id=None,
        pickup_hub="NexCart Central Hub",
        drop_address=payload.shipping_address,
        rider_fee=rider_fee,
        status="Unassigned",
        otp_verified=False,
    ))

    # Create OrderEvent
    db.add(OrderEvent(
        order_id=new_order.id,
        actor_role="customer",
        status="Processing",
        note="Order placed by customer via Storefront checkout",
    ))

    add_notification(db, customer.id, "Order confirmed", f"Order {order_num} confirmed! Your Delivery OTP is {otp_code}.", target_role="customer", order_number=order_num)
    notify_role(db, "admin", "New marketplace order", f"New order {order_num} placed — GMV updated.", order_num)
    notify_role(db, "delivery", "Order ready for dispatch", f"New Dispatch {order_num} ready for route assignment.", order_num)
    for vendor_id in vendor_buckets:
        add_notification(db, vendor_id, "New order", f"New Order {order_num} received — pack items.", target_role="vendor", order_number=order_num)

    # Clear user's cart_items
    db.query(CartItem).filter(CartItem.user_id == customer.id).delete(synchronize_session=False)

    db.commit()
    db.refresh(new_order)

    return {
        "message": "Order placed successfully!",
        "order_number": order_num,
        "total_amount": total_amount,
        "delivery_otp": otp_code,
        "payment_method": payment_method,
    }


@router.post("/checkout")
def place_order(payload: CheckoutRequest, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    customer_id = _customer_id_from_token(authorization, db)
    if customer_id != payload.customer_id:
        raise HTTPException(status_code=403, detail="Customer session does not match this checkout")
    if payload.payment_method.strip().upper() != "COD":
        raise HTTPException(status_code=422, detail="Online payments must use Razorpay Checkout")
    return _place_order(payload, db, payment_method_override="COD")


def _razorpay_request(method: str, path: str, payload: Optional[dict] = None):
    key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
    key_secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    if not key_id or not key_secret:
        raise HTTPException(status_code=503, detail="Razorpay is not configured. Add the API keys to the backend environment.")
    credentials = base64.b64encode(f"{key_id}:{key_secret}".encode()).decode()
    body = json.dumps(payload).encode() if payload is not None else None
    request = Request(
        f"https://api.razorpay.com/v1/{path.lstrip('/')}",
        data=body,
        method=method,
        headers={"Authorization": f"Basic {credentials}", "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode())
    except HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise HTTPException(status_code=502, detail=f"Razorpay request failed: {detail[:400]}") from error
    except (URLError, TimeoutError) as error:
        raise HTTPException(status_code=502, detail="Could not reach Razorpay. Please try again.") from error


@router.post("/razorpay/order")
def create_razorpay_order(payload: RazorpayOrderRequest, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    customer_id = _customer_id_from_token(authorization, db)
    if not payload.items:
        raise HTTPException(status_code=400, detail="Cart is empty")
    customer = db.query(User).filter(User.id == customer_id).first()
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    total = 0.0
    base_total = 0.0
    saved_items = []
    coupon_code = payload.coupon_code.strip().upper()
    coupon_matched = False
    for item in payload.items:
        product = db.query(Product).filter(Product.id == item.product_id, Product.status == "Approved").first()
        if product is None:
            raise HTTPException(status_code=400, detail=f"Product ID {item.product_id} is unavailable")
        try:
            validate_product_options(product.specifications, item.variant_options, product.variant_configurations)
            if product.variant_configurations and not find_variant_configuration(product.variant_configurations, item.variant_options):
                raise ValueError("This product combination is unavailable")
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        inventory = db.query(Inventory).filter(Inventory.product_id == product.id).first()
        if inventory is None or inventory.stock_qty < item.quantity:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for {product.name}")
        unit_price = selected_variant_price(product.variant_configurations, item.variant_options, float(product.discount_price or product.price))
        base_total += unit_price * item.quantity
        terms = product.admin_terms or {}
        if coupon_code and terms.get("coupon_code", "").strip().upper() == coupon_code:
            coupon_percent = max(0.0, min(99.0, float(terms.get("coupon_percent") or 0)))
            if coupon_percent > 0:
                coupon_matched = True
                unit_price = round(unit_price * (1 - coupon_percent / 100), 2)
        total += unit_price * item.quantity
        saved_items.append({"product_id": item.product_id, "quantity": item.quantity, "variant_options": item.variant_options, "unit_price": unit_price})
    if coupon_code and not coupon_matched:
        raise HTTPException(status_code=422, detail="This coupon is invalid or does not apply to items in your bag")
    if total <= 0:
        raise HTTPException(status_code=422, detail="Order amount must be greater than zero")

    checkout_id = uuid.uuid4().hex
    remote_order = _razorpay_request("POST", "orders", {
        "amount": int(round(total * 100)), "currency": "INR", "receipt": checkout_id[:40],
        "notes": {"checkout_id": checkout_id, "customer_id": str(customer_id)},
    })
    checkout = RazorpayCheckout(
        checkout_id=checkout_id, customer_id=customer_id, razorpay_order_id=remote_order["id"],
        shipping_address=payload.shipping_address.strip(), items=saved_items, amount=total, status="Created",
        coupon_code=coupon_code,
    )
    db.add(checkout)
    db.commit()
    return {
        "checkout_id": checkout_id,
        "razorpay_order_id": remote_order["id"],
        "amount": remote_order["amount"],
        "discount_amount": round(base_total - total, 2),
        "currency": remote_order["currency"],
        "key_id": os.getenv("RAZORPAY_KEY_ID", "").strip(),
        "name": "NexCart",
        "description": "Marketplace order",
        "prefill": {"name": customer.full_name or "", "email": customer.email or "", "contact": customer.phone or ""},
    }


@router.post("/razorpay/verify")
def verify_razorpay_payment(payload: RazorpayVerifyRequest, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    customer_id = _customer_id_from_token(authorization, db)
    checkout = db.query(RazorpayCheckout).filter(RazorpayCheckout.checkout_id == payload.checkout_id, RazorpayCheckout.customer_id == customer_id).with_for_update().first()
    if checkout is None or checkout.razorpay_order_id != payload.razorpay_order_id:
        raise HTTPException(status_code=404, detail="Razorpay checkout session not found")
    if checkout.status == "Completed" and checkout.order_number:
        return {"order_number": checkout.order_number, "total_amount": checkout.amount, "payment_method": "RAZORPAY"}
    key_secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    if not key_secret:
        raise HTTPException(status_code=503, detail="Razorpay is not configured")
    expected = hmac.new(key_secret.encode(), f"{checkout.razorpay_order_id}|{payload.razorpay_payment_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        raise HTTPException(status_code=400, detail="Razorpay payment signature is invalid")
    payment_info = _razorpay_request("GET", f"payments/{payload.razorpay_payment_id}")
    if payment_info.get("order_id") != checkout.razorpay_order_id or int(payment_info.get("amount", 0)) != int(round(checkout.amount * 100)):
        raise HTTPException(status_code=400, detail="Razorpay payment does not match this order")
    if payment_info.get("status") != "captured":
        raise HTTPException(status_code=409, detail="Payment is not captured yet. Please check Razorpay and retry.")
    method = str(payment_info.get("method") or "payment").upper()
    payment_method = "RAZORPAY_EMI" if method == "EMI" else f"RAZORPAY_{method}"
    order_payload = CheckoutRequest(
        customer_id=customer_id, shipping_address=checkout.shipping_address, payment_method=payment_method,
        items=[CartCheckoutItem(**item) for item in checkout.items],
        coupon_code=checkout.coupon_code,
    )
    result = _place_order(order_payload, db, payment_method_override=payment_method, transaction_ref_override=payload.razorpay_payment_id, locked_items=checkout.items)
    checkout.status = "Completed"
    checkout.order_number = result["order_number"]
    db.commit()
    return result


@router.get("/orders/{customer_id}")
def get_customer_orders(customer_id: int, db: Session = Depends(get_db)):
    orders = (
        db.query(Order)
        .filter(Order.customer_id == customer_id)
        .order_by(Order.created_at.desc())
        .all()
    )

    result = []
    for o in orders:
        delivery = db.query(Delivery).filter(Delivery.order_id == o.id).first()
        rider_user = db.query(User).filter(User.id == delivery.rider_id).first() if (delivery and delivery.rider_id) else None

        events = (
            db.query(OrderEvent)
            .filter(OrderEvent.order_id == o.id)
            .order_by(OrderEvent.created_at.asc())
            .all()
        )

        # Items
        order_items = []
        for vo in o.vendor_orders:
            for item in vo.items:
                p = item.product
                img = db.query(ProductImage).filter(ProductImage.product_id == p.id).first() if p else None
                order_items.append({
                    "product_id": p.id if p else None,
                    "product_name": p.name if p else "Product",
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "subtotal": item.unit_price * item.quantity,
                    "image_url": selected_variant_image(p.variant_images, item.variant_options, p.variant_configurations) or (img.image_url if img else None),
                    "variant_options": item.variant_options or {},
                })

        result.append({
            "id": o.id,
            "order_number": o.order_number,
            "total_amount": o.total_amount,
            "status": o.status,
            "can_cancel": o.status == "Processing" and all(vendor_order.status == "Processing" for vendor_order in o.vendor_orders),
            "shipping_address": o.shipping_address,
            "delivery_lat": o.delivery_lat,
            "delivery_lng": o.delivery_lng,
            "delivery_otp": o.delivery_otp,
            "payment_method": o.payment_method,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "delivered_at": delivery.delivered_at.isoformat() if (delivery and delivery.delivered_at) else None,
            "delivery_status": delivery.status if delivery else "Pending",
            "rider_name": rider_user.full_name if rider_user else "Assigned Courier",
            "rider_phone": rider_user.phone if rider_user else None,
            "items": order_items,
            "timeline": [
                {
                    "actor_role": e.actor_role,
                    "status": e.status,
                    "note": e.note,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in events
            ],
        })
    return result


@router.patch("/orders/{order_id}/address")
def update_order_address(order_id: int, payload: OrderAddressUpdate, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    customer_id = _customer_id_from_token(authorization, db)
    order = db.query(Order).filter(Order.id == order_id, Order.customer_id == customer_id).with_for_update(of=Order).first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "Processing" or any(vendor_order.status != "Processing" for vendor_order in order.vendor_orders):
        raise HTTPException(status_code=409, detail="Delivery address can only be changed before the vendor packs the order")

    order.shipping_address = payload.shipping_address.strip()
    order.delivery_lat = payload.lat
    order.delivery_lng = payload.lng
    delivery = db.query(Delivery).filter(Delivery.order_id == order.id).first()
    if delivery:
        delivery.drop_address = order.shipping_address
    db.add(OrderEvent(order_id=order.id, actor_role="customer", status="Address Updated", note="Customer updated the delivery address and location."))
    add_notification(db, customer_id, "Delivery address updated", f"Delivery details for {order.order_number} were updated.", target_role="customer", order_number=order.order_number)
    for vendor_order in order.vendor_orders:
        add_notification(db, vendor_order.vendor_id, "Delivery address changed", f"Customer updated the delivery address for {order.order_number}.", target_role="vendor", order_number=order.order_number)
    notify_role(db, "delivery", "Delivery location updated", f"The delivery location for {order.order_number} was updated.", order.order_number)
    if delivery and delivery.rider_id:
        add_notification(db, delivery.rider_id, "Delivery location updated", f"The delivery location for {order.order_number} was updated.", target_role="delivery", order_number=order.order_number)

    db.commit()
    return {"message": "Delivery address updated", "shipping_address": order.shipping_address, "lat": order.delivery_lat, "lng": order.delivery_lng}


@router.post("/orders/{order_id}/cancel")
def cancel_customer_order(order_id: int, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    customer_id = _customer_id_from_token(authorization, db)
    order = db.query(Order).filter(Order.id == order_id, Order.customer_id == customer_id).with_for_update(of=Order).first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "Processing" or any(vendor_order.status != "Processing" for vendor_order in order.vendor_orders):
        raise HTTPException(status_code=409, detail="This order can no longer be cancelled because fulfillment has started")

    for vendor_order in order.vendor_orders:
        vendor_order.status = "Cancelled"
        for item in vendor_order.items:
            inventory = db.query(Inventory).filter(Inventory.product_id == item.product_id).with_for_update().first()
            if inventory:
                inventory.stock_qty += item.quantity
        add_notification(db, vendor_order.vendor_id, "Order cancelled", f"Customer cancelled order {order.order_number} before packing.", target_role="vendor", order_number=order.order_number)

    delivery = db.query(Delivery).filter(Delivery.order_id == order.id).first()
    if delivery:
        delivery.status = "Cancelled"
    payment = db.query(Payment).filter(Payment.order_id == order.id).first()
    if payment:
        payment.status = "Refund Pending" if payment.status == "Completed" else "Cancelled"
    order.status = "Cancelled"
    db.add(OrderEvent(order_id=order.id, actor_role="customer", status="Cancelled", note="Customer cancelled the order before fulfillment began."))
    add_notification(db, customer_id, "Order cancelled", f"Order {order.order_number} was cancelled. Stock has been returned.", target_role="customer", order_number=order.order_number)
    notify_role(db, "admin", "Order cancelled", f"Customer cancelled order {order.order_number} before fulfillment.", order.order_number)
    db.commit()
    return {"message": "Order cancelled", "status": order.status, "payment_status": payment.status if payment else None}


@router.post("/products/{product_id}/reviews")
def submit_product_review(product_id: int, payload: ReviewCreate, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    customer_id = _customer_id_from_token(authorization, db)
    purchased = db.query(OrderItem.id).join(
        VendorOrder, VendorOrder.id == OrderItem.vendor_order_id
    ).join(
        Order, Order.id == VendorOrder.order_id
    ).filter(
        Order.customer_id == customer_id,
        Order.status != "Cancelled",
        OrderItem.product_id == product_id,
    ).first()
    if not purchased:
        raise HTTPException(status_code=403, detail="You can review a product after ordering it")

    rev = db.query(Review).filter(Review.product_id == product_id, Review.user_id == customer_id).first()
    if rev is None:
        rev = Review(product_id=product_id, user_id=customer_id, rating=payload.rating)
        db.add(rev)
    rev.rating = payload.rating
    rev.comment = payload.comment.strip() if payload.comment and payload.comment.strip() else None
    db.commit()
    db.refresh(rev)
    return {"message": "Review saved", "id": rev.id, "rating": rev.rating, "comment": rev.comment or ""}


@router.get("/products/{product_id}/reviews")
def get_product_reviews(product_id: int, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    customer_id = _customer_id_from_token(authorization, db) if authorization else None
    reviews = db.query(Review).filter(Review.product_id == product_id).order_by(Review.created_at.desc()).all()
    purchased = False
    if customer_id is not None:
        purchased = db.query(OrderItem.id).join(
            VendorOrder, VendorOrder.id == OrderItem.vendor_order_id
        ).join(
            Order, Order.id == VendorOrder.order_id
        ).filter(
            Order.customer_id == customer_id,
            Order.status != "Cancelled",
            OrderItem.product_id == product_id,
        ).first() is not None

    own_review = next((review for review in reviews if review.user_id == customer_id), None) if customer_id else None
    return {
        "average_rating": round(sum(review.rating for review in reviews) / len(reviews), 1) if reviews else 0,
        "review_count": len(reviews),
        "can_review": purchased,
        "my_review": {"rating": own_review.rating, "comment": own_review.comment or ""} if own_review else None,
        "reviews": [{
            "id": review.id,
            "customer_name": review.user.full_name if review.user else "Customer",
            "rating": review.rating,
            "comment": review.comment or "",
            "created_at": review.created_at.isoformat() if review.created_at else None,
        } for review in reviews],
    }
