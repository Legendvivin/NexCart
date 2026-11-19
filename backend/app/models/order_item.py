from sqlalchemy import Float, ForeignKey, Integer, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    vendor_order_id: Mapped[int] = mapped_column(ForeignKey("vendor_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[float] = mapped_column(Float, nullable=False)
    variant_options: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    vendor_order = relationship("VendorOrder", back_populates="items")
    product = relationship("Product", lazy="joined")

    @property
    def price(self) -> float:
        return self.unit_price

    @property
    def order_id(self) -> int:
        return self.vendor_order.order_id if self.vendor_order else 0
