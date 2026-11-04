from flask import Blueprint, jsonify

from app.models.user import User
from app.models.video import Video
from app.models.like import Like
from app.models.comment import Comment


dashboard_bp = Blueprint("dashboard", __name__)


# ==========================
# Dashboard Statistics
# ==========================
@dashboard_bp.route("/dashboard", methods=["GET"])
def dashboard():

    total_users = User.query.count()
    total_videos = Video.query.count()
    total_likes = Like.query.count()
    total_comments = Comment.query.count()

    # Calculate total views from all videos
    total_views = sum(
        video.views for video in Video.query.all()
    )

    return jsonify({
        "total_users": total_users,
        "total_videos": total_videos,
        "total_likes": total_likes,
        "total_comments": total_comments,
        "total_views": total_views
    }), 200