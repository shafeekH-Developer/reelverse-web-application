from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db
from app.models.history import History
from app.models.video import Video
from app.models.user import User
from app.models.like import Like

history_bp = Blueprint("history", __name__)


# ==========================
# Add Video to History
# ==========================
@history_bp.route("/videos/<int:video_id>/history", methods=["POST"])
@jwt_required()
def add_history(video_id):

    current_user = int(get_jwt_identity())

    video = Video.query.get(video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    existing = History.query.filter_by(
        user_id=current_user,
        video_id=video_id
    ).first()

    if existing:
        existing.watched_at = db.func.now()
        db.session.commit()

        return jsonify({
            "message": "History updated."
        }), 200

    history = History(
        user_id=current_user,
        video_id=video_id
    )

    db.session.add(history)
    db.session.commit()

    return jsonify({
        "message": "History updated."
    }), 201


# ==========================
# My Watch History
# ==========================
@history_bp.route("/my-history", methods=["GET"])
@jwt_required()
def my_history():

    current_user = int(get_jwt_identity())

    history_list = History.query.filter_by(
        user_id=current_user
    ).order_by(
        History.watched_at.desc()
    ).all()

    videos = []

    for item in history_list:

        video = Video.query.get(item.video_id)

        if video:

            creator = User.query.get(video.creator_id)

            videos.append({
                "id": video.id,
                "title": video.title,
                "description": video.description,
                "thumbnail_url": video.thumbnail_url,
                "category": video.category,
                "creator": creator.username if creator else "Unknown",
                "views": video.views,
                "likes": Like.query.filter_by(
                    video_id=video.id
                ).count(),
                "watched_at": item.watched_at
            })

    return jsonify(videos), 200


# ==========================
# Clear Watch History
# ==========================
@history_bp.route("/my-history", methods=["DELETE"])
@jwt_required()
def clear_history():

    current_user = int(get_jwt_identity())

    History.query.filter_by(
        user_id=current_user
    ).delete()

    db.session.commit()

    return jsonify({
        "message": "Watch history cleared successfully!"
    }), 200