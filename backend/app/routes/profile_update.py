import secrets
import time
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from flask_mail import Message
from werkzeug.security import generate_password_hash, check_password_hash

import cloudinary.uploader

from app.extensions import db, mail
from app.models.user import User
from app.models.email_verification import EmailVerification


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
    # Update Email (needs a verified code)
    # ==========================
    if "email" in data:

        email = str(data["email"]).strip().lower()

        if not email:
            return jsonify({
                "message": "Email cannot be empty."
            }), 400

        # Only a different email address needs verification.
        if email != (user.email or "").strip().lower():

            existing_email = User.query.filter(
                db.func.lower(User.email) == email
            ).first()

            if (
                existing_email
                and existing_email.id != user.id
            ):
                return jsonify({
                    "message": "Email already exists."
                }), 400

            verification = EmailVerification.query.filter(
                db.func.lower(EmailVerification.email) == email
            ).first()

            if (
                not verification
                or not verification.is_verified
                or datetime.utcnow() > verification.expires_at
            ):
                return jsonify({
                    "message": "Please verify your new email address "
                               "with the code we send you before "
                               "changing it."
                }), 403

            user.email = email

            # The code can be used only once.
            db.session.delete(verification)

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
# Change Email: send a code to the NEW address
# ==========================

# Keeps one person from asking for codes again and again.
_EMAIL_CODE_COOLDOWN_SECONDS = 30
_EMAIL_CODE_MAX_WRONG_TRIES = 5

_last_code_sent = {}
_wrong_tries = {}


@profile_update_bp.route(
    "/users/email-change/send-code",
    methods=["POST"]
)
@jwt_required()
def email_change_send_code():

    current_user = int(get_jwt_identity())

    user = User.query.get(current_user)

    if not user:
        return jsonify({
            "message": "User not found."
        }), 404

    data = request.get_json(silent=True) or {}

    email = str(data.get("email", "")).strip().lower()

    if not email or "@" not in email or "." not in email or len(email) > 120:
        return jsonify({
            "message": "Please enter a valid email address."
        }), 400

    if email == (user.email or "").strip().lower():
        return jsonify({
            "message": "This is already your email address."
        }), 400

    existing_email = User.query.filter(
        db.func.lower(User.email) == email
    ).first()

    if existing_email:
        return jsonify({
            "message": "This email is already used by another account."
        }), 400

    waited = time.time() - _last_code_sent.get(user.id, 0)

    if waited < _EMAIL_CODE_COOLDOWN_SECONDS:
        wait_more = int(_EMAIL_CODE_COOLDOWN_SECONDS - waited) + 1

        return jsonify({
            "message": f"Please wait {wait_more} seconds before "
                       "asking for another code."
        }), 429

    code = str(secrets.randbelow(900000) + 100000)

    verification = EmailVerification.query.filter(
        db.func.lower(EmailVerification.email) == email
    ).first()

    if verification:
        verification.email = email
        verification.code_hash = generate_password_hash(code)
        verification.expires_at = datetime.utcnow() + timedelta(minutes=10)
        verification.is_verified = False
    else:
        verification = EmailVerification(
            email=email,
            code_hash=generate_password_hash(code),
            expires_at=datetime.utcnow() + timedelta(minutes=10),
            is_verified=False
        )

        db.session.add(verification)

    db.session.commit()

    try:
        message = Message(
            subject="Your ReelVerse email change code",
            recipients=[email]
        )

        message.body = (
            "You asked to change the email address of your "
            "ReelVerse account to this address.\n\n"
            "Your verification code is:\n\n"
            f"{code}\n\n"
            "This code expires in 10 minutes.\n\n"
            "If you did not request this, you can ignore this email."
        )

        mail.send(message)

    except Exception as error:
        print(f"[ReelVerse] Email change mail failed: {error}")

        db.session.delete(verification)
        db.session.commit()

        return jsonify({
            "message": "We could not send the verification email. "
                       "Please try again."
        }), 500

    _last_code_sent[user.id] = time.time()
    _wrong_tries[(user.id, email)] = 0

    return jsonify({
        "message": "Verification code sent.",
        "expires_in": 600
    }), 200


# ==========================
# Change Email: check the code
# ==========================
@profile_update_bp.route(
    "/users/email-change/verify",
    methods=["POST"]
)
@jwt_required()
def email_change_verify():

    current_user = int(get_jwt_identity())

    data = request.get_json(silent=True) or {}

    email = str(data.get("email", "")).strip().lower()
    code = str(data.get("code", "")).strip()

    if not email:
        return jsonify({
            "message": "Email address is required."
        }), 400

    if not code.isdigit() or len(code) != 6:
        return jsonify({
            "message": "The code must be 6 digits."
        }), 400

    key = (current_user, email)

    if _wrong_tries.get(key, 0) >= _EMAIL_CODE_MAX_WRONG_TRIES:
        return jsonify({
            "message": "Too many wrong codes. Please ask for a new code."
        }), 429

    verification = EmailVerification.query.filter(
        db.func.lower(EmailVerification.email) == email
    ).first()

    if not verification:
        return jsonify({
            "message": "No code was requested for this email."
        }), 404

    if datetime.utcnow() > verification.expires_at:
        return jsonify({
            "message": "The code has expired. Please ask for a new one."
        }), 400

    if not check_password_hash(verification.code_hash, code):
        _wrong_tries[key] = _wrong_tries.get(key, 0) + 1

        return jsonify({
            "message": "Wrong code. Please check it and try again."
        }), 400

    verification.is_verified = True

    # Time to press Save Changes after the code is accepted.
    verification.expires_at = datetime.utcnow() + timedelta(minutes=15)

    db.session.commit()

    _wrong_tries.pop(key, None)

    return jsonify({
        "message": "Email verified.",
        "email": email
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