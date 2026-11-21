from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from sqlalchemy import select

from app.extensions import db
from app.models.user import User
from app.models.video import Video


# Helpers that hide everything that belongs to a banned user.
# Use them in any query that shows videos or users to normal visitors.

def banned_user_ids():
    # A subquery with the ids of all banned users.
    return select(User.id).where(User.is_banned.is_(True))


def visible_videos_filter():
    # Add to a Video query:  Video.query.filter(visible_videos_filter())
    return ~Video.creator_id.in_(banned_user_ids())


def requester_is_admin():
    # True when the request carries the login token of an admin.
    # Lets the admin open a banned user's video from the Admin page.
    try:
        verify_jwt_in_request(optional=True)
        identity = get_jwt_identity()
    except Exception:
        return False

    if not identity:
        return False

    admin = db.session.get(User, int(identity))

    return bool(admin and admin.is_admin and not admin.is_banned)