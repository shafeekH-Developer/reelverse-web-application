from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

import cloudinary.uploader

from app.extensions import db
from app.models.user import User


profile_update_bp = Blueprint("profile_update", __name__)


# ==========================
# Update Profile
# ==========================
@profile_update_bp.route("/users/profile", methods=["PUT"])
@jwt_required()
def update_profile():

    current_user = int(get_jwt_identity())

    user = User.query.get(current_user)

    if not user:
        return jsonify({
            "message": "User not found."
        }), 404

    data = request.get_json(silent=True) or {}

    # ==========================
    # Update Username
    # ==========================
    if "username" in data:

        username = str(data["username"]).strip()

        if not username:
            return jsonify({
                "message": "Username cannot be empty."
            }), 400

        existing_username = User.query.filter_by(
            username=username
        ).first()

        if (
            existing_username
            and existing_username.id != user.id
        ):
            return jsonify({
                "message": "Username already exists."
            }), 400

        user.username = username

    # ==========================
    # Update Email
    # ==========================
    if "email" in data:

        email = str(data["email"]).strip()

        if not email:
            return jsonify({
                "message": "Email cannot be empty."
            }), 400

        existing_email = User.query.filter_by(
            email=email
        ).first()

        if (
            existing_email
            and existing_email.id != user.id
        ):
            return jsonify({
                "message": "Email already exists."
            }), 400

        user.email = email

    # ==========================
    # Update Bio / Description
    # ==========================
    if "bio" in data:

        bio = str(data["bio"] or "").strip()

        if len(bio) > 500:
            return jsonify({
                "message": "Bio cannot be longer than 500 characters."
            }), 400

        user.bio = bio if bio else None

    # ==========================
    # Update Website
    # ==========================
    if "website_url" in data:

        website_url = str(
            data["website_url"] or ""
        ).strip()

        if len(website_url) > 500:
            return jsonify({
                "message": "Website link is too long."
            }), 400

        user.website_url = (
            website_url if website_url else None
        )

    # ==========================
    # Update YouTube
    # ==========================
    if "youtube_url" in data:

        youtube_url = str(
            data["youtube_url"] or ""
        ).strip()

        if len(youtube_url) > 500:
            return jsonify({
                "message": "YouTube link is too long."
            }), 400

        user.youtube_url = (
            youtube_url if youtube_url else None
        )

    # ==========================
    # Update Instagram
    # ==========================
    if "instagram_url" in data:

        instagram_url = str(
            data["instagram_url"] or ""
        ).strip()

        if len(instagram_url) > 500:
            return jsonify({
                "message": "Instagram link is too long."
            }), 400

        user.instagram_url = (
            instagram_url if instagram_url else None
        )

    db.session.commit()

    return jsonify({
        "message": "Profile updated successfully!",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "bio": user.bio,
            "profile_photo_url": user.profile_photo_url,
            "website_url": user.website_url,
            "youtube_url": user.youtube_url,
            "instagram_url": user.instagram_url
        }
    }), 200


# ==========================
# Upload Profile Photo
# ==========================
@profile_update_bp.route(
    "/users/profile/photo",
    methods=["POST"]
)
@jwt_required()
def upload_profile_photo():

    current_user = int(get_jwt_identity())

    user = User.query.get(current_user)

    if not user:
        return jsonify({
            "message": "User not found."
        }), 404

    profile_photo = request.files.get("profile_photo")

    if not profile_photo:
        return jsonify({
            "message": "Profile photo is required."
        }), 400

    # ==========================
    # Validate File Type
    # ==========================
    allowed_extensions = {
        "jpg",
        "jpeg",
        "png",
        "webp"
    }

    filename = profile_photo.filename or ""

    if "." not in filename:
        return jsonify({
            "message": "Please select a valid image."
        }), 400

    extension = filename.rsplit(".", 1)[1].lower()

    if extension not in allowed_extensions:
        return jsonify({
            "message": "Only JPG, JPEG, PNG and WEBP images are allowed."
        }), 400

    try:

        # ==========================
        # Upload To Cloudinary
        # ==========================
        upload_result = cloudinary.uploader.upload(
            profile_photo,
            resource_type="image",
            folder="ReelVerse/profile_photos"
        )

        profile_photo_url = upload_result.get(
            "secure_url"
        )

        if not profile_photo_url:
            return jsonify({
                "message": "Profile photo upload failed."
            }), 500

        # ==========================
        # Save URL
        # ==========================
        user.profile_photo_url = profile_photo_url

        db.session.commit()

        return jsonify({
            "message": "Profile photo uploaded successfully!",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "bio": user.bio,
                "profile_photo_url": user.profile_photo_url,
                "website_url": user.website_url,
                "youtube_url": user.youtube_url,
                "instagram_url": user.instagram_url
            }
        }), 200

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "message": "Profile photo upload failed.",
            "error": str(e)
        }), 500


# ==========================
# Remove Profile Photo
# ==========================
@profile_update_bp.route(
    "/users/profile/photo",
    methods=["DELETE"]
)
@jwt_required()
def remove_profile_photo():

    current_user = int(get_jwt_identity())

    user = User.query.get(current_user)

    if not user:
        return jsonify({
            "message": "User not found."
        }), 404

    # User already has no profile photo
    if not user.profile_photo_url:
        return jsonify({
            "message": "No profile photo to remove.",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "bio": user.bio,
                "profile_photo_url": None,
                "website_url": user.website_url,
                "youtube_url": user.youtube_url,
                "instagram_url": user.instagram_url
            }
        }), 200

    try:

        # ==========================
        # Remove Photo From Profile
        # ==========================
        user.profile_photo_url = None

        db.session.commit()

        return jsonify({
            "message": "Profile photo removed successfully!",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "bio": user.bio,
                "profile_photo_url": user.profile_photo_url,
                "website_url": user.website_url,
                "youtube_url": user.youtube_url,
                "instagram_url": user.instagram_url
            }
        }), 200

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "message": "Failed to remove profile photo.",
            "error": str(e)
        }), 500