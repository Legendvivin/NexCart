from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.order import Order
from app.models.vendor_order import VendorOrder
from app.models.order_item import OrderItem
from app.models.product import Product
from app.models.user import User
from app.models.vendor_profile import VendorProfile
from app.models.audit_log import AuditLog

router = APIRouter(prefix="/admin/vendors", tags=["Admin Vendors"])


class VendorStatusUpdate(BaseModel):
    status: str  # Active, Suspended


class VendorKycUpdate(BaseModel):
    kyc_status: str  # Approved, Pending, Rejected


@router.get("")
def list_vendors(db: Session = Depends(get_db)):
    vendors = db.query(User).filter(User.role == "vendor").order_by(User.created_at.desc()).all()
    result = []
    for vendor in vendors:
        v_profile = db.query(VendorProfile).filter(VendorProfile.user_id == vendor.id).first()
        product_count = db.query(func.count(Product.id)).filter(Product.vendor_id == vendor.id).scalar()
        revenue = (
            db.query(func.coalesce(func.sum(VendorOrder.subtotal), 0.0))
            .join(Order, Order.id == VendorOrder.order_id)
            .filter(VendorOrder.vendor_id == vendor.id, Order.status != "Cancelled")
            .scalar()
        )
        commission = (
            db.query(func.coalesce(func.sum(VendorOrder.commission_amount), 0.0))
            .join(Order, Order.id == VendorOrder.order_id)
            .filter(VendorOrder.vendor_id == vendor.id, Order.status != "Cancelled")
            .scalar()
        )

        state = "Suspended" if not vendor.is_active else "Active"
        store_title = (v_profile.store_name if v_profile else None) or vendor.store_name or vendor.full_name
        result.append({
            "id": vendor.id,
            "store_name": store_title,
            "owner": vendor.full_name,
            "email": vendor.email,
            "phone": vendor.phone,
            "products": int(product_count or 0),
            "revenue": float(revenue or 0),
            "commission": float(commission or 0),
            "status": state,
            "kyc_status": v_profile.kyc_status if v_profile else "Approved",
            "gst_number": v_profile.gst_number if v_profile else "—",
            "bank_account": v_profile.bank_account if v_profile else "—",
            "commission_rate": v_profile.commission_rate if v_profile else 10.0,
            "rating": v_profile.rating if v_profile else 5.0,
        })
    return result


@router.patch("/{vendor_id}/status")
def update_vendor_status(vendor_id: int, payload: VendorStatusUpdate, db: Session = Depends(get_db)):
    vendor = db.query(User).filter(User.id == vendor_id, User.role == "vendor").first()
    if vendor is None:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if payload.status not in {"Active", "Suspended"}:
        raise HTTPException(status_code=422, detail="Status must be Active or Suspended")

    vendor.is_active = payload.status == "Active"

    admin_user = db.query(User).filter(User.role == "admin").first()
    db.add(AuditLog(
        actor_id=admin_user.id if admin_user else None,
        action=f"VENDOR_STATUS_{payload.status.upper()}",
        entity_type="Vendor",
        entity_id=vendor.id,
    ))

    db.commit()
    return {"id": vendor.id, "status": "Active" if vendor.is_active else "Suspended"}


@router.patch("/{vendor_id}/kyc")
def update_vendor_kyc(vendor_id: int, payload: VendorKycUpdate, db: Session = Depends(get_db)):
    vendor = db.query(User).filter(User.id == vendor_id, User.role == "vendor").first()
    if vendor is None:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if payload.kyc_status not in {"Approved", "Pending", "Rejected"}:
        raise HTTPException(status_code=422, detail="KYC status must be Approved, Pending, or Rejected")

    v_profile = db.query(VendorProfile).filter(VendorProfile.user_id == vendor.id).first()
    if v_profile is None:
        v_profile = VendorProfile(
            user_id=vendor.id,
            store_name=vendor.store_name or vendor.full_name,
            kyc_status=payload.kyc_status,
        )
        db.add(v_profile)
    else:
        v_profile.kyc_status = payload.kyc_status

    admin_user = db.query(User).filter(User.role == "admin").first()
    db.add(AuditLog(
        actor_id=admin_user.id if admin_user else None,
        action=f"VENDOR_KYC_{payload.kyc_status.upper()}",
        entity_type="Vendor",
        entity_id=vendor.id,
    ))

    db.commit()
    return {"id": vendor.id, "kyc_status": v_profile.kyc_status}
