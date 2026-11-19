from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    vendor_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, index=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    discount_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    brand: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sku: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    cost_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    weight: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    specifications: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    variant_images: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    variant_configurations: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    highlights: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    admin_terms: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String, default="Pending", nullable=False)  # Pending, Approved, Rejected
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(timezone.utc))

    # Compatibility properties / relationships
    vendor = relationship("User", backref="products", lazy="joined")
    category = relationship("Category", backref="products", lazy="joined")
    images = relationship("ProductImage", back_populates="product", cascade="all, delete-orphan", lazy="selectin")
    inventory_item = relationship("Inventory", back_populates="product", uselist=False, cascade="all, delete-orphan", lazy="joined")
    reviews = relationship("Review", back_populates="product", cascade="all, delete-orphan", lazy="selectin")

    @property
    def stock(self) -> int:
        if self.inventory_item:
            return self.inventory_item.stock_qty
        return 0

    @property
    def image_url(self) -> Optional[str]:
        if self.images:
            for img in self.images:
                if img.is_primary:
                    return img.image_url
            return self.images[0].image_url
        return None
