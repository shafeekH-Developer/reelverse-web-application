"""add admin and ban flags

Revision ID: 70a9a34235a3
Revises: c8f3d5b1e217
Create Date: 2026-11-21

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '70a9a34235a3'
down_revision = 'c8f3d5b1e217'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'is_admin',
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False
            )
        )
        batch_op.add_column(
            sa.Column(
                'is_banned',
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False
            )
        )


def downgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('is_banned')
        batch_op.drop_column('is_admin')