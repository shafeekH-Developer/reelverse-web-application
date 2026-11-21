from collections import Counter, defaultdict
from functools import wraps

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import func, or_

from app.extensions import db
from app.models.user import User
from app.models.video import Video
from app.models.report import Report
from app.routes.video_delete import (
    VideoRemovalError,
    remove_video_completely,
)


admin_bp = Blueprint("admin", __name__)

PAGE_SIZE = 20


# ==========================
# Admin Only
# ==========================
# The admin flag is read from the database on every request, so removing
# it (or banning the account) takes effect immediately.

def admin_required(view):

    @wraps(view)
    @jwt_required()
    def wrapper(*args, **kwargs):

        admin = db.session.get(User, int(get_jwt_identity()))

        if not admin or not admin.is_admin or admin.is_banned:
            return jsonify({
                "message": "Admin access only."
            }), 403

        return view(*args, **kwargs)

    return wrapper


def get_page():
    page = request.args.get("page", default=1, type=int)
    return page if page and page > 0 else 1


def pagination(page, total):
    pages = (total + PAGE_SIZE - 1) // PAGE_SIZE if total else 0
    return {
        "page": page,
        "per_page": PAGE_SIZE,
        "total": total,
        "total_pages": pages,
        "has_next": page < pages,
        "has_previous": page > 1,
    }


def video_row(video, creator, report_count):
    return {
        "id": video.id,
        "title": video.title,
        "thumbnail_url": video.thumbnail_url,
        "category": video.category,
        "views": video.views or 0,
        "created_at": video.created_at,
        "storage": video.storage_provider or "cloudinary",
        "processing_status": video.processing_status,
        "creator_id": video.creator_id,
        "creator": creator.username if creator else "Unknown",
        "creator_banned": bool(creator.is_banned) if creator else False,
        "report_count": report_count,
    }


# ==========================
# Overview Numbers
# ==========================
@admin_bp.route("/admin/stats", methods=["GET"])
@admin_required
def admin_stats():

    reported_videos = db.session.query(
        func.count(func.distinct(Report.video_id))
    ).scalar() or 0

    return jsonify({
        "users": User.query.count(),
        "banned_users": User.query.filter(
            User.is_banned.is_(True)
        ).count(),
        "videos": Video.query.count(),
        "reported_videos": reported_videos,
    }), 200


# ==========================
# Reports (grouped by video, most reported first)
# ==========================
@admin_bp.route("/admin/reports", methods=["GET"])
@admin_required
def admin_reports():

    page = get_page()

    grouped = (
        db.session.query(
            Report.video_id.label("video_id"),
            func.count(Report.id).label("total"),
            func.max(Report.created_at).label("latest"),
        )
        .group_by(Report.video_id)
    )

    total = grouped.count()

    rows = (
        grouped
        .order_by(
            func.count(Report.id).desc(),
            func.max(Report.created_at).desc(),
        )
        .offset((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .all()
    )

    video_ids = [row.video_id for row in rows]

    reasons = defaultdict(Counter)

    if video_ids:
        for video_id, reason in db.session.query(
            Report.video_id, Report.reason
        ).filter(Report.video_id.in_(video_ids)).all():
            reasons[video_id][reason] += 1

    items = []

    for row in rows:

        video = db.session.get(Video, row.video_id)

        if not video:
            continue

        creator = db.session.get(User, video.creator_id)

        item = video_row(video, creator, row.total)
        item["latest_report"] = row.latest
        item["reasons"] = [
            {"reason": reason, "count": count}
            for reason, count in reasons[row.video_id].most_common()
        ]
        items.append(item)

    return jsonify({
        "items": items,
        "pagination": pagination(page, total),
    }), 200


# ==========================
# Dismiss Reports (keep the video)
# ==========================
@admin_bp.route("/admin/videos/<int:video_id>/reports", methods=["DELETE"])
@admin_required
def admin_dismiss_reports(video_id):

    removed = Report.query.filter_by(
        video_id=video_id
    ).delete(synchronize_session=False)

    db.session.commit()

    return jsonify({
        "message": "Reports dismissed. The video stays on the site.",
        "removed": removed,
    }), 200


# ==========================
# All Videos (search by title or creator)
# ==========================
@admin_bp.route("/admin/videos", methods=["GET"])
@admin_required
def admin_videos():

    page = get_page()
    keyword = request.args.get("q", default="", type=str).strip()

    query = Video.query.join(User, User.id == Video.creator_id)

    if keyword:

        like = f"%{keyword}%"
        conditions = [
            Video.title.ilike(like),
            User.username.ilike(like),
        ]

        if keyword.isdigit():
            conditions.append(Video.id == int(keyword))

        query = query.filter(or_(*conditions))

    total = query.count()

    videos = (
        query
        .order_by(Video.created_at.desc())
        .offset((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .all()
    )

    counts = {}

    if videos:
        counts = dict(
            db.session.query(Report.video_id, func.count(Report.id))
            .filter(Report.video_id.in_([v.id for v in videos]))
            .group_by(Report.video_id)
            .all()
        )

    items = [
        video_row(
            video,
            db.session.get(User, video.creator_id),
            counts.get(video.id, 0),
        )
        for video in videos
    ]

    return jsonify({
        "items": items,
        "pagination": pagination(page, total),
    }), 200


# ==========================
# Delete a Video (database + R2 / Cloudinary files)
# ==========================
@admin_bp.route("/admin/videos/<int:video_id>", methods=["DELETE"])
@admin_required
def admin_delete_video(video_id):

    video = db.session.get(Video, video_id)

    if not video:
        return jsonify({
            "message": "Video not found."
        }), 404

    try:
        result = remove_video_completely(video)

    except VideoRemovalError as error:

        body = {"message": error.message}

        if error.detail:
            body["error"] = error.detail

        return jsonify(body), error.status

    return jsonify({
        "message": "Video deleted from the site and from storage.",
        "storage": result["storage"],
        "thumbnail_removed": result["thumbnail_removed"],
    }), 200


# ==========================
# Users (search by username, email or name)
# ==========================
@admin_bp.route("/admin/users", methods=["GET"])
@admin_required
def admin_users():

    page = get_page()
    keyword = request.args.get("q", default="", type=str).strip()
    only_banned = request.args.get("banned", default="", type=str) == "1"

    query = User.query

    if keyword:

        like = f"%{keyword}%"
        conditions = [
            User.username.ilike(like),
            User.email.ilike(like),
            User.first_name.ilike(like),
            User.last_name.ilike(like),
        ]

        if keyword.isdigit():
            conditions.append(User.id == int(keyword))

        query = query.filter(or_(*conditions))

    if only_banned:
        query = query.filter(User.is_banned.is_(True))

    total = query.count()

    users = (
        query
        .order_by(User.created_at.desc(), User.id.desc())
        .offset((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .all()
    )

    user_ids = [user.id for user in users]

    video_counts = {}
    report_counts = {}

    if user_ids:

        video_counts = dict(
            db.session.query(Video.creator_id, func.count(Video.id))
            .filter(Video.creator_id.in_(user_ids))
            .group_by(Video.creator_id)
            .all()
        )

        # Reports received on all videos of each user.
        report_counts = dict(
            db.session.query(Video.creator_id, func.count(Report.id))
            .join(Report, Report.video_id == Video.id)
            .filter(Video.creator_id.in_(user_ids))
            .group_by(Video.creator_id)
            .all()
        )

    items = [
        {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "name": " ".join(
                part for part in (user.first_name, user.last_name) if part
            ),
            "profile_photo_url": user.profile_photo_url,
            "created_at": user.created_at,
            "videos": video_counts.get(user.id, 0),
            "reports_received": report_counts.get(user.id, 0),
            "is_banned": bool(user.is_banned),
            "is_admin": bool(user.is_admin),
        }
        for user in users
    ]

    return jsonify({
        "items": items,
        "pagination": pagination(page, total),
    }), 200


# ==========================
# Ban / Unban
# ==========================
def set_ban(user_id, banned):

    current_user = int(get_jwt_identity())

    user = db.session.get(User, user_id)

    if not user:
        return jsonify({
            "message": "User not found."
        }), 404

    if banned and (user.id == current_user or user.is_admin):
        return jsonify({
            "message": "An admin account cannot be banned."
        }), 400

    user.is_banned = banned
    db.session.commit()

    return jsonify({
        "message": (
            f"{user.username} is banned. Their videos and profile "
            "are hidden and they cannot log in."
            if banned
            else f"{user.username} is unbanned and visible again."
        ),
        "user_id": user.id,
        "is_banned": banned,
    }), 200


@admin_bp.route("/admin/users/<int:user_id>/ban", methods=["POST"])
@admin_required
def admin_ban_user(user_id):
    return set_ban(user_id, True)


@admin_bp.route("/admin/users/<int:user_id>/unban", methods=["POST"])
@admin_required
def admin_unban_user(user_id):
    return set_ban(user_id, False)