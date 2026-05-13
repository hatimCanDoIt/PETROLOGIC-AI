"""Pydantic schemas for authentication endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=200)
    confirm_password: str = Field(min_length=8, max_length=200)

    @model_validator(mode="after")
    def _passwords_match(self) -> "RegisterRequest":
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match.")
        return self


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    name: str

    model_config = ConfigDict(from_attributes=True)


class UserMe(BaseModel):
    id: str
    email: EmailStr
    name: str
    provider: str
    created_at: datetime
    well_count: int = 0
    billing_plan: Optional[str] = None
    billing_status: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class MessageResponse(BaseModel):
    message: str
    detail: Optional[str] = None
