from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import case

import cloudinary
import cloudinary.uploader

from app.extensions import db
from app.models.user_cover import UserCover

from app.models.video import Video
from app.models.user import User
from app.models.like import Like
from app.models.follow import Follow
from app.models.comment import Comment


feed_bp = Blueprint("feed", __name__)


# ==========================
# Home Feed
# ==========================
@feed_bp.route("/feed", methods=["GET"])
@jwt_required()
def home_feed():

    current_user = int(get_jwt_identity())

    # ==========================
    # Pagination
    # ==========================
    page = request.args.get(
        "page",
        default=1,
        type=int
    )

    limit = request.args.get(
        "limit",
        default=10,
        type=int
    )

    if page < 1:
        page = 1

    if limit < 1:
        limit = 10

    if limit > 50:
        limit = 50

    # ==========================
    # Get Users I Follow
    # ==========================
    follows = Follow.query.filter_by(
        follower_id=current_user
    ).all()

    followed_user_ids = [
        follow.following_id
        for follow in follows
    ]

    # ==========================
    # Feed Ordering
    # ==========================
    # Followed users' videos appear first.
    # Other videos appear after them.
    # Within both groups, newest videos appear first.

    followed_priority = case(
        (
            Video.creator_id.in_(followed_user_ids),
            0
        ),
        else_=1
    )

    feed_query = Video.query.order_by(
        followed_priority,
        Video.created_at.desc()
    )

    # ==========================
    # Paginate Feed
    # ==========================
    videos = feed_query.paginate(
        page=page,
        per_page=limit,
        error_out=False
    )

    feed_list = []

    for video in videos.items:

        creator = User.query.get(video.creator_id)

        feed_list.append({
            "id": video.id,
            "title": video.title,
            "description": video.description,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "category": video.category,

            # ==========================
            # Creator Information
            # ==========================
            "creator_id": creator.id if creator else None,
            "creator": creator.username if creator else "Unknown",
            "creator_profile_photo_url": (
                creator.profile_photo_url
                if creator
                else None
            ),

            "views": video.views,
            "likes": Like.query.filter_by(
                video_id=video.id
            ).count(),
            "created_at": video.created_at
        })

    # ==========================
    # Response
    # ==========================
    return jsonify({
        "videos": feed_list,
        "pagination": {
            "current_page": page,
            "per_page": limit,
            "total_videos": videos.total,
            "total_pages": videos.pages,
            "has_next": videos.has_next,
            "has_previous": videos.has_prev
        }
    }), 200


# ==========================
# Following Feed
# ==========================
# Latest videos ONLY from the creators the current user follows.
@feed_bp.route("/feed/following", methods=["GET"])
@jwt_required()
def following_feed():

    current_user = int(get_jwt_identity())

    page = request.args.get("page", default=1, type=int)
    limit = request.args.get("limit", default=12, type=int)

    if page < 1:
        page = 1

    if limit < 1:
        limit = 12

    if limit > 50:
        limit = 50

    followed_user_ids = [
        follow.following_id
        for follow in Follow.query.filter_by(
            follower_id=current_user
        ).all()
    ]

    # Not following anyone yet: let the website show a helpful message.
    if not followed_user_ids:
        return jsonify({
            "videos": [],
            "total_following": 0,
            "pagination": {
                "current_page": page,
                "per_page": limit,
                "total_videos": 0,
                "total_pages": 0,
                "has_next": False,
                "has_previous": False
            }
        }), 200

    videos = Video.query.filter(
        Video.creator_id.in_(followed_user_ids)
    ).order_by(
        Video.created_at.desc(),
        Video.id.desc()
    ).paginate(
        page=page,
        per_page=limit,
        error_out=False
    )

    feed_list = []

    for video in videos.items:

        creator = User.query.get(video.creator_id)

        feed_list.append({
            "id": video.id,
            "title": video.title,
            "description": video.description,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "category": video.category,
            "creator_id": creator.id if creator else None,
            "creator": creator.username if creator else "Unknown",
            "creator_profile_photo_url": (
                creator.profile_photo_url
                if creator
                else None
            ),
            "views": video.views,
            "likes": Like.query.filter_by(
                video_id=video.id
            ).count(),
            "created_at": video.created_at
        })

    return jsonify({
        "videos": feed_list,
        "total_following": len(followed_user_ids),
        "pagination": {
            "current_page": page,
            "per_page": limit,
            "total_videos": videos.total,
            "total_pages": videos.pages,
            "has_next": videos.has_next,
            "has_previous": videos.has_prev
        }
    }), 200


# ==========================
# Trending Videos
# ==========================
@feed_bp.route("/trending", methods=["GET"])
def trending_videos():

    videos = Video.query.all()

    trending_list = []

    for video in videos:

        creator = User.query.get(
            video.creator_id
        )

        likes_count = Like.query.filter_by(
            video_id=video.id
        ).count()

        comments_count = Comment.query.filter_by(
            video_id=video.id
        ).count()

        views_count = video.views or 0

        # ==========================
        # Trending Score
        # ==========================
        # View = 1 point
        # Like = 3 points
        # Comment = 2 points
        trending_score = (
            views_count
            + (likes_count * 3)
            + (comments_count * 2)
        )

        trending_list.append({
            "id": video.id,
            "title": video.title,
            "description": video.description,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "category": video.category,

            # ==========================
            # Creator Information
            # ==========================
            "creator_id": (
                creator.id
                if creator
                else None
            ),

            "creator": (
                creator.username
                if creator
                else "Unknown"
            ),

            "creator_profile_photo_url": (
                creator.profile_photo_url
                if creator
                else None
            ),

            # ==========================
            # Engagement
            # ==========================
            "views": views_count,
            "likes": likes_count,
            "comments": comments_count,
            "trending_score": trending_score,

            "created_at": video.created_at
        })

    # ==========================
    # Highest Trending First
    # ==========================
    trending_list.sort(
        key=lambda video: (
            video["trending_score"],
            video["created_at"]
        ),
        reverse=True
    )

    return jsonify({
        "videos": trending_list,
        "total_videos": len(trending_list)
    }), 200


# ==========================
# Profile cover photo (the wide banner on a profile)
# ==========================
COVER_ALLOWED_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp"
}

COVER_MAX_BYTES = 8 * 1024 * 1024


def cover_json(cover):
    return {
        "cover_photo_url": cover.cover_photo_url if cover else None
    }


@feed_bp.route("/users/<int:user_id>/cover", methods=["GET"])
def get_user_cover(user_id):

    cover = UserCover.query.filter_by(user_id=user_id).first()

    return jsonify(cover_json(cover)), 200


@feed_bp.route("/users/profile/cover", methods=["PUT", "POST"])
@jwt_required()
def upload_profile_cover():

    current_user = int(get_jwt_identity())

    cover_file = request.files.get("cover")

    if not cover_file or not cover_file.filename:
        return jsonify({
            "message": "Please choose a cover image."
        }), 400

    if cover_file.mimetype not in COVER_ALLOWED_TYPES:
        return jsonify({
            "message": "Only JPG, PNG and WEBP images are allowed."
        }), 400

    cover_file.seek(0, 2)
    size = cover_file.tell()
    cover_file.seek(0)

    if size > COVER_MAX_BYTES:
        return jsonify({
            "message": "The cover image must be 8 MB or smaller."
        }), 400

    cloud_config = cloudinary.config()

    if not (
        cloud_config.cloud_name
        and cloud_config.api_key
        and cloud_config.api_secret
    ):
        return jsonify({
            "message": "Cloudinary is not configured. Check backend/.env."
        }), 500

    try:
        upload_result = cloudinary.uploader.upload(
            cover_file,
            resource_type="image",
            folder="reelverse/covers",
            transformation=[
                {"width": 2400, "crop": "limit", "quality": "auto"}
            ]
        )
    except Exception as error:
        return jsonify({
            "message": "Cover upload failed.",
            "error": str(error)
        }), 500

    secure_url = upload_result.get("secure_url")

    if not secure_url:
        return jsonify({
            "message": "Cover upload failed."
        }), 500

    cover = UserCover.query.filter_by(user_id=current_user).first()
    old_public_id = None

    if cover:
        old_public_id = cover.public_id
        cover.cover_photo_url = secure_url
        cover.public_id = upload_result.get("public_id")
    else:
        cover = UserCover(
            user_id=current_user,
            cover_photo_url=secure_url,
            public_id=upload_result.get("public_id")
        )
        db.session.add(cover)

    db.session.commit()

    # Remove the previous image from Cloudinary (best effort).
    if old_public_id and old_public_id != cover.public_id:
        try:
            cloudinary.uploader.destroy(old_public_id)
        except Exception:
            pass

    payload = cover_json(cover)
    payload["message"] = "Cover photo updated!"

    return jsonify(payload), 200


@feed_bp.route("/users/profile/cover", methods=["DELETE"])
@jwt_required()
def remove_profile_cover():

    current_user = int(get_jwt_identity())

    cover = UserCover.query.filter_by(user_id=current_user).first()

    if cover:
        old_public_id = cover.public_id

        db.session.delete(cover)
        db.session.commit()

        if old_public_id:
            try:
                cloudinary.uploader.destroy(old_public_id)
            except Exception:
                pass

    payload = cover_json(None)
    payload["message"] = "Cover photo removed."

    return jsonify(payload), 200