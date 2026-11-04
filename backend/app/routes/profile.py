from flask import Blueprint, jsonify

from app.models.user import User
from app.models.video import Video
from app.models.like import Like
from app.models.follow import Follow


profile_bp = Blueprint("profile", __name__)


# ==========================
# Public User Profile
# ==========================
@profile_bp.route("/users/<int:user_id>", methods=["GET"])
def public_profile(user_id):

    user = User.query.get(user_id)

    if not user:
        return jsonify({
            "message": "User not found."
        }), 404

    # ==========================
    # Get User Videos
    # ==========================
    videos = Video.query.filter_by(
        creator_id=user.id
    ).all()

    total_likes_received = 0
    video_list = []

    for video in videos:

        likes = Like.query.filter_by(
            video_id=video.id
        ).count()

        total_likes_received += likes

        video_list.append({
            "id": video.id,
            "title": video.title,
            "description": video.description,
            "thumbnail_url": video.thumbnail_url,
            "category": video.category,
            "likes": likes,
            "created_at": video.created_at
        })

    # ==========================
    # Followers Count
    # ==========================
    total_followers = Follow.query.filter_by(
        following_id=user.id
    ).count()

    # ==========================
    # Following Count
    # ==========================
    total_following = Follow.query.filter_by(
        follower_id=user.id
    ).count()

    # ==========================
    # Final Profile Response
    # ==========================
    return jsonify({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "bio": user.bio,
        "profile_photo_url": user.profile_photo_url,

        # Profile Links
        "website_url": user.website_url,
        "youtube_url": user.youtube_url,
        "instagram_url": user.instagram_url,

        "total_followers": total_followers,
        "total_following": total_following,
        "total_videos": len(videos),
        "total_likes_received": total_likes_received,
        "videos": video_list
    }), 200