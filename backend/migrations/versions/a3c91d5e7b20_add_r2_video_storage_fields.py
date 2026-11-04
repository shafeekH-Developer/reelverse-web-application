"""add r2 video storage fields

Revision ID: a3c91d5e7b20
Revises: 74613bf8b441
Create Date: 2026-10-04 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3c91d5e7b20'
down_revision = '74613bf8b441'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('videos', schema=None) as batch_op:
        batch_op.add_column(sa.Column('storage_provider', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('r2_key', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('renditions', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('processing_status', sa.String(length=20), nullable=True))


def downgrade():
    with op.batch_alter_table('videos', schema=None) as batch_op:
        batch_op.drop_column('processing_status')
        batch_op.drop_column('renditions')
        batch_op.drop_column('r2_key')
        batch_op.drop_column('storage_provider')