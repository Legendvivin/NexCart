import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.categories import Category
from app.models.product import Product
from app.models.user import User
from app.models.audit_log import AuditLog

router = APIRouter(prefix="/admin/categories", tags=["Admin Categories"])


class CategoryCreate(BaseModel):
    name: str
    specifications: list[str] = Field(default_factory=list)


class CategoryUpdate(BaseModel):
    name: str
    specifications: list[str] = Field(default_factory=list)


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    return re.sub(r"[-\s]+", "-", text)


@router.get("")
def list_categories(db: Session = Depends(get_db)):
    rows = db.query(Category).order_by(Category.name.asc()).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "slug": c.slug,
            "specs": c.specifications or [],
            "product_count": int(db.query(func.count(Product.id)).filter(Product.category_id == c.id).scalar() or 0),
        }
        for c in rows
    ]


@router.post("", status_code=201)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Category name is required")
    if db.query(Category).filter(func.lower(Category.name) == name.lower()).first():
        raise HTTPException(status_code=409, detail="Category already exists")

    slug = slugify(name)
    existing_slug = db.query(Category).filter(Category.slug == slug).first()
    if existing_slug:
        slug = f"{slug}-{Category.id}"

    category = Category(
        name=name,
        slug=slug,
        specifications=[spec.strip() for spec in payload.specifications if spec.strip()],
        is_active=True,
    )
    db.add(category)
    db.flush()

    admin_user = db.query(User).filter(User.role == "admin").first()
    db.add(AuditLog(
        actor_id=admin_user.id if admin_user else None,
        action="CATEGORY_CREATED",
        entity_type="Category",
        entity_id=category.id,
    ))

    db.commit()
    db.refresh(category)
    return {"id": category.id, "name": category.name, "slug": category.slug, "specs": category.specifications}


@router.put("/{category_id}")
def update_category(category_id: int, payload: CategoryUpdate, db: Session = Depends(get_db)):
    category = db.query(Category).filter(Category.id == category_id).first()
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")

    category.name = payload.name.strip()
    category.slug = slugify(category.name)
    category.specifications = [s.strip() for s in payload.specifications if s.strip()]

    admin_user = db.query(User).filter(User.role == "admin").first()
    db.add(AuditLog(
        actor_id=admin_user.id if admin_user else None,
        action="CATEGORY_UPDATED",
        entity_type="Category",
        entity_id=category.id,
    ))

    db.commit()
    db.refresh(category)
    return {"id": category.id, "name": category.name, "slug": category.slug, "specs": category.specifications}


@router.delete("/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db)):
    category = db.query(Category).filter(Category.id == category_id).first()
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found")
    if db.query(Product.id).filter(Product.category_id == category_id).first():
        raise HTTPException(status_code=409, detail="Category has products and cannot be deleted")

    admin_user = db.query(User).filter(User.role == "admin").first()
    db.add(AuditLog(
        actor_id=admin_user.id if admin_user else None,
        action="CATEGORY_DELETED",
        entity_type="Category",
        entity_id=category.id,
    ))

    db.delete(category)
    db.commit()
    return {"message": "Category deleted"}
