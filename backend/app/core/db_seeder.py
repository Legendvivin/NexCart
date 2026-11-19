from sqlalchemy.orm import Session
from passlib.context import CryptContext
from app.models.user import User
from app.models.vendor_profile import VendorProfile
from app.models.categories import Category
from app.models.system_setting import SystemSetting

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SYSTEM_ACCOUNTS = (
    {
        "full_name": "NexCart Administrator",
        "email": "admin@nexcart.com",
        "password": "admin123",
        "role": "admin",
    },
    {
        "full_name": "NexCart Seller",
        "email": "vendor@nexcart.com",
        "password": "vendor123",
        "role": "vendor",
        "store_name": "NexCart Seller",
    },
    {
        "full_name": "Delivery Operations",
        "email": "delivery@nexcart.com",
        "password": "delivery123",
        "role": "delivery",
    },
    {
        "full_name": "NexCart Courier Rider",
        "email": "rider@nexcart.com",
        "password": "rider123",
        "role": "rider",
    },
)

BASE_CATEGORIES = (
    {
        "name": "Electronics",
        "slug": "electronics",
        "specifications": ["Brand", "Model", "Warranty", "Color"],
    },
    {
        "name": "Fashion",
        "slug": "fashion",
        "specifications": ["Size", "Color", "Material", "Gender"],
    },
    {
        "name": "Home & Living",
        "slug": "home-living",
        "specifications": ["Material", "Dimensions", "Weight"],
    },
    {
        "name": "Food & Grocery",
        "slug": "food-grocery",
        "specifications": ["Expiry Date", "Veg/Non-Veg", "Net Quantity"],
    },
)

BASE_SETTINGS = {
    "platform_name": "NexCart",
    "platform_commission_rate": "10.0",
    "commission_rate": "10.0",
    "base_rider_fee": "65.0",
    "delivery_fee": "65.0",
}


def seed_initial_data(db: Session):
    """Seed ONLY default role accounts, initial categories, and platform settings.

    Never seed fake orders, products, or mock analytics.
    """
    try:
        # 1. Accounts
        for account in SYSTEM_ACCOUNTS:
            existing = db.query(User).filter(User.email == account["email"]).first()
            if existing is None:
                user = User(
                    full_name=account["full_name"],
                    email=account["email"],
                    hashed_password=pwd_context.hash(account["password"]),
                    role=account["role"],
                    is_active=True,
                    is_verified=True,
                    store_name=account.get("store_name"),
                )
                db.add(user)
                db.flush()

                if account["role"] == "vendor":
                    profile = db.query(VendorProfile).filter(VendorProfile.user_id == user.id).first()
                    if profile is None:
                        db.add(VendorProfile(
                            user_id=user.id,
                            store_name=account.get("store_name", "NexCart Seller"),
                            gst_number="GSTIN29ABCDE1234F1Z5",
                            bank_account="HDFC000123456789",
                            commission_rate=10.0,
                            rating=5.0,
                            kyc_status="Approved",
                        ))
            elif account["role"] == "vendor":
                profile = db.query(VendorProfile).filter(VendorProfile.user_id == existing.id).first()
                if profile is None:
                    db.add(VendorProfile(
                        user_id=existing.id,
                        store_name=account.get("store_name", "NexCart Seller"),
                        gst_number="GSTIN29ABCDE1234F1Z5",
                        bank_account="HDFC000123456789",
                        commission_rate=10.0,
                        rating=5.0,
                        kyc_status="Approved",
                    ))
            elif account["email"] == "delivery@nexcart.com" and str(existing.role) == "rider":
                # Keep the seeded dispatcher separate from courier accounts so
                # checkout and rider queues cannot assign work to the manager login.
                existing.role = "delivery"
        db.flush()

        # 2. Categories
        for cat in BASE_CATEGORIES:
            existing = db.query(Category).filter(Category.name == cat["name"]).first()
            if existing is None:
                db.add(Category(
                    name=cat["name"],
                    slug=cat["slug"],
                    specifications=cat["specifications"],
                    is_active=True,
                ))
            else:
                if not getattr(existing, "slug", None):
                    existing.slug = cat["slug"]
                if not getattr(existing, "specifications", None):
                    existing.specifications = cat["specifications"]
        db.flush()

        # 3. System settings
        for key, value in BASE_SETTINGS.items():
            setting = db.query(SystemSetting).filter(SystemSetting.key == key).first()
            if setting is None:
                db.add(SystemSetting(key=key, value=value))
        db.commit()
    except Exception:
        db.rollback()
        raise
