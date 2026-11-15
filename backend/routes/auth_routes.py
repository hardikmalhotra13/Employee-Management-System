import jwt
import pymysql
import uuid
from datetime import datetime, timedelta, timezone
from flask import Blueprint, request, jsonify
from werkzeug.security import check_password_hash, generate_password_hash

from config import settings
from database.connection import get_db_connection
from utils.token_helper import hash_token, generate_token, get_expiry
from utils.email_sender import send_email
from utils.login_attempts import is_locked_out, record_failed_attempt, reset_attempts
from utils.password_helper import validate_password_strength
from utils.auth_helper import get_role_permissions, is_demo_account
from utils.rate_limiter import is_rate_limited, record_event, check_and_record, rate_limited_response
from utils.mfa_helper import (
    requires_mfa, generate_totp_secret, get_totp_uri, verify_totp_code, encrypt_mfa_secret, decrypt_mfa_secret,
    is_pending_token_used, consume_pending_token_jti, replace_recovery_codes, consume_recovery_code,
    decode_interim_token
)
from utils.google_oauth_helper import exchange_code_for_claims
from utils.audit_helper import log_action

auth_bp = Blueprint("auth", __name__)

ADMIN_SELECT = """SELECT a.*, ar.role_name
                   FROM admins a
                   JOIN admin_roles ar ON a.admin_role_id = ar.admin_role_id
                   WHERE {where}"""


def _build_full_session(admin):
    """Single convergence point for password login, Google SSO login,
    and MFA verification - all three end up here so the issued JWT and
    response shape are identical no matter which path got the admin
    here. Returns None if permissions could not be resolved."""
    permissions = get_role_permissions(admin["admin_role_id"])
    if permissions is None:
        return None

    payload = {
        "admin_id": admin["admin_id"],
        "email": admin["email"],
        "role": admin["role_name"],
        "admin_role_id": admin["admin_role_id"],
        "permissions": permissions,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRATION_HOURS)
    }
    token = jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")

    return {
        "success": True,
        "message": "Login successful",
        "token": token,
        "name": admin["name"],
        "role": admin["role_name"],
        "permissions": permissions
    }


def _issue_mfa_setup_challenge(admin):
    """Admin's role/settings require MFA but it isn't enrolled yet. The
    freshly generated secret is not persisted until the admin proves
    they can generate a valid code with it (see /mfa/setup/verify) - it
    travels instead inside this short-lived, single-purpose signed
    token, which also ties the secret to this specific admin_id so a
    client cannot submit an arbitrary (admin_id, secret) pair."""
    setup_payload = {
        "admin_id": admin["admin_id"],
        "secret": generate_totp_secret(),
        "type": "mfa_setup",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5)
    }
    setup_token = jwt.encode(setup_payload, settings.JWT_SECRET_KEY, algorithm="HS256")

    return {
        "success": True,
        "mfa_setup_required": True,
        "setup_token": setup_token,
        "otpauth_uri": get_totp_uri(setup_payload["secret"], admin["email"]),
        "manual_key": setup_payload["secret"]
    }


def _issue_mfa_challenge(admin):
    """MFA is already enrolled - a short-lived token carrying only the
    admin_id, exchanged for the real session once a valid TOTP code is
    submitted. Cannot be used against any protected route itself. Carries
    a unique jti so it can be marked used-once verified (see verify_mfa)
    and rejected if replayed."""
    pending_payload = {
        "admin_id": admin["admin_id"],
        "type": "mfa_pending",
        "jti": uuid.uuid4().hex,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5)
    }
    pending_token = jwt.encode(pending_payload, settings.JWT_SECRET_KEY, algorithm="HS256")

    return {"success": True, "mfa_required": True, "pending_token": pending_token}


def _issue_recovery_reenroll_grant(admin_id):
    """Issued only alongside a successful recovery-code login (never
    alongside a normal TOTP login). Lets the admin replace their
    authenticator from Security Settings without needing another
    recovery code, for exactly the case that would otherwise strand
    them: they just used their LAST unused code to log in, so no
    unused code remains to authorize re-enrollment the normal way.
    Short-lived and single-use via the same jti-consumption mechanism
    already used for mfa_pending (is_pending_token_used /
    consume_pending_token_jti) - not a new mechanism, just reused for a
    second interim-token type. Carries no permissions and is rejected
    by require_auth like every other interim token (see the "type"
    check in auth_helper.require_auth)."""
    grant_payload = {
        "admin_id": admin_id,
        "type": "mfa_recovery_grant",
        "jti": uuid.uuid4().hex,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15)
    }
    return jwt.encode(grant_payload, settings.JWT_SECRET_KEY, algorithm="HS256")


def _resolve_login(admin):
    """Applied identically after password verification and after Google
    identity verification. Returns (response_dict, status_code)."""
    if not requires_mfa(admin["admin_role_id"], admin["mfa_enabled"]):
        session = _build_full_session(admin)
        if session is None:
            return {"success": False, "message": "Could not verify account permissions, please try again"}, 500
        return session, 200

    if not admin["mfa_enabled"]:
        return _issue_mfa_setup_challenge(admin), 200

    return _issue_mfa_challenge(admin), 200


def _decode_interim_token(token, expected_type):
    return decode_interim_token(token, expected_type)


@auth_bp.route("/login", methods=["POST"])
def login():
    limited, retry_after = is_rate_limited("login", settings.IP_LOGIN_MAX_FAILURES)
    if limited:
        return rate_limited_response(retry_after)

    data = request.get_json(silent=True)

    if not data:
        return jsonify({"success": False, "message": "Invalid request body"}), 400

    email = data.get("email")
    password = data.get("password")

    if not email or not password or not isinstance(email, str) or not isinstance(password, str):
        return jsonify({"success": False, "message": "Email and password are required"}), 400

    locked_out, minutes_remaining = is_locked_out(email)
    if locked_out:
        return jsonify({
            "success": False,
            "message": f"Too many failed login attempts. Please try again in {minutes_remaining} minute(s)."
        }), 429

    connection = get_db_connection()
    if not connection:
        return jsonify({"success": False, "message": "Database connection failed"}), 500

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(ADMIN_SELECT.format(where="a.email = %s"), (email,))
        admin = cursor.fetchone()

        if not admin:
            record_failed_attempt(email)
            record_event("login")
            return jsonify({"success": False, "message": "Invalid email or password"}), 401

        if admin["password"] is None:
            return jsonify({
                "success": False,
                "message": "Account not yet activated. Please check your email to set your password."
            }), 401

        if not check_password_hash(admin["password"], password):
            record_failed_attempt(email)
            record_event("login")
            return jsonify({"success": False, "message": "Invalid email or password"}), 401

        reset_attempts(email)

        response, status_code = _resolve_login(admin)
        return jsonify(response), status_code

    except pymysql.MySQLError as e:
        print(f"Login DB error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@auth_bp.route("/mfa/setup/verify", methods=["POST"])
def verify_mfa_setup():
    """Completes MFA enrollment forced during login (Super Admin/HR
    Admin's first login after this feature ships). Voluntary
    enrollment for an already-authenticated admin (e.g. Read-only
    opting in) uses /settings/mfa/setup/start + /settings/mfa/setup/
    confirm instead - see settings_routes.py."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "message": "Invalid request body"}), 400

    setup_token = data.get("setup_token")
    code = data.get("code")

    if not setup_token or not code:
        return jsonify({"success": False, "message": "setup_token and code are required"}), 400

    payload = _decode_interim_token(setup_token, "mfa_setup")
    if not payload:
        return jsonify({"success": False, "message": "This setup session is invalid or has expired. Please log in again."}), 401

    secret = payload.get("secret")
    if not verify_totp_code(secret, code):
        return jsonify({"success": False, "message": "Invalid verification code"}), 400

    connection = get_db_connection()
    if not connection:
        return jsonify({"success": False, "message": "Database connection failed"}), 500

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(ADMIN_SELECT.format(where="a.admin_id = %s"), (payload["admin_id"],))
        admin = cursor.fetchone()

        if not admin:
            return jsonify({"success": False, "message": "Account not found"}), 404

        # Re-checked here (not just when the setup_token was issued at
        # login) in case MFA was enabled in the meantime - never
        # overwrite an already-enrolled secret through this flow.
        if admin["mfa_enabled"]:
            return jsonify({
                "success": False,
                "message": "MFA is already enabled for this account. Please log in again."
            }), 409

        cursor.execute(
            "UPDATE admins SET mfa_secret = %s, mfa_enabled = TRUE, mfa_enrolled_at = NOW() WHERE admin_id = %s",
            (encrypt_mfa_secret(secret), admin["admin_id"])
        )
        recovery_codes = replace_recovery_codes(cursor, admin["admin_id"])
        log_action(cursor, admin["admin_id"], "update", "admin_mfa", admin["admin_id"], details="MFA enabled")

        # Build the session BEFORE committing. The recovery codes are shown only
        # once, in this response: if the session cannot be built, returning here
        # leaves everything uncommitted (the connection closes and the database
        # rolls it back), so MFA stays off and no codes are lost - the user can
        # simply try again.
        session = _build_full_session(admin)
        if session is None:
            return jsonify({"success": False, "message": "Could not verify account permissions, please try again"}), 500

        connection.commit()

        session["recovery_codes"] = recovery_codes
        return jsonify(session), 200

    except pymysql.MySQLError as e:
        print(f"MFA setup verify error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@auth_bp.route("/mfa/verify", methods=["POST"])
def verify_mfa():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "message": "Invalid request body"}), 400

    pending_token = data.get("pending_token")
    code = data.get("code")

    if not pending_token or not code:
        return jsonify({"success": False, "message": "pending_token and code are required"}), 400

    payload = _decode_interim_token(pending_token, "mfa_pending")
    if not payload:
        return jsonify({"success": False, "message": "This login session is invalid or has expired. Please log in again."}), 401

    jti = payload.get("jti")
    if jti and is_pending_token_used(jti):
        return jsonify({"success": False, "message": "This login session has already been used. Please log in again."}), 401

    connection = get_db_connection()
    if not connection:
        return jsonify({"success": False, "message": "Database connection failed"}), 500

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(ADMIN_SELECT.format(where="a.admin_id = %s"), (payload["admin_id"],))
        admin = cursor.fetchone()

        if not admin or not admin["mfa_enabled"]:
            return jsonify({"success": False, "message": "This login session is invalid or has expired. Please log in again."}), 401

        mfa_attempt_key = f"mfa:{admin['email']}"
        locked_out, minutes_remaining = is_locked_out(mfa_attempt_key)
        if locked_out:
            return jsonify({
                "success": False,
                "message": f"Too many failed codes. Please try again in {minutes_remaining} minute(s)."
            }), 429

        secret = decrypt_mfa_secret(admin["mfa_secret"])
        if not secret or not verify_totp_code(secret, code):
            record_failed_attempt(mfa_attempt_key)
            return jsonify({"success": False, "message": "Invalid verification code"}), 400

        reset_attempts(mfa_attempt_key)

        if jti and not consume_pending_token_jti(jti, payload["exp"]):
            return jsonify({"success": False, "message": "This login session has already been used. Please log in again."}), 401

        session = _build_full_session(admin)
        if session is None:
            return jsonify({"success": False, "message": "Could not verify account permissions, please try again"}), 500

        return jsonify(session), 200

    except pymysql.MySQLError as e:
        print(f"MFA verify error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@auth_bp.route("/mfa/verify-recovery", methods=["POST"])
def verify_mfa_recovery():
    """Explicit, separate endpoint for logging in with a recovery code
    instead of a TOTP code - the UI/API never guesses which one was
    submitted. Unlike /mfa/verify, a successful recovery-code login does
    not issue fresh recovery codes and does not touch the TOTP secret;
    it only consumes the one code used. Re-enrollment (replacing the
    secret and getting a fresh set of codes) is a separate, deliberate
    action in Security Settings - see settings_routes.py."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "message": "Invalid request body"}), 400

    pending_token = data.get("pending_token")
    recovery_code = data.get("recovery_code")

    if not pending_token or not recovery_code:
        return jsonify({"success": False, "message": "pending_token and recovery_code are required"}), 400

    payload = _decode_interim_token(pending_token, "mfa_pending")
    if not payload:
        return jsonify({"success": False, "message": "This login session is invalid or has expired. Please log in again."}), 401

    jti = payload.get("jti")
    if jti and is_pending_token_used(jti):
        return jsonify({"success": False, "message": "This login session has already been used. Please log in again."}), 401

    connection = get_db_connection()
    if not connection:
        return jsonify({"success": False, "message": "Database connection failed"}), 500

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(ADMIN_SELECT.format(where="a.admin_id = %s"), (payload["admin_id"],))
        admin = cursor.fetchone()

        if not admin or not admin["mfa_enabled"]:
            return jsonify({"success": False, "message": "This login session is invalid or has expired. Please log in again."}), 401

        mfa_attempt_key = f"mfa:{admin['email']}"
        locked_out, minutes_remaining = is_locked_out(mfa_attempt_key)
        if locked_out:
            return jsonify({
                "success": False,
                "message": f"Too many failed codes. Please try again in {minutes_remaining} minute(s)."
            }), 429

        if not consume_recovery_code(cursor, admin["admin_id"], recovery_code):
            record_failed_attempt(mfa_attempt_key)
            return jsonify({"success": False, "message": "Invalid or already-used recovery code"}), 400

        reset_attempts(mfa_attempt_key)

        # Build the session BEFORE anything irreversible happens. At this point
        # the recovery code is only marked used in an uncommitted UPDATE: if the
        # session cannot be built, returning here rolls that back (the connection
        # closes without a commit) and leaves the pending token unused, so the
        # user keeps the code and can simply try again.
        session = _build_full_session(admin)
        if session is None:
            return jsonify({"success": False, "message": "Could not verify account permissions, please try again"}), 500

        if jti and not consume_pending_token_jti(jti, payload["exp"]):
            return jsonify({"success": False, "message": "This login session has already been used. Please log in again."}), 401

        log_action(cursor, admin["admin_id"], "update", "admin_mfa", admin["admin_id"], details="Logged in with a recovery code")
        connection.commit()

        session["used_recovery_code"] = True
        session["recovery_grant_token"] = _issue_recovery_reenroll_grant(admin["admin_id"])
        return jsonify(session), 200

    except pymysql.MySQLError as e:
        print(f"MFA recovery verify error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@auth_bp.route("/auth/google/callback", methods=["POST"])
def google_login_callback():
    """Google SSO login. Only succeeds for a Google identity already
    explicitly linked to an admin account (google_sub match) - a valid
    Google account is never, by itself, sufficient to sign in, and no
    account is created or linked here."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "message": "Invalid request body"}), 400

    code = data.get("code")
    code_verifier = data.get("code_verifier")
    nonce = data.get("nonce")

    if not code or not code_verifier or not nonce:
        return jsonify({"success": False, "message": "code, code_verifier and nonce are required"}), 400

    claims = exchange_code_for_claims(code, code_verifier, nonce)
    if not claims:
        return jsonify({"success": False, "message": "Google sign-in failed. Please try again."}), 401

    connection = get_db_connection()
    if not connection:
        return jsonify({"success": False, "message": "Database connection failed"}), 500

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(ADMIN_SELECT.format(where="a.google_sub = %s"), (claims["sub"],))
        admin = cursor.fetchone()

        if not admin:
            return jsonify({
                "success": False,
                "message": "This Google account is not linked to any admin account. Please log in with your "
                            "password and link your Google account from Settings."
            }), 401

        response, status_code = _resolve_login(admin)
        return jsonify(response), status_code

    except pymysql.MySQLError as e:
        print(f"Google login error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@auth_bp.route("/forgot-password", methods=["POST"])
def forgot_password():
    limited, retry_after = check_and_record("forgot_password", settings.IP_FORGOT_PASSWORD_MAX)
    if limited:
        return rate_limited_response(retry_after)

    data = request.get_json(silent=True)

    if not data:
        return jsonify({"success": False, "message": "Invalid request body"}), 400

    email = data.get("email")

    if not email or not isinstance(email, str):
        return jsonify({"success": False, "message": "Email is required"}), 400

    generic_message = "If that email is registered, a password reset link has been sent."

    # The public demo accounts never get a reset token or an email. Same generic
    # answer as for any other address, so nothing is revealed about them.
    if is_demo_account(email):
        return jsonify({"success": True, "message": generic_message}), 200

    connection = get_db_connection()
    if not connection:
        return jsonify({"success": False, "message": "Database connection failed"}), 500

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM admins WHERE email = %s", (email,))
        admin = cursor.fetchone()

        if not admin:
            return jsonify({"success": True, "message": generic_message}), 200

        cursor.execute(
            "UPDATE password_tokens SET used_at = NOW() WHERE admin_id = %s AND used_at IS NULL",
            (admin["admin_id"],)
        )

        raw_token = generate_token()
        token_hash = hash_token(raw_token)
        expires_at = get_expiry("reset")

        cursor.execute(
            "INSERT INTO password_tokens (admin_id, token_hash, token_type, expires_at) VALUES (%s, %s, %s, %s)",
            (admin["admin_id"], token_hash, "reset", expires_at)
        )
        connection.commit()

        reset_link = f"{settings.FRONTEND_BASE_URL}/set-password?token={raw_token}"
        send_email(
            admin["email"],
            "Reset your Employee Management System password",
            f"Hi {admin['name']},\n\n"
            f"We received a request to reset your password. Click the link below to set a new one:\n\n"
            f"{reset_link}\n\n"
            f"This link expires in 1 hour. If you didn't request this, you can safely ignore this email."
        )

        return jsonify({"success": True, "message": generic_message}), 200

    except pymysql.MySQLError as e:
        print(f"Forgot password error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@auth_bp.route("/validate-token", methods=["GET"])
def validate_token():
    token = request.args.get("token")

    if not token:
        return jsonify({"success": False, "message": "Token is required"}), 400

    connection = get_db_connection()
    if not connection:
        return jsonify({"success": False, "message": "Database connection failed"}), 500

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT * FROM password_tokens WHERE token_hash = %s AND used_at IS NULL",
            (hash_token(token),)
        )
        token_row = cursor.fetchone()

        if not token_row or token_row["expires_at"] < datetime.utcnow():
            return jsonify({"success": False, "message": "This link is invalid or has expired"}), 400

        return jsonify({"success": True, "message": "Token is valid"}), 200

    except pymysql.MySQLError as e:
        print(f"Validate token error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@auth_bp.route("/set-password", methods=["POST"])
def set_password():
    data = request.get_json(silent=True)

    if not data:
        return jsonify({"success": False, "message": "Invalid request body"}), 400

    token = data.get("token")
    new_password = data.get("new_password")

    if not token or not new_password:
        return jsonify({"success": False, "message": "Token and new password are required"}), 400

    password_error = validate_password_strength(new_password)
    if password_error:
        return jsonify({"success": False, "message": password_error}), 400

    connection = get_db_connection()
    if not connection:
        return jsonify({"success": False, "message": "Database connection failed"}), 500

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT * FROM password_tokens WHERE token_hash = %s AND used_at IS NULL",
            (hash_token(token),)
        )
        token_row = cursor.fetchone()

        if not token_row or token_row["expires_at"] < datetime.utcnow():
            return jsonify({"success": False, "message": "This link is invalid or has expired"}), 400

        new_password_hash = generate_password_hash(new_password)

        cursor.execute(
            "UPDATE admins SET password = %s WHERE admin_id = %s",
            (new_password_hash, token_row["admin_id"])
        )
        cursor.execute(
            "UPDATE password_tokens SET used_at = NOW() WHERE token_id = %s",
            (token_row["token_id"],)
        )
        connection.commit()

        return jsonify({"success": True, "message": "Password set successfully"}), 200

    except pymysql.MySQLError as e:
        print(f"Set password error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()