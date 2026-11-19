from fastapi import APIRouter, Depends, Header, HTTPException
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.system_setting import SystemSetting
from app.models.user import User
from app.models.audit_log import AuditLog
from app.routers.admin_auth import SECRET_KEY, ALGORITHM

router = APIRouter(prefix="/admin/settings", tags=["Admin Settings"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
SETTING_KEYS = ("platform_name", "commission_rate", "delivery_fee", "platform_commission_rate", "base_rider_fee")


class SettingsUpdate(BaseModel):
    platform_name: str = Field(min_length=1, max_length=120)
    commission_rate: float = Field(ge=0, le=100)
    delivery_fee: float = Field(ge=0)


class AdminProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(default="", max_length=30)


class AdminPasswordUpdate(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


def _current_admin(authorization: str, db: Session) -> User:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in as an admin to manage account settings")
    try:
        claims = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(claims.get("user_id", 0))
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Your admin session is invalid. Please sign in again.")
    if claims.get("role") != "admin" or not user_id:
        raise HTTPException(status_code=403, detail="Admin access is required")
    admin = db.query(User).filter(User.id == user_id, User.role == "admin", User.is_active.is_(True)).first()
    if admin is None:
        raise HTTPException(status_code=404, detail="Admin account not found")
    return admin


@router.get("/admin-profile")
def get_admin_profile(authorization: str = Header(default=""), db: Session = Depends(get_db)):
    admin = _current_admin(authorization, db)
    return {
        "id": admin.id,
        "full_name": admin.full_name,
        "email": admin.email,
        "phone": admin.phone or "",
        "created_at": admin.created_at.isoformat() if admin.created_at else None,
    }


@router.put("/admin-profile")
def update_admin_profile(payload: AdminProfileUpdate, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    admin = _current_admin(authorization, db)
    if len(payload.full_name.strip()) < 2:
        raise HTTPException(status_code=422, detail="Full name must contain at least 2 characters")
    admin.full_name = payload.full_name.strip()
    admin.phone = payload.phone.strip() or None
    db.add(AuditLog(actor_id=admin.id, action="ADMIN_PROFILE_UPDATED", entity_type="User", entity_id=admin.id))
    db.commit()
    return {"id": admin.id, "full_name": admin.full_name, "email": admin.email, "phone": admin.phone or ""}


@router.patch("/admin-password")
def update_admin_password(payload: AdminPasswordUpdate, authorization: str = Header(default=""), db: Session = Depends(get_db)):
    admin = _current_admin(authorization, db)
    if not pwd_context.verify(payload.current_password, admin.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    admin.hashed_password = pwd_context.hash(payload.new_password)
    db.add(AuditLog(actor_id=admin.id, action="ADMIN_PASSWORD_UPDATED", entity_type="User", entity_id=admin.id))
    db.commit()
    return {"message": "Admin password updated"}


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    rows = db.query(SystemSetting).all()
    values = {row.key: row.value for row in rows}
    return {
        "platform_name": values.get("platform_name", "NexCart"),
        "commission_rate": values.get("commission_rate", values.get("platform_commission_rate", "10.0")),
        "delivery_fee": values.get("delivery_fee", values.get("base_rider_fee", "65.0")),
    }


@router.put("")
def update_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    updates = {
        "platform_name": payload.platform_name.strip(),
        "commission_rate": str(payload.commission_rate),
        "platform_commission_rate": str(payload.commission_rate),
        "delivery_fee": str(payload.delivery_fee),
        "base_rider_fee": str(payload.delivery_fee),
    }

    for key, value in updates.items():
        setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        if setting is None:
            db.add(SystemSetting(key=key, value=value))
        else:
            setting.value = value

    admin_user = db.query(User).filter(User.role == "admin").first()
    db.add(AuditLog(
        actor_id=admin_user.id if admin_user else None,
        action="SETTINGS_UPDATED",
        entity_type="SystemSetting",
        entity_id=None,
    ))

    db.commit()
    return {
        "platform_name": updates["platform_name"],
        "commission_rate": updates["commission_rate"],
        "delivery_fee": updates["delivery_fee"],
    }
