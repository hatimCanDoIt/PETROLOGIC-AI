"""User ORM model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from uuid import uuid4

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base

if TYPE_CHECKING:
    from .well import Well


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid4())
    )
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    hashed_password: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    provider: Mapped[str] = mapped_column(String, default="local", nullable=False)
    google_id: Mapped[Optional[str]] = mapped_column(
        String, nullable=True, unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    wells: Mapped[List["Well"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
