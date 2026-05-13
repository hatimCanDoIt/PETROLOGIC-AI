"""Application configuration loaded from environment variables.

All configuration values are read once at process start via Pydantic's
``BaseSettings``. The settings object is exposed as a module-level singleton
``settings`` so we don't re-parse environment variables on every request.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Server-side runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Database
    DATABASE_URL: str = (
        "postgresql+asyncpg://petrologic:petrologic@localhost:5432/petrologic"
    )

    # JWT
    JWT_SECRET: str = "change-me-please-this-must-be-at-least-32-chars-long"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # Google OAuth (optional — endpoints return 503 when unset)
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/auth/google/callback"

    # Anthropic
    ANTHROPIC_API_KEY: Optional[str] = None
    ANTHROPIC_MODEL: str = "claude-sonnet-4-20250514"

    # Frontend / upload limits
    FRONTEND_URL: str = "http://localhost:5173"
    MAX_UPLOAD_MB: int = 50

    # CORS — comma-separated list; defaults include local dev frontends
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    # Stripe Billing (Checkout + Portal + webhook). Optional for local dev.
    STRIPE_SECRET_KEY: Optional[str] = None
    STRIPE_WEBHOOK_SECRET: Optional[str] = None
    STRIPE_PRICE_SOLO_MONTHLY: Optional[str] = None
    STRIPE_PRICE_SOLO_YEARLY: Optional[str] = None
    STRIPE_PRICE_TEAM_SEAT_MONTHLY: Optional[str] = None
    STRIPE_PRICE_TEAM_SEAT_YEARLY: Optional[str] = None
    SOLO_TRIAL_DAYS: int = 7
    # Shown on enterprise CTAs when no Stripe product exists for this tier.
    BILLING_ENTERPRISE_CONTACT_EMAIL: str = "sales@example.com"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.MAX_UPLOAD_MB * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
