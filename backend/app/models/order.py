from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_number: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    address_id: Mapped[Optional[int]] = mapped_column(ForeignKey("addresses.id", ondelete="SET NULL"), nullable=True, index=True)
    shipping_address: Mapped[str] = mapped_column(Text, nullable=False)
    total_amount: Mapped[float] = mapped_column(Float, nullable=False)
    payment_method: Mapped[str] = mapped_column(String, nullable=False, default="COD")
    status: Mapped[str] = mapped_column(String, nullable=False, default="Processing")  # Processing, Shipped, Out for Delivery, Delivered, Cancelled
    delivery_otp: Mapped[str] = mapped_column(String, nullable=False)
    rider_fee: Mapped[float] = mapped_column(Float, nullable=False, default=65.0)
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    delivery_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delivery_lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc))

    # Relationships
    customer = relationship("User", foreign_keys=[customer_id], backref="orders", lazy="joined")
    address = relationship("Address", foreign_keys=[address_id], lazy="joined")
    vendor_orders = relationship("VendorOrder", back_populates="order", cascade="all, delete-orphan", lazy="selectin")
    payment = relationship("Payment", back_populates="order", uselist=False, cascade="all, delete-orphan", lazy="joined")
    delivery = relationship("Delivery", back_populates="order", uselist=False, cascade="all, delete-orphan", lazy="joined")
    events = relationship("OrderEvent", back_populates="order", cascade="all, delete-orphan", lazy="selectin", order_by="OrderEvent.created_at.asc()")

    # Convenience properties for backward compatibility
    @property
    def rider_id(self) -> Optional[int]:
        return self.delivery.rider_id if self.delivery else None

    @property
    def assigned_rider(self) -> Optional[str]:
        return self.delivery.rider.full_name if (self.delivery and self.delivery.rider) else None

