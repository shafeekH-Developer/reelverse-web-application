from datetime import datetime

from app.extensions import db


class MessagePin(db.Model):
    """A message pinned by one user (personal, the other person can't see it)."""

    __tablename__ = "message_pins"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    conversation_id = db.Column(
        db.Integer,
        db.ForeignKey("conversations.id"),
        nullable=False,
        index=True
    )

    message_id = db.Column(
        db.Integer,
        db.ForeignKey("messages.id"),
        nullable=False,
        index=True
    )

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
        index=True
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False
    )

    __table_args__ = (
        db.UniqueConstraint(
            "message_id",
            "user_id",
            name="uq_message_pin_user"
        ),
    )