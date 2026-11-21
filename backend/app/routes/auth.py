import secrets
import string
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify
from flask_mail import Message
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    jwt_required,
    get_jwt_identity
)
from app.models import User, EmailVerification, PasswordReset
from app.extensions import db, mail
auth_bp = Blueprint("auth", __name__)
# ==========================
# Password Security
# ==========================
def validate_password(password, username="", email=""):
    if len(password) < 12:
        return (
            False,
            "Password must be at least 12 characters long."
        )
    if len(password) > 128:
        return (
            False,
            "Password must not exceed 128 characters."
        )
    # ==========================
    # Reject Only Letters
    # ==========================
    if password.isalpha():
        return (
            False,
            "Password is too simple. Add numbers, symbols, or spaces."
        )
    # ==========================
    # Reject Only Numbers
    # ==========================
    if password.isdigit():
        return (
            False,
            "Password cannot contain only numbers."
        )
    # ==========================
    # Reject Repeated Character
    # ==========================
    if len(set(password)) == 1:
        return (
            False,
            "Password is too repetitive."
        )
    password_lower = password.lower()
    # ==========================
    # Common Weak Passwords
    # ==========================
    common_passwords = {
        "password1234",
        "password12345",
        "password123456",
        "123456789012",
        "qwerty123456",
        "qwertyuiop123",
        "letmein123456",
        "admin12345678",
        "welcome12345",
        "iloveyou1234",
    }
    if password_lower in common_passwords:
        return (
            False,
            "This password is too common. Choose a stronger password."
        )
    # ==========================
    # Reject Username as Password
    # ==========================
    clean_username = username.strip().lower()
    if clean_username:
        if password_lower == clean_username:
            return (
                False,
                "Password cannot be the same as your username."
            )
    # ==========================
    # Reject Email as Password
    # ==========================
    clean_email = email.strip().lower()
    if clean_email:
        if password_lower == clean_email:
            return (
                False,
                "Password cannot be the same as your email address."
            )
    return True, None
# ==========================
# Generate Strong Password
# ==========================
def generate_strong_password():
    uppercase = string.ascii_uppercase
    lowercase = string.ascii_lowercase
    numbers = string.digits
    # Avoid characters that may be awkward
    # inside forms, URLs, or copied text.
    symbols = "!@#$%&*?"
    password_characters = [
        secrets.choice(uppercase),
        secrets.choice(lowercase),
        secrets.choice(numbers),
        secrets.choice(symbols),
    ]
    all_characters = (
        uppercase
        + lowercase
        + numbers
        + symbols
    )
    # Total password length = 18 characters
    for _ in range(14):
        password_characters.append(
            secrets.choice(all_characters)
        )
    # Securely shuffle the characters
    secrets.SystemRandom().shuffle(
        password_characters
    )
    return "".join(
        password_characters
    )
# ==========================
# Suggest Strong Password
# ==========================
@auth_bp.route("/auth/suggest-password", methods=["GET"])
def suggest_password():
    suggested_password = generate_strong_password()
    return jsonify({
        "password": suggested_password
    }), 200
# ==========================
# Send Email Verification Code
# ==========================
@auth_bp.route("/auth/send-verification-code", methods=["POST"])
def send_verification_code():
    data = request.get_json(silent=True) or {}
    email = str(
        data.get("email", "")
    ).strip().lower()
    if not email:
        return jsonify({
            "message": "Email address is required."
        }), 400
    # ==========================
    # Check Existing Account
    # ==========================
    existing_user = User.query.filter(
        db.func.lower(User.email) == email
    ).first()
    if existing_user:
        return jsonify({
            "message": "This email has already been registered."
        }), 400
    # ==========================
    # Generate 6-Digit Code
    # ==========================
    verification_code = str(
        secrets.randbelow(900000) + 100000
    )
    code_hash = generate_password_hash(
        verification_code
    )
    expires_at = (
        datetime.utcnow()
        + timedelta(minutes=10)
    )
    # ==========================
    # Store Verification
    # ==========================
    verification = EmailVerification.query.filter(
        db.func.lower(
            EmailVerification.email
        ) == email
    ).first()
    if verification:
        verification.email = email
        verification.code_hash = code_hash
        verification.expires_at = expires_at
        verification.is_verified = False
    else:
        verification = EmailVerification(
            email=email,
            code_hash=code_hash,
            expires_at=expires_at,
            is_verified=False
        )
        db.session.add(
            verification
        )
    db.session.commit()
    # ==========================
    # Send Email
    # ==========================
    try:
        message = Message(
            subject="Your ReelVerse verification code",
            recipients=[email]
        )
        message.body = (
            "Welcome to ReelVerse!\n\n"
            "Your email verification code is:\n\n"
            f"{verification_code}\n\n"
            "This code expires in 10 minutes.\n\n"
            "If you did not request this code, "
            "you can ignore this email."
        )
        mail.send(
            message
        )
    except Exception:
        db.session.delete(
            verification
        )
        db.session.commit()
        return jsonify({
            "message": (
                "We could not send the verification "
                "email. Please try again."
            )
        }), 500
    return jsonify({
        "message": "Verification code sent successfully.",
        "expires_in": 600
    }), 200
# ==========================
# Verify Email Code
# ==========================
@auth_bp.route("/auth/verify-email-code", methods=["POST"])
def verify_email_code():
    data = request.get_json(silent=True) or {}
    email = str(
        data.get("email", "")
    ).strip().lower()
    code = str(
        data.get("code", "")
    ).strip()
    if not email:
        return jsonify({
            "message": "Email address is required."
        }), 400
    if not code:
        return jsonify({
            "message": "Verification code is required."
        }), 400
    if not code.isdigit() or len(code) != 6:
        return jsonify({
            "message": "Verification code must be 6 digits."
        }), 400
    verification = EmailVerification.query.filter(
        db.func.lower(
            EmailVerification.email
        ) == email
    ).first()
    if not verification:
        return jsonify({
            "message": (
                "No verification request was found "
                "for this email."
            )
        }), 404
    # ==========================
    # Check Expiration
    # ==========================
    if datetime.utcnow() > verification.expires_at:
        return jsonify({
            "message": (
                "Verification code has expired. "
                "Please request a new code."
            )
        }), 400
    # ==========================
    # Check Verification Code
    # ==========================
    if not check_password_hash(
        verification.code_hash,
        code
    ):
        return jsonify({
            "message": "Invalid verification code."
        }), 400
    # ==========================
    # Mark Email Verified
    # ==========================
    verification.is_verified = True
    db.session.commit()
    return jsonify({
        "message": "Email verified successfully.",
        "email": verification.email
    }), 200
# ==========================
# Check Username Availability
# ==========================
@auth_bp.route("/auth/check-username", methods=["GET"])
def check_username():
    username = str(
        request.args.get("username", "")
    ).strip()
    if not username:
        return jsonify({
            "available": False,
            "message": "Username is required."
        }), 400
    if len(username) < 3:
        return jsonify({
            "available": False,
            "message": "Username must be at least 3 characters long."
        }), 400
    if len(username) > 80:
        return jsonify({
            "available": False,
            "message": "Username must not exceed 80 characters."
        }), 400
    allowed_characters = (
        username.replace(".", "")
        .replace("_", "")
        .isalnum()
    )
    if not allowed_characters:
        return jsonify({
            "available": False,
            "message": (
                "Username can only contain letters, "
                "numbers, periods, and underscores."
            )
        }), 400
    existing_username = User.query.filter(
        db.func.lower(User.username)
        == username.lower()
    ).first()
    if existing_username:
        return jsonify({
            "available": False,
            "message": "Username is already taken."
        }), 200
    return jsonify({
        "available": True,
        "message": "Username is available."
    }), 200
# ==========================
# Register
# ==========================
@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    email = str(
        data.get("email", "")
    ).strip().lower()
    first_name = str(
        data.get("first_name", "")
    ).strip()
    last_name = str(
        data.get("last_name", "")
    ).strip()
    date_of_birth = str(
        data.get("date_of_birth", "")
    ).strip()
    username = str(
        data.get("username", "")
    ).strip()
    password = str(
        data.get("password", "")
    )
    confirm_password = str(
        data.get("confirm_password", "")
    )
    # ==========================
    # Required Fields
    # ==========================
    if not email:
        return jsonify({
            "message": "Email address is required."
        }), 400
    if not first_name:
        return jsonify({
            "message": "First name is required."
        }), 400
    if not last_name:
        return jsonify({
            "message": "Last name is required."
        }), 400
    if not date_of_birth:
        return jsonify({
            "message": "Date of birth is required."
        }), 400
    if not username:
        return jsonify({
            "message": "Username is required."
        }), 400
    if not password:
        return jsonify({
            "message": "Password is required."
        }), 400
    if not confirm_password:
        return jsonify({
            "message": "Please confirm your password."
        }), 400
    # ==========================
    # Password Confirmation
    # ==========================
    if password != confirm_password:
        return jsonify({
            "message": "Passwords do not match."
        }), 400
    # ==========================
    # Password Security
    # ==========================
    password_valid, password_error = validate_password(
        password=password,
        username=username,
        email=email
    )
    if not password_valid:
        return jsonify({
            "message": password_error
        }), 400
    # ==========================
    # Validate Date of Birth
    # ==========================
    try:
        parsed_date_of_birth = datetime.strptime(
            date_of_birth,
            "%Y-%m-%d"
        ).date()
    except ValueError:
        return jsonify({
            "message": (
                "Date of birth must use "
                "YYYY-MM-DD format."
            )
        }), 400
    if parsed_date_of_birth > datetime.utcnow().date():
        return jsonify({
            "message": "Date of birth cannot be in the future."
        }), 400
    # ==========================
    # One Email = One Account
    # ==========================
    existing_email = User.query.filter(
        db.func.lower(User.email) == email
    ).first()
    if existing_email:
        return jsonify({
            "message": "This email has already been registered."
        }), 400
    # ==========================
    # Email Must Be Verified
    # ==========================
    verification = EmailVerification.query.filter(
        db.func.lower(
            EmailVerification.email
        ) == email
    ).first()
    if not verification or not verification.is_verified:
        return jsonify({
            "message": (
                "Please verify your email address "
                "before creating your account."
            )
        }), 403
    # ==========================
    # Unique Username
    # ==========================
    existing_username = User.query.filter(
        db.func.lower(User.username)
        == username.lower()
    ).first()
    if existing_username:
        return jsonify({
            "message": "Username already exists."
        }), 400
    # ==========================
    # Create Account
    # ==========================
    new_user = User(
        email=email,
        first_name=first_name,
        last_name=last_name,
        date_of_birth=parsed_date_of_birth,
        username=username,
        password=generate_password_hash(
            password
        )
    )
    db.session.add(
        new_user
    )
    db.session.commit()
    return jsonify({
        "message": "User registered successfully!"
    }), 201
# ==========================
# Forgot Password - Send Reset Code
# ==========================
@auth_bp.route("/auth/forgot-password/send-code", methods=["POST"])
def forgot_password_send_code():
    data = request.get_json(silent=True) or {}
    email = str(
        data.get("email", "")
    ).strip().lower()
    if not email:
        return jsonify({
            "message": "Email address is required."
        }), 400
    # Only an existing ReelVerse account can request a reset code.
    user = User.query.filter(
        db.func.lower(User.email) == email
    ).first()
    if not user:
        return jsonify({
            "message": "No ReelVerse account was found with this email address."
        }), 404
    reset_code = str(
        secrets.randbelow(900000) + 100000
    )
    code_hash = generate_password_hash(
        reset_code
    )
    expires_at = (
        datetime.utcnow()
        + timedelta(minutes=10)
    )
    reset_request = PasswordReset.query.filter(
        db.func.lower(PasswordReset.email) == email
    ).first()
    if reset_request:
        reset_request.email = email
        reset_request.code_hash = code_hash
        reset_request.expires_at = expires_at
        reset_request.is_verified = False
    else:
        reset_request = PasswordReset(
            email=email,
            code_hash=code_hash,
            expires_at=expires_at,
            is_verified=False
        )
        db.session.add(reset_request)
    try:
        message = Message(
            subject="Reset your ReelVerse password",
            recipients=[email]
        )
        message.body = (
            "ReelVerse password recovery\n\n"
            "Your password reset verification code is:\n\n"
            f"{reset_code}\n\n"
            "This code expires in 10 minutes.\n\n"
            "If you did not request a password reset, "
            "you can ignore this email."
        )
        mail.send(message)
    except Exception:
        db.session.rollback()
        return jsonify({
            "message": (
                "We could not send the password reset email. "
                "Please try again."
            )
        }), 500
    db.session.commit()
    return jsonify({
        "message": "Password reset code sent successfully.",
        "expires_in": 600
    }), 200
# ==========================
# Forgot Password - Verify Reset Code
# ==========================
@auth_bp.route("/auth/forgot-password/verify-code", methods=["POST"])
def forgot_password_verify_code():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    code = str(data.get("code", "")).strip()

    if not email:
        return jsonify({"message": "Email address is required."}), 400

    if not code:
        return jsonify({"message": "Verification code is required."}), 400

    if not code.isdigit() or len(code) != 6:
        return jsonify({"message": "Verification code must be 6 digits."}), 400

    user = User.query.filter(
        db.func.lower(User.email) == email
    ).first()

    if not user:
        return jsonify({
            "message": "No ReelVerse account was found with this email address."
        }), 404

    reset_request = PasswordReset.query.filter(
        db.func.lower(PasswordReset.email) == email
    ).first()

    if not reset_request:
        return jsonify({
            "message": (
                "No password reset request was found for this email. "
                "Please request a new code."
            )
        }), 404

    if datetime.utcnow() > reset_request.expires_at:
        reset_request.is_verified = False
        db.session.commit()
        return jsonify({
            "message": (
                "Verification code has expired. "
                "Please request a new code."
            )
        }), 400

    if not check_password_hash(reset_request.code_hash, code):
        return jsonify({"message": "Invalid verification code."}), 400

    reset_request.is_verified = True
    db.session.commit()

    return jsonify({
        "message": "Password reset code verified successfully.",
        "email": reset_request.email
    }), 200

# ==========================
# Forgot Password - Reset Password
# ==========================
@auth_bp.route("/auth/forgot-password/reset-password", methods=["POST"])
def forgot_password_reset_password():
    data = request.get_json(silent=True) or {}

    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    confirm_password = str(data.get("confirm_password", ""))

    if not email:
        return jsonify({"message": "Email address is required."}), 400

    if not password:
        return jsonify({"message": "Password is required."}), 400

    if not confirm_password:
        return jsonify({"message": "Please confirm your password."}), 400

    if password != confirm_password:
        return jsonify({"message": "Passwords do not match."}), 400

    user = User.query.filter(
        db.func.lower(User.email) == email
    ).first()

    if not user:
        return jsonify({
            "message": "No ReelVerse account was found with this email address."
        }), 404

    reset_request = PasswordReset.query.filter(
        db.func.lower(PasswordReset.email) == email
    ).first()

    if not reset_request:
        return jsonify({
            "message": (
                "No password reset request was found. "
                "Please request a new verification code."
            )
        }), 404

    if datetime.utcnow() > reset_request.expires_at:
        reset_request.is_verified = False
        db.session.commit()
        return jsonify({
            "message": (
                "Password reset verification has expired. "
                "Please request a new code."
            )
        }), 400

    if not reset_request.is_verified:
        return jsonify({
            "message": (
                "Please verify your password reset code "
                "before creating a new password."
            )
        }), 403

    password_valid, password_error = validate_password(
        password=password,
        username=user.username,
        email=user.email
    )

    if not password_valid:
        return jsonify({"message": password_error}), 400

    if check_password_hash(user.password, password):
        return jsonify({
            "message": (
                "Your new password must be different "
                "from your current password."
            )
        }), 400

    user.password = generate_password_hash(password)

    # Make the verified reset request single-use.
    db.session.delete(reset_request)
    db.session.commit()

    return jsonify({
        "message": (
            "Password reset successfully. "
            "Please login with your new password."
        )
    }), 200


# ==========================
# Login
# ==========================
@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    login_identifier = str(
        data.get("login", "")
    ).strip()
    password = str(
        data.get("password", "")
    )
    # ==========================
    # Required Fields
    # ==========================
    if not login_identifier:
        return jsonify({
            "message": "Username or email address is required."
        }), 400
    if not password:
        return jsonify({
            "message": "Password is required."
        }), 400
    # ==========================
    # Find User by Username
    # OR Email Address
    # ==========================
    identifier_lower = login_identifier.lower()
    user = User.query.filter(
        db.or_(
            db.func.lower(User.email)
            == identifier_lower,
            db.func.lower(User.username)
            == identifier_lower
        )
    ).first()
    # ==========================
    # Check Credentials
    # ==========================
    if not user:
        return jsonify({
            "message": "Invalid username/email or password."
        }), 401
    if not check_password_hash(
        user.password,
        password
    ):
        return jsonify({
            "message": "Invalid username/email or password."
        }), 401
    # ==========================
    # Banned Accounts Cannot Log In
    # ==========================
    # Checked after the password, so the message is only shown to the
    # real owner of the account.
    if user.is_banned:
        return jsonify({
            "message": (
                "This account has been suspended for breaking "
                "the ReelVerse rules."
            ),
            "banned": True
        }), 403
    # ==========================
    # Create Access Token
    # ==========================
    access_token = create_access_token(
        identity=str(user.id)
    )

    # Long-lived token used only to get a new access token.
    refresh_token = create_refresh_token(
        identity=str(user.id)
    )
    return jsonify({
        "message": "Login successful!",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "date_of_birth": (
                user.date_of_birth.isoformat()
                if user.date_of_birth
                else None
            ),
            "bio": user.bio,
            "profile_photo_url": user.profile_photo_url,
            "is_admin": bool(user.is_admin)
        }
    }), 200
# ==========================
# Refresh Access Token
# ==========================
@auth_bp.route("/refresh", methods=["POST"])
@jwt_required(refresh=True)
def refresh_access_token():
    user = db.session.get(
        User,
        int(get_jwt_identity())
    )

    if not user:
        return jsonify({
            "message": "User not found."
        }), 401

    if user.is_banned:
        return jsonify({
            "message": "This account has been suspended.",
            "banned": True
        }), 403

    return jsonify({
        "access_token": create_access_token(
            identity=str(user.id)
        )
    }), 200


# ==========================
# Current User Profile
# ==========================
@auth_bp.route("/profile", methods=["GET"])
@jwt_required()
def profile():
    current_user_id = get_jwt_identity()
    user = User.query.get(
        int(current_user_id)
    )
    if not user:
        return jsonify({
            "message": "User not found."
        }), 404
    return jsonify({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "bio": user.bio,
        "profile_photo_url": user.profile_photo_url,
        "is_admin": bool(user.is_admin)
    }), 200