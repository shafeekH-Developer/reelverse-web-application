from datetime import datetime

from app.extensions import db


class ConversationState(db.Model):
    """
    Personal settings of ONE user for ONE conversation.

    - cleared_message_id : messages with id <= this are hidden for this
      user ("delete chat for me"). The other person is not affected.
    - is_hidden          : the conversation is removed from this user's
      inbox. It comes back by itself when a new message is sent.
    - pinned_at          : set when this user pinned the chat (max 3).
    """

    __tablename__ = "conversation_states"

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

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
        index=True
    )

    cleared_message_id = db.Column(
        db.Integer,
        default=0,
        nullable=False
    )

    is_hidden = db.Column(
        db.Boolean,
        default=False,
        nullable=False
    )

    pinned_at = db.Column(
        db.DateTime,
        nullable=True
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False
    )

    __table_args__ = (
        db.UniqueConstraint(
            "conversation_id",
            "user_id",
            name="uq_conversation_state_user"
        ),
    )