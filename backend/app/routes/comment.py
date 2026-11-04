from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db
from app.models.comment import Comment, CommentLike
from app.models.video import Video
from app.models.user import User
from app.models.notification import Notification

comment_bp = Blueprint("comment", __name__)


# ==========================
# Add Comment
# ==========================
@comment_bp.route("/videos/<int:video_id>/comments", methods=["POST"])
@jwt_required()
def add_comment(video_id):

    current_user = int(get_jwt_identity())

    video = Video.query.get(video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    data = request.get_json()

    if not data or "content" not in data or not data["content"].strip():
        return jsonify({
            "message": "Comment content is required."
        }), 400

    comment = Comment(
        content=data["content"],
        user_id=current_user,
        video_id=video_id
    )

    db.session.add(comment)

    # ==========================
    # Create Notification
    # ==========================
    if video.creator_id != current_user:

        notification = Notification(
            user_id=video.creator_id,
            sender_id=current_user,
            type="comment",
            message="Someone commented on your video.",
            video_id=video.id
        )

        db.session.add(notification)

    db.session.commit()

    return jsonify({
        "message": "Comment added successfully!",
        "comment_id": comment.id
    }), 201


# ==========================
# Get All Comments
# ==========================
@comment_bp.route("/videos/<int:video_id>/comments", methods=["GET"])
def get_comments(video_id):

    video = Video.query.get(video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    comments = Comment.query.filter_by(
        video_id=video_id
    ).all()

    comment_list = []

    for comment in comments:

        user = User.query.get(comment.user_id)

        likes_count = CommentLike.query.filter_by(
            comment_id=comment.id
        ).count()

        comment_list.append({
            "id": comment.id,
            "content": comment.content,
            "user": user.username if user else "Unknown",
            "user_id": user.id if user else None,
            "profile_photo_url": (
                user.profile_photo_url
                if user
                else None
            ),
            "created_at": comment.created_at,
            "likes_count": likes_count
        })

    # ==========================
    # Most Liked Comments First
    # ==========================
    comment_list.sort(
        key=lambda comment: (
            comment["likes_count"],
            comment["created_at"]
        ),
        reverse=True
    )

    return jsonify(comment_list), 200


# ==========================
# Update Comment
# ==========================
@comment_bp.route("/comments/<int:comment_id>", methods=["PUT"])
@jwt_required()
def update_comment(comment_id):

    current_user = int(get_jwt_identity())

    comment = Comment.query.get(comment_id)

    if not comment:
        return jsonify({
            "message": "Comment not found."
        }), 404

    if comment.user_id != current_user:
        return jsonify({
            "message": "You are not authorized to update this comment."
        }), 403

    data = request.get_json()

    if "content" in data:
        comment.content = data["content"]

    db.session.commit()

    return jsonify({
        "message": "Comment updated successfully!"
    }), 200


# ==========================
# Delete Comment
# ==========================
@comment_bp.route("/comments/<int:comment_id>", methods=["DELETE"])
@jwt_required()
def delete_comment(comment_id):

    current_user = int(get_jwt_identity())

    comment = Comment.query.get(comment_id)

    if not comment:
        return jsonify({
            "message": "Comment not found."
        }), 404

    if comment.user_id != current_user:
        return jsonify({
            "message": "You are not authorized to delete this comment."
        }), 403

    # Delete likes belonging to this comment first.
    CommentLike.query.filter_by(
        comment_id=comment_id
    ).delete()

    db.session.delete(comment)
    db.session.commit()

    return jsonify({
        "message": "Comment deleted successfully!"
    }), 200


# ==========================
# Like Comment
# ==========================
@comment_bp.route(
    "/comments/<int:comment_id>/like",
    methods=["POST"]
)
@jwt_required()
def like_comment(comment_id):

    current_user = int(get_jwt_identity())

    comment = Comment.query.get(comment_id)

    if not comment:
        return jsonify({
            "message": "Comment not found."
        }), 404

    existing_like = CommentLike.query.filter_by(
        user_id=current_user,
        comment_id=comment_id
    ).first()

    if existing_like:
        return jsonify({
            "message": "You already liked this comment."
        }), 400

    comment_like = CommentLike(
        user_id=current_user,
        comment_id=comment_id
    )

    db.session.add(comment_like)
    db.session.commit()

    likes_count = CommentLike.query.filter_by(
        comment_id=comment_id
    ).count()

    return jsonify({
        "message": "Comment liked successfully!",
        "comment_id": comment_id,
        "likes_count": likes_count,
        "liked": True
    }), 201


# ==========================
# Unlike Comment
# ==========================
@comment_bp.route(
    "/comments/<int:comment_id>/like",
    methods=["DELETE"]
)
@jwt_required()
def unlike_comment(comment_id):

    current_user = int(get_jwt_identity())

    comment = Comment.query.get(comment_id)

    if not comment:
        return jsonify({
            "message": "Comment not found."
        }), 404

    existing_like = CommentLike.query.filter_by(
        user_id=current_user,
        comment_id=comment_id
    ).first()

    if not existing_like:
        return jsonify({
            "message": "You have not liked this comment."
        }), 404

    db.session.delete(existing_like)
    db.session.commit()

    likes_count = CommentLike.query.filter_by(
        comment_id=comment_id
    ).count()

    return jsonify({
        "message": "Comment unliked successfully!",
        "comment_id": comment_id,
        "likes_count": likes_count,
        "liked": False
    }), 200


# ==========================
# Get My Liked Comments
# ==========================
@comment_bp.route(
    "/comments/likes/me",
    methods=["GET"]
)
@jwt_required()
def get_my_liked_comments():

    current_user = int(get_jwt_identity())

    likes = CommentLike.query.filter_by(
        user_id=current_user
    ).all()

    liked_comment_ids = [
        like.comment_id
        for like in likes
    ]

    return jsonify({
        "liked_comment_ids": liked_comment_ids
    }), 200