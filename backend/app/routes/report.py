from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db

from app.models.report import Report
from app.models.video import Video
from app.routes.video_delete import (
    VideoRemovalError,
    remove_video_completely,
)


report_bp = Blueprint("report", __name__)


# ==========================
# Report Limit
# ==========================
REPORT_DELETE_THRESHOLD = 1000


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

        # Save the report first, so it is never lost even if the
        # automatic delete below cannot finish.
        db.session.commit()

        total_reports = Report.query.filter_by(
            video_id=video_id
        ).count()

        # ==========================
        # 1000 Reports = Delete Video
        # ==========================
        # Uses the same delete as the owner and the admin, so the files
        # in R2 / Cloudinary are removed too (not only the database rows).
        if total_reports >= REPORT_DELETE_THRESHOLD:

            deleted_video_id = video.id

            try:

                remove_video_completely(video)

                return jsonify({
                    "message":
                        "Video removed after reaching "
                        "the report limit.",
                    "video_id": deleted_video_id,
                    "removed": True,
                    "report_threshold":
                        REPORT_DELETE_THRESHOLD
                }), 200

            except VideoRemovalError as removal_error:

                # The report counts. The video stays and the admin can
                # remove it from the Admin page.
                print(
                    "[ReelVerse] Auto-delete skipped: "
                    f"{removal_error.message}"
                )

        # Normal report
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