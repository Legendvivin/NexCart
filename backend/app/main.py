from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.database import engine, Base, SessionLocal, migrate_legacy_columns
from app.core.db_seeder import seed_initial_data
from app import models
from app.routers import admin_auth, admin_dashboard, admin_users, admin_vendors, admin_settings, categories, product as product_router, vendor, store, delivery, cart, review, role_auth, notifications
Base.metadata.create_all(bind=engine)
migrate_legacy_columns()

db = SessionLocal()
try:
    seed_initial_data(db)
finally:
    db.close()

app = FastAPI(title="NexCart API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin_auth.router)
app.include_router(admin_dashboard.router)
app.include_router(admin_users.router)
app.include_router(admin_vendors.router)
app.include_router(admin_settings.router)
app.include_router(categories.router)
app.include_router(product_router.router)
app.include_router(vendor.router)
app.include_router(store.router)
app.include_router(delivery.router)
app.include_router(cart.router)
app.include_router(review.router)
app.include_router(role_auth.router)
app.include_router(notifications.router)

@app.get("/")
def health_check():
    return {"status": "NexCart API ready"}
