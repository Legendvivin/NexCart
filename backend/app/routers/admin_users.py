from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.order import Order
from app.models.user import User

router = APIRouter(prefix="/admin/users", tags=["Admin Users"])


class UserStatusUpdate(BaseModel):
    is_active: bool


@router.get("")
def list_customers(db: Session = Depends(get_db)):
    customers = db.query(User).filter(User.role == "customer").order_by(User.created_at.desc()).all()
    result = []
    for customer in customers:
        count = db.query(func.count(Order.id)).filter(Order.customer_id == customer.id).scalar()
        spent = db.query(func.coalesce(func.sum(Order.total_amount), 0.0)).filter(Order.customer_id == customer.id, Order.status != "Cancelled").scalar()
        result.append({
            "id": customer.id,
            "name": customer.full_name,
            "email": customer.email,
            "phone": customer.phone,
            "orders": int(count or 0),
            "spent": float(spent or 0),
            "joined": customer.created_at.isoformat() if customer.created_at else None,
            "active": bool(customer.is_active),
        })
    return result


@router.patch("/{user_id}/status")
def update_customer_status(user_id: int, payload: UserStatusUpdate, db: Session = Depends(get_db)):
    customer = db.query(User).filter(User.id == user_id, User.role == "customer").first()
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    customer.is_active = payload.is_active
    db.commit()
    return {"id": customer.id, "active": customer.is_active}
