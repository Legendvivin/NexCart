from typing import List
from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class VendorOrder(Base):
    __tablename__ = "vendor_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    subtotal: Mapped[float] = mapped_column(Float, nullable=False)
    commission_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    payout_status: Mapped[str] = mapped_column(String, default="Pending", nullable=False)  # Pending, Paid, Processing
    status: Mapped[str] = mapped_column(String, default="Processing", nullable=False)

    order = relationship("Order", back_populates="vendor_orders")
    vendor = relationship("User", foreign_keys=[vendor_id], backref="vendor_orders", lazy="joined")
    items = relationship("OrderItem", back_populates="vendor_order", cascade="all, delete-orphan", lazy="selectin")
