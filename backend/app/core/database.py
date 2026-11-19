import os
from pathlib import Path
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5433/nexcart_db"
)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def migrate_legacy_columns():
    """Add fields to existing database installations without dropping user data."""
    inspector = inspect(engine)
    if "users" in inspector.get_table_names():
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        user_additions = {
            "phone": "VARCHAR",
            "store_bio": "TEXT",
            "payout_upi_id": "VARCHAR",
        }
        with engine.begin() as connection:
            for name, sql_type in user_additions.items():
                if name not in user_columns:
                    connection.execute(text(f"ALTER TABLE users ADD COLUMN {name} {sql_type}"))

    if "orders" in inspector.get_table_names():
        order_columns = {column["name"] for column in inspector.get_columns("orders")}
        order_additions = {
            "rider_id": "INTEGER REFERENCES users(id)",
            "rider_fee": "DOUBLE PRECISION NOT NULL DEFAULT 0",
            "payment_method": "VARCHAR NOT NULL DEFAULT 'UPI'",
            "cod_collected": "BOOLEAN NOT NULL DEFAULT FALSE",
            "delivered_at": "TIMESTAMP WITH TIME ZONE",
            "delivery_lat": "DOUBLE PRECISION",
            "delivery_lng": "DOUBLE PRECISION",
        }
        with engine.begin() as connection:
            for name, sql_type in order_additions.items():
                if name not in order_columns:
                    connection.execute(text(f"ALTER TABLE orders ADD COLUMN {name} {sql_type}"))
            connection.execute(text(
                "UPDATE orders SET delivery_otp = lpad((floor(random() * 10000))::int::text, 4, '0') "
                "WHERE delivery_otp IS NULL OR delivery_otp = '4829'"
            ))
            # Migrate old string assignments into the delivery relation.
            if "assigned_rider" in order_columns and "deliveries" in inspector.get_table_names():
                connection.execute(text(
                    "UPDATE deliveries AS d SET rider_id = u.id "
                    "FROM orders AS o, users AS u "
                    "WHERE d.order_id = o.id AND d.rider_id IS NULL "
                    "AND u.role = 'rider' AND o.assigned_rider IS NOT NULL "
                    "AND lower(o.assigned_rider) LIKE '%' || "
                    "lower(split_part(u.full_name, '•', 1)) || '%'"
                ))
            if "deliveries" in inspector.get_table_names():
                connection.execute(text(
                    "UPDATE orders o SET rider_fee = d.rider_fee, delivered_at = COALESCE(o.delivered_at, d.delivered_at) "
                    "FROM deliveries d WHERE d.order_id = o.id"
                ))

    if "deliveries" in inspector.get_table_names():
        delivery_columns = {column["name"] for column in inspector.get_columns("deliveries")}
        if "accepted_at" not in delivery_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE deliveries ADD COLUMN accepted_at TIMESTAMP WITH TIME ZONE"))

    if "vendor_profiles" in inspector.get_table_names():
        vendor_columns = {column["name"] for column in inspector.get_columns("vendor_profiles")}
        vendor_additions = {"store_address": "TEXT", "store_lat": "DOUBLE PRECISION", "store_lng": "DOUBLE PRECISION"}
        with engine.begin() as connection:
            for name, sql_type in vendor_additions.items():
                if name not in vendor_columns:
                    connection.execute(text(f"ALTER TABLE vendor_profiles ADD COLUMN {name} {sql_type}"))

    if "products" in inspector.get_table_names():
        product_columns = {column["name"] for column in inspector.get_columns("products")}
        product_additions = {
            "brand": "VARCHAR",
            "sku": "VARCHAR",
            "cost_price": "DOUBLE PRECISION",
            "weight": "VARCHAR",
            "specifications": "JSON NOT NULL DEFAULT '{}'::json",
            "highlights": "JSON NOT NULL DEFAULT '[]'::json",
            "variant_images": "JSON NOT NULL DEFAULT '{}'::json",
            "variant_configurations": "JSON NOT NULL DEFAULT '[]'::json",
            "admin_terms": "JSON NOT NULL DEFAULT '{}'::json",
        }
        with engine.begin() as connection:
            for name, sql_type in product_additions.items():
                if name not in product_columns:
                    connection.execute(text(f"ALTER TABLE products ADD COLUMN {name} {sql_type}"))

    if "razorpay_checkouts" in inspector.get_table_names():
        checkout_columns = {column["name"] for column in inspector.get_columns("razorpay_checkouts")}
        if "coupon_code" not in checkout_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE razorpay_checkouts ADD COLUMN coupon_code VARCHAR NOT NULL DEFAULT ''"))

    for table_name in ("cart_items", "order_items"):
        if table_name in inspector.get_table_names():
            columns = {column["name"] for column in inspector.get_columns(table_name)}
            if "variant_options" not in columns:
                with engine.begin() as connection:
                    connection.execute(text(
                        f"ALTER TABLE {table_name} ADD COLUMN variant_options JSON NOT NULL DEFAULT '{{}}'::json"
                    ))

    if "cart_items" in inspector.get_table_names():
        cart_constraints = {constraint.get("name") for constraint in inspector.get_unique_constraints("cart_items")}
        if "uq_user_product_cart" in cart_constraints:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE cart_items DROP CONSTRAINT uq_user_product_cart"))

    if "notifications" in inspector.get_table_names():
        notification_columns = {column["name"] for column in inspector.get_columns("notifications")}
        with engine.begin() as connection:
            if "target_role" not in notification_columns:
                connection.execute(text("ALTER TABLE notifications ADD COLUMN target_role VARCHAR NOT NULL DEFAULT 'customer'"))
                connection.execute(text("UPDATE notifications n SET target_role = COALESCE(u.role, 'customer') FROM users u WHERE u.id = n.user_id"))
            connection.execute(text("UPDATE notifications SET target_role = 'delivery' WHERE target_role = 'rider'"))
            if "order_number" not in notification_columns:
                connection.execute(text("ALTER TABLE notifications ADD COLUMN order_number VARCHAR"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_notifications_target_role ON notifications (target_role)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_notifications_order_number ON notifications (order_number)"))
