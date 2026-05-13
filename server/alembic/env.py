"""Alembic environment configuration.

We use the *sync* database URL here because Alembic does not natively run
under an asyncio event loop unless configured for it. The application uses
``postgresql+asyncpg://...`` at runtime; for migrations we convert that to a
plain ``postgresql://`` URL (psycopg2 driver) so Alembic can introspect and
apply migrations synchronously.
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Ensure the app package is importable
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Load server/.env so DATABASE_URL is available without exporting it manually.
# We import the Pydantic settings (which uses python-dotenv under the hood)
# rather than parsing the file ourselves.
from app.config import settings as _app_settings  # noqa: E402
from app.database import Base  # noqa: E402
from app.models import user as _user_model  # noqa: F401,E402
from app.models import well as _well_model  # noqa: F401,E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _sync_db_url() -> str:
    """Return a sync DB URL derived from DATABASE_URL (asyncpg → psycopg2)."""
    # Prefer env var if set explicitly, otherwise use the Pydantic settings
    # which has already loaded server/.env.
    url = os.getenv("DATABASE_URL") or _app_settings.DATABASE_URL
    # asyncpg → psycopg2 for migrations
    return url.replace("postgresql+asyncpg", "postgresql").replace(
        "sqlite+aiosqlite", "sqlite"
    )


def run_migrations_offline() -> None:
    context.configure(
        url=_sync_db_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    cfg = config.get_section(config.config_ini_section) or {}
    cfg["sqlalchemy.url"] = _sync_db_url()
    connectable = engine_from_config(
        cfg,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
