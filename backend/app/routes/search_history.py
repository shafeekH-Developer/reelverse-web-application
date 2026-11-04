from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime

from app.extensions import db
from app.models.search_history import SearchHistory


search_history_bp = Blueprint(
    "search_history",
    __name__
)


# ==========================
# Get Search History
# ==========================
@search_history_bp.route(
    "/search-history",
    methods=["GET"]
)
@jwt_required()
def get_search_history():

    current_user_id = int(
        get_jwt_identity()
    )

    history = (
        SearchHistory.query
        .filter_by(
            user_id=current_user_id
        )
        .order_by(
            SearchHistory.created_at.desc(),
            SearchHistory.id.desc()
        )
        .limit(5)
        .all()
    )

    history_list = []

    for item in history:

        history_list.append({
            "id": item.id,
            "query": item.search_text,
            "created_at": item.created_at
        })

    return jsonify({
        "history": history_list
    }), 200


# ==========================
# Add Search History
# ==========================
@search_history_bp.route(
    "/search-history",
    methods=["POST"]
)
@jwt_required()
def add_search_history():

    current_user_id = int(
        get_jwt_identity()
    )

    data = request.get_json(
        silent=True
    ) or {}

    search_text = str(
        data.get("query", "")
    ).strip()

    if not search_text:

        return jsonify({
            "message": "Search query is required."
        }), 400

    search_text = search_text[:255]

    # ==========================
    # Check Existing Search
    # ==========================
    # "Flask" and "flask" are
    # treated as the same search.
    existing = (
        SearchHistory.query
        .filter(
            SearchHistory.user_id
            == current_user_id,

            db.func.lower(
                SearchHistory.search_text
            )
            == search_text.lower()
        )
        .first()
    )

    if existing:

        # Move existing search back
        # to the top.
        existing.search_text = search_text
        existing.created_at = datetime.utcnow()

    else:

        new_search = SearchHistory(
            user_id=current_user_id,
            search_text=search_text
        )

        db.session.add(new_search)

    db.session.flush()

    # ==========================
    # Keep Maximum 5 Searches
    # ==========================
    history = (
        SearchHistory.query
        .filter_by(
            user_id=current_user_id
        )
        .order_by(
            SearchHistory.created_at.desc(),
            SearchHistory.id.desc()
        )
        .all()
    )

    if len(history) > 5:

        for old_search in history[5:]:

            db.session.delete(
                old_search
            )

    db.session.commit()

    # ==========================
    # Return Updated History
    # ==========================
    updated_history = (
        SearchHistory.query
        .filter_by(
            user_id=current_user_id
        )
        .order_by(
            SearchHistory.created_at.desc(),
            SearchHistory.id.desc()
        )
        .limit(5)
        .all()
    )

    return jsonify({
        "message": "Search history saved.",
        "history": [
            {
                "id": item.id,
                "query": item.search_text,
                "created_at": item.created_at
            }
            for item in updated_history
        ]
    }), 201


# ==========================
# Clear Search History
# ==========================
@search_history_bp.route(
    "/search-history",
    methods=["DELETE"]
)
@jwt_required()
def clear_search_history():

    current_user_id = int(
        get_jwt_identity()
    )

    SearchHistory.query.filter_by(
        user_id=current_user_id
    ).delete(
        synchronize_session=False
    )

    db.session.commit()

    return jsonify({
        "message": (
            "Search history removed successfully."
        ),
        "history": []
    }), 200