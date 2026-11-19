from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.review import Review
from app.models.product import Product
from app.models.user import User
from app.models.audit_log import AuditLog

router = APIRouter(prefix="/admin/reviews", tags=["Admin Reviews"])


@router.get("")
def list_all_reviews(db: Session = Depends(get_db)):
    reviews = db.query(Review).order_by(Review.created_at.desc()).all()
    result = []
    for r in reviews:
        p = db.query(Product).filter(Product.id == r.product_id).first()
        u = db.query(User).filter(User.id == r.user_id).first()
        result.append({
            "id": r.id,
            "product_id": r.product_id,
            "product_name": p.name if p else "Deleted Product",
            "user_id": r.user_id,
            "customer_name": u.full_name if u else "Anonymous",
            "rating": r.rating,
            "comment": r.comment or "",
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return result


@router.delete("/{review_id}")
def delete_review(review_id: int, db: Session = Depends(get_db)):
    review = db.query(Review).filter(Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    admin_user = db.query(User).filter(User.role == "admin").first()
    db.add(AuditLog(
        actor_id=admin_user.id if admin_user else None,
        action="REVIEW_MODERATED_DELETE",
        entity_type="Review",
        entity_id=review.id,
    ))

    db.delete(review)
    db.commit()
    return {"message": "Review deleted by moderator"}
