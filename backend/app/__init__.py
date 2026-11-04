from datetime import timedelta

from flask import Flask

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

    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///reelverse.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

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