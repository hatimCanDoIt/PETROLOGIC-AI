"""Authentication endpoints.

Email + password login is fully implemented. Google OAuth is stubbed — the
endpoints return 503 when the OAuth credentials have not been configured, so
the rest of the application still runs without external credentials.
"""

from __future__ import annotations

import logging
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..middleware.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from ..models.user import User
from ..models.well import Well
from ..schemas.auth import (
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    TokenResponse,
    UserMe,
    UserPublic,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Email / password
# ---------------------------------------------------------------------------


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )
    user = User(
        email=str(payload.email).lower(),
        name=payload.name,
        hashed_password=hash_password(payload.password),
        provider="local",
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )
    await db.refresh(user)
    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserPublic.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == str(payload.email).lower()))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )
    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserPublic.model_validate(user),
    )


@router.get("/me", response_model=UserMe)
async def me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count_q = await db.execute(
        select(func.count(Well.id)).where(Well.user_id == current_user.id)
    )
    well_count = int(count_q.scalar() or 0)
    return UserMe(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        provider=current_user.provider,
        created_at=current_user.created_at,
        well_count=well_count,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout():
    """Stateless JWT — the client just discards the token."""
    return MessageResponse(message="Logged out.")


# ---------------------------------------------------------------------------
# Google OAuth (stubbed — only active when env vars are set)
# ---------------------------------------------------------------------------


_GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo"


def _google_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


@router.get("/google")
async def google_login(request: Request):
    """Redirect the user to Google's consent screen."""
    if not _google_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured on this server.",
        )
    state = secrets.token_urlsafe(24)
    request.session["oauth_state"] = state  # type: ignore[attr-defined]
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "response_type": "code",
        "scope": "openid email profile",
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return RedirectResponse(url=f"{_GOOGLE_AUTHORIZE}?{urlencode(params)}")


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    if not _google_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured on this server.",
        )
    if not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing authorization code.",
        )

    # Best-effort CSRF check
    try:
        stored_state = request.session.get("oauth_state")  # type: ignore[attr-defined]
        if stored_state and state and stored_state != state:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OAuth state mismatch.",
            )
    except Exception:
        pass  # session middleware optional

    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            _GOOGLE_TOKEN,
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            logger.warning("Google token exchange failed: %s", token_resp.text)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google token exchange failed.",
            )
        access_token = token_resp.json().get("access_token")
        if not access_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google did not return an access token.",
            )

        user_resp = await client.get(
            _GOOGLE_USERINFO,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not fetch Google user info.",
            )
        info = user_resp.json()

    google_id = info.get("sub")
    email = (info.get("email") or "").lower()
    name = info.get("name") or email.split("@")[0]
    if not google_id or not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google response missing required fields.",
        )

    # Find by google_id or email
    q = await db.execute(
        select(User).where((User.google_id == google_id) | (User.email == email))
    )
    user = q.scalar_one_or_none()
    if user is None:
        user = User(
            email=email,
            name=name,
            provider="google",
            google_id=google_id,
        )
        db.add(user)
    else:
        if user.google_id != google_id:
            user.google_id = google_id
        if user.provider != "google":
            user.provider = "google"
    await db.commit()
    await db.refresh(user)

    jwt_token = create_access_token(user.id)
    redirect = f"{settings.FRONTEND_URL.rstrip('/')}/oauth-callback?token={jwt_token}"
    return RedirectResponse(url=redirect)
