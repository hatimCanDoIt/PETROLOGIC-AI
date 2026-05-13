"""Schemas for Stripe Checkout and subscription catalog."""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


BillingInterval = Literal["monthly", "yearly"]
CheckoutPlanCode = Literal["solo", "team"]


class PlanPriceLine(BaseModel):
    """Display pricing for docs + UI parity with Stripe products."""

    label: str
    amount_note: str
    yearly_discount_pct: Optional[int] = None


class PlanCatalogEntry(BaseModel):
    code: str
    title: str
    blurb: str
    highlights: List[str]
    monthly: Optional[PlanPriceLine] = None
    yearly: Optional[PlanPriceLine] = None
    seat_pricing_monthly_note: Optional[str] = (
        None  # Team: dollars per seat / month
    )
    seat_pricing_yearly_note: Optional[str] = None
    trial_days: Optional[int] = None
    cta_kind: Literal["stripe_checkout", "contact_sales"]
    contact_email: Optional[str] = None
    seats_min: Optional[int] = None
    seats_max: Optional[int] = None


class PlanCatalogResponse(BaseModel):
    plans: List[PlanCatalogEntry]


class CheckoutRequest(BaseModel):
    plan_code: CheckoutPlanCode
    billing_interval: BillingInterval
    seat_count: Optional[int] = Field(default=None)

    @model_validator(mode="after")
    def _validate_team(self) -> "CheckoutRequest":
        if self.plan_code == "team":
            if self.seat_count is None:
                raise ValueError("seat_count is required for the team plan.")
            if self.seat_count < 3 or self.seat_count > 10:
                raise ValueError("Team subscriptions support 3 to 10 seats.")
        elif self.seat_count is not None:
            raise ValueError("seat_count is only valid for the team plan.")
        return self


class CheckoutSessionResponse(BaseModel):
    url: str


class PortalSessionResponse(BaseModel):
    url: str


class BillingStripeStatus(BaseModel):
    """Whether server-side Stripe env is wired for Checkout."""

    checkout_configured: bool
