from datetime import datetime

from app.extensions import db


class SearchHistory(db.Model):

    __tablename__ = "search_history"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    user_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False,
        index=True
    )

    # Python attribute = search_text
    # Database column remains = query
    search_text = db.Column(
        "query",
        db.String(255),
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.utcnow,
        nullable=False
    )