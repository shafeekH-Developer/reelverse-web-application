from app.extensions import db


class Video(db.Model):
    __tablename__ = "videos"

    id = db.Column(
        db.Integer,
        primary_key=True
    )

    title = db.Column(
        db.String(200),
        nullable=False
    )

    description = db.Column(
        db.Text,
        nullable=False
    )

    video_url = db.Column(
        db.String(500),
        nullable=False
    )

    # Cloudinary public ID of the original video.
    # Used to generate adaptive streaming URLs.
    cloudinary_public_id = db.Column(
        db.String(500),
        nullable=True
    )

    # Original uploaded video dimensions.
    source_width = db.Column(
        db.Integer,
        nullable=True
    )

    source_height = db.Column(
        db.Integer,
        nullable=True
    )

    # Where the video file is stored: "cloudinary" (older videos) or "r2".
    storage_provider = db.Column(
        db.String(20),
        nullable=True,
        default="cloudinary"
    )

    # R2 key of the original uploaded file.
    r2_key = db.Column(
        db.String(500),
        nullable=True
    )

    # JSON list of extra qualities: [{"height": 720, "url": "..."}]
    renditions = db.Column(
        db.Text,
        nullable=True
    )

    # "processing", "ready" or "failed"
    processing_status = db.Column(
        db.String(20),
        nullable=True
    )

    thumbnail_url = db.Column(
        db.String(500),
        nullable=False
    )

    category = db.Column(
        db.String(100),
        nullable=False
    )

    # Video Views
    views = db.Column(
        db.Integer,
        default=0,
        nullable=False
    )

    creator_id = db.Column(
        db.Integer,
        db.ForeignKey("users.id"),
        nullable=False
    )

    created_at = db.Column(
        db.DateTime,
        server_default=db.func.now()
    )