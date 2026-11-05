import os

from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from flask_socketio import SocketIO
from flask_mail import Mail


db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()
mail = Mail()


# Websites allowed to use the chat connection. Your computer is always
# allowed. When hosted, set FRONTEND_ORIGIN to the website address, for
# example https://reelverse.vercel.app (several can be separated by commas).
chat_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

for origin in os.getenv("FRONTEND_ORIGIN", "").split(","):
    origin = origin.strip().rstrip("/")

    if origin and origin not in chat_origins:
        chat_origins.append(origin)


socketio = SocketIO(
    cors_allowed_origins=chat_origins,
    async_mode="threading",
)