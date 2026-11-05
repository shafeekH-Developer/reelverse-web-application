import os
from datetime import timedelta

from flask import Flask, request

from app.extensions import (
    db,
    migrate,
    jwt,
    socketio,
    mail,
)


def create_app():

    # Load .env and configure Cloudinary before routes use it.
    from app import config as app_config

    app = Flask(__name__)

    # ==========================
    # Configuration
    # ==========================

    # On your computer this stays the local SQLite file. When hosted, set
    # DATABASE_URL to the PostgreSQL address given by the hosting site.
    database_url = os.getenv("DATABASE_URL", "").strip()

    if database_url.startswith("postgres://"):
        database_url = database_url.replace(
            "postgres://", "postgresql://", 1
        )

    app.config["SQLALCHEMY_DATABASE_URI"] = (
        database_url or "sqlite:///reelverse.db"
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    if database_url:
        # Hosted databases close idle connections: check before using one.
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
            "pool_pre_ping": True,
            "pool_recycle": 280,
        }

    app.config["JWT_SECRET_KEY"] = app_config.os.getenv(
        "JWT_SECRET_KEY",
        "reelverse_secret_key"
    )

    # Short access token, long refresh token. The website renews the
    # access token automatically using the refresh token.
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=1)
    app.config["JWT_REFRESH_TOKEN_EXPIRES"] = timedelta(days=30)

    # ==========================
    # Email Configuration
    # ==========================

    app.config["MAIL_SERVER"] = app_config.MAIL_SERVER
    app.config["MAIL_PORT"] = app_config.MAIL_PORT
    app.config["MAIL_USE_TLS"] = app_config.MAIL_USE_TLS
    app.config["MAIL_USE_SSL"] = False

    app.config["MAIL_USERNAME"] = app_config.MAIL_USERNAME
    app.config["MAIL_PASSWORD"] = app_config.MAIL_PASSWORD
    app.config["MAIL_DEFAULT_SENDER"] = app_config.MAIL_DEFAULT_SENDER

    # ==========================
    # CORS (lets the hosted website call this backend)
    # ==========================
    # FRONTEND_ORIGIN holds the website address, for example
    # https://reelverse.vercel.app (several can be separated by commas).

    allowed_origins = {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    }

    for origin in os.getenv("FRONTEND_ORIGIN", "").split(","):
        origin = origin.strip().rstrip("/")

        if origin:
            allowed_origins.add(origin)

    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get("Origin", "").rstrip("/")

        if origin in allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Headers"] = (
                "Authorization, Content-Type"
            )
            response.headers["Access-Control-Allow-Methods"] = (
                "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            )
            response.headers["Access-Control-Max-Age"] = "86400"

        return response

    # ==========================
    # Initialize Extensions
    # ==========================

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    mail.init_app(app)
    socketio.init_app(app)

    # ==========================
    # Import Models
    # ==========================

    from app.models.user import User
    from app.models.video import Video
    from app.models.like import Like
    from app.models.comment import Comment
    from app.models.follow import Follow
    from app.models.notification import Notification
    from app.models.history import History
    from app.models.bookmark import Bookmark
    from app.models.conversation import Conversation
    from app.models.message import Message
    from app.models.search_history import SearchHistory
    from app.models.email_verification import EmailVerification
    from app.models.password_reset import PasswordReset
    from app.models.report import Report

    # ==========================
    # Import Routes
    # ==========================

    from app.routes.auth import auth_bp

    from app.routes.video_create import video_create_bp
    from app.routes.video_read import video_read_bp
    from app.routes.video_update import video_update_bp
    from app.routes.video_delete import video_delete_bp
    from app.routes.video_quality import video_quality_bp

    from app.routes.like import like_bp
    from app.routes.comment import comment_bp
    from app.routes.follow import follow_bp
    from app.routes.notification import notification_bp
    from app.routes.history import history_bp
    from app.routes.bookmark import bookmark_bp
    from app.routes.message import message_bp
    from app.routes.search_history import search_history_bp
    from app.routes.report import report_bp

    from app.routes.profile import profile_bp
    from app.routes.profile_update import profile_update_bp
    from app.routes.dashboard import dashboard_bp

    # Home Feed
    from app.routes.feed import feed_bp

    # ==========================
    # Register Blueprints
    # ==========================

    app.register_blueprint(auth_bp)

    app.register_blueprint(video_create_bp)
    app.register_blueprint(video_read_bp)
    app.register_blueprint(video_update_bp)
    app.register_blueprint(video_delete_bp)
    app.register_blueprint(video_quality_bp)

    app.register_blueprint(like_bp)
    app.register_blueprint(comment_bp)
    app.register_blueprint(follow_bp)
    app.register_blueprint(notification_bp)
    app.register_blueprint(history_bp)
    app.register_blueprint(bookmark_bp)
    app.register_blueprint(message_bp)
    app.register_blueprint(search_history_bp)
    app.register_blueprint(report_bp)

    app.register_blueprint(profile_bp)
    app.register_blueprint(profile_update_bp)
    app.register_blueprint(dashboard_bp)

    # Home Feed
    app.register_blueprint(feed_bp)

    # ==========================
    # Socket.IO Events
    # ==========================

    from app import socket_events

    # ==========================
    # Home Route
    # ==========================

    @app.route("/")
    def home():
        return {
            "message": "Welcome to ReelVerse API 🚀"
        }

    return app