"""FastAPI application entry point."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from .config import settings
from .routers import auth as auth_router
from .routers import wells as wells_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s [%(name)s] %(message)s",
)

app = FastAPI(
    title="PETROLOGIC AI",
    version="1.0.0",
    description=(
        "AI-Powered Well Log Analysis. Deterministic petrophysics + Claude "
        "interpretation. Results must be validated by a licensed petrophysicist."
    ),
)

# Session middleware (required for OAuth state). Uses signed-cookie session.
app.add_middleware(SessionMiddleware, secret_key=settings.JWT_SECRET)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(auth_router.router)
app.include_router(wells_router.router)


@app.get("/")
async def root():
    return {
        "app": "PETROLOGIC AI",
        "version": app.version,
        "status": "ok",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
