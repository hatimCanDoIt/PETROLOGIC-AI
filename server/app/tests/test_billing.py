"""Billing catalog and Checkout guard tests."""

from fastapi.testclient import TestClient


def test_billing_plans_is_public(client: TestClient):
    r = client.get("/api/billing/plans")
    assert r.status_code == 200, r.text
    data = r.json()
    codes = {p["code"] for p in data["plans"]}
    assert codes == {"solo", "team", "enterprise"}


def test_stripe_status_public(client: TestClient):
    r = client.get("/api/billing/stripe-status")
    assert r.status_code == 200
    body = r.json()
    assert "checkout_configured" in body
    assert body["checkout_configured"] is False


def test_checkout_requires_auth(client: TestClient):
    r = client.post(
        "/api/billing/checkout",
        json={"plan_code": "solo", "billing_interval": "monthly"},
    )
    assert r.status_code == 401


def test_checkout_requires_stripe_env(client: TestClient):
    reg = client.post(
        "/api/auth/register",
        json={
            "email": "billing_checkout_tester@example.com",
            "name": "Stripe Tester",
            "password": "supersecret123",
            "confirm_password": "supersecret123",
        },
    )
    assert reg.status_code == 201, reg.text

    login = client.post(
        "/api/auth/login",
        json={
            "email": "billing_checkout_tester@example.com",
            "password": "supersecret123",
        },
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    r = client.post(
        "/api/billing/checkout",
        headers=headers,
        json={"plan_code": "solo", "billing_interval": "monthly"},
    )
    assert r.status_code == 503, r.text
