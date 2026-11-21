from app.extensions import db


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    username = db.Column(
        db.String(80),
        unique=True,
        nullable=False
    )

    email = db.Column(
        db.String(120),
        unique=True,
        nullable=False
    )

    password = db.Column(
        db.String(255),
        nullable=False
    )

    # ==========================
    # Personal Information
    # ==========================

    first_name = db.Column(
        db.String(80),
        nullable=True
    )

    last_name = db.Column(
        db.String(80),
        nullable=True
    )

    date_of_birth = db.Column(
        db.Date,
        nullable=True
    )

    # ==========================
    # Profile Settings
    # ==========================

    # Main profile description / About section
    bio = db.Column(
        db.Text,
        nullable=True
    )

    profile_photo_url = db.Column(
        db.String(500),
        nullable=True
    )

    # ==========================
    # Profile Links
    # ==========================

    website_url = db.Column(
        db.String(500),
        nullable=True
    )

    youtube_url = db.Column(
        db.String(500),
        nullable=True
    )

    instagram_url = db.Column(
        db.String(500),
        nullable=True
    )

    created_at = db.Column(
        db.DateTime,
        server_default=db.func.now()
    )

    # ==========================
    # Moderation
    # ==========================

    # The site owner. Only an admin can open the Admin page.
    # Set it once with SQL (see the setup steps), never from the website.
    is_admin = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default=db.false()
    )

    # A banned user cannot log in, and their videos and profile are hidden.
    # Nothing is deleted, so the ban can be undone.
    is_banned = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default=db.false()
    )