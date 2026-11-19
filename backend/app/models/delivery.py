from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Delivery(Base):
    __tablename__ = "deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    rider_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    pickup_hub: Mapped[str] = mapped_column(String, default="NexCart Central Hub", nullable=False)
    drop_address: Mapped[str] = mapped_column(Text, nullable=False)
    rider_fee: Mapped[float] = mapped_column(Float, default=65.0, nullable=False)
    status: Mapped[str] = mapped_column(String, default="Assigned", nullable=False)  # Assigned, Picked Up, Out for Delivery, Delivered
    otp_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc))
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    order = relationship("Order", back_populates="delivery")
    rider = relationship("User", foreign_keys=[rider_id], lazy="joined")
