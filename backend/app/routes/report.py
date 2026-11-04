from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db

from app.models.report import Report
from app.models.video import Video
from app.models.like import Like
from app.models.comment import Comment, CommentLike
from app.models.bookmark import Bookmark
from app.models.history import History
from app.models.notification import Notification


report_bp = Blueprint("report", __name__)


# ==========================
# Report Limit
# ==========================
REPORT_DELETE_THRESHOLD = 1000


# ==========================
# Delete Video + Related Data
# ==========================
def delete_reported_video(video):

    video_id = video.id

    # --------------------------
    # Delete Comment Likes
    # --------------------------
    comment_ids = [
        comment.id
        for comment in Comment.query.filter_by(
            video_id=video_id
        ).all()
    ]

    if comment_ids:
        CommentLike.query.filter(
            CommentLike.comment_id.in_(comment_ids)
        ).delete(
            synchronize_session=False
        )

    # --------------------------
    # Delete Comments
    # --------------------------
    Comment.query.filter_by(
        video_id=video_id
    ).delete(
        synchronize_session=False
    )

    # --------------------------
    # Delete Likes
    # --------------------------
    Like.query.filter_by(
        video_id=video_id
    ).delete(
        synchronize_session=False
    )

    # --------------------------
    # Delete Bookmarks
    # --------------------------
    Bookmark.query.filter_by(
        video_id=video_id
    ).delete(
        synchronize_session=False
    )

    # --------------------------
    # Delete Watch History
    # --------------------------
    History.query.filter_by(
        video_id=video_id
    ).delete(
        synchronize_session=False
    )

    # --------------------------
    # Delete Notifications
    # --------------------------
    Notification.query.filter_by(
        video_id=video_id
    ).delete(
        synchronize_session=False
    )

    # --------------------------
    # Delete Reports
    # --------------------------
    Report.query.filter_by(
        video_id=video_id
    ).delete(
        synchronize_session=False
    )

    # --------------------------
    # Delete Video
    # --------------------------
    db.session.delete(video)


# ==========================
# Report a Video
# ==========================
@report_bp.route(
    "/videos/<int:video_id>/report",
    methods=["POST"]
)
@jwt_required()
def report_video(video_id):

    current_user = int(get_jwt_identity())

    video = Video.query.get(video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    # Creator cannot report own video
    if video.creator_id == current_user:
        return jsonify({
            "message": "You cannot report your own video."
        }), 400

    # Prevent duplicate reports
    existing_report = Report.query.filter_by(
        user_id=current_user,
        video_id=video_id
    ).first()

    if existing_report:
        return jsonify({
            "message": "You already reported this video."
        }), 400

    data = request.get_json(
        silent=True
    ) or {}

    reason = str(
        data.get("reason", "")
    ).strip()

    if not reason:
        return jsonify({
            "message": "Report reason is required."
        }), 400

    if len(reason) > 100:
        return jsonify({
            "message":
                "Report reason must be 100 characters or less."
        }), 400

    try:

        # Save new report
        new_report = Report(
            user_id=current_user,
            video_id=video_id,
            reason=reason
        )

        db.session.add(new_report)

        # Flush makes the new report visible to
        # the count without committing yet.
        db.session.flush()

        total_reports = Report.query.filter_by(
            video_id=video_id
        ).count()

        # ==========================
        # 1000 Reports = Delete Video
        # ==========================
        if total_reports >= REPORT_DELETE_THRESHOLD:

            deleted_video_id = video.id

            delete_reported_video(video)

            db.session.commit()

            return jsonify({
                "message":
                    "Video removed after reaching "
                    "the report limit.",
                "video_id": deleted_video_id,
                "removed": True,
                "report_threshold":
                    REPORT_DELETE_THRESHOLD
            }), 200

        # Normal report
        db.session.commit()

        return jsonify({
            "message": "Video reported successfully.",
            "video_id": video_id,
            "total_reports": total_reports,
            "removed": False
        }), 201

    except Exception as e:

        db.session.rollback()

        return jsonify({
            "message": "Failed to report video.",
            "error": str(e)
        }), 500


# ==========================
# Check My Report Status
# ==========================
@report_bp.route(
    "/videos/<int:video_id>/report/status",
    methods=["GET"]
)
@jwt_required()
def report_status(video_id):

    current_user = int(get_jwt_identity())

    video = Video.query.get(video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    report = Report.query.filter_by(
        user_id=current_user,
        video_id=video_id
    ).first()

    total_reports = Report.query.filter_by(
        video_id=video_id
    ).count()

    return jsonify({
        "video_id": video_id,
        "reported": report is not None,
        "total_reports": total_reports,
        "report_threshold": REPORT_DELETE_THRESHOLD
    }), 200