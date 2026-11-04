from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db
from app.models.bookmark import Bookmark
from app.models.video import Video
from app.models.user import User
from app.models.like import Like

bookmark_bp = Blueprint("bookmark", __name__)


# ==========================
# Bookmark a Video
# ==========================
@bookmark_bp.route("/videos/<int:video_id>/bookmark", methods=["POST"])
@jwt_required()
def bookmark_video(video_id):

    current_user = int(get_jwt_identity())

    video = Video.query.get(video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    existing = Bookmark.query.filter_by(
        user_id=current_user,
        video_id=video_id
    ).first()

    if existing:
        return jsonify({
            "message": "Video already bookmarked."
        }), 400

    bookmark = Bookmark(
        user_id=current_user,
        video_id=video_id
    )

    db.session.add(bookmark)
    db.session.commit()

    return jsonify({
        "message": "Video bookmarked successfully!"
    }), 201


# ==========================
# Remove Bookmark
# ==========================
@bookmark_bp.route("/videos/<int:video_id>/bookmark", methods=["DELETE"])
@jwt_required()
def remove_bookmark(video_id):

    current_user = int(get_jwt_identity())

    bookmark = Bookmark.query.filter_by(
        user_id=current_user,
        video_id=video_id
    ).first()

    if not bookmark:
        return jsonify({
            "message": "Bookmark not found."
        }), 404

    db.session.delete(bookmark)
    db.session.commit()

    return jsonify({
        "message": "Bookmark removed successfully!"
    }), 200


# ==========================
# My Bookmarks
# ==========================
@bookmark_bp.route("/my-bookmarks", methods=["GET"])
@jwt_required()
def my_bookmarks():

    current_user = int(get_jwt_identity())

    bookmarks = Bookmark.query.filter_by(
        user_id=current_user
    ).all()

    bookmark_list = []

    for bookmark in bookmarks:

        video = Video.query.get(bookmark.video_id)

        if video:

            creator = User.query.get(video.creator_id)

            bookmark_list.append({
                "id": video.id,
                "title": video.title,
                "description": video.description,
                "thumbnail_url": video.thumbnail_url,
                "category": video.category,
                "creator": creator.username if creator else "Unknown",
                "views": video.views,
                "likes": Like.query.filter_by(video_id=video.id).count(),
                "bookmarked_at": bookmark.created_at
            })

    return jsonify(bookmark_list), 200