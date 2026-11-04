from datetime import datetime

from app.extensions import db


class UserCover(db.Model):
    """
    Cover photo (the wide banner on a profile, like YouTube) of ONE user.

    Kept in its own table so the existing users table is not changed.
    """

    __tablename__ = "user_covers"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
        unique=True,
        index=True
    )

    cover_photo_url = db.Column(
        db.String(500),
        nullable=False
    )

    public_id = db.Column(
        db.String(255),
        nullable=True
    )

    updated_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )