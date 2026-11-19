from typing import Optional
from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship, backref

from app.core.database import Base


class VendorProfile(Base):
    __tablename__ = "vendor_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    store_name: Mapped[str] = mapped_column(String, nullable=False)
    gst_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    bank_account: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    commission_rate: Mapped[float] = mapped_column(Float, default=10.0, nullable=False)
    rating: Mapped[float] = mapped_column(Float, default=5.0, nullable=False)
    kyc_status: Mapped[str] = mapped_column(String, default="Approved", nullable=False)
    store_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    store_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    store_lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    user = relationship("User", backref=backref("vendor_profile", uselist=False), lazy="joined")
