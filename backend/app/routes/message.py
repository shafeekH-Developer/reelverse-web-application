from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import or_

import cloudinary
import cloudinary.uploader

from app.extensions import db, socketio
from app.models.user import User
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_reaction import MessageReaction
from app.models.conversation_state import ConversationState
from app.models.message_pin import MessagePin


message_bp = Blueprint("message", __name__)


# ==========================
# Helpers
# ==========================
def get_ordered_user_ids(first_user_id, second_user_id):
    return (
        min(first_user_id, second_user_id),
        max(first_user_id, second_user_id)
    )


def get_or_create_conversation(first_user_id, second_user_id):
    user_one_id, user_two_id = get_ordered_user_ids(
        first_user_id,
        second_user_id
    )

    conversation = Conversation.query.filter_by(
        user_one_id=user_one_id,
        user_two_id=user_two_id
    ).first()

    if conversation:
        return conversation, False

    conversation = Conversation(
        user_one_id=user_one_id,
        user_two_id=user_two_id
    )

    db.session.add(conversation)
    db.session.flush()

    return conversation, True


def is_conversation_member(conversation, user_id):
    return user_id in (
        conversation.user_one_id,
        conversation.user_two_id
    )


def get_other_user_id(conversation, current_user_id):
    if conversation.user_one_id == current_user_id:
        return conversation.user_two_id

    return conversation.user_one_id


MAX_PINNED_CHATS = 3
MAX_PINNED_MESSAGES = 3


def get_state(conversation_id, user_id):
    return ConversationState.query.filter_by(
        conversation_id=conversation_id,
        user_id=user_id
    ).first()


def get_or_create_state(conversation_id, user_id):
    state = get_state(conversation_id, user_id)

    if state:
        return state

    state = ConversationState(
        conversation_id=conversation_id,
        user_id=user_id,
        cleared_message_id=0,
        is_hidden=False
    )

    db.session.add(state)
    db.session.flush()

    return state


def get_cleared_id(conversation_id, user_id):
    state = get_state(conversation_id, user_id)

    return state.cleared_message_id if state else 0


def reveal_conversation(conversation):
    """
    A new message was sent, so the conversation must show up again in
    the inbox of both people (if one of them had deleted the chat).
    """
    states = ConversationState.query.filter_by(
        conversation_id=conversation.id,
        is_hidden=True
    ).all()

    for state in states:
        state.is_hidden = False


def get_pinned_message_ids(conversation_id, user_id):
    pins = (
        MessagePin.query
        .join(Message, MessagePin.message_id == Message.id)
        .filter(
            MessagePin.conversation_id == conversation_id,
            MessagePin.user_id == user_id,
            Message.is_unsent.is_(False)
        )
        .order_by(MessagePin.created_at.asc(), MessagePin.id.asc())
        .all()
    )

    return [pin.message_id for pin in pins]


def serialize_message(message):
    sender = User.query.get(message.sender_id)
    receiver = User.query.get(message.receiver_id)

    return {
        "id": message.id,
        "conversation_id": message.conversation_id,
        "sender_id": message.sender_id,
        "sender_username": (
            sender.username
            if sender
            else "Unknown user"
        ),
        "receiver_id": message.receiver_id,
        "receiver_username": (
            receiver.username
            if receiver
            else "Unknown user"
        ),
        "message_type": message.message_type,
        "content": (
            None
            if message.is_unsent
            else message.content
        ),
        "media_url": (
            None
            if message.is_unsent
            else message.media_url
        ),
        "reply_to_id": message.reply_to_id,
        "is_read": message.is_read,
        "read_at": message.read_at,
        "is_unsent": message.is_unsent,
        "reactions": [{"id": r.id, "user_id": r.user_id, "reaction": r.reaction, "created_at": r.created_at} for r in message.reactions],
        "created_at": message.created_at
    }


def serialize_message_realtime(message):
    data = serialize_message(message)

    data["created_at"] = (
        message.created_at.isoformat()
        if message.created_at
        else None
    )

    data["read_at"] = (
        message.read_at.isoformat()
        if message.read_at
        else None
    )

    data["reactions"] = [
        {
            "id": reaction.id,
            "user_id": reaction.user_id,
            "reaction": reaction.reaction,
            "created_at": (
                reaction.created_at.isoformat()
                if reaction.created_at
                else None
            )
        }
        for reaction in message.reactions
    ]

    return data


def get_latest_conversation_reaction(conversation_id, cleared_id=0):
    reaction = (
        MessageReaction.query
        .join(Message, MessageReaction.message_id == Message.id)
        .filter(
            Message.conversation_id == conversation_id,
            Message.id > cleared_id
        )
        .order_by(
            MessageReaction.created_at.desc(),
            MessageReaction.id.desc()
        )
        .first()
    )

    if not reaction:
        return None

    message = Message.query.get(reaction.message_id)

    if not message or message.is_unsent:
        return None

    return {
        "reaction": reaction.reaction,
        "user_id": reaction.user_id,
        "message_id": message.id,
        "message_type": message.message_type,
        "message_content": message.content,
        "created_at": reaction.created_at
    }


# ==========================
# Start / Get Conversation
# ==========================
@message_bp.route(
    "/messages/users/<int:user_id>/conversation",
    methods=["POST"]
)
@jwt_required()
def start_conversation(user_id):

    current_user = int(get_jwt_identity())

    if current_user == user_id:
        return jsonify({
            "message": "You cannot start a conversation with yourself."
        }), 400

    other_user = User.query.get(user_id)

    if not other_user:
        return jsonify({
            "message": "User not found."
        }), 404

    conversation, created = get_or_create_conversation(
        current_user,
        user_id
    )

    # If this user had deleted the chat earlier, it opens again
    # (empty - the old messages stay deleted for this user).
    reveal_conversation(conversation)

    db.session.commit()

    return jsonify({
        "message": (
            "Conversation created successfully."
            if created
            else "Conversation already exists."
        ),
        "conversation": {
            "id": conversation.id,
            "other_user": {
                "id": other_user.id,
                "username": other_user.username,
                "email": other_user.email
            },
            "created_at": conversation.created_at,
            "updated_at": conversation.updated_at
        }
    }), 201 if created else 200


# ==========================
# Send Text Message To User
# ==========================
@message_bp.route(
    "/messages/users/<int:user_id>",
    methods=["POST"]
)
@jwt_required()
def send_message_to_user(user_id):

    current_user = int(get_jwt_identity())

    if current_user == user_id:
        return jsonify({
            "message": "You cannot message yourself."
        }), 400

    receiver = User.query.get(user_id)

    if not receiver:
        return jsonify({
            "message": "User not found."
        }), 404

    data = request.get_json(silent=True) or {}
    content = str(data.get("content", "")).strip()

    if not content:
        return jsonify({
            "message": "Message content is required."
        }), 400

    conversation, _ = get_or_create_conversation(
        current_user,
        user_id
    )

    new_message = Message(
        conversation_id=conversation.id,
        sender_id=current_user,
        receiver_id=user_id,
        message_type="text",
        content=content
    )

    conversation.updated_at = datetime.utcnow()
    reveal_conversation(conversation)

    db.session.add(new_message)
    db.session.commit()

    realtime_message = serialize_message_realtime(new_message)

    socketio.emit(
        "new_message",
        {
            "conversation_id": conversation.id,
            "message": realtime_message
        },
        to=f"user_{user_id}"
    )

    socketio.emit(
        "new_message",
        {
            "conversation_id": conversation.id,
            "message": realtime_message
        },
        to=f"user_{current_user}"
    )

    return jsonify({
        "message": "Message sent successfully!",
        "data": serialize_message(new_message)
    }), 201


# ==========================
# Reply / Send Inside Conversation
# ==========================
@message_bp.route(
    "/messages/conversations/<int:conversation_id>",
    methods=["POST"]
)
@jwt_required()
def send_message_in_conversation(conversation_id):

    current_user = int(get_jwt_identity())

    conversation = Conversation.query.get(conversation_id)

    if not conversation:
        return jsonify({
            "message": "Conversation not found."
        }), 404

    if not is_conversation_member(
        conversation,
        current_user
    ):
        return jsonify({
            "message": "You are not allowed to use this conversation."
        }), 403

    data = request.get_json(silent=True) or {}
    content = str(data.get("content", "")).strip()
    reply_to_id = data.get("reply_to_id")

    if not content:
        return jsonify({
            "message": "Message content is required."
        }), 400

    reply_to_message = None

    if reply_to_id is not None:
        try:
            reply_to_id = int(reply_to_id)
        except (TypeError, ValueError):
            return jsonify({
                "message": "Invalid reply_to_id."
            }), 400

        reply_to_message = Message.query.filter_by(
            id=reply_to_id,
            conversation_id=conversation.id
        ).first()

        if not reply_to_message:
            return jsonify({
                "message": "Reply message not found in this conversation."
            }), 404

    receiver_id = get_other_user_id(
        conversation,
        current_user
    )

    new_message = Message(
        conversation_id=conversation.id,
        sender_id=current_user,
        receiver_id=receiver_id,
        message_type="text",
        content=content,
        reply_to_id=(
            reply_to_message.id
            if reply_to_message
            else None
        )
    )

    conversation.updated_at = datetime.utcnow()
    reveal_conversation(conversation)

    db.session.add(new_message)
    db.session.commit()

    realtime_message = serialize_message_realtime(new_message)

    socketio.emit(
        "new_message",
        {
            "conversation_id": conversation.id,
            "message": realtime_message
        },
        to=f"user_{receiver_id}"
    )

    socketio.emit(
        "new_message",
        {
            "conversation_id": conversation.id,
            "message": realtime_message
        },
        to=f"user_{current_user}"
    )

    return jsonify({
        "message": "Message sent successfully!",
        "data": serialize_message(new_message)
    }), 201


# ==========================
# Send Image / Video Message
# ==========================
@message_bp.route(
    "/messages/conversations/<int:conversation_id>/media",
    methods=["POST"]
)
@jwt_required()
def send_media_message(conversation_id):

    current_user = int(get_jwt_identity())

    conversation = Conversation.query.get(conversation_id)

    if not conversation:
        return jsonify({
            "message": "Conversation not found."
        }), 404

    if not is_conversation_member(
        conversation,
        current_user
    ):
        return jsonify({
            "message": "You are not allowed to use this conversation."
        }), 403

    media_file = request.files.get("media")

    if not media_file or not media_file.filename:
        return jsonify({
            "message": "Please choose an image or video."
        }), 400

    mime_type = (media_file.mimetype or "").lower()
    filename = (media_file.filename or "").lower()

    image_extensions = (
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif"
    )

    video_extensions = (
        ".mp4",
        ".mov",
        ".webm",
        ".mkv"
    )

    is_image = (
        mime_type.startswith("image/")
        or filename.endswith(image_extensions)
    )

    is_video = (
        mime_type.startswith("video/")
        or filename.endswith(video_extensions)
    )

    if is_image:
        message_type = "image"
        resource_type = "image"
        folder = "ReelVerse/messages/images"
    elif is_video:
        message_type = "video"
        resource_type = "video"
        folder = "ReelVerse/messages/videos"
    else:
        return jsonify({
            "message": "Only image and video files are supported."
        }), 400

    # Optional caption. The media itself is enough to send the message.
    content = request.form.get("content", "").strip() or None
    reply_to_id = request.form.get("reply_to_id")
    reply_to_message = None

    if reply_to_id not in (None, ""):
        try:
            reply_to_id = int(reply_to_id)
        except (TypeError, ValueError):
            return jsonify({
                "message": "Invalid reply_to_id."
            }), 400

        reply_to_message = Message.query.filter_by(
            id=reply_to_id,
            conversation_id=conversation.id
        ).first()

        if not reply_to_message:
            return jsonify({
                "message": "Reply message not found in this conversation."
            }), 404

    receiver_id = get_other_user_id(
        conversation,
        current_user
    )

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
            media_file,
            resource_type=resource_type,
            folder=folder
        )

        media_url = upload_result.get("secure_url")

        if not media_url:
            return jsonify({
                "message": "Media upload failed."
            }), 500

        new_message = Message(
            conversation_id=conversation.id,
            sender_id=current_user,
            receiver_id=receiver_id,
            message_type=message_type,
            content=content,
            media_url=media_url,
            reply_to_id=(
                reply_to_message.id
                if reply_to_message
                else None
            )
        )

        conversation.updated_at = datetime.utcnow()
        reveal_conversation(conversation)

        db.session.add(new_message)
        db.session.commit()

        realtime_message = serialize_message_realtime(
            new_message
        )

        socketio.emit(
            "new_message",
            {
                "conversation_id": conversation.id,
                "message": realtime_message
            },
            to=f"user_{receiver_id}"
        )

        socketio.emit(
            "new_message",
            {
                "conversation_id": conversation.id,
                "message": realtime_message
            },
            to=f"user_{current_user}"
        )

        return jsonify({
            "message": (
                "Image sent successfully!"
                if message_type == "image"
                else "Video sent successfully!"
            ),
            "data": serialize_message(new_message)
        }), 201

    except Exception as e:
        db.session.rollback()

        return jsonify({
            "message": "Media message failed.",
            "error": str(e)
        }), 500


# ==========================
# Unsend Message For Everyone
# ==========================
@message_bp.route(
    "/messages/<int:message_id>/unsend",
    methods=["PUT"]
)
@jwt_required()
def unsend_message(message_id):

    current_user = int(get_jwt_identity())

    message = Message.query.get(message_id)

    if not message:
        return jsonify({
            "message": "Message not found."
        }), 404

    if message.sender_id != current_user:
        return jsonify({
            "message": "You can only unsend your own messages."
        }), 403

    if message.is_unsent:
        return jsonify({
            "message": "Message is already unsent.",
            "data": serialize_message(message)
        }), 200

    message.is_unsent = True
    message.content = None
    message.media_url = None

    # An unsent message cannot stay pinned for anybody.
    MessagePin.query.filter_by(message_id=message.id).delete()

    conversation = Conversation.query.get(
        message.conversation_id
    )

    if conversation:
        conversation.updated_at = datetime.utcnow()

    db.session.commit()

    realtime_message = serialize_message_realtime(
        message
    )

    payload = {
        "conversation_id": message.conversation_id,
        "message_id": message.id,
        "message": realtime_message
    }

    socketio.emit(
        "message_unsent",
        payload,
        to=f"user_{message.receiver_id}"
    )

    socketio.emit(
        "message_unsent",
        payload,
        to=f"user_{current_user}"
    )

    return jsonify({
        "message": "Message unsent successfully!",
        "data": serialize_message(message)
    }), 200


# ==========================
# Delete Message For Me
# ==========================
@message_bp.route(
    "/messages/<int:message_id>/delete-for-me",
    methods=["PUT"]
)
@jwt_required()
def delete_message_for_me(message_id):

    current_user = int(get_jwt_identity())

    message = Message.query.get(message_id)

    if not message:
        return jsonify({
            "message": "Message not found."
        }), 404

    conversation = Conversation.query.get(
        message.conversation_id
    )

    if not conversation or not is_conversation_member(
        conversation,
        current_user
    ):
        return jsonify({
            "message": "You are not allowed to delete this message."
        }), 403

    if message.sender_id == current_user:
        if message.sender_deleted:
            return jsonify({
                "message": "Message is already deleted for you.",
                "message_id": message.id
            }), 200

        message.sender_deleted = True

    elif message.receiver_id == current_user:
        if message.receiver_deleted:
            return jsonify({
                "message": "Message is already deleted for you.",
                "message_id": message.id
            }), 200

        message.receiver_deleted = True

    else:
        return jsonify({
            "message": "You are not allowed to delete this message."
        }), 403

    MessagePin.query.filter_by(
        message_id=message.id,
        user_id=current_user
    ).delete()

    db.session.commit()

    return jsonify({
        "message": "Message deleted for you successfully!",
        "message_id": message.id,
        "conversation_id": message.conversation_id
    }), 200


# ==========================
# Add / Change Message Reaction
# ==========================
@message_bp.route("/messages/<int:message_id>/reaction", methods=["PUT"])
@jwt_required()
def add_or_change_message_reaction(message_id):
    current_user = int(get_jwt_identity())
    message = Message.query.get(message_id)
    if not message:
        return jsonify({"message": "Message not found."}), 404
    conversation = Conversation.query.get(message.conversation_id)
    if not conversation or not is_conversation_member(conversation, current_user):
        return jsonify({"message": "You are not allowed to react to this message."}), 403
    if message.is_unsent:
        return jsonify({"message": "You cannot react to an unsent message."}), 400
    data = request.get_json(silent=True) or {}
    reaction_value = str(data.get("reaction", "")).strip()
    allowed_reactions = {"❤️", "😂", "😮", "😢", "👍", "🔥"}
    if reaction_value not in allowed_reactions:
        return jsonify({"message": "Invalid reaction."}), 400
    reaction = MessageReaction.query.filter_by(message_id=message.id, user_id=current_user).first()
    if reaction:
        reaction.reaction = reaction_value
        reaction.created_at = datetime.utcnow()
        response_message = "Reaction changed successfully!"
    else:
        reaction = MessageReaction(message_id=message.id, user_id=current_user, reaction=reaction_value)
        db.session.add(reaction)
        response_message = "Reaction added successfully!"
    db.session.commit()
    payload = {
        "conversation_id": message.conversation_id,
        "message_id": message.id,
        "reaction_user_id": current_user,
        "message": serialize_message_realtime(message)
    }
    socketio.emit("message_reaction_updated", payload, to=f"user_{message.sender_id}")
    socketio.emit("message_reaction_updated", payload, to=f"user_{message.receiver_id}")
    return jsonify({"message": response_message, "data": serialize_message(message)}), 200


# ==========================
# Remove Message Reaction
# ==========================
@message_bp.route("/messages/<int:message_id>/reaction", methods=["DELETE"])
@jwt_required()
def remove_message_reaction(message_id):
    current_user = int(get_jwt_identity())
    message = Message.query.get(message_id)
    if not message:
        return jsonify({"message": "Message not found."}), 404
    conversation = Conversation.query.get(message.conversation_id)
    if not conversation or not is_conversation_member(conversation, current_user):
        return jsonify({"message": "You are not allowed to update this message."}), 403
    reaction = MessageReaction.query.filter_by(message_id=message.id, user_id=current_user).first()
    if not reaction:
        return jsonify({"message": "You have not reacted to this message."}), 404
    db.session.delete(reaction)
    db.session.commit()
    payload = {
        "conversation_id": message.conversation_id,
        "message_id": message.id,
        "reaction_user_id": current_user,
        "message": serialize_message_realtime(message)
    }
    socketio.emit("message_reaction_updated", payload, to=f"user_{message.sender_id}")
    socketio.emit("message_reaction_updated", payload, to=f"user_{message.receiver_id}")
    return jsonify({"message": "Reaction removed successfully!", "data": serialize_message(message)}), 200


# ==========================
# Mark Conversation Messages As Read
# ==========================
@message_bp.route(
    "/messages/conversations/<int:conversation_id>/read",
    methods=["PUT"]
)
@jwt_required()
def mark_conversation_read(conversation_id):

    current_user = int(get_jwt_identity())

    conversation = Conversation.query.get(conversation_id)

    if not conversation:
        return jsonify({
            "message": "Conversation not found."
        }), 404

    if not is_conversation_member(
        conversation,
        current_user
    ):
        return jsonify({
            "message": "You are not allowed to update this conversation."
        }), 403

    unread_messages = Message.query.filter_by(
        conversation_id=conversation.id,
        receiver_id=current_user,
        is_read=False
    ).all()

    now = datetime.utcnow()

    for message in unread_messages:
        message.is_read = True
        message.read_at = now

    db.session.commit()

    if unread_messages:
        sender_ids = {
            message.sender_id
            for message in unread_messages
        }

        read_payload = {
            "conversation_id": conversation.id,
            "reader_id": current_user,
            "message_ids": [
                message.id
                for message in unread_messages
            ],
            "read_at": now.isoformat()
        }

        for sender_id in sender_ids:
            socketio.emit(
                "messages_read",
                read_payload,
                to=f"user_{sender_id}"
            )

        socketio.emit(
            "messages_read",
            read_payload,
            to=f"user_{current_user}"
        )

    return jsonify({
        "message": "Conversation marked as read.",
        "conversation_id": conversation.id,
        "marked_read": len(unread_messages),
        "read_at": now
    }), 200


# ==========================
# Get Conversation Chat History
# ==========================
@message_bp.route(
    "/messages/conversations/<int:conversation_id>",
    methods=["GET"]
)
@jwt_required()
def get_conversation_messages(conversation_id):

    current_user = int(get_jwt_identity())

    conversation = Conversation.query.get(conversation_id)

    if not conversation:
        return jsonify({
            "message": "Conversation not found."
        }), 404

    if not is_conversation_member(
        conversation,
        current_user
    ):
        return jsonify({
            "message": "You are not allowed to view this conversation."
        }), 403

    other_user_id = get_other_user_id(
        conversation,
        current_user
    )

    other_user = User.query.get(other_user_id)

    cleared_id = get_cleared_id(conversation.id, current_user)

    messages = Message.query.filter(
        Message.conversation_id == conversation.id,
        Message.id > cleared_id
    ).order_by(
        Message.created_at.asc(),
        Message.id.asc()
    ).all()

    visible_messages = []

    for message in messages:
        if (
            message.sender_id == current_user
            and message.sender_deleted
        ):
            continue

        if (
            message.receiver_id == current_user
            and message.receiver_deleted
        ):
            continue

        visible_messages.append(
            serialize_message(message)
        )

    visible_ids = {item["id"] for item in visible_messages}

    pinned_message_ids = [
        message_id
        for message_id in get_pinned_message_ids(
            conversation.id,
            current_user
        )
        if message_id in visible_ids
    ]

    state = get_state(conversation.id, current_user)

    return jsonify({
        "conversation": {
            "id": conversation.id,
            "other_user": {
                "id": other_user.id,
                "username": other_user.username,
                "email": other_user.email,
                "profile_photo_url": other_user.profile_photo_url
            } if other_user else None,
            "is_pinned": bool(state and state.pinned_at),
            "created_at": conversation.created_at,
            "updated_at": conversation.updated_at
        },
        "total_messages": len(visible_messages),
        "pinned_message_ids": pinned_message_ids,
        "messages": visible_messages
    }), 200


# ==========================
# Get My Inbox / Conversations
# ==========================
@message_bp.route(
    "/messages/conversations",
    methods=["GET"]
)
@jwt_required()
def get_my_conversations():

    current_user = int(get_jwt_identity())

    conversations = Conversation.query.filter(
        or_(
            Conversation.user_one_id == current_user,
            Conversation.user_two_id == current_user
        )
    ).order_by(
        Conversation.updated_at.desc(),
        Conversation.id.desc()
    ).all()

    states = {
        state.conversation_id: state
        for state in ConversationState.query.filter_by(
            user_id=current_user
        ).all()
    }

    conversation_list = []

    for conversation in conversations:

        state = states.get(conversation.id)

        # Chats this user deleted stay out of the inbox
        # until somebody sends a new message.
        if state and state.is_hidden:
            continue

        cleared_id = state.cleared_message_id if state else 0

        other_user_id = get_other_user_id(
            conversation,
            current_user
        )

        other_user = User.query.get(other_user_id)

        last_message = Message.query.filter(
            Message.conversation_id == conversation.id,
            Message.id > cleared_id
        ).order_by(
            Message.created_at.desc(),
            Message.id.desc()
        ).first()

        latest_reaction = get_latest_conversation_reaction(
            conversation.id,
            cleared_id
        )

        unread_count = Message.query.filter(
            Message.conversation_id == conversation.id,
            Message.receiver_id == current_user,
            Message.is_read.is_(False),
            Message.id > cleared_id
        ).count()

        conversation_list.append({
            "id": conversation.id,
            "other_user": {
                "id": other_user.id,
                "username": other_user.username,
                "email": other_user.email,
                "profile_photo_url": other_user.profile_photo_url
            } if other_user else None,
            "last_message": (
                serialize_message(last_message)
                if last_message
                else None
            ),
            "latest_reaction": latest_reaction,
            "unread_count": unread_count,
            "is_pinned": bool(state and state.pinned_at),
            "pinned_at": (
                state.pinned_at
                if state and state.pinned_at
                else None
            ),
            "created_at": conversation.created_at,
            "updated_at": conversation.updated_at
        })

    # Pinned chats first (most recently pinned on top),
    # then everything else in the usual newest-first order.
    pinned_chats = sorted(
        [item for item in conversation_list if item["is_pinned"]],
        key=lambda item: item["pinned_at"],
        reverse=True
    )
    other_chats = [
        item for item in conversation_list if not item["is_pinned"]
    ]
    conversation_list = pinned_chats + other_chats

    return jsonify({
        "total_conversations": len(conversation_list),
        "conversations": conversation_list
    }), 200


# ==========================
# Delete Conversation For Me
# ==========================
@message_bp.route(
    "/messages/conversations/<int:conversation_id>",
    methods=["DELETE"]
)
@jwt_required()
def delete_conversation_for_me(conversation_id):

    current_user = int(get_jwt_identity())

    conversation = Conversation.query.get(conversation_id)

    if not conversation:
        return jsonify({
            "message": "Conversation not found."
        }), 404

    if not is_conversation_member(
        conversation,
        current_user
    ):
        return jsonify({
            "message": "You are not allowed to delete this conversation."
        }), 403

    latest_message = Message.query.filter_by(
        conversation_id=conversation.id
    ).order_by(Message.id.desc()).first()

    state = get_or_create_state(
        conversation.id,
        current_user
    )

    # Everything up to the newest message is gone for this user only.
    state.cleared_message_id = (
        latest_message.id
        if latest_message
        else state.cleared_message_id
    )
    state.is_hidden = True
    state.pinned_at = None

    MessagePin.query.filter_by(
        conversation_id=conversation.id,
        user_id=current_user
    ).delete()

    db.session.commit()

    return jsonify({
        "message": "Conversation deleted for you.",
        "conversation_id": conversation.id
    }), 200


# ==========================
# Pin / Unpin Conversation
# ==========================
@message_bp.route(
    "/messages/conversations/<int:conversation_id>/pin",
    methods=["PUT"]
)
@jwt_required()
def pin_conversation(conversation_id):

    current_user = int(get_jwt_identity())

    conversation = Conversation.query.get(conversation_id)

    if not conversation:
        return jsonify({
            "message": "Conversation not found."
        }), 404

    if not is_conversation_member(
        conversation,
        current_user
    ):
        return jsonify({
            "message": "You are not allowed to pin this conversation."
        }), 403

    data = request.get_json(silent=True) or {}
    should_pin = bool(data.get("pinned", True))

    state = get_or_create_state(
        conversation.id,
        current_user
    )

    if should_pin and not state.pinned_at:
        pinned_count = ConversationState.query.filter(
            ConversationState.user_id == current_user,
            ConversationState.pinned_at.isnot(None),
            ConversationState.is_hidden.is_(False)
        ).count()

        if pinned_count >= MAX_PINNED_CHATS:
            db.session.rollback()

            return jsonify({
                "message": (
                    f"You can pin up to {MAX_PINNED_CHATS} chats. "
                    "Unpin one first."
                )
            }), 400

        state.pinned_at = datetime.utcnow()

    elif not should_pin:
        state.pinned_at = None

    db.session.commit()

    return jsonify({
        "message": (
            "Chat pinned."
            if state.pinned_at
            else "Chat unpinned."
        ),
        "conversation_id": conversation.id,
        "is_pinned": bool(state.pinned_at)
    }), 200


# ==========================
# Pin / Unpin Message
# ==========================
@message_bp.route(
    "/messages/<int:message_id>/pin",
    methods=["PUT"]
)
@jwt_required()
def pin_message(message_id):

    current_user = int(get_jwt_identity())

    message = Message.query.get(message_id)

    if not message:
        return jsonify({
            "message": "Message not found."
        }), 404

    conversation = Conversation.query.get(
        message.conversation_id
    )

    if not conversation or not is_conversation_member(
        conversation,
        current_user
    ):
        return jsonify({
            "message": "You are not allowed to pin this message."
        }), 403

    data = request.get_json(silent=True) or {}
    should_pin = bool(data.get("pinned", True))

    existing_pin = MessagePin.query.filter_by(
        message_id=message.id,
        user_id=current_user
    ).first()

    if should_pin and not existing_pin:
        if message.is_unsent:
            return jsonify({
                "message": "You cannot pin an unsent message."
            }), 400

        deleted_for_me = (
            (
                message.sender_id == current_user
                and message.sender_deleted
            )
            or (
                message.receiver_id == current_user
                and message.receiver_deleted
            )
            or message.id <= get_cleared_id(
                conversation.id,
                current_user
            )
        )

        if deleted_for_me:
            return jsonify({
                "message": "This message is no longer available."
            }), 404

        pinned_count = len(
            get_pinned_message_ids(
                conversation.id,
                current_user
            )
        )

        if pinned_count >= MAX_PINNED_MESSAGES:
            return jsonify({
                "message": (
                    f"You can pin up to {MAX_PINNED_MESSAGES} "
                    "messages in a chat. Unpin one first."
                )
            }), 400

        db.session.add(MessagePin(
            conversation_id=conversation.id,
            message_id=message.id,
            user_id=current_user
        ))

    elif not should_pin and existing_pin:
        db.session.delete(existing_pin)

    db.session.commit()

    return jsonify({
        "message": (
            "Message pinned."
            if should_pin
            else "Message unpinned."
        ),
        "message_id": message.id,
        "conversation_id": conversation.id,
        "pinned_message_ids": get_pinned_message_ids(
            conversation.id,
            current_user
        )
    }), 200