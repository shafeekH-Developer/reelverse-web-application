from datetime import datetime

from app.extensions import db


class Message(db.Model):
    __tablename__ = "messages"

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

    sender_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
        index=True
    )

    receiver_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
        index=True
    )

    # text / image / video
    message_type = db.Column(
        db.String(20),
        default="text",
        nullable=False
    )

    content = db.Column(
        db.Text,
        nullable=True
    )

    media_url = db.Column(
        db.String(500),
        nullable=True
    )

    reply_to_id = db.Column(
        db.Integer,
        db.ForeignKey("messages.id"),
        nullable=True
    )

    is_read = db.Column(
        db.Boolean,
        default=False,
        nullable=False
    )

    read_at = db.Column(
        db.DateTime,
        nullable=True
    )

    is_unsent = db.Column(
        db.Boolean,
        default=False,
        nullable=False
    )

    sender_deleted = db.Column(
        db.Boolean,
        default=False,
        nullable=False
    )

    receiver_deleted = db.Column(
        db.Boolean,
        default=False,
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False,
        index=True
    )

    conversation = db.relationship(
        "Conversation",
        backref=db.backref(
            "messages",
            lazy=True,
            cascade="all, delete-orphan"
        )
    )

    reply_to = db.relationship(
        "Message",
        remote_side=[id],
        foreign_keys=[reply_to_id],
        uselist=False
    )
