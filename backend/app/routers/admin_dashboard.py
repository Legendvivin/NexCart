from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.categories import Category
from app.models.order import Order
from app.models.vendor_order import VendorOrder
from app.models.order_item import OrderItem
from app.models.product import Product
from app.models.user import User
from app.models.vendor_profile import VendorProfile
from app.models.audit_log import AuditLog

router = APIRouter(prefix="/admin/dashboard", tags=["Admin Dashboard"])


@router.get("/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    # 1. Core KPIs
    total_gmv = db.query(func.coalesce(func.sum(Order.total_amount), 0.0)).filter(Order.status != "Cancelled").scalar()
    platform_commission = (
        db.query(func.coalesce(func.sum(VendorOrder.commission_amount), 0.0))
        .join(Order, Order.id == VendorOrder.order_id)
        .filter(Order.status != "Cancelled")
        .scalar()
    )
    total_orders = db.query(Order).count()
    active_vendors = db.query(User).filter(User.role == "vendor", User.is_active.is_(True)).count()
    pending_products = db.query(Product).filter(Product.status == "Pending").count()
    total_customers = db.query(User).filter(User.role == "customer").count()
    total_riders = db.query(User).filter(User.role == "rider", User.is_active.is_(True)).count()

    # 2. Monthly Revenue (last 6 months)
    now = datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    months = []
    cursor = month_start
    for _ in range(5):
        cursor = (cursor.replace(day=1) - timedelta(days=1)).replace(day=1)
    for _ in range(6):
        next_month = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
        months.append({"start": cursor, "end": next_month, "label": cursor.strftime("%b")})
        cursor = next_month

    month_orders = db.query(Order).filter(Order.created_at >= months[0]["start"], Order.created_at < months[-1]["end"], Order.status != "Cancelled").all()
    monthly_revenue = []
    for month in months:
        month_rows = [order for order in month_orders if month["start"] <= order.created_at < month["end"]]
        monthly_revenue.append({
            "month": month["label"],
            "revenue": sum(float(order.total_amount or 0) for order in month_rows),
            "orders": len(month_rows),
        })

    # 3. Order Breakdown
    status_counts = dict(db.query(Order.status, func.count(Order.id)).group_by(Order.status).all())
    order_breakdown = [{"status": key, "count": int(value)} for key, value in sorted(status_counts.items())]

    # 4. Category Sales
    category_rows = (
        db.query(Category.name, func.sum(OrderItem.unit_price * OrderItem.quantity))
        .join(Product, Product.category_id == Category.id)
        .join(OrderItem, OrderItem.product_id == Product.id)
        .join(VendorOrder, VendorOrder.id == OrderItem.vendor_order_id)
        .join(Order, Order.id == VendorOrder.order_id)
        .filter(Order.status != "Cancelled")
        .group_by(Category.name)
        .order_by(func.sum(OrderItem.unit_price * OrderItem.quantity).desc())
        .all()
    )
    category_sales = [{"label": name, "sales": float(sales or 0)} for name, sales in category_rows]

    # 5. Top Vendors
    vendor_rows = db.query(User).filter(User.role == "vendor").all()
    top_vendors = []
    for vendor in vendor_rows:
        v_profile = db.query(VendorProfile).filter(VendorProfile.user_id == vendor.id).first()
        prod_count = db.query(Product).filter(Product.vendor_id == vendor.id).count()
        rev = (
            db.query(func.coalesce(func.sum(VendorOrder.subtotal), 0.0))
            .join(Order, Order.id == VendorOrder.order_id)
            .filter(VendorOrder.vendor_id == vendor.id, Order.status != "Cancelled")
            .scalar()
        )
        comm = (
            db.query(func.coalesce(func.sum(VendorOrder.commission_amount), 0.0))
            .join(Order, Order.id == VendorOrder.order_id)
            .filter(VendorOrder.vendor_id == vendor.id, Order.status != "Cancelled")
            .scalar()
        )
        store_title = (v_profile.store_name if v_profile else None) or vendor.store_name or vendor.full_name
        top_vendors.append({
            "id": vendor.id,
            "name": store_title,
            "products": prod_count,
            "revenue": float(rev or 0),
            "commission": float(comm or 0),
        })
    top_vendors.sort(key=lambda v: v["revenue"], reverse=True)

    # 6. Recent Orders
    recent_rows = db.query(Order).order_by(Order.created_at.desc()).limit(8).all()
    recent_orders = []
    for o in recent_rows:
        cust = db.query(User).filter(User.id == o.customer_id).first()
        vendors = (
            db.query(User.full_name, User.store_name)
            .join(VendorOrder, VendorOrder.vendor_id == User.id)
            .filter(VendorOrder.order_id == o.id)
            .all()
        )
        v_names = ", ".join(store or name for name, store in vendors) if vendors else "—"
        recent_orders.append({
            "id": o.order_number or f"#NX-{o.id}",
            "raw_id": o.id,
            "customer": cust.full_name if cust else "Shopper",
            "vendor": v_names,
            "total": float(o.total_amount),
            "status": o.status,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "timeline": [
                {"actor_role": event.actor_role, "status": event.status, "note": event.note,
                 "created_at": event.created_at.isoformat() if event.created_at else None}
                for event in o.events
            ],
        })

    return {
        "total_revenue": float(total_gmv or 0),
        "total_gmv": float(total_gmv or 0),
        "platform_commission": float(platform_commission or 0),
        "total_orders": total_orders,
        "active_vendors": active_vendors,
        "pending_products": pending_products,
        "total_customers": total_customers,
        "active_riders": total_riders,
        "recent_orders": recent_orders,
        "monthly_revenue": monthly_revenue,
        "category_sales": category_sales,
        "order_breakdown": order_breakdown,
        "top_vendors": top_vendors[:5],
    }


@router.get("/audit-logs")
def get_audit_logs(db: Session = Depends(get_db)):
    logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(25).all()
    result = []
    for log in logs:
        actor = db.query(User).filter(User.id == log.actor_id).first() if log.actor_id else None
        result.append({
            "id": log.id,
            "actor": actor.full_name if actor else "System",
            "actor_role": actor.role if actor else "system",
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        })
    return result
