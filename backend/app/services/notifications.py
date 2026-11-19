import json

from sqlalchemy import text

from app.models.notification import Notification


def add_notification(db, user_id: int, title: str, message: str, target_role=None, order_number=None):
    if user_id:
        if target_role is None:
            from app.models.user import User
            target_role = db.query(User.role).filter(User.id == user_id).scalar() or "customer"
        if str(target_role) == "rider":
            target_role = "delivery"
        row = Notification(user_id=user_id, target_role=str(target_role), title=title, message=message, order_number=order_number)
        db.add(row)
        db.flush()
        db.execute(text("SELECT pg_notify('nexcart_notifications', :payload)"), {
            "payload": json.dumps({"id": row.id, "user_id": user_id, "role": str(target_role), "order_number": order_number})
        })


def notify_role(db, role: str, title: str, message: str, order_number=None):
    from app.models.user import User
    recipients = db.query(User.id).filter(User.role == role, User.is_active.is_(True)).all()
    if role == "delivery" and not recipients:
        recipients = db.query(User.id).filter(User.role == "rider", User.is_active.is_(True)).all()
    for user_id, in recipients:
        add_notification(db, user_id, title, message, target_role=role, order_number=order_number)
