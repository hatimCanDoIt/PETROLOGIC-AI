"""Well + HcZone ORM models."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, List, Optional
from uuid import uuid4

from sqlalchemy import JSON, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

if TYPE_CHECKING:
    from .user import User


class Well(Base):
    __tablename__ = "wells"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    well_name: Mapped[str] = mapped_column(String, nullable=False)
    api_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    operator: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    field: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    log_date: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    depth_start: Mapped[float] = mapped_column(Float, nullable=False)
    depth_stop: Mapped[float] = mapped_column(Float, nullable=False)

    curves_available: Mapped[List[Any]] = mapped_column(JSON, default=list)
    petro_params: Mapped[dict] = mapped_column(JSON, default=dict)
    result_json: Mapped[dict] = mapped_column(JSON, default=dict)
    ai_interpretation: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="wells")
    zones: Mapped[List["HcZone"]] = relationship(
        back_populates="well", cascade="all, delete-orphan"
    )


class HcZone(Base):
    __tablename__ = "hc_zones"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid4())
    )
    well_id: Mapped[str] = mapped_column(
        ForeignKey("wells.id", ondelete="CASCADE"), nullable=False, index=True
    )

    zone_type: Mapped[str] = mapped_column(String, nullable=False)  # "OIL"/"GAS"
    top_ft: Mapped[float] = mapped_column(Float, nullable=False)
    bot_ft: Mapped[float] = mapped_column(Float, nullable=False)
    thick_ft: Mapped[float] = mapped_column(Float, nullable=False)
    shc_pct: Mapped[float] = mapped_column(Float, nullable=False)
    sw_pct: Mapped[float] = mapped_column(Float, nullable=False)
    phi_pct: Mapped[float] = mapped_column(Float, nullable=False)
    rt_mean: Mapped[float] = mapped_column(Float, nullable=False)
    gr_mean: Mapped[float] = mapped_column(Float, nullable=False)
    vsh_pct: Mapped[float] = mapped_column(Float, nullable=False)
    pef_mean: Mapped[float] = mapped_column(Float, nullable=False)
    bvw_mean: Mapped[float] = mapped_column(Float, nullable=False)
    producible_pct: Mapped[float] = mapped_column(Float, nullable=False)
    lith_flag: Mapped[str] = mapped_column(String, nullable=False)
    ai_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    well: Mapped["Well"] = relationship(back_populates="zones")
