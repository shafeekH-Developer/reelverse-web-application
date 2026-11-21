from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import or_

from app.extensions import db
from app.models.video import Video
from app.models.user import User
from app.models.like import Like
from app.visibility import requester_is_admin, visible_videos_filter


video_read_bp = Blueprint("video_read", __name__)


# ==========================
# Add Video View
# ==========================
@video_read_bp.route("/videos/<int:video_id>/view", methods=["POST"])
def add_view(video_id):

    video = Video.query.filter(
        Video.id == video_id,
        visible_videos_filter()
    ).first()

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    video.views += 1

    db.session.commit()

    return jsonify({
        "message": "View added successfully!",
        "views": video.views
    }), 200


# ==========================
# Get All Videos
# ==========================
@video_read_bp.route("/videos", methods=["GET"])
def get_all_videos():

    page = request.args.get("page", default=1, type=int)
    limit = request.args.get("limit", default=10, type=int)

    if page < 1:
        page = 1

    if limit < 1:
        limit = 10

    if limit > 50:
        limit = 50

    total_videos = Video.query.filter(
        visible_videos_filter()
    ).count()

    videos = Video.query.filter(
        visible_videos_filter()
    ).order_by(
        Video.created_at.desc()
    ).paginate(
        page=page,
        per_page=limit,
        error_out=False
    )

    video_list = []

    for video in videos.items:

        creator = User.query.get(video.creator_id)

        video_list.append({
            "id": video.id,
            "title": video.title,
            "description": video.description,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "category": video.category,

            # ==========================
            # Creator Information
            # ==========================
            "creator_id": video.creator_id,
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

    total_pages = (
        (total_videos + limit - 1) // limit
        if total_videos > 0
        else 0
    )

    return jsonify({
        "videos": video_list,
        "pagination": {
            "current_page": page,
            "per_page": limit,
            "total_videos": total_videos,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_previous": page > 1
        }
    }), 200


# ==========================
# Search Videos
# ==========================
@video_read_bp.route("/videos/search", methods=["GET"])
def search_videos():

    keyword = request.args.get(
        "q",
        default="",
        type=str
    ).strip()

    if not keyword:
        return jsonify({
            "message": "Search keyword is required."
        }), 400

    # Search title, description, category
    # and creator username.
    videos = (
        Video.query
        .join(
            User,
            User.id == Video.creator_id
        )
        .filter(
            visible_videos_filter(),
            or_(
                Video.title.ilike(
                    f"%{keyword}%"
                ),
                Video.description.ilike(
                    f"%{keyword}%"
                ),
                Video.category.ilike(
                    f"%{keyword}%"
                ),
                User.username.ilike(
                    f"%{keyword}%"
                )
            )
        )
        .order_by(
            Video.created_at.desc()
        )
        .all()
    )

    video_list = []

    for video in videos:

        creator = User.query.get(video.creator_id)

        video_list.append({
            "id": video.id,
            "title": video.title,
            "description": video.description,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "category": video.category,

            # ==========================
            # Creator Information
            # ==========================
            "creator_id": video.creator_id,
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

    return jsonify(video_list), 200


# ==========================
# Search Suggestions
# ==========================
@video_read_bp.route(
    "/videos/search-suggestions",
    methods=["GET"]
)
def search_suggestions():

    keyword = request.args.get(
        "q",
        default="",
        type=str
    ).strip()

    videos = Video.query.filter(
        visible_videos_filter()
    ).all()

    suggestion_candidates = []

    for video in videos:

        creator = User.query.get(
            video.creator_id
        )

        likes_count = Like.query.filter_by(
            video_id=video.id
        ).count()

        views_count = video.views or 0

        # Simple engagement score.
        # This helps active/popular content
        # influence recommendations.
        engagement_score = (
            views_count
            + (likes_count * 3)
        )

        # ==========================
        # Video Title Candidate
        # ==========================
        if video.title:

            suggestion_candidates.append({
                "text": video.title.strip(),
                "type": "title",
                "score": engagement_score,
                "created_at": video.created_at
            })

        # ==========================
        # Category Candidate
        # ==========================
        if video.category:

            suggestion_candidates.append({
                "text": video.category.strip(),
                "type": "category",
                "score": engagement_score,
                "created_at": video.created_at
            })

        # ==========================
        # Creator Candidate
        # ==========================
        if creator and creator.username:

            suggestion_candidates.append({
                "text": creator.username.strip(),
                "type": "creator",
                "score": engagement_score,
                "created_at": video.created_at
            })

    # ==========================
    # Filter While User Types
    # ==========================
    if keyword:

        keyword_lower = keyword.lower()

        suggestion_candidates = [
            suggestion
            for suggestion in suggestion_candidates
            if keyword_lower in suggestion["text"].lower()
        ]

    # ==========================
    # Remove Duplicate Text
    # ==========================
    unique_suggestions = {}

    for suggestion in suggestion_candidates:

        normalized_text = (
            suggestion["text"]
            .strip()
            .lower()
        )

        if not normalized_text:
            continue

        existing = unique_suggestions.get(
            normalized_text
        )

        # Keep the stronger/newer version
        # when duplicate suggestions exist.
        if (
            existing is None
            or suggestion["score"] > existing["score"]
            or (
                suggestion["score"] == existing["score"]
                and suggestion["created_at"] > existing["created_at"]
            )
        ):
            unique_suggestions[
                normalized_text
            ] = suggestion

    suggestions = list(
        unique_suggestions.values()
    )

    # ==========================
    # Recommendation Ordering
    # ==========================
    # New uploads matter because created_at
    # is used when engagement is equal.
    #
    # Popular existing content also remains
    # useful because engagement comes first.
    suggestions.sort(
        key=lambda suggestion: (
            suggestion["score"],
            suggestion["created_at"]
        ),
        reverse=True
    )

    # Maximum five suggestions.
    suggestions = suggestions[:5]

    response = []

    for suggestion in suggestions:

        response.append({
            "text": suggestion["text"],
            "type": suggestion["type"]
        })

    return jsonify({
        "suggestions": response
    }), 200


# ==========================
# Category Filter
# ==========================
@video_read_bp.route(
    "/videos/category/<string:category>",
    methods=["GET"]
)
def videos_by_category(category):

    videos = Video.query.filter(
        Video.category.ilike(category),
        visible_videos_filter()
    ).all()

    video_list = []

    for video in videos:

        creator = User.query.get(video.creator_id)

        video_list.append({
            "id": video.id,
            "title": video.title,
            "description": video.description,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "category": video.category,

            # ==========================
            # Creator Information
            # ==========================
            "creator_id": video.creator_id,
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

    return jsonify(video_list), 200


# ==========================
# Get Single Video
# ==========================
@video_read_bp.route(
    "/videos/<int:video_id>",
    methods=["GET"]
)
def get_single_video(video_id):

    video = Video.query.get(video_id)

    # Videos of banned users are hidden from everyone except the admin.
    if video and not requester_is_admin():
        creator_row = User.query.get(video.creator_id)

        if creator_row and creator_row.is_banned:
            video = None

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    creator = User.query.get(video.creator_id)

    return jsonify({
        "id": video.id,
        "title": video.title,
        "description": video.description,
        "video_url": video.video_url,
        "thumbnail_url": video.thumbnail_url,
        "category": video.category,

        # ==========================
        # Creator Information
        # ==========================
        "creator_id": video.creator_id,
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
    }), 200


# ==========================
# My Videos
# ==========================
@video_read_bp.route("/my-videos", methods=["GET"])
@jwt_required()
def my_videos():

    current_user = int(get_jwt_identity())

    creator = User.query.get(current_user)

    videos = Video.query.filter_by(
        creator_id=current_user
    ).all()

    video_list = []

    for video in videos:

        video_list.append({
            "id": video.id,
            "title": video.title,
            "description": video.description,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "category": video.category,

            # ==========================
            # Creator Information
            # ==========================
            "creator_id": video.creator_id,
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

    return jsonify(video_list), 200


# ==========================
# Trending Videos
# ==========================
@video_read_bp.route(
    "/videos/trending",
    methods=["GET"]
)
def trending_videos():

    videos = Video.query.filter(
        visible_videos_filter()
    ).all()

    trending = []

    for video in videos:

        creator = User.query.get(video.creator_id)

        total_likes = Like.query.filter_by(
            video_id=video.id
        ).count()

        trending.append({
            "id": video.id,
            "title": video.title,
            "description": video.description,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "category": video.category,

            # ==========================
            # Creator Information
            # ==========================
            "creator_id": video.creator_id,
            "creator": creator.username if creator else "Unknown",
            "creator_profile_photo_url": (
                creator.profile_photo_url
                if creator
                else None
            ),

            "views": video.views,
            "likes": total_likes,
            "created_at": video.created_at
        })

    trending.sort(
        key=lambda video: (
            video["likes"],
            video["views"]
        ),
        reverse=True
    )

    return jsonify(trending), 200