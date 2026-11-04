from datetime import datetime, timezone

from flask import request
from flask_jwt_extended import decode_token
from flask_socketio import join_room, leave_room

from app.extensions import socketio
from app.models.conversation import Conversation
from app.models.user import User


# In-memory presence for the development/MVP server.
# A user can have more than one browser tab/device socket.
user_sids = {}
sid_user = {}
last_active = {}


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_socket_user_id(auth):
    if not isinstance(auth, dict):
        return None

    token = auth.get("token")

    if not token:
        return None

    try:
        decoded = decode_token(token)
        return int(decoded["sub"])
    except Exception:
        return None


def current_socket_user_id():
    return sid_user.get(request.sid)


def user_is_online(user_id):
    return bool(user_sids.get(int(user_id)))


def presence_payload(user_id):
    user_id = int(user_id)

    return {
        "user_id": user_id,
        "online": user_is_online(user_id),
        "last_active": last_active.get(user_id)
    }


@socketio.on("connect")
def handle_connect(auth):
    user_id = get_socket_user_id(auth)

    if not user_id:
        return False

    user = User.query.get(user_id)

    if not user:
        return False

    sid_user[request.sid] = user_id
    user_sids.setdefault(user_id, set()).add(request.sid)

    join_room(f"user_{user_id}")

    socketio.emit(
        "socket_ready",
        {
            "user_id": user_id,
            "message": "Real-time messaging connected."
        },
        to=request.sid
    )

    # Tell connected clients that this ReelVerse user is online.
    socketio.emit(
        "presence_update",
        {
            "user_id": user_id,
            "online": True,
            "last_active": last_active.get(user_id)
        }
    )


@socketio.on("presence_request")
def handle_presence_request(data):
    try:
        requested_user_id = int(data.get("user_id"))
    except (TypeError, ValueError, AttributeError):
        return

    socketio.emit(
        "presence_update",
        presence_payload(requested_user_id),
        to=request.sid
    )


@socketio.on("join_conversation")
def handle_join_conversation(data):
    user_id = current_socket_user_id()

    if not user_id:
        return

    try:
        conversation_id = int(data.get("conversation_id"))
    except (TypeError, ValueError, AttributeError):
        return

    conversation = Conversation.query.get(conversation_id)

    if not conversation:
        return

    if user_id not in (
        conversation.user_one_id,
        conversation.user_two_id
    ):
        return

    join_room(f"conversation_{conversation_id}")


@socketio.on("leave_conversation")
def handle_leave_conversation(data):
    user_id = current_socket_user_id()

    if not user_id:
        return

    try:
        conversation_id = int(data.get("conversation_id"))
    except (TypeError, ValueError, AttributeError):
        return

    conversation = Conversation.query.get(conversation_id)

    if not conversation:
        return

    if user_id not in (
        conversation.user_one_id,
        conversation.user_two_id
    ):
        return

    leave_room(f"conversation_{conversation_id}")


@socketio.on("typing")
def handle_typing(data):
    sender_id = current_socket_user_id()

    if not sender_id:
        return

    try:
        conversation_id = int(data.get("conversation_id"))
        is_typing = bool(data.get("is_typing"))
    except (TypeError, ValueError, AttributeError):
        return

    conversation = Conversation.query.get(conversation_id)

    if not conversation:
        return

    if sender_id not in (
        conversation.user_one_id,
        conversation.user_two_id
    ):
        return

    receiver_id = (
        conversation.user_two_id
        if conversation.user_one_id == sender_id
        else conversation.user_one_id
    )

    sender = User.query.get(sender_id)

    socketio.emit(
        "typing_update",
        {
            "conversation_id": conversation_id,
            "user_id": sender_id,
            "username": sender.username if sender else "User",
            "is_typing": is_typing
        },
        to=f"user_{receiver_id}"
    )


@socketio.on("disconnect")
def handle_disconnect():
    user_id = sid_user.pop(request.sid, None)

    if not user_id:
        return

    sockets = user_sids.get(user_id)

    if sockets is not None:
        sockets.discard(request.sid)

        if not sockets:
            user_sids.pop(user_id, None)

            disconnected_at = utc_now_iso()
            last_active[user_id] = disconnected_at

            socketio.emit(
                "presence_update",
                {
                    "user_id": user_id,
                    "online": False,
                    "last_active": disconnected_at
                }
            )
