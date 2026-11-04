import json

from flask import Blueprint, jsonify

from app.extensions import db
from app.models.video import Video

video_quality_bp = Blueprint("video_quality", __name__)


# ==========================
# Video Qualities
# ==========================
@video_quality_bp.route(
    "/videos/<int:video_id>/qualities",
    methods=["GET"]
)
def get_video_qualities(video_id):

    video = db.session.get(Video, video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    # Older videos (Cloudinary) make their qualities in the player.
    if video.storage_provider != "r2":
        return jsonify({
            "storage": video.storage_provider or "cloudinary",
            "status": "ready",
            "qualities": []
        }), 200

    try:
        qualities = json.loads(video.renditions or "[]")
    except ValueError:
        qualities = []

    short_side = None

    if video.source_width and video.source_height:
        short_side = min(video.source_width, video.source_height)

    # The original file is the highest quality.
    if short_side and not any(
        item["height"] == short_side for item in qualities
    ):
        qualities.append({
            "height": short_side,
            "url": video.video_url,
            "original": True
        })

    qualities.sort(key=lambda item: item["height"])

    return jsonify({
        "storage": "r2",
        "status": video.processing_status or "ready",
        "qualities": qualities
    }), 200