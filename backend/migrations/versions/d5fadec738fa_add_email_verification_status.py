"""Add email verification status

Revision ID: d5fadec738fa
Revises: 83cd6f054537
Create Date: 2026-09-30 21:39:46.705053

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd5fadec738fa'
down_revision = '83cd6f054537'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table(
        'email_verifications',
        schema=None
    ) as batch_op:

        batch_op.add_column(
            sa.Column(
                'is_verified',
                sa.Boolean(),
                nullable=False,
                server_default=sa.false()
            )
        )


def downgrade():
    with op.batch_alter_table(
        'email_verifications',
        schema=None
    ) as batch_op:

        batch_op.drop_column(
            'is_verified'
        )