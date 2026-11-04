from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db
from app.models.like import Like
from app.models.video import Video
from app.models.notification import Notification

like_bp = Blueprint("like", __name__)


# ==========================
# Get My Liked Videos
# ==========================
@like_bp.route("/likes/me", methods=["GET"])
@jwt_required()
def get_my_liked_videos():

    current_user = int(get_jwt_identity())

    likes = Like.query.filter_by(
        user_id=current_user
    ).all()

    liked_video_ids = [
        like.video_id
        for like in likes
    ]

    return jsonify({
        "liked_video_ids": liked_video_ids
    }), 200


# ==========================
# Like a Video
# ==========================
@like_bp.route("/videos/<int:video_id>/like", methods=["POST"])
@jwt_required()
def like_video(video_id):

    current_user = int(get_jwt_identity())

    video = Video.query.get(video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    existing_like = Like.query.filter_by(
        user_id=current_user,
        video_id=video_id
    ).first()

    if existing_like:
        return jsonify({
            "message": "You already liked this video."
        }), 400

    new_like = Like(
        user_id=current_user,
        video_id=video_id
    )

    db.session.add(new_like)

    # ==========================
    # Create Notification
    # ==========================
    if video.creator_id != current_user:

        notification = Notification(
            user_id=video.creator_id,
            sender_id=current_user,
            type="like",
            message="Someone liked your video.",
            video_id=video.id
        )

        db.session.add(notification)

    db.session.commit()

    return jsonify({
        "message": "Video liked successfully!"
    }), 201


# ==========================
# Unlike a Video
# ==========================
@like_bp.route("/videos/<int:video_id>/like", methods=["DELETE"])
@jwt_required()
def unlike_video(video_id):

    current_user = int(get_jwt_identity())

    like = Like.query.filter_by(
        user_id=current_user,
        video_id=video_id
    ).first()

    if not like:
        return jsonify({
            "message": "Like not found."
        }), 404

    db.session.delete(like)

    db.session.commit()

    return jsonify({
        "message": "Video unliked successfully!"
    }), 200


# ==========================
# Get Total Likes
# ==========================
@like_bp.route("/videos/<int:video_id>/likes", methods=["GET"])
def total_likes(video_id):

    video = Video.query.get(video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    total = Like.query.filter_by(
        video_id=video_id
    ).count()

    return jsonify({
        "video_id": video_id,
        "total_likes": total
    }), 200