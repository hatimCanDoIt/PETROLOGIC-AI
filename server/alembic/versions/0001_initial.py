"""initial schema: users, wells, hc_zones

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-13

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("hashed_password", sa.String(), nullable=True),
        sa.Column("provider", sa.String(), nullable=False, server_default="local"),
        sa.Column("google_id", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.UniqueConstraint("google_id", name="uq_users_google_id"),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_google_id", "users", ["google_id"])

    op.create_table(
        "wells",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("well_name", sa.String(), nullable=False),
        sa.Column("api_number", sa.String(), nullable=True),
        sa.Column("operator", sa.String(), nullable=True),
        sa.Column("field", sa.String(), nullable=True),
        sa.Column("log_date", sa.String(), nullable=True),
        sa.Column("depth_start", sa.Float(), nullable=False),
        sa.Column("depth_stop", sa.Float(), nullable=False),
        sa.Column("curves_available", sa.JSON(), nullable=True),
        sa.Column("petro_params", sa.JSON(), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("ai_interpretation", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_wells_user_id", "wells", ["user_id"])

    op.create_table(
        "hc_zones",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "well_id",
            sa.String(),
            sa.ForeignKey("wells.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("zone_type", sa.String(), nullable=False),
        sa.Column("top_ft", sa.Float(), nullable=False),
        sa.Column("bot_ft", sa.Float(), nullable=False),
        sa.Column("thick_ft", sa.Float(), nullable=False),
        sa.Column("shc_pct", sa.Float(), nullable=False),
        sa.Column("sw_pct", sa.Float(), nullable=False),
        sa.Column("phi_pct", sa.Float(), nullable=False),
        sa.Column("rt_mean", sa.Float(), nullable=False),
        sa.Column("gr_mean", sa.Float(), nullable=False),
        sa.Column("vsh_pct", sa.Float(), nullable=False),
        sa.Column("pef_mean", sa.Float(), nullable=False),
        sa.Column("bvw_mean", sa.Float(), nullable=False),
        sa.Column("producible_pct", sa.Float(), nullable=False),
        sa.Column("lith_flag", sa.String(), nullable=False),
        sa.Column("ai_note", sa.Text(), nullable=True),
    )
    op.create_index("ix_hc_zones_well_id", "hc_zones", ["well_id"])


def downgrade() -> None:
    op.drop_index("ix_hc_zones_well_id", table_name="hc_zones")
    op.drop_table("hc_zones")
    op.drop_index("ix_wells_user_id", table_name="wells")
    op.drop_table("wells")
    op.drop_index("ix_users_google_id", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
