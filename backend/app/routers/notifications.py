from fastapi import APIRouter, Depends, Header, HTTPException, Query
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.notification import Notification
from app.routers.admin_auth import SECRET_KEY, ALGORITHM

router = APIRouter(prefix="/notifications", tags=["Notifications"])


def current_user(authorization: str = Header(default="")) -> dict:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in to view notifications")
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(claims.get("user_id", 0))
        if not user_id:
            raise ValueError("Missing user id")
        return {"user_id": user_id, "role": claims.get("role")}
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Your session is invalid. Please sign in again.")


@router.get("")
def list_notifications(role: str = Query(...), user_id: int = Query(...), identity: dict = Depends(current_user), db: Session = Depends(get_db)):
    actual_role = "delivery" if identity["role"] in {"delivery", "rider"} else identity["role"]
    requested_role = "delivery" if role in {"delivery", "rider"} else role
    if identity["user_id"] != user_id or actual_role != requested_role:
        raise HTTPException(status_code=403, detail="You can only view your own notifications")
    rows = (db.query(Notification).filter(Notification.user_id == user_id, Notification.target_role == requested_role)
            .order_by(Notification.created_at.desc()).limit(50).all())
    return [{"id": row.id, "title": row.title, "message": row.message,
             "target_role": row.target_role, "order_number": row.order_number,
             "is_read": row.is_read, "created_at": row.created_at.isoformat() if row.created_at else None}
            for row in rows]


@router.patch("/read-all")
def mark_all_read(identity: dict = Depends(current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == identity["user_id"], Notification.is_read.is_(False)).update({"is_read": True}, synchronize_session=False)
    db.commit()
    return {"message": "All notifications marked as read"}


@router.patch("/{notification_id}/read")
def mark_read(notification_id: int, identity: dict = Depends(current_user), db: Session = Depends(get_db)):
    row = db.query(Notification).filter(Notification.id == notification_id, Notification.user_id == identity["user_id"]).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    row.is_read = True
    db.commit()
    return {"message": "Notification marked as read"}
