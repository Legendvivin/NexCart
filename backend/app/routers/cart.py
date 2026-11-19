from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Dict, Optional
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.cart_item import CartItem
from app.models.product import Product
from app.models.product_image import ProductImage
from app.models.inventory import Inventory
from app.models.user import User
from app.services.product_options import validate_product_options, selected_variant_image, selected_variant_price, find_variant_configuration

router = APIRouter(prefix="/cart", tags=["Customer Cart"])


class CartQuantity(BaseModel):
    quantity: int = Field(ge=0)
    variant_options: Optional[Dict[str, str]] = None


@router.get("/{customer_id}")
def get_cart(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(User).filter(User.id == customer_id).first()
    if customer is None:
        return []

    rows = (
        db.query(CartItem, Product)
        .join(Product, Product.id == CartItem.product_id)
        .filter(CartItem.user_id == customer_id)
        .order_by(CartItem.added_at.desc())
        .all()
    )

    result = []
    for item, product in rows:
        inv = db.query(Inventory).filter(Inventory.product_id == product.id).first()
        stock = inv.stock_qty if inv else 0
        img = db.query(ProductImage).filter(ProductImage.product_id == product.id, ProductImage.is_primary.is_(True)).first()
        if not img:
            img = db.query(ProductImage).filter(ProductImage.product_id == product.id).first()

        result.append({
            "id": product.id,
            "cart_item_id": item.id,
            "product_id": product.id,
            "name": product.name,
            "price": selected_variant_price(product.variant_configurations, item.variant_options, float(product.discount_price or product.price)),
            "discount_price": None,
            "stock": stock,
            "image_url": selected_variant_image(product.variant_images, item.variant_options, product.variant_configurations) or (img.image_url if img else None),
            "quantity": item.quantity,
            "variant_options": item.variant_options or {},
        })
    return result


@router.put("/{customer_id}/items/{product_id}")
def set_cart_quantity(customer_id: int, product_id: int, payload: CartQuantity, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id, Product.status == "Approved").first()
    if product is None:
        raise HTTPException(status_code=404, detail="Product is unavailable")

    if payload.variant_options is not None:
        try:
            validate_product_options(product.specifications, payload.variant_options, product.variant_configurations)
            if product.variant_configurations and not find_variant_configuration(product.variant_configurations, payload.variant_options):
                raise ValueError("This product combination is unavailable")
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    inv = db.query(Inventory).filter(Inventory.product_id == product.id).first()
    available_stock = inv.stock_qty if inv else 0

    candidates = db.query(CartItem).filter(CartItem.user_id == customer_id, CartItem.product_id == product_id).all()
    item = next((candidate for candidate in candidates if (candidate.variant_options or {}) == (payload.variant_options or {})), None)

    if payload.quantity <= 0:
        if item is not None:
            db.delete(item)
            db.commit()
        return {"message": "Item removed from cart"}

    if payload.quantity > available_stock:
        raise HTTPException(status_code=400, detail=f"Requested quantity ({payload.quantity}) exceeds available stock ({available_stock})")

    if item is None:
        item = CartItem(
            user_id=customer_id,
            product_id=product_id,
            quantity=payload.quantity,
            variant_options=payload.variant_options or {},
        )
        db.add(item)
    else:
        item.quantity = payload.quantity
        if payload.variant_options is not None:
            item.variant_options = payload.variant_options

    db.commit()
    db.refresh(item)
    return {"message": "Cart updated", "quantity": item.quantity}


@router.delete("/{customer_id}/items/{product_id}")
def remove_from_cart(customer_id: int, product_id: int, db: Session = Depends(get_db)):
    item = db.query(CartItem).filter(CartItem.user_id == customer_id, CartItem.product_id == product_id).first()
    if item is not None:
        db.delete(item)
        db.commit()
    return {"message": "Item removed from cart"}


@router.delete("/{customer_id}")
def clear_cart(customer_id: int, db: Session = Depends(get_db)):
    db.query(CartItem).filter(CartItem.user_id == customer_id).delete(synchronize_session=False)
    db.commit()
    return {"message": "Cart cleared"}
