import os

from dotenv import load_dotenv
import cloudinary


BASE_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        ".."
    )
)

ENV_PATH = os.path.join(
    BASE_DIR,
    ".env"
)

load_dotenv(
    dotenv_path=ENV_PATH
)


# ==========================
# Cloudinary Configuration
# ==========================

cloudinary.config(
    cloud_name=os.getenv(
        "CLOUDINARY_CLOUD_NAME"
    ),
    api_key=os.getenv(
        "CLOUDINARY_API_KEY"
    ),
    api_secret=os.getenv(
        "CLOUDINARY_API_SECRET"
    ),
    secure=True
)


# ==========================
# Email Configuration
# ==========================

MAIL_SERVER = os.getenv(
    "MAIL_SERVER",
    "smtp.gmail.com"
)

MAIL_PORT = int(
    os.getenv(
        "MAIL_PORT",
        "587"
    )
)

MAIL_USE_TLS = (
    os.getenv(
        "MAIL_USE_TLS",
        "true"
    ).lower()
    == "true"
)

MAIL_USERNAME = os.getenv(
    "MAIL_USERNAME"
)

MAIL_PASSWORD = os.getenv(
    "MAIL_PASSWORD"
)

MAIL_DEFAULT_SENDER = os.getenv(
    "MAIL_DEFAULT_SENDER"
)