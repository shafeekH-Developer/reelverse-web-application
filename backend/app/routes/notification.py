from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db
from app.models.notification import Notification
from app.models.user import User


notification_bp = Blueprint("notification", __name__)


# ==========================
# Get My Notifications
# ==========================
@notification_bp.route("/notifications", methods=["GET"])
@jwt_required()
def get_notifications():

    current_user = int(get_jwt_identity())

    notifications = Notification.query.filter_by(
        user_id=current_user
    ).order_by(
        Notification.created_at.desc()
    ).all()

    notification_list = []

    for notification in notifications:

        sender = User.query.get(notification.sender_id)

        sender_username = (
            sender.username
            if sender
            else "Unknown user"
        )

        if notification.type == "follow":

            message = f"{sender_username} started following you."

        elif notification.type == "like":

            message = f"{sender_username} liked your video."

        elif notification.type == "comment":

            message = f"{sender_username} commented on your video."

        elif notification.type == "bookmark":

            message = f"{sender_username} bookmarked your video."

        elif notification.type == "message":

            message = f"{sender_username} sent you a message."

        else:

            message = (
                notification.message
                or "You have a new notification."
            )

        notification_list.append({
            "id": notification.id,
            "sender_id": notification.sender_id,
            "sender_username": sender_username,
            "type": notification.type,
            "message": message,
            "video_id": notification.video_id,
            "conversation_id": notification.conversation_id,
            "is_read": notification.is_read,
            "created_at": notification.created_at
        })

    return jsonify(notification_list), 200


# ==========================
# Mark One Notification As Read
# ==========================
@notification_bp.route(
    "/notifications/<int:notification_id>/read",
    methods=["PUT"]
)
@jwt_required()
def mark_notification_read(notification_id):

    current_user = int(get_jwt_identity())

    notification = Notification.query.filter_by(
        id=notification_id,
        user_id=current_user
    ).first()

    if not notification:
        return jsonify({
            "message": "Notification not found."
        }), 404

    notification.is_read = True

    db.session.commit()

    return jsonify({
        "message": "Notification marked as read."
    }), 200


# ==========================
# Mark All Notifications As Read
# ==========================
@notification_bp.route(
    "/notifications/read-all",
    methods=["PUT"]
)
@jwt_required()
def mark_all_notifications_read():

    current_user = int(get_jwt_identity())

    notifications = Notification.query.filter_by(
        user_id=current_user,
        is_read=False
    ).all()

    for notification in notifications:
        notification.is_read = True

    db.session.commit()

    return jsonify({
        "message": "All notifications marked as read."
    }), 200