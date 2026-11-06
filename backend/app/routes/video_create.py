import json
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
    public_url,
    start_direct_upload,
    finish_direct_upload,
    abort_direct_upload,
    delete_r2_object,
    DIRECT_MAX_SIZE,
    WEB_CODECS,
    WEB_EXTENSIONS,
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


# ==========================
# Direct Upload (big videos, browser -> R2)
# ==========================

def _own_key_is_valid(key, extension):
    # The browser sends the key back; only accept the shape we created.
    return (
        isinstance(key, str)
        and key.startswith("videos/")
        and key.endswith("/original" + extension)
        and ".." not in key
        and key.count("/") == 2
    )


@video_create_bp.route("/videos/direct/start", methods=["POST"])
@jwt_required()
def direct_upload_start():

    data = request.get_json(silent=True) or {}

    filename = str(data.get("filename") or "")
    size = int(data.get("size") or 0)

    extension = os.path.splitext(filename)[1].lower()

    if extension not in WEB_EXTENSIONS:
        return jsonify({
            "message": "Please upload an MP4, M4V, MOV or WEBM video."
        }), 400

    if size <= 0 or size > DIRECT_MAX_SIZE:
        return jsonify({
            "message": "The video must be smaller than 5 GB."
        }), 400

    if not r2_is_configured():
        return jsonify({
            "message": "Video storage is not set up on the server."
        }), 500

    try:
        key = f"videos/{uuid.uuid4().hex}/original{extension}"

        content_type = (
            mimetypes.guess_type("video" + extension)[0] or "video/mp4"
        )

        upload_id, part_size, urls = start_direct_upload(
            key,
            content_type,
            size
        )

        return jsonify({
            "key": key,
            "upload_id": upload_id,
            "part_size": part_size,
            "part_urls": urls
        }), 200

    except Exception as e:
        return jsonify({"message": f"Could not start the upload: {e}"}), 500


@video_create_bp.route("/videos/direct/abort", methods=["POST"])
@jwt_required()
def direct_upload_abort():

    data = request.get_json(silent=True) or {}

    key = data.get("key")
    upload_id = data.get("upload_id")

    extension = os.path.splitext(str(key or ""))[1].lower()

    if upload_id and _own_key_is_valid(key, extension):
        abort_direct_upload(key, upload_id)

    return jsonify({"message": "Upload cancelled."}), 200


@video_create_bp.route("/videos/direct/complete", methods=["POST"])
@jwt_required()
def direct_upload_complete():

    current_user = int(get_jwt_identity())

    title = request.form.get("title")
    description = request.form.get("description")
    category = request.form.get("category")

    key = request.form.get("key")
    upload_id = request.form.get("upload_id")

    thumbnail_file = request.files.get("thumbnail")

    extension = os.path.splitext(str(key or ""))[1].lower()

    if not title or not description or not category:
        return jsonify({
            "message": "Title, description and category are required."
        }), 400

    if not thumbnail_file:
        return jsonify({
            "message": "Thumbnail image is required."
        }), 400

    if not upload_id or not _own_key_is_valid(key, extension):
        return jsonify({"message": "Invalid upload."}), 400

    try:
        parts = json.loads(request.form.get("parts") or "[]")
    except ValueError:
        parts = []

    if not parts:
        return jsonify({"message": "No uploaded parts were sent."}), 400

    try:

        # Join the parts into one file on R2.
        finish_direct_upload(key, upload_id, parts)

        video_url = public_url(key)

        # Read the size and codec straight from R2 (small range reads).
        width = height = None

        try:
            width, height, codec = probe_video(video_url)

        except Exception as error:
            print(f"[ReelVerse] Could not read the video file: {error}")

            delete_r2_object(key)

            return jsonify({
                "message": "This file could not be read as a video."
            }), 400

        if codec not in WEB_CODECS:
            delete_r2_object(key)

            return jsonify({
                "message": "This video format (for example HEVC/H.265) "
                           "does not play in most browsers. Please "
                           "convert it to H.264 MP4 and upload again."
            }), 400

        thumbnail_upload = cloudinary.uploader.upload(
            thumbnail_file,
            resource_type="image",
            folder="ReelVerse/thumbnails"
        )

        new_video = Video(
            title=title,
            description=description,
            category=category,

            video_url=video_url,

            storage_provider="r2",
            r2_key=key,

            # Big videos keep only the original (no extra qualities).
            renditions="[]",
            processing_status="ready",

            source_width=width,
            source_height=height,

            thumbnail_url=thumbnail_upload["secure_url"],

            creator_id=current_user
        )

        db.session.add(new_video)
        db.session.commit()

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