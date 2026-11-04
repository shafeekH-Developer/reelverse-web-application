"""Add views to videos

Revision ID: aa992e2e5685
Revises: daf892ad54f8
Create Date: 2026-08-04 21:54:22.026398
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "aa992e2e5685"
down_revision = "daf892ad54f8"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("videos", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "views",
                sa.Integer(),
                nullable=False,
                server_default="0"
            )
        )


def downgrade():
    with op.batch_alter_table("videos", schema=None) as batch_op:
        batch_op.drop_column("views")