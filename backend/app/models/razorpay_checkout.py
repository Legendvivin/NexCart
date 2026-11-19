from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RazorpayCheckout(Base):
    __tablename__ = "razorpay_checkouts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    checkout_id: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    razorpay_order_id: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    shipping_address: Mapped[str] = mapped_column(String, nullable=False)
    items: Mapped[list] = mapped_column(JSON, nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    coupon_code: Mapped[str] = mapped_column(String, default="", nullable=False)
    status: Mapped[str] = mapped_column(String, default="Created", nullable=False)
    order_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc))
