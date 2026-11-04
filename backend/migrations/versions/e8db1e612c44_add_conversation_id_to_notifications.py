"""Add conversation id to notifications

Revision ID: e8db1e612c44
Revises: 7d31df2062f9
Create Date: 2026-09-22

"""

from alembic import op
import sqlalchemy as sa


# Revision identifiers, used by Alembic.
revision = "e8db1e612c44"
down_revision = "7d31df2062f9"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table(
        "notifications",
        schema=None
    ) as batch_op:

        batch_op.add_column(
            sa.Column(
                "conversation_id",
                sa.Integer(),
                nullable=True
            )
        )

        batch_op.create_foreign_key(
            "fk_notifications_conversation_id",
            "conversations",
            ["conversation_id"],
            ["id"]
        )


def downgrade():
    with op.batch_alter_table(
        "notifications",
        schema=None
    ) as batch_op:

        batch_op.drop_constraint(
            "fk_notifications_conversation_id",
            type_="foreignkey"
        )

        batch_op.drop_column(
            "conversation_id"
        )