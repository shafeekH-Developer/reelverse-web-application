"""Add user cover photos

Revision ID: c8f3d5b1e217
Revises: b7e2c4a9d106
Create Date: 2026-10-16 13:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c8f3d5b1e217'
down_revision = 'b7e2c4a9d106'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('user_covers',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('cover_photo_url', sa.String(length=500), nullable=False),
    sa.Column('public_id', sa.String(length=255), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('user_covers', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_user_covers_user_id'), ['user_id'], unique=True)


def downgrade():
    with op.batch_alter_table('user_covers', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_user_covers_user_id'))

    op.drop_table('user_covers')