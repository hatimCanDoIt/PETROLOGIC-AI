"""LLM zone-picker support: well.analysis_mode + hc_zones.ai_rationale/confidence

Revision ID: 0003_llm_zone_picker
Revises: 0002_user_stripe_billing
Create Date: 2026-05-17

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0003_llm_zone_picker"
down_revision: Union[str, None] = "0002_user_stripe_billing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wells",
        sa.Column(
            "analysis_mode",
            sa.String(),
            nullable=False,
            server_default="deterministic",
        ),
    )
    op.add_column("hc_zones", sa.Column("ai_rationale", sa.Text(), nullable=True))
    op.add_column("hc_zones", sa.Column("ai_confidence", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("hc_zones", "ai_confidence")
    op.drop_column("hc_zones", "ai_rationale")
    op.drop_column("wells", "analysis_mode")
