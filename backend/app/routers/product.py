from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.product import Product
from app.models.product_image import ProductImage
from app.models.inventory import Inventory
from app.models.user import User
from app.models.vendor_profile import VendorProfile
from app.models.categories import Category
from app.models.audit_log import AuditLog
from app.services.notifications import add_notification
from jose import JWTError, jwt
from app.routers.admin_auth import SECRET_KEY, ALGORITHM

router = APIRouter(prefix="/admin/products", tags=["Admin Products"])


class ProductStatusUpdate(BaseModel):
    status: str  # Approved, Rejected, Pending


class ProductTermsUpdate(BaseModel):
    emi_offer: str = Field(default="", max_length=1000)
    special_offer: str = Field(default="", max_length=1000)
    replacement_policy: str = Field(default="", max_length=2000)
    coupon_code: str = Field(default="", max_length=32)
    coupon_percent: float = Field(default=0, ge=0, le=99)


def require_admin(authorization: str):
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in as an admin to manage product terms")
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if claims.get("role") != "admin":
            raise ValueError("Not an admin")
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Admin session is invalid. Please sign in again.")


@router.get("/")
def list_all_products(db: Session = Depends(get_db)):
    products = db.query(Product).order_by(Product.id.desc()).all()
    result = []
    for p in products:
        vendor_user = db.query(User).filter(User.id == p.vendor_id).first()
        v_profile = db.query(VendorProfile).filter(VendorProfile.user_id == p.vendor_id).first() if vendor_user else None
        category = db.query(Category).filter(Category.id == p.category_id).first()
        inv = db.query(Inventory).filter(Inventory.product_id == p.id).first()
        img = db.query(ProductImage).filter(ProductImage.product_id == p.id, ProductImage.is_primary.is_(True)).first()
        if not img:
            img = db.query(ProductImage).filter(ProductImage.product_id == p.id).first()

        vendor_name = (v_profile.store_name if v_profile else None) or (vendor_user.store_name or vendor_user.full_name if vendor_user else "Unknown")
        result.append({
            "id": p.id,
            "code": f"PRD-{p.id:02d}",
            "name": p.name,
            "description": p.description or "",
            "vendor": vendor_name,
            "vendor_id": p.vendor_id,
            "category": category.name if category else "Uncategorized",
            "category_id": p.category_id,
            "price": float(p.price),
            "discount_price": float(p.discount_price) if p.discount_price else None,
            "stock": inv.stock_qty if inv else 0,
            "image_url": img.image_url if img else None,
            "status": p.status,
            "admin_terms": p.admin_terms or {},
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })
    return result


@router.put("/{product_id}/terms")
def update_product_terms(product_id: int, payload: ProductTermsUpdate, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    require_admin(authorization)
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    product.admin_terms = {**payload.dict(), "coupon_code": payload.coupon_code.strip().upper()}
    db.commit()
    return {"id": product.id, "admin_terms": product.admin_terms}


@router.patch("/{product_id}/status")
def set_product_status(product_id: int, payload: ProductStatusUpdate, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    if payload.status not in {"Approved", "Rejected", "Pending"}:
        raise HTTPException(status_code=422, detail="Invalid status. Must be Approved, Rejected, or Pending")

    prev_status = product.status
    product.status = payload.status
    if prev_status != payload.status:
        add_notification(
            db, product.vendor_id, "Product review updated",
            f"Admin changed {product.name} from {prev_status} to {payload.status}.",
            target_role="vendor",
        )

    # Record in audit_logs
    admin_user = db.query(User).filter(User.role == "admin").first()
    db.add(AuditLog(
        actor_id=admin_user.id if admin_user else None,
        action=f"PRODUCT_{payload.status.upper()}",
        entity_type="Product",
        entity_id=product.id,
    ))

    db.commit()
    db.refresh(product)
    return {"id": product.id, "status": product.status, "previous_status": prev_status}


@router.patch("/{product_id}/toggle-status")
def toggle_product_status(product_id: int, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    previous_status = product.status
    next_status = "Approved" if str(product.status) != "Approved" else "Pending"
    product.status = next_status
    add_notification(
        db, product.vendor_id, "Product listing updated",
        f"Admin changed {product.name} from {previous_status} to {next_status}.",
        target_role="vendor",
    )

    admin_user = db.query(User).filter(User.role == "admin").first()
    db.add(AuditLog(
        actor_id=admin_user.id if admin_user else None,
        action=f"PRODUCT_TOGGLED_{next_status.upper()}",
        entity_type="Product",
        entity_id=product.id,
    ))

    db.commit()
    db.refresh(product)
    return {"id": product.id, "status": product.status}


@router.delete("/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    add_notification(
        db, product.vendor_id, "Product listing removed",
        f"Admin removed {product.name} from the marketplace.",
        target_role="vendor",
    )

    admin_user = db.query(User).filter(User.role == "admin").first()
    db.add(AuditLog(
        actor_id=admin_user.id if admin_user else None,
        action="PRODUCT_DELETED",
        entity_type="Product",
        entity_id=product.id,
    ))

    db.delete(product)
    db.commit()
    return {"message": "Product deleted"}
