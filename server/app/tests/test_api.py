"""End-to-end API tests using FastAPI's TestClient + SQLite.

We rebuild the DB engine in-process to talk to an in-memory SQLite database
via aiosqlite. JSON columns are stored as TEXT under SQLite which works fine
for tests.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import database
from app.database import Base, get_db
from app.main import app


@pytest.fixture(scope="module")
def client():
    # Use a file-backed sqlite so the same engine survives across the test.
    db_file = Path("./_test_petrologic.sqlite")
    if db_file.exists():
        db_file.unlink()

    test_url = f"sqlite+aiosqlite:///{db_file.resolve().as_posix()}"
    test_engine = create_async_engine(test_url, future=True)
    test_session = async_sessionmaker(test_engine, expire_on_commit=False)

    # Swap the app's engine + session
    database.engine = test_engine
    database.AsyncSessionLocal = test_session

    async def _override():
        async with test_session() as s:
            try:
                yield s
            finally:
                await s.close()

    app.dependency_overrides[get_db] = _override

    async def _init():
        async with test_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.get_event_loop().run_until_complete(_init())

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()
    if db_file.exists():
        db_file.unlink()


def test_register_and_login_flow(client):
    r = client.post(
        "/api/auth/register",
        json={
            "email": "tester@example.com",
            "name": "Tester",
            "password": "supersecret123",
            "confirm_password": "supersecret123",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == "tester@example.com"
    token = body["access_token"]

    # Duplicate registration -> 409
    r2 = client.post(
        "/api/auth/register",
        json={
            "email": "tester@example.com",
            "name": "Tester",
            "password": "supersecret123",
            "confirm_password": "supersecret123",
        },
    )
    assert r2.status_code == 409

    # Login
    r3 = client.post(
        "/api/auth/login",
        json={"email": "tester@example.com", "password": "supersecret123"},
    )
    assert r3.status_code == 200
    assert "access_token" in r3.json()

    # /me
    r4 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r4.status_code == 200
    assert r4.json()["email"] == "tester@example.com"


def test_unauthorized_well_list(client):
    r = client.get("/api/wells")
    assert r.status_code == 401


def test_upload_and_list_wells(client, synthetic_las_bytes):
    # Login
    login = client.post(
        "/api/auth/login",
        json={"email": "tester@example.com", "password": "supersecret123"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Upload synthetic LAS (AI call will fail without API key → handled gracefully)
    files = {"las_file": ("synthetic.las", synthetic_las_bytes, "text/plain")}
    data = {"rho_ma": "2.71", "Rw": "0.1"}
    r = client.post("/api/wells/upload", headers=headers, files=files, data=data)
    assert r.status_code == 201, r.text
    body = r.json()
    well_id = body["id"]
    assert body["well_name"] == "SYNTHETIC-1"
    assert body["zone_count"] >= 1

    # List
    r2 = client.get("/api/wells", headers=headers)
    assert r2.status_code == 200
    assert any(w["id"] == well_id for w in r2.json())

    # Detail
    r3 = client.get(f"/api/wells/{well_id}", headers=headers)
    assert r3.status_code == 200
    detail = r3.json()
    assert "result_json" in detail
    assert "overview" in detail["result_json"]
    assert detail["zones"]

    # Export
    r4 = client.get(f"/api/wells/{well_id}/export", headers=headers)
    assert r4.status_code == 200
    assert r4.headers["content-type"].startswith("text/csv")
    assert b"DEPTH" in r4.content

    # Reanalyze with stricter cutoffs
    r5 = client.post(
        f"/api/wells/{well_id}/reanalyze",
        headers=headers,
        json={"Rt_cutoff": 30.0, "Shc_cutoff": 0.4},
    )
    assert r5.status_code == 200

    # Delete
    r6 = client.delete(f"/api/wells/{well_id}", headers=headers)
    assert r6.status_code == 204
    r7 = client.get(f"/api/wells/{well_id}", headers=headers)
    assert r7.status_code == 404
