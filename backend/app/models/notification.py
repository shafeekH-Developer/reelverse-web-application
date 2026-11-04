from datetime import datetime

from app.extensions import db


class Notification(db.Model):
    __tablename__ = "notifications"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False
    )

    sender_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False
    )

    type = db.Column(
        db.String(50),
        nullable=False
    )

    message = db.Column(
        db.String(255),
        nullable=False
    )

    video_id = db.Column(
        db.Integer,
        db.ForeignKey("videos.id"),
        nullable=True
    )

    # Used by direct-message notifications.
    # Existing follow/like/comment/bookmark notifications
    # will simply keep this as NULL.
    conversation_id = db.Column(
        db.Integer,
        db.ForeignKey("conversations.id"),
        nullable=True
    )

    is_read = db.Column(
        db.Boolean,
        default=False,
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False
    )