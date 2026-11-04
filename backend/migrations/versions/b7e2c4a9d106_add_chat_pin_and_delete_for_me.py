"""Add chat delete-for-me and pin tables

Revision ID: b7e2c4a9d106
Revises: a3c91d5e7b20
Create Date: 2026-10-13 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b7e2c4a9d106'
down_revision = 'a3c91d5e7b20'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('conversation_states',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('conversation_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('cleared_message_id', sa.Integer(), nullable=False),
    sa.Column('is_hidden', sa.Boolean(), nullable=False),
    sa.Column('pinned_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('conversation_id', 'user_id', name='uq_conversation_state_user')
    )
    with op.batch_alter_table('conversation_states', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_conversation_states_conversation_id'), ['conversation_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_conversation_states_user_id'), ['user_id'], unique=False)

    op.create_table('message_pins',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('conversation_id', sa.Integer(), nullable=False),
    sa.Column('message_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ),
    sa.ForeignKeyConstraint(['message_id'], ['messages.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('message_id', 'user_id', name='uq_message_pin_user')
    )
    with op.batch_alter_table('message_pins', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_message_pins_conversation_id'), ['conversation_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_message_pins_message_id'), ['message_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_message_pins_user_id'), ['user_id'], unique=False)


def downgrade():
    with op.batch_alter_table('message_pins', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_message_pins_user_id'))
        batch_op.drop_index(batch_op.f('ix_message_pins_message_id'))
        batch_op.drop_index(batch_op.f('ix_message_pins_conversation_id'))

    op.drop_table('message_pins')

    with op.batch_alter_table('conversation_states', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_conversation_states_user_id'))
        batch_op.drop_index(batch_op.f('ix_conversation_states_conversation_id'))

    op.drop_table('conversation_states')