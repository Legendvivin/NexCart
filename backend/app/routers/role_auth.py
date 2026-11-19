import os
import json
import secrets
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, status
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user import User
from app.models.vendor_profile import VendorProfile
from app.models.delivery_partner_application import DeliveryPartnerApplication
from app.routers.admin_auth import create_access_token, pwd_context as password_context
from app.services.notifications import add_notification, notify_role

router = APIRouter(prefix="/auth", tags=["Role Authentication"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ROLE_HOME = {"customer": "/store", "vendor": "/vendor/dashboard", "rider": "/rider/dashboard", "delivery": "/delivery/dashboard", "admin": "/admin"}


class RegisterRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    phone: str = ""
    store_name: str = ""
    registration_key: str = ""


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    role: str


@router.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate every portal against the same user table and issue a role claim."""
    if payload.role not in ROLE_HOME:
        raise HTTPException(status_code=400, detail="Unsupported account type")
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or user.role != payload.role or not password_context.verify(payload.password, str(user.hashed_password)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid {payload.role} email or password")
    if user.role == "vendor":
        profile = db.query(VendorProfile).filter(VendorProfile.user_id == user.id).first()
        kyc_status = profile.kyc_status if profile else "Approved"
        if kyc_status != "Approved":
            message = "Your vendor application was rejected. Contact the marketplace team." if kyc_status == "Rejected" else "Your vendor account is awaiting admin approval. You can sign in after it is approved."
            raise HTTPException(status_code=403, detail=message)
    if not user.is_active or (user.role == "rider" and not user.is_verified):
        application = db.query(DeliveryPartnerApplication).filter(DeliveryPartnerApplication.user_id == user.id).first() if user.role == "rider" else None
        if application and application.status == "Rejected":
            raise HTTPException(status_code=403, detail="Your delivery partner application was not approved. Contact the marketplace team.")
        raise HTTPException(status_code=403, detail="This account is awaiting approval or is inactive.")
    return _response(user)


class GoogleRequest(BaseModel):
    credential: str
    role: str
    store_name: str = ""
    registration_key: str = ""


def _response(user: User):
    if user.role == "rider" and not user.is_active:
        return {
            "role": "rider",
            "user_id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "application_status": "Pending",
            "message": "Your delivery partner application was submitted and is awaiting admin approval.",
        }
    return {
        "access_token": create_access_token({"sub": user.email, "role": user.role, "user_id": user.id}),
        "role": user.role,
        "user_id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "store_name": user.store_name,
        "next": ROLE_HOME[user.role],
    }


def _vendor_pending_response(user: User, profile):
    if profile and profile.kyc_status == "Rejected":
        message = "Your vendor application was rejected. Contact the marketplace team."
    else:
        message = "Your vendor application was submitted and is awaiting admin approval. You can sign in after it is approved."
    return {
        "role": "vendor",
        "user_id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "application_status": profile.kyc_status if profile else "Pending",
        "message": message,
    }


def _create_user(db: Session, *, role: str, full_name: str, email: str, password: str, phone: str = "", store_name: str = ""):
    if role not in ROLE_HOME:
        raise HTTPException(status_code=400, detail="Registration is not available for this role")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered. Please sign in.")
    user = User(
        full_name=full_name.strip(), email=email, phone=phone.strip() or None,
        hashed_password=pwd_context.hash(password),
        role=role,
        is_active=role != "rider",
        is_verified=role != "rider",
        store_name=(store_name.strip() or full_name.strip()) if role == "vendor" else None,
    )
    db.add(user)
    db.flush()
    if role == "vendor":
        db.add(VendorProfile(user_id=user.id, store_name=user.store_name, kyc_status="Pending"))
        notify_role(db, "admin", "New vendor registration", f"{user.store_name} registered and is awaiting review.")
    elif role == "rider":
        db.add(DeliveryPartnerApplication(user_id=user.id, status="Pending"))
        notify_role(db, "admin", "New delivery partner application", f"{user.full_name} applied to join the delivery fleet.")
    add_notification(db, user.id, "Welcome to NexCart", "Your account is ready. We'll keep important updates here.")
    db.commit()
    db.refresh(user)
    return user


@router.post("/{role}/register")
def register(role: str, payload: RegisterRequest, db: Session = Depends(get_db)):
    if role not in ROLE_HOME or len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Use a supported account type and a password with at least 8 characters")
    if role == "admin":
        configured_key = os.getenv("ADMIN_REGISTRATION_KEY")
        if not configured_key or not secrets.compare_digest(payload.registration_key, configured_key):
            raise HTTPException(status_code=403, detail="A valid admin setup key is required to create an admin account")
    user = _create_user(db, role=role, full_name=payload.full_name, email=payload.email, password=payload.password, phone=payload.phone, store_name=payload.store_name)
    if role == "rider":
        return _response(user)
    return _response(user)


@router.post("/google")
def google_sign_in(payload: GoogleRequest, db: Session = Depends(get_db)):
    if payload.role != "customer":
        raise HTTPException(status_code=400, detail="Google sign-in is available for customer accounts only")
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the backend and VITE_GOOGLE_CLIENT_ID in the frontend.")
    try:
        query = urllib.parse.urlencode({"id_token": payload.credential})
        with urllib.request.urlopen(f"https://oauth2.googleapis.com/tokeninfo?{query}", timeout=8) as response:
            claims = json.loads(response.read())
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google credential could not be verified")
    if claims.get("aud") != client_id or claims.get("email_verified") not in (True, "true"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google account verification failed")
    email = claims.get("email", "").lower()
    user = db.query(User).filter(User.email == email).first()
    if user:
        if user.role != payload.role:
            raise HTTPException(status_code=403, detail=f"This Google account is registered as {user.role}. Use that portal to sign in.")
        if user.role == "vendor":
            profile = db.query(VendorProfile).filter(VendorProfile.user_id == user.id).first()
            if (profile.kyc_status if profile else "Approved") != "Approved":
                return _vendor_pending_response(user, profile)
        if user.role == "rider" and not user.is_active:
            application = db.query(DeliveryPartnerApplication).filter(DeliveryPartnerApplication.user_id == user.id).first()
            application_status = application.status if application else "Pending"
            return {
                "role": "rider",
                "user_id": user.id,
                "full_name": user.full_name,
                "email": user.email,
                "application_status": application_status,
                "message": "Your delivery partner application was not approved." if application_status == "Rejected" else "Your delivery partner application is awaiting admin approval.",
            }
        return _response(user)
    if payload.role == "admin":
        configured_key = os.getenv("ADMIN_REGISTRATION_KEY")
        if not configured_key or not secrets.compare_digest(payload.registration_key, configured_key):
            raise HTTPException(status_code=403, detail="No admin account exists for this Google account. Enter the admin setup key to create one.")
    user = _create_user(db, role=payload.role, full_name=claims.get("name") or email.split("@")[0], email=email, password=secrets.token_urlsafe(32), store_name=payload.store_name)
    if payload.role == "vendor":
        profile = db.query(VendorProfile).filter(VendorProfile.user_id == user.id).first()
        return _vendor_pending_response(user, profile)
    if payload.role == "rider":
        return _response(user)
    return _response(user)
