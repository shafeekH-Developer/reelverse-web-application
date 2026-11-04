from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.extensions import db
from app.models.user import User
from app.models.follow import Follow
from app.models.notification import Notification

follow_bp = Blueprint("follow", __name__)


# ==========================
# Follow User
# ==========================
@follow_bp.route("/users/<int:user_id>/follow", methods=["POST"])
@jwt_required()
def follow_user(user_id):

    current_user = int(get_jwt_identity())

    if current_user == user_id:
        return jsonify({
            "message": "You cannot follow yourself."
        }), 400

    user = User.query.get(user_id)

    if not user:
        return jsonify({
            "message": "User not found."
        }), 404

    existing_follow = Follow.query.filter_by(
        follower_id=current_user,
        following_id=user_id
    ).first()

    if existing_follow:
        return jsonify({
            "message": "You already follow this user."
        }), 400

    follow = Follow(
        follower_id=current_user,
        following_id=user_id
    )

    db.session.add(follow)

    # ==========================
    # Create Notification
    # ==========================
    notification = Notification(
        user_id=user_id,
        sender_id=current_user,
        type="follow",
        message="Someone started following you."
    )

    db.session.add(notification)

    db.session.commit()

    return jsonify({
        "message": "User followed successfully!"
    }), 201


# ==========================
# Unfollow User
# ==========================
@follow_bp.route("/users/<int:user_id>/follow", methods=["DELETE"])
@jwt_required()
def unfollow_user(user_id):

    current_user = int(get_jwt_identity())

    follow = Follow.query.filter_by(
        follower_id=current_user,
        following_id=user_id
    ).first()

    if not follow:
        return jsonify({
            "message": "You are not following this user."
        }), 404

    db.session.delete(follow)
    db.session.commit()

    return jsonify({
        "message": "User unfollowed successfully!"
    }), 200


# ==========================
# Get Followers
# ==========================
@follow_bp.route("/users/<int:user_id>/followers", methods=["GET"])
def get_followers(user_id):

    user = User.query.get(user_id)

    if not user:
        return jsonify({
            "message": "User not found."
        }), 404

    followers = Follow.query.filter_by(
        following_id=user_id
    ).all()

    follower_list = []

    for follow in followers:

        follower = User.query.get(follow.follower_id)

        if follower:
            follower_list.append({
                "id": follower.id,
                "username": follower.username,
                "email": follower.email,
                "profile_photo_url": follower.profile_photo_url
            })

    return jsonify({
        "total_followers": len(follower_list),
        "followers": follower_list
    }), 200


# ==========================
# Get Following
# ==========================
@follow_bp.route("/users/<int:user_id>/following", methods=["GET"])
def get_following(user_id):

    user = User.query.get(user_id)

    if not user:
        return jsonify({
            "message": "User not found."
        }), 404

    following = Follow.query.filter_by(
        follower_id=user_id
    ).all()

    following_list = []

    for follow in following:

        followed_user = User.query.get(follow.following_id)

        if followed_user:
            following_list.append({
                "id": followed_user.id,
                "username": followed_user.username,
                "email": followed_user.email,
                "profile_photo_url": followed_user.profile_photo_url
            })

    return jsonify({
        "total_following": len(following_list),
        "following": following_list
    }), 200