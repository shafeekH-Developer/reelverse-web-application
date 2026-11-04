import mimetypes
import os
import shutil
import subprocess
import tempfile
import uuid

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity

import cloudinary.uploader

from app.extensions import db
from app.models.video import Video
from app.video_storage import (
    r2_is_configured,
    probe_video,
    upload_to_r2,
    start_processing,
)

video_create_bp = Blueprint("video_create", __name__)


# ==========================
# Upload Video
# ==========================
@video_create_bp.route("/videos", methods=["POST"])
@jwt_required()
def upload_video():

    current_user = int(get_jwt_identity())

    title = request.form.get("title")
    description = request.form.get("description")
    category = request.form.get("category")

    video_file = request.files.get("video")
    thumbnail_file = request.files.get("thumbnail")

    # ==========================
    # Validation
    # ==========================

    if not title or not description or not category:
        return jsonify({
            "message": "Title, description and category are required."
        }), 400

    if not video_file:
        return jsonify({
            "message": "Video file is required."
        }), 400

    if not thumbnail_file:
        return jsonify({
            "message": "Thumbnail image is required."
        }), 400

    if not r2_is_configured():
        return jsonify({
            "message": "Video storage is not set up. "
                       "Check the R2 values in the backend .env file."
        }), 500

    work_dir = tempfile.mkdtemp(prefix="reelverse_")
    keep_work_dir = False

    try:

        # ==========================
        # Upload Thumbnail (Cloudinary)
        # ==========================

        thumbnail_upload = cloudinary.uploader.upload(
            thumbnail_file,
            resource_type="image",
            folder="ReelVerse/thumbnails"
        )

        # ==========================
        # Save Video to a Temporary File
        # ==========================

        extension = os.path.splitext(
            video_file.filename or ""
        )[1].lower() or ".mp4"

        local_path = os.path.join(work_dir, "original" + extension)

        video_file.save(local_path)

        # ==========================
        # Read Video Size and Codec
        # ==========================

        try:
            width, height, codec = probe_video(local_path)

        except FileNotFoundError:
            # ffprobe is not installed, or this terminal cannot find it.
            return jsonify({
                "message": "ffprobe was not found by the backend. "
                           "Close VS Code completely, open it again, "
                           "then restart the backend."
            }), 500

        except Exception as error:
            print(f"[ReelVerse] Could not read the video file: {error}")

            return jsonify({
                "message": "This file could not be read as a video."
            }), 400

        # ==========================
        # Upload Original to R2
        # ==========================

        key_prefix = f"videos/{uuid.uuid4().hex}"
        original_key = f"{key_prefix}/original{extension}"

        content_type = (
            mimetypes.guess_type(local_path)[0] or "video/mp4"
        )

        video_url = upload_to_r2(
            local_path,
            original_key,
            content_type
        )

        # ==========================
        # Save Video
        # ==========================

        new_video = Video(
            title=title,
            description=description,
            category=category,

            video_url=video_url,

            storage_provider="r2",
            r2_key=original_key,
            renditions="[]",
            processing_status="processing",

            source_width=width,
            source_height=height,

            thumbnail_url=thumbnail_upload["secure_url"],

            creator_id=current_user
        )

        db.session.add(new_video)
        db.session.commit()

        # ==========================
        # Make Other Qualities in the Background
        # ==========================

        start_processing(
            current_app._get_current_object(),
            new_video.id,
            local_path,
            work_dir,
            key_prefix,
            width,
            height,
            codec,
            extension,
        )

        keep_work_dir = True

        # ==========================
        # Response
        # ==========================

        return jsonify({
            "message": "Video uploaded successfully!",
            "video": {
                "id": new_video.id,
                "title": new_video.title,
                "category": new_video.category,
                "video_url": new_video.video_url,
                "thumbnail_url": new_video.thumbnail_url,

                "source_width": new_video.source_width,
                "source_height": new_video.source_height,

                "processing_status": new_video.processing_status
            }
        }), 201

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "message": f"Upload failed: {e}",
            "error": str(e)
        }), 500

    finally:

        # The temporary folder is kept only while qualities are processed.
        if not keep_work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)