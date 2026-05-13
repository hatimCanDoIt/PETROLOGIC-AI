"""Stripe Checkout, Billing Portal, and subscription catalog."""

from __future__ import annotations

import asyncio
import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..middleware.auth import get_current_user
from ..models.user import User
from ..schemas.billing import (
    BillingStripeStatus,
    CheckoutRequest,
    CheckoutSessionResponse,
    PlanCatalogEntry,
    PlanCatalogResponse,
    PlanPriceLine,
    PortalSessionResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/billing", tags=["billing"])


def _stripe_ready() -> bool:
    return bool(settings.STRIPE_SECRET_KEY)


def _price_id(plan_code: str, billing_interval: str) -> str | None:
    if plan_code == "solo":
        if billing_interval == "yearly":
            return settings.STRIPE_PRICE_SOLO_YEARLY
        return settings.STRIPE_PRICE_SOLO_MONTHLY
    if plan_code == "team":
        if billing_interval == "yearly":
            return settings.STRIPE_PRICE_TEAM_SEAT_YEARLY
        return settings.STRIPE_PRICE_TEAM_SEAT_MONTHLY
    return None


async def _stripe_call(fn):  # type: ignore[no-untyped-def]
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fn)


async def _create_checkout_session(**kwargs):  # type: ignore[no-untyped-def]
    def _sync():
        stripe.api_key = settings.STRIPE_SECRET_KEY or ""
        return stripe.checkout.Session.create(**kwargs)

    return await _stripe_call(_sync)


async def _create_portal_session(**kwargs):  # type: ignore[no-untyped-def]
    def _sync():
        stripe.api_key = settings.STRIPE_SECRET_KEY or ""
        return stripe.billing_portal.Session.create(**kwargs)

    return await _stripe_call(_sync)


async def _retrieve_subscription(sub_id: str):  # type: ignore[no-untyped-def]
    def _sync():
        stripe.api_key = settings.STRIPE_SECRET_KEY or ""
        return stripe.Subscription.retrieve(sub_id)

    return await _stripe_call(_sync)


@router.get("/stripe-status", response_model=BillingStripeStatus)
async def stripe_status():
    """Frontend can probe whether Checkout is expected to work."""
    checkout_ok = _stripe_ready() and bool(
        settings.STRIPE_PRICE_SOLO_MONTHLY
        and settings.STRIPE_PRICE_SOLO_YEARLY
        and settings.STRIPE_PRICE_TEAM_SEAT_MONTHLY
        and settings.STRIPE_PRICE_TEAM_SEAT_YEARLY
    )
    return BillingStripeStatus(checkout_configured=checkout_ok)


@router.get("/plans", response_model=PlanCatalogResponse)
async def list_plans():
    """Marketing-style catalog mirrored for the SPA (amounts align with Stripe)."""
    solo = PlanCatalogEntry(
        code="solo",
        title="Solo",
        blurb="One petro-engineer workstation with deterministic petrophysics and AI narration.",
        monthly=PlanPriceLine(
            label="Monthly billing",
            amount_note=f"$500/month after the {settings.SOLO_TRIAL_DAYS}-day trial",
        ),
        yearly=PlanPriceLine(
            label="Yearly billing",
            amount_note="$4,800/year (20% versus twelve monthly invoices)",
            yearly_discount_pct=20,
        ),
        trial_days=settings.SOLO_TRIAL_DAYS,
        highlights=[
            f"{settings.SOLO_TRIAL_DAYS}-day free trial — no Solo charge until the trial ends",
            "LAS uploads sized for solo interpretation workflows",
            "Email support",
        ],
        cta_kind="stripe_checkout",
    )

    team = PlanCatalogEntry(
        code="team",
        title="Team",
        blurb="Shared workspace for multidisciplinary interpretation crews.",
        seat_pricing_monthly_note="$250/seat/month (3–10 seats)",
        seat_pricing_yearly_note=(
            "~$200/seat/month effective — 20% off when prepaid annually "
            "(Stripe quantity = seat count)."
        ),
        yearly=PlanPriceLine(
            label="Yearly billing",
            amount_note="20% off each seat versus monthly invoicing.",
            yearly_discount_pct=20,
        ),
        highlights=[
            "Quantity-based billing for 3–10 collaborators",
            "Same feature set as Solo with room to grow",
            "Priority onboarding assistance",
        ],
        cta_kind="stripe_checkout",
        seats_min=3,
        seats_max=10,
    )

    enterprise = PlanCatalogEntry(
        code="enterprise",
        title="Enterprise",
        blurb="For organizations with more than ten seats, SSO requirements, or custom contracts.",
        monthly=None,
        highlights=[
            "Volume licensing mapped to procurement workflows",
            "Security reviews & bespoke uptime expectations",
            "Dedicated technical liaison",
        ],
        cta_kind="contact_sales",
        contact_email=settings.BILLING_ENTERPRISE_CONTACT_EMAIL,
        seats_min=11,
        seats_max=None,
    )

    return PlanCatalogResponse(plans=[solo, team, enterprise])


@router.post(
    "/checkout",
    response_model=CheckoutSessionResponse,
    responses={503: {"description": "Stripe is not configured"}},
)
async def create_checkout(
    payload: CheckoutRequest,
    current_user: User = Depends(get_current_user),
):
    if not _stripe_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Stripe billing is not configured. Set STRIPE_SECRET_KEY plus price IDs."
            ),
        )
    price = _price_id(payload.plan_code, payload.billing_interval)
    if not price:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Missing Stripe price ID for this plan and billing interval.",
        )

    qty = payload.seat_count if payload.plan_code == "team" else 1
    kwargs: dict = dict(
        mode="subscription",
        client_reference_id=current_user.id,
        line_items=[{"price": price, "quantity": qty}],
        success_url=(
            f"{settings.FRONTEND_URL}/billing?"
            "checkout=success&session_id={CHECKOUT_SESSION_ID}"
        ),
        cancel_url=f"{settings.FRONTEND_URL}/subscription?checkout=canceled",
        metadata={
            "user_id": current_user.id,
            "plan_code": payload.plan_code,
            "billing_interval": payload.billing_interval,
            "seat_quantity": str(qty),
        },
        allow_promotion_codes=True,
    )

    subscription_meta = {
        "user_id": current_user.id,
        "plan_code": payload.plan_code,
    }
    if payload.plan_code == "solo":
        kwargs["subscription_data"] = {
            "trial_period_days": settings.SOLO_TRIAL_DAYS,
            "metadata": subscription_meta,
        }
    else:
        kwargs["subscription_data"] = {"metadata": subscription_meta}

    if current_user.stripe_customer_id:
        kwargs["customer"] = current_user.stripe_customer_id
    else:
        kwargs["customer_email"] = current_user.email

    try:
        sess = await _create_checkout_session(**kwargs)
    except stripe.StripeError as exc:  # type: ignore[attr-defined]
        logger.warning("Stripe Checkout error: %s", exc)
        user_msg = getattr(exc, "user_message", None) or str(exc)
        http_status = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if "auth" in str(exc).lower() or "permission" in str(exc).lower()
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=http_status, detail=user_msg) from exc

    return CheckoutSessionResponse(url=sess.url)


@router.post(
    "/portal",
    response_model=PortalSessionResponse,
    responses={
        400: {"description": "Customer has not completed Checkout yet"},
        503: {"description": "Stripe is not configured"},
    },
)
async def create_portal_session(
    current_user: User = Depends(get_current_user),
):
    if not _stripe_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe billing is not configured.",
        )
    if not current_user.stripe_customer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No Stripe customer on file yet — start a subscription from the Subscription page.",
        )
    try:
        sess = await _create_portal_session(
            customer=current_user.stripe_customer_id,
            return_url=f"{settings.FRONTEND_URL}/billing",
        )
    except stripe.StripeError as exc:  # type: ignore[attr-defined]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=getattr(exc, "user_message", None) or str(exc),
        ) from exc
    return PortalSessionResponse(url=sess.url)


def _stripe_status_normalize(stripe_status: str | None) -> str | None:
    return stripe_status or None


@router.post("/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Raw-body Stripe webhook — updates user's billing snapshot fields."""
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe webhook signing secret is not configured.",
        )
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe secret key is not configured.",
        )

    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    if not sig:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Missing signature.")

    stripe.api_key = settings.STRIPE_SECRET_KEY or ""
    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig,
            secret=settings.STRIPE_WEBHOOK_SECRET,
        )
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Invalid payload."
        ) from exc
    except stripe.SignatureVerificationError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe signature."
        ) from exc

    etype = event["type"]

    try:
        if etype == "checkout.session.completed":
            obj = event["data"]["object"]
            uid = (obj.get("metadata") or {}).get("user_id") or obj.get(
                "client_reference_id"
            )
            cust = obj.get("customer")
            sub_id = obj.get("subscription")
            meta_plan = (obj.get("metadata") or {}).get("plan_code")
            if uid and cust and sub_id:
                row = await db.execute(select(User).where(User.id == uid))
                u = row.scalar_one_or_none()
                if u:
                    u.stripe_customer_id = cust  # type: ignore[assignment]
                    u.stripe_subscription_id = sub_id  # type: ignore[assignment]
                    u.billing_plan = meta_plan  # type: ignore[assignment]
                    try:
                        sub = await _retrieve_subscription(sub_id)
                        status_val = getattr(sub, "status", None)
                        u.billing_status = _stripe_status_normalize(status_val)  # type: ignore[assignment]
                    except stripe.StripeError:  # type: ignore[attr-defined]
                        u.billing_status = "active"  # type: ignore[assignment]
                    await db.commit()

        elif etype == "customer.subscription.updated":
            obj = event["data"]["object"]
            sub_id = obj.get("id")
            row = await db.execute(
                select(User).where(User.stripe_subscription_id == sub_id)
            )
            u = row.scalar_one_or_none()
            if u:
                plan_code = (obj.get("metadata") or {}).get("plan_code")
                if plan_code in ("solo", "team"):
                    u.billing_plan = plan_code  # type: ignore[assignment]
                status_raw = obj.get("status")
                u.billing_status = _stripe_status_normalize(status_raw)  # type: ignore[assignment]
                if status_raw == "canceled":
                    u.stripe_subscription_id = None  # type: ignore[assignment]
                await db.commit()

        elif etype == "customer.subscription.deleted":
            obj = event["data"]["object"]
            sub_id = obj.get("id")
            row = await db.execute(
                select(User).where(User.stripe_subscription_id == sub_id)
            )
            u = row.scalar_one_or_none()
            if u:
                u.billing_status = "canceled"  # type: ignore[assignment]
                u.stripe_subscription_id = None  # type: ignore[assignment]
                await db.commit()
        else:
            logger.debug("Unhandled Stripe webhook type: %s", etype)

    except Exception:
        logger.exception("Stripe webhook handler failed (%s)", etype)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR) from None

    return {"received": True}
