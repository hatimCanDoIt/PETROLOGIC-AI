"""user stripe + billing snapshot columns

Revision ID: 0002_user_stripe_billing
Revises: 0001_initial
Create Date: 2026-05-13

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_user_stripe_billing"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("stripe_customer_id", sa.String(), nullable=True))
    op.add_column(
        "users", sa.Column("stripe_subscription_id", sa.String(), nullable=True)
    )
    op.add_column("users", sa.Column("billing_plan", sa.String(), nullable=True))
    op.add_column("users", sa.Column("billing_status", sa.String(), nullable=True))
    op.create_index("ix_users_stripe_customer_id", "users", ["stripe_customer_id"])


def downgrade() -> None:
    op.drop_index("ix_users_stripe_customer_id", table_name="users")
    op.drop_column("users", "billing_status")
    op.drop_column("users", "billing_plan")
    op.drop_column("users", "stripe_subscription_id")
    op.drop_column("users", "stripe_customer_id")
