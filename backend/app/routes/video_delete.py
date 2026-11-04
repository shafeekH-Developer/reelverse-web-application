import os
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote, urlparse

import cloudinary.api

from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db
from app.models.video import Video
from app.models.like import Like
from app.models.comment import Comment, CommentLike
from app.models.bookmark import Bookmark
from app.models.history import History
from app.models.report import Report
from app.models.notification import Notification
from app.video_storage import delete_r2_prefix


video_delete_bp = Blueprint("video_delete", __name__)


# Every video uploaded to R2 lives in its own folder: videos/<32 letters>.
# The folder name is checked before anything is deleted, so a wrong value
# can never wipe other videos.
R2_FOLDER_PATTERN = re.compile(r"^videos/[0-9a-f]{32}$")

# A video that is still being prepared (other qualities are being made)
# cannot be deleted yet. After this time it is treated as stuck.
PROCESSING_WAIT = timedelta(hours=3)


# ==========================
# Cloudinary Helpers
# ==========================

def cloudinary_public_id(url):
    # https://res.cloudinary.com/<cloud>/video/upload/v123/ReelVerse/videos/abc.mp4
    # becomes ReelVerse/videos/abc
    if (
        not url
        or "res.cloudinary.com" not in url
        or "/upload/" not in url
    ):
        return None

    path = unquote(urlparse(url).path).split("/upload/", 1)[1]

    # Remove the version number (v1700000000/).
    path = re.sub(r"^v\d+/", "", path)

    # Remove the file extension.
    name = path.rsplit("/", 1)[-1]

    if "." in name:
        path = path.rsplit(".", 1)[0]

    return path or None


def remove_from_cloudinary(public_id, resource_type):
    # Deletes the file and its generated copies (like the lower qualities
    # created for older videos). "Not found" means it is already gone.
    result = cloudinary.api.delete_resources(
        [public_id],
        resource_type=resource_type,
        type="upload",
        invalidate=True,
    )

    state = result.get("deleted", {}).get(public_id)

    if state not in ("deleted", "not_found"):
        raise RuntimeError(
            f"Cloudinary did not delete {public_id} ({state})"
        )


# ==========================
# Delete Video
# ==========================
@video_delete_bp.route("/videos/<int:video_id>", methods=["DELETE"])
@jwt_required()
def delete_video(video_id):

    current_user = int(get_jwt_identity())

    # Find video
    video = db.session.get(Video, video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    # Check ownership
    if video.creator_id != current_user:
        return jsonify({
            "message": "You are not authorized to delete this video."
        }), 403

    # Wait while the other qualities are still being made, because the
    # background work would put new files into the folder after delete.
    if video.processing_status == "processing" and video.created_at:

        now = datetime.now(timezone.utc).replace(tzinfo=None)

        if now - video.created_at < PROCESSING_WAIT:
            return jsonify({
                "message": (
                    "This video is still being prepared. "
                    "Please try deleting it again in a few minutes."
                )
            }), 409

    storage = video.storage_provider or "cloudinary"

    # ==========================
    # Remove the Video Files
    # ==========================
    # This happens first. If it fails, the video stays on the website so
    # the delete can be tried again, and no storage is left behind.

    try:

        if storage == "r2":

            folder = os.path.dirname(video.r2_key or "")

            if R2_FOLDER_PATTERN.match(folder):
                delete_r2_prefix(folder + "/")

        else:

            public_id = (
                video.cloudinary_public_id
                or cloudinary_public_id(video.video_url)
            )

            if public_id:
                remove_from_cloudinary(public_id, "video")

    except Exception as error:

        print(f"[ReelVerse] Could not remove video files: {error}")

        return jsonify({
            "message": (
                "The video files could not be removed from cloud "
                "storage, so the video was not deleted. "
                "Please try again."
            )
        }), 502

    # ==========================
    # Remove the Thumbnail (Cloudinary)
    # ==========================
    # A thumbnail that cannot be removed does not stop the delete.

    thumbnail_removed = True

    thumbnail_id = cloudinary_public_id(video.thumbnail_url)

    if thumbnail_id:
        try:
            remove_from_cloudinary(thumbnail_id, "image")
        except Exception as error:
            thumbnail_removed = False
            print(f"[ReelVerse] Could not remove thumbnail: {error}")

    # ==========================
    # Remove the Video From the Database
    # ==========================

    try:

        comment_ids = [
            row[0]
            for row in db.session.query(Comment.id).filter_by(
                video_id=video.id
            ).all()
        ]

        if comment_ids:
            CommentLike.query.filter(
                CommentLike.comment_id.in_(comment_ids)
            ).delete(synchronize_session=False)

        for model in (
            Comment,
            Like,
            Bookmark,
            History,
            Report,
            Notification,
        ):
            model.query.filter_by(
                video_id=video.id
            ).delete(synchronize_session=False)

        db.session.delete(video)
        db.session.commit()

    except Exception as error:

        db.session.rollback()

        print(f"[ReelVerse] Could not delete video record: {error}")

        return jsonify({
            "message": "Failed to delete video.",
            "error": str(error)
        }), 500

    return jsonify({
        "message": "Video deleted successfully!",
        "storage": storage,
        "thumbnail_removed": thumbnail_removed
    }), 200