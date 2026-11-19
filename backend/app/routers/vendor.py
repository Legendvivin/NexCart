from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field
from passlib.context import CryptContext
from jose import JWTError, jwt

from app.core.database import get_db
from app.models.user import User
from app.models.vendor_profile import VendorProfile
from app.models.product import Product
from app.models.product_image import ProductImage
from app.models.inventory import Inventory
from app.models.categories import Category
from app.models.order import Order
from app.models.vendor_order import VendorOrder
from app.models.order_item import OrderItem
from app.models.order_event import OrderEvent
from app.models.delivery import Delivery
from app.models.review import Review
from app.schemas.auth import LoginRequest
from app.routers.admin_auth import create_access_token, SECRET_KEY, ALGORITHM
from app.services.notifications import add_notification, notify_role
from app.services.product_options import selected_variant_image

router = APIRouter(prefix="/vendor", tags=["Vendor Portal"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class ProductCreate(BaseModel):
    name: str
    description: str = ""
    price: float = Field(gt=0)
    discount_price: Optional[float] = None
    stock: int = Field(ge=0)
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    vendor_id: Optional[int] = None
    image_url: Optional[str] = None
    gallery_images: List[str] = Field(default_factory=list)
    brand: Optional[str] = None
    sku: Optional[str] = None
    cost_price: Optional[float] = None
    weight: Optional[str] = None
    low_stock_threshold: int = Field(default=5, ge=0)
    specifications: Dict[str, Any] = Field(default_factory=dict)
    variant_images: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    variant_configurations: List[Dict[str, Any]] = Field(default_factory=list)
    highlights: List[str] = Field(default_factory=list)


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = Field(default=None, gt=0)
    discount_price: Optional[float] = None
    stock: Optional[int] = Field(default=None, ge=0)
    category_name: Optional[str] = None
    brand: Optional[str] = None
    sku: Optional[str] = None
    cost_price: Optional[float] = None
    weight: Optional[str] = None
    low_stock_threshold: Optional[int] = Field(default=None, ge=0)
    specifications: Optional[Dict[str, Any]] = None
    variant_images: Optional[Dict[str, Dict[str, Any]]] = None
    variant_configurations: Optional[List[Dict[str, Any]]] = None
    highlights: Optional[List[str]] = None
    image_url: Optional[str] = None
    gallery_images: Optional[List[str]] = None


class VendorProfileUpdate(BaseModel):
    store_name: str
    store_bio: str = ""
    payout_upi_id: str = ""
    store_address: str = ""
    store_lat: Optional[float] = None
    store_lng: Optional[float] = None
    gst_number: Optional[str] = None
    bank_account: Optional[str] = None


@router.post("/login")
def vendor_login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or str(user.role) != "vendor":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid vendor credentials",
        )
    if not pwd_context.verify(payload.password, str(user.hashed_password)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password",
        )

    v_profile = db.query(VendorProfile).filter(VendorProfile.user_id == user.id).first()
    if v_profile and v_profile.kyc_status != "Approved":
        message = "Your vendor application was rejected. Contact the marketplace team." if v_profile.kyc_status == "Rejected" else "Your vendor account is awaiting admin approval. You can sign in after it is approved."
        raise HTTPException(status_code=403, detail=message)
    store_name = (v_profile.store_name if v_profile else None) or user.store_name or "NexCart Seller"

    token = create_access_token({"sub": user.email, "role": user.role, "user_id": user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "role": str(user.role),
        "full_name": str(user.full_name),
        "store_name": store_name,
        "vendor_id": user.id,
    }


@router.get("/categories")
def get_categories(db: Session = Depends(get_db)):
    cats = db.query(Category).filter(Category.is_active.is_(True)).all()
    return [{"id": c.id, "name": c.name, "slug": c.slug, "specs": c.specifications or []} for c in cats]


@router.get("/{vendor_id}/profile")
def get_vendor_profile(vendor_id: int, db: Session = Depends(get_db)):
    vendor = db.query(User).filter(User.id == vendor_id, User.role == "vendor").first()
    if vendor is None:
        raise HTTPException(status_code=404, detail="Vendor not found")

    v_profile = db.query(VendorProfile).filter(VendorProfile.user_id == vendor_id).first()

    return {
        "vendor_id": vendor.id,
        "store_name": (v_profile.store_name if v_profile else None) or vendor.store_name or "",
        "store_address": v_profile.store_address if v_profile else "",
        "store_lat": v_profile.store_lat if v_profile else None,
        "store_lng": v_profile.store_lng if v_profile else None,
        "store_bio": vendor.store_bio or "",
        "payout_upi_id": vendor.payout_upi_id or "",
        "gst_number": v_profile.gst_number if v_profile else "",
        "bank_account": v_profile.bank_account if v_profile else "",
        "commission_rate": v_profile.commission_rate if v_profile else 10.0,
        "rating": v_profile.rating if v_profile else 5.0,
        "kyc_status": v_profile.kyc_status if v_profile else "Approved",
    }


@router.put("/{vendor_id}/profile")
def update_vendor_profile(vendor_id: int, payload: VendorProfileUpdate, db: Session = Depends(get_db)):
    vendor = db.query(User).filter(User.id == vendor_id, User.role == "vendor").first()
    if vendor is None:
        raise HTTPException(status_code=404, detail="Vendor not found")

    vendor.store_name = payload.store_name.strip()
    vendor.store_bio = payload.store_bio.strip()
    vendor.payout_upi_id = payload.payout_upi_id.strip()

    v_profile = db.query(VendorProfile).filter(VendorProfile.user_id == vendor_id).first()
    if v_profile is None:
        v_profile = VendorProfile(
            user_id=vendor_id,
            store_name=payload.store_name.strip(),
            store_address=payload.store_address.strip() or None,
            store_lat=payload.store_lat,
            store_lng=payload.store_lng,
            gst_number=payload.gst_number.strip() if payload.gst_number else None,
            bank_account=payload.bank_account.strip() if payload.bank_account else None,
        )
        db.add(v_profile)
    else:
        v_profile.store_name = payload.store_name.strip()
        v_profile.store_address = payload.store_address.strip() or None
        v_profile.store_lat = payload.store_lat
        v_profile.store_lng = payload.store_lng
        if payload.gst_number is not None:
            v_profile.gst_number = payload.gst_number.strip()
        if payload.bank_account is not None:
            v_profile.bank_account = payload.bank_account.strip()

    db.commit()
    return {"message": "Vendor profile saved"}


@router.get("/{vendor_id}/products")
def get_vendor_products(vendor_id: int, db: Session = Depends(get_db)):
    products = db.query(Product).filter(Product.vendor_id == vendor_id).order_by(Product.id.desc()).all()
    result = []
    for p in products:
        cat = db.query(Category).filter(Category.id == p.category_id).first()
        inv = db.query(Inventory).filter(Inventory.product_id == p.id).first()
        img = db.query(ProductImage).filter(ProductImage.product_id == p.id, ProductImage.is_primary.is_(True)).first()
        if not img:
            img = db.query(ProductImage).filter(ProductImage.product_id == p.id).first()

        result.append({
            "id": p.id,
            "code": f"PRD-{p.id:02d}",
            "name": p.name,
            "description": p.description or "",
            "brand": p.brand,
            "sku": p.sku,
            "specifications": p.specifications or {},
            "variant_images": p.variant_images or {},
            "variant_configurations": p.variant_configurations or [],
            "highlights": p.highlights or [],
            "gallery_images": [image.image_url for image in p.images],
            "category": cat.name if cat else "General",
            "category_id": p.category_id,
            "price": float(p.price),
            "discount_price": float(p.discount_price) if p.discount_price else None,
            "cost_price": float(p.cost_price) if p.cost_price is not None else None,
            "weight": p.weight,
            "stock": inv.stock_qty if inv else 0,
            "low_stock_threshold": inv.low_stock_threshold if inv else 5,
            "status": p.status,
            "image_url": img.image_url if img else None,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })
    return result


@router.post("/products")
def add_vendor_product(payload: ProductCreate, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in as a vendor before submitting products")
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if claims.get("role") != "vendor":
            raise HTTPException(status_code=403, detail="Only vendor accounts can submit products")
        authenticated_vendor_id = int(claims.get("user_id", 0))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Your session is invalid. Please sign in again.")

    vendor = db.query(User).filter(User.id == authenticated_vendor_id, User.role == "vendor", User.is_active.is_(True)).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Active vendor account not found")

    category = db.query(Category).filter(Category.id == payload.category_id).first() if payload.category_id else None
    if category is None and payload.category_name:
        category = db.query(Category).filter(func.lower(Category.name) == payload.category_name.strip().lower(), Category.is_active.is_(True)).first()
    if category is None:
        raise HTTPException(status_code=422, detail="Choose a valid product category")

    gallery = []
    for image in [payload.image_url, *payload.gallery_images]:
        clean_image = image.strip() if image else ""
        if clean_image and clean_image not in gallery:
            gallery.append(clean_image)
    if not gallery:
        gallery.append("https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600")

    new_product = Product(
        name=payload.name.strip(),
        description=payload.description.strip(),
        price=payload.price,
        discount_price=payload.discount_price,
        category_id=category.id,
        vendor_id=vendor.id,
        brand=payload.brand.strip() if payload.brand else None,
        sku=payload.sku.strip() if payload.sku else None,
        cost_price=payload.cost_price,
        weight=payload.weight.strip() if payload.weight else None,
        specifications=payload.specifications,
        variant_images=payload.variant_images,
        variant_configurations=payload.variant_configurations,
        highlights=[highlight.strip() for highlight in payload.highlights if highlight.strip()],
        status="Pending",
    )
    db.add(new_product)
    db.flush()

    # Create Inventory row
    db.add(Inventory(
        product_id=new_product.id,
        stock_qty=payload.stock,
        reserved_qty=0,
        low_stock_threshold=payload.low_stock_threshold,
    ))

    for index, image_url in enumerate(gallery):
        db.add(ProductImage(product_id=new_product.id, image_url=image_url, is_primary=index == 0))

    notify_role(db, "admin", "Product awaiting review", f"{vendor.store_name or vendor.full_name} submitted {new_product.name} for approval.")

    db.commit()
    db.refresh(new_product)
    return {"message": "Product submitted for Admin approval", "id": new_product.id}


@router.put("/products/{product_id}")
def update_vendor_product(product_id: int, payload: ProductUpdate, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in as a vendor to edit products")
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        vendor_id = int(claims.get("user_id", 0))
        if claims.get("role") != "vendor" or not vendor_id:
            raise ValueError("Invalid vendor session")
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Your session is invalid. Please sign in again.")

    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.vendor_id != vendor_id:
        raise HTTPException(status_code=403, detail="You can only edit products from your store")

    supplied = payload.__fields_set__
    values = payload.dict()
    for field in ("name", "description", "price", "discount_price", "brand", "sku", "cost_price", "weight", "specifications", "variant_images", "variant_configurations", "highlights"):
        if field in supplied:
            setattr(product, field, values[field])
    if "name" in supplied and product.name is not None:
        product.name = product.name.strip()
    if "description" in supplied and product.description is not None:
        product.description = product.description.strip()
    if "category_name" in supplied:
        category = db.query(Category).filter(func.lower(Category.name) == payload.category_name.strip().lower(), Category.is_active.is_(True)).first()
        if category is None:
            raise HTTPException(status_code=422, detail="Choose a valid product category")
        product.category_id = category.id

    if "stock" in supplied or "low_stock_threshold" in supplied:
        inventory = db.query(Inventory).filter(Inventory.product_id == product.id).first()
        if inventory is None:
            inventory = Inventory(product_id=product.id, stock_qty=payload.stock or 0)
            db.add(inventory)
        if "stock" in supplied:
            inventory.stock_qty = payload.stock
        if "low_stock_threshold" in supplied:
            inventory.low_stock_threshold = payload.low_stock_threshold

    if "gallery_images" in supplied or "image_url" in supplied:
        image_urls = []
        for image in [payload.image_url, *(payload.gallery_images or [])]:
            clean = image.strip() if image else ""
            if clean and clean not in image_urls:
                image_urls.append(clean)
        db.query(ProductImage).filter(ProductImage.product_id == product.id).delete(synchronize_session=False)
        for index, image_url in enumerate(image_urls):
            db.add(ProductImage(product_id=product.id, image_url=image_url, is_primary=index == 0))

    notify_role(db, "admin", "Vendor updated a product listing", f"{product.name} was updated by its vendor and may need review.")
    db.commit()
    return {"message": "Product updated", "id": product.id, "status": product.status}


@router.delete("/products/{product_id}")
def delete_vendor_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    notify_role(db, "admin", "Vendor removed a product listing", f"{product.name} was removed from the vendor catalog.")
    db.delete(product)
    db.commit()
    return {"message": "Product deleted"}


@router.get("/{vendor_id}/orders")
def get_vendor_orders(vendor_id: int, db: Session = Depends(get_db)):
    vendor_orders = (
        db.query(VendorOrder)
        .filter(VendorOrder.vendor_id == vendor_id)
        .order_by(VendorOrder.id.desc())
        .all()
    )

    result = []
    for vo in vendor_orders:
        order = db.query(Order).filter(Order.id == vo.order_id).first()
        customer = db.query(User).filter(User.id == order.customer_id).first() if order else None
        customer_store_orders = 0
        customer_store_spent = 0.0
        if customer:
            customer_store_orders = db.query(func.count(VendorOrder.id)).join(
                Order, Order.id == VendorOrder.order_id
            ).filter(
                VendorOrder.vendor_id == vendor_id,
                Order.customer_id == customer.id,
            ).scalar() or 0
            customer_store_spent = db.query(func.coalesce(func.sum(VendorOrder.subtotal), 0.0)).join(
                Order, Order.id == VendorOrder.order_id
            ).filter(
                VendorOrder.vendor_id == vendor_id,
                Order.customer_id == customer.id,
                Order.status != "Cancelled",
            ).scalar() or 0.0

        for item in vo.items:
            p = item.product
            img = db.query(ProductImage).filter(ProductImage.product_id == p.id, ProductImage.is_primary.is_(True)).first() if p else None
            if p and not img:
                img = db.query(ProductImage).filter(ProductImage.product_id == p.id).first()
            result.append({
                "id": item.id,
                "vendor_order_id": vo.id,
                "order_id": vo.order_id,
                "order_number": order.order_number if order else f"#NX-{vo.order_id}",
                "customer_name": customer.full_name if customer else "Customer",
                "customer_email": customer.email if customer else None,
                "customer_phone": customer.phone if customer else None,
                "customer_id": customer.id if customer else None,
                "customer_store_order_count": int(customer_store_orders),
                "customer_store_spent": float(customer_store_spent),
                "customer_joined": customer.created_at.isoformat() if customer and customer.created_at else None,
                "customer_is_active": bool(customer.is_active) if customer else None,
                "product_name": p.name if p else "Product",
                "image_url": selected_variant_image(p.variant_images, item.variant_options, p.variant_configurations) if p else (img.image_url if img else None),
                "variant_options": item.variant_options or {},
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "total": item.unit_price * item.quantity,
                "status": vo.status or (order.status if order else "Processing"),
                "order_status": order.status if order else "Processing",
                "payment_method": order.payment_method if order else "UPI",
                "commission_amount": vo.commission_amount,
                "payout_status": vo.payout_status,
                "shipping_address": order.shipping_address if order else "—",
                "created_at": order.created_at.isoformat() if (order and order.created_at) else None,
            })
    return result


@router.patch("/orders/{order_id}/pack")
def pack_vendor_order(order_id: int, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in as a vendor to pack orders")
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        vendor_id = int(claims.get("user_id", 0))
        if claims.get("role") != "vendor" or not vendor_id:
            raise ValueError("Invalid vendor session")
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Your session is invalid. Please sign in again.")

    # VendorOrder eagerly joins its User relation with an outer join; lock only
    # the vendor_orders row, since PostgreSQL cannot lock the nullable join side.
    vendor_order = db.query(VendorOrder).filter(
        VendorOrder.order_id == order_id,
        VendorOrder.vendor_id == vendor_id,
    ).with_for_update(of=VendorOrder).first()
    order = db.query(Order).filter(Order.id == order_id).with_for_update(of=Order).first()
    if not vendor_order or not order:
        raise HTTPException(status_code=404, detail="Order not found for this vendor")
    if order.status != "Processing" or vendor_order.status != "Processing":
        raise HTTPException(status_code=409, detail=f"Order cannot be packed from {order.status}")

    vendor_order.status = "Ready for Pickup"
    db.add(OrderEvent(order_id=order.id, actor_role="vendor", status="Packed", note=f"Vendor {vendor_id} packed their items and marked them ready."))
    # Query the persisted rows directly; the relationship may already have been
    # loaded before this request changed this vendor order's status.
    db.flush()
    all_packed = not db.query(VendorOrder.id).filter(
        VendorOrder.order_id == order.id,
        VendorOrder.status != "Ready for Pickup",
    ).first()
    if all_packed:
        order.status = "Ready for Pickup"
        delivery = db.query(Delivery).filter(Delivery.order_id == order.id).first()
        if delivery is None:
            delivery = Delivery(
                order_id=order.id,
                drop_address=order.shipping_address,
                pickup_hub="NexCart Central Hub",
                status="Ready for Pickup",
            )
            db.add(delivery)
        else:
            delivery.status = "Ready for Pickup"
        db.add(OrderEvent(order_id=order.id, actor_role="vendor", status="Ready for Pickup", note="All vendors have packed the order. Ready for rider pickup."))
        add_notification(db, order.customer_id, "Order packed", f"Seller has packed your order {order.order_number}.", target_role="customer", order_number=order.order_number)
        notify_role(db, "delivery", "Order ready for pickup", f"Order {order.order_number} packed by vendor and ready for pickup.", order.order_number)
        notify_role(db, "admin", "Order ready for pickup", f"Order {order.order_number} is packed and waiting for driver pickup.", order.order_number)
        if delivery and delivery.rider_id:
            add_notification(db, delivery.rider_id, "Order ready for pickup", f"Order {order.order_number} packed by vendor and ready for pickup.", target_role="delivery", order_number=order.order_number)

    db.commit()
    return {"order_id": order.id, "status": order.status, "vendor_status": vendor_order.status, "all_vendors_packed": all_packed}


@router.get("/{vendor_id}/reviews")
def get_vendor_reviews(vendor_id: int, db: Session = Depends(get_db)):
    reviews = (
        db.query(Review, Product, User)
        .join(Product, Product.id == Review.product_id)
        .join(User, User.id == Review.user_id)
        .filter(Product.vendor_id == vendor_id)
        .order_by(Review.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "product_name": p.name,
            "customer_name": u.full_name,
            "rating": r.rating,
            "comment": r.comment or "",
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r, p, u in reviews
    ]


@router.get("/{vendor_id}/analytics")
def get_vendor_analytics(vendor_id: int, db: Session = Depends(get_db)):
    v_orders = db.query(VendorOrder).filter(VendorOrder.vendor_id == vendor_id).all()
    total_sales = sum(vo.subtotal for vo in v_orders)
    total_commission = sum(vo.commission_amount for vo in v_orders)
    net_earnings = max(0.0, total_sales - total_commission)

    return {
        "total_sales": float(total_sales),
        "total_commission": float(total_commission),
        "net_earnings": float(net_earnings),
        "order_count": len(v_orders),
        "product_count": db.query(Product).filter(Product.vendor_id == vendor_id).count(),
    }
