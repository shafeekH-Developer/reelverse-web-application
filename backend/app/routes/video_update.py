from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db
from app.models.video import Video


video_update_bp = Blueprint("video_update", __name__)


# ==========================
# Update Video
# ==========================
@video_update_bp.route("/videos/<int:video_id>", methods=["PUT"])
@jwt_required()
def update_video(video_id):

    # Get logged-in user's ID from JWT
    current_user = int(get_jwt_identity())

    # Find video
    video = Video.query.get(video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    # Check ownership
    if video.creator_id != current_user:
        return jsonify({
            "message": "You are not authorized to update this video."
        }), 403

    # Get JSON body
    data = request.get_json()

    if not data:
        return jsonify({
            "message": "No update data provided."
        }), 400

    # ==========================
    # Update Title
    # ==========================
    if "title" in data:

        title = data["title"]

        if not title or not title.strip():
            return jsonify({
                "message": "Title cannot be empty."
            }), 400

        video.title = title.strip()

    # ==========================
    # Update Description
    # ==========================
    if "description" in data:

        description = data["description"]

        if not description or not description.strip():
            return jsonify({
                "message": "Description cannot be empty."
            }), 400

        video.description = description.strip()

    # ==========================
    # Update Category
    # ==========================
    if "category" in data:

        category = data["category"]

        if not category or not category.strip():
            return jsonify({
                "message": "Category cannot be empty."
            }), 400

        video.category = category.strip()

    # ==========================
    # Save Changes
    # ==========================
    db.session.commit()

    return jsonify({
        "message": "Video updated successfully!",
        "video": {
            "id": video.id,
            "title": video.title,
            "description": video.description,
            "category": video.category,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "creator_id": video.creator_id,
            "views": video.views
        }
    }), 200