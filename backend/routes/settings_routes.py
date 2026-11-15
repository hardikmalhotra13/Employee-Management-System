import re

import pymysql
from flask import Blueprint, request
from werkzeug.security import check_password_hash, generate_password_hash

from config import settings
from database.connection import get_db_connection
from utils.response_helpers import success_response, created_response, error_response, validation_error_response, not_found_response
from utils.token_helper import generate_token, hash_token, get_expiry
from utils.email_sender import send_email
from utils.auth_helper import require_auth, require_permission, block_demo_account
from utils.password_helper import validate_password_strength
from utils.audit_helper import log_action
from utils.login_attempts import is_locked_out, record_failed_attempt, reset_attempts
from utils.mfa_helper import (
    generate_totp_secret, get_totp_uri, verify_totp_code, encrypt_mfa_secret, decrypt_mfa_secret,
    replace_recovery_codes, consume_recovery_code, has_recovery_codes, recovery_code_is_valid,
    decode_interim_token, is_pending_token_used, consume_pending_token_jti
)
from utils.google_oauth_helper import exchange_code_for_claims

settings_bp = Blueprint("settings", __name__)

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@settings_bp.route("/settings/profile", methods=["PUT"])
@require_auth
@block_demo_account
def update_profile():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    admin_id = request.current_admin["admin_id"]
    name = data.get("name")
    email = data.get("email")
    phone = data.get("phone")

    errors = {}
    if not name or not name.strip():
        errors["name"] = "Name is required"
    if not email or not email.strip():
        errors["email"] = "Email is required"
    elif not EMAIL_PATTERN.match(email):
        errors["email"] = "Enter a valid email address"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM admins WHERE admin_id = %s", (admin_id,))
        admin = cursor.fetchone()

        if not admin:
            return not_found_response("Admin not found")

        cursor.execute(
            "UPDATE admins SET name = %s, email = %s, phone = %s WHERE admin_id = %s",
            (name.strip(), email.strip(), phone, admin_id)
        )
        connection.commit()

        cursor.execute("SELECT admin_id, name, email, phone FROM admins WHERE admin_id = %s", (admin_id,))
        updated_admin = cursor.fetchone()

        return success_response("Profile updated successfully", data=updated_admin)

    except pymysql.err.IntegrityError:
        return error_response("Email already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Update profile error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/users", methods=["GET"])
@require_permission("users.view")
def get_users():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """SELECT a.admin_id, a.name, a.email, a.admin_role_id, a.mfa_enabled, ar.role_name AS role
               FROM admins a
               JOIN admin_roles ar ON a.admin_role_id = ar.admin_role_id
               ORDER BY a.admin_id"""
        )
        users = cursor.fetchall()

        return success_response(data=users)

    except pymysql.MySQLError as e:
        print(f"Get users error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/users", methods=["POST"])
@require_permission("users.create")
def create_user():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    name = data.get("name")
    email = data.get("email")
    admin_role_id = data.get("admin_role_id")

    errors = {}
    if not name or not name.strip():
        errors["name"] = "Name is required"
    if not email or not email.strip():
        errors["email"] = "Email is required"
    elif not EMAIL_PATTERN.match(email):
        errors["email"] = "Enter a valid email address"
    if not admin_role_id:
        errors["admin_role_id"] = "Role is required"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute("SELECT admin_role_id FROM admin_roles WHERE admin_role_id = %s", (admin_role_id,))
        if not cursor.fetchone():
            return validation_error_response({"admin_role_id": "Selected role does not exist"})

        cursor.execute(
            "INSERT INTO admins (name, email, password, has_logged_in, admin_role_id) VALUES (%s, %s, NULL, FALSE, %s)",
            (name.strip(), email.strip(), admin_role_id)
        )
        new_admin_id = cursor.lastrowid

        raw_token = generate_token()
        token_hash = hash_token(raw_token)
        expires_at = get_expiry("invite")

        cursor.execute(
            "INSERT INTO password_tokens (admin_id, token_hash, token_type, expires_at) VALUES (%s, %s, %s, %s)",
            (new_admin_id, token_hash, "invite", expires_at)
        )

        connection.commit()

        set_password_link = f"{settings.FRONTEND_BASE_URL}/set-password?token={raw_token}"
        email_sent = send_email(
            email.strip(),
            "You've been invited to Employee Management System",
            f"Hi {name.strip()},\n\n"
            f"You have been added as a user on Employee Management System. "
            f"Click the link below to set your password and activate your account:\n\n"
            f"{set_password_link}\n\n"
            f"This link expires in 24 hours."
        )

        cursor.execute(
            """SELECT a.admin_id, a.name, a.email, a.admin_role_id, ar.role_name AS role
               FROM admins a
               JOIN admin_roles ar ON a.admin_role_id = ar.admin_role_id
               WHERE a.admin_id = %s""",
            (new_admin_id,)
        )
        new_admin = cursor.fetchone()

        message = "User created successfully"
        if not email_sent:
            message = "User created successfully, but the invitation email could not be sent"

        return created_response(message, data=new_admin)

    except pymysql.err.IntegrityError:
        return error_response("Email already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create user error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/users/<int:user_id>", methods=["PUT"])
@require_permission("users.update")
def update_user(user_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    name = data.get("name")
    email = data.get("email")
    admin_role_id = data.get("admin_role_id")

    errors = {}
    if not name or not name.strip():
        errors["name"] = "Name is required"
    if not email or not email.strip():
        errors["email"] = "Email is required"
    elif not EMAIL_PATTERN.match(email):
        errors["email"] = "Enter a valid email address"
    if not admin_role_id:
        errors["admin_role_id"] = "Role is required"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM admins WHERE admin_id = %s", (user_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("User not found")

        cursor.execute("SELECT admin_role_id FROM admin_roles WHERE admin_role_id = %s", (admin_role_id,))
        if not cursor.fetchone():
            return validation_error_response({"admin_role_id": "Selected role does not exist"})

        cursor.execute(
            "UPDATE admins SET name = %s, email = %s, admin_role_id = %s WHERE admin_id = %s",
            (name.strip(), email.strip(), admin_role_id, user_id)
        )
        connection.commit()

        cursor.execute(
            """SELECT a.admin_id, a.name, a.email, a.admin_role_id, ar.role_name AS role
               FROM admins a
               JOIN admin_roles ar ON a.admin_role_id = ar.admin_role_id
               WHERE a.admin_id = %s""",
            (user_id,)
        )
        updated_user = cursor.fetchone()

        return success_response("User updated successfully", data=updated_user)

    except pymysql.err.IntegrityError:
        return error_response("Email already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Update user error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/users/<int:user_id>", methods=["DELETE"])
@require_permission("users.delete")
def delete_user(user_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM admins WHERE admin_id = %s", (user_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("User not found")

        if user_id == request.current_admin["admin_id"]:
            return error_response("You cannot delete your own account", status_code=409)

        cursor.execute("SELECT COUNT(*) AS admin_count FROM admins")
        admin_count = cursor.fetchone()["admin_count"]

        if admin_count <= 1:
            return error_response("Cannot delete the last remaining admin", status_code=409)

        cursor.execute("DELETE FROM admins WHERE admin_id = %s", (user_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "admin_user", user_id,
            details=f"{existing['name']} ({existing['email']})"
        )
        connection.commit()

        return success_response("User deleted successfully")

    except pymysql.MySQLError as e:
        print(f"Delete user error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/users/<int:user_id>/mfa/reset", methods=["PUT"])
@require_permission("users.mfa_reset")
def reset_user_mfa(user_id):
    if user_id == request.current_admin["admin_id"]:
        return error_response("You cannot reset your own MFA. Ask another Super Admin to reset it.", status_code=400)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT admin_id, name, email FROM admins WHERE admin_id = %s", (user_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("User not found")

        cursor.execute(
            "UPDATE admins SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_enrolled_at = NULL WHERE admin_id = %s",
            (user_id,)
        )
        cursor.execute("DELETE FROM admin_mfa_recovery_codes WHERE admin_id = %s", (user_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "update", "admin_mfa", user_id,
            details=f"MFA reset for {existing['name']} ({existing['email']})"
        )
        connection.commit()

        return success_response(
            "MFA has been reset for this user. They can log in normally and turn it on again from Security Settings."
        )

    except pymysql.MySQLError as e:
        print(f"Reset user MFA error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/change-password", methods=["PUT"])
@require_auth
@block_demo_account
def change_password():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    admin_id = request.current_admin["admin_id"]
    current_password = data.get("current_password")
    new_password = data.get("new_password")

    errors = {}
    if not current_password:
        errors["current_password"] = "Current password is required"
    if not new_password:
        errors["new_password"] = "New password is required"
    else:
        password_error = validate_password_strength(new_password)
        if password_error:
            errors["new_password"] = password_error

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM admins WHERE admin_id = %s", (admin_id,))
        admin = cursor.fetchone()

        if not admin:
            return not_found_response("Admin not found")

        if not check_password_hash(admin["password"], current_password):
            return error_response("Current password is incorrect", status_code=400)

        new_password_hash = generate_password_hash(new_password)
        cursor.execute(
            "UPDATE admins SET password = %s WHERE admin_id = %s",
            (new_password_hash, admin_id)
        )
        connection.commit()

        return success_response("Password changed successfully")

    except pymysql.MySQLError as e:
        print(f"Change password error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/security", methods=["GET"])
@require_auth
def get_security_status():
    admin_id = request.current_admin["admin_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT mfa_enabled, google_sub FROM admins WHERE admin_id = %s",
            (admin_id,)
        )
        admin = cursor.fetchone()

        if not admin:
            return not_found_response("Admin not found")

        return success_response(data={
            "mfa_enabled": bool(admin["mfa_enabled"]),
            "google_linked": admin["google_sub"] is not None,
            "has_recovery_codes": has_recovery_codes(cursor, admin_id) if admin["mfa_enabled"] else False
        })

    except pymysql.MySQLError as e:
        print(f"Get security status error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/mfa/setup/start", methods=["POST"])
@require_auth
@block_demo_account
def start_own_mfa_setup():
    """Voluntary enrollment for an already-authenticated admin (mainly
    Read-only, for whom MFA is optional). The secret is returned to the
    client and only persisted once confirmed by /settings/mfa/setup/
    confirm, matching the same not-persisted-until-proven approach used
    for enrollment forced during login. Blocked if MFA is already
    enabled - re-enrollment must go through the privileged MFA reset
    action (/settings/users/<id>/mfa/reset), not this self-service flow."""
    admin_id = request.current_admin["admin_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT mfa_enabled FROM admins WHERE admin_id = %s", (admin_id,))
        admin = cursor.fetchone()

        if not admin:
            return not_found_response("Admin not found")

        if admin["mfa_enabled"]:
            return error_response(
                "MFA is already enabled for your account. Ask a Super Admin to reset it if you need to re-enroll.",
                status_code=409
            )

        secret = generate_totp_secret()
        return success_response(data={
            "secret": secret,
            "otpauth_uri": get_totp_uri(secret, request.current_admin["email"])
        })

    except pymysql.MySQLError as e:
        print(f"Start MFA setup error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/mfa/setup/confirm", methods=["POST"])
@require_auth
@block_demo_account
def confirm_own_mfa_setup():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    secret = data.get("secret")
    code = data.get("code")

    if not secret or not code:
        return error_response("secret and code are required", status_code=400)

    if not verify_totp_code(secret, code):
        return error_response("Invalid verification code", status_code=400)

    admin_id = request.current_admin["admin_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        # Re-checked here (not just at /setup/start) in case MFA was
        # enabled by some other action in between - never overwrite an
        # already-enrolled secret through this self-service flow.
        cursor.execute("SELECT mfa_enabled FROM admins WHERE admin_id = %s", (admin_id,))
        admin = cursor.fetchone()

        if not admin:
            return not_found_response("Admin not found")

        if admin["mfa_enabled"]:
            return error_response(
                "MFA is already enabled for your account. Use \"Replace authenticator\" in Security Settings "
                "(requires a recovery code) if you need to re-enroll.",
                status_code=409
            )

        cursor.execute(
            "UPDATE admins SET mfa_secret = %s, mfa_enabled = TRUE, mfa_enrolled_at = NOW() WHERE admin_id = %s",
            (encrypt_mfa_secret(secret), admin_id)
        )
        recovery_codes = replace_recovery_codes(cursor, admin_id)
        log_action(cursor, admin_id, "update", "admin_mfa", admin_id, details="MFA enabled")
        connection.commit()

        return success_response("MFA enabled successfully", data={"recovery_codes": recovery_codes})

    except pymysql.MySQLError as e:
        print(f"MFA setup confirm error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/mfa/disable", methods=["POST"])
@require_auth
@block_demo_account
def disable_own_mfa():
    """Turns MFA off for the logged-in admin. Being logged in is not
    enough - it must be authorized by a current authenticator code or an
    unused recovery code (exactly one of the two)."""
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    code = data.get("code")
    recovery_code = data.get("recovery_code")
    if bool(code) == bool(recovery_code):
        return error_response("Provide either an authenticator code or a recovery code", status_code=400)

    admin_id = request.current_admin["admin_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT email, mfa_enabled, mfa_secret FROM admins WHERE admin_id = %s", (admin_id,))
        admin = cursor.fetchone()

        if not admin:
            return not_found_response("Admin not found")

        if not admin["mfa_enabled"]:
            return error_response("MFA is not enabled for this account", status_code=400)

        # Same attempt counter as the login MFA step, so a stolen session
        # can't be used to guess codes here without limit.
        mfa_attempt_key = f"mfa:{admin['email']}"
        locked_out, minutes_remaining = is_locked_out(mfa_attempt_key)
        if locked_out:
            return error_response(
                f"Too many failed codes. Please try again in {minutes_remaining} minute(s).", status_code=429
            )

        if code:
            secret = decrypt_mfa_secret(admin["mfa_secret"])
            if not secret or not verify_totp_code(secret, code):
                record_failed_attempt(mfa_attempt_key)
                return error_response("Invalid verification code", status_code=400)
        elif not consume_recovery_code(cursor, admin_id, recovery_code):
            record_failed_attempt(mfa_attempt_key)
            return error_response("Invalid or already-used recovery code", status_code=400)

        reset_attempts(mfa_attempt_key)

        cursor.execute(
            "UPDATE admins SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_enrolled_at = NULL WHERE admin_id = %s",
            (admin_id,)
        )
        cursor.execute("DELETE FROM admin_mfa_recovery_codes WHERE admin_id = %s", (admin_id,))
        log_action(cursor, admin_id, "update", "admin_mfa", admin_id, details="MFA disabled")
        connection.commit()

        return success_response("Two-step verification has been turned off")

    except pymysql.MySQLError as e:
        print(f"Disable own MFA error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/mfa/recovery-codes/setup", methods=["POST"])
@require_auth
@block_demo_account
def setup_recovery_codes():
    """One-time backfill for admins who were already mfa_enabled before
    recovery codes existed. Requires the admin's CURRENT TOTP code (they
    still have their authenticator - this is not a recovery path, just
    catching existing accounts up). Does not touch the existing secret.
    Once an admin has any recovery codes at all (even fully used ones),
    this is permanently blocked - getting a fresh set after that always
    goes through re-enrollment instead, never through this endpoint
    again, so this can't become a backdoor way to keep "topping up"
    codes with only a TOTP code."""
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    code = data.get("code")
    if not code:
        return error_response("code is required", status_code=400)

    admin_id = request.current_admin["admin_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT mfa_enabled, mfa_secret FROM admins WHERE admin_id = %s", (admin_id,))
        admin = cursor.fetchone()

        if not admin:
            return not_found_response("Admin not found")

        if not admin["mfa_enabled"]:
            return error_response("MFA is not enabled for your account", status_code=400)

        if has_recovery_codes(cursor, admin_id):
            return error_response(
                "Recovery codes are already set up for your account. Use \"Replace authenticator\" instead "
                "to get a fresh set.",
                status_code=409
            )

        secret = decrypt_mfa_secret(admin["mfa_secret"])
        if not secret or not verify_totp_code(secret, code):
            return error_response("Invalid verification code", status_code=400)

        recovery_codes = replace_recovery_codes(cursor, admin_id)
        log_action(cursor, admin_id, "update", "admin_mfa", admin_id, details="Recovery codes set up")
        connection.commit()

        return success_response("Recovery codes created successfully", data={"recovery_codes": recovery_codes})

    except pymysql.MySQLError as e:
        print(f"Setup recovery codes error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


def _check_reenroll_authorization(cursor, admin_id, data):
    """Validate-only (does not consume) - exactly one of recovery_code
    or recovery_grant_token must be valid. A normal TOTP session still
    needs a currently-unused recovery code; a session that logged in
    via recovery code carries a grant instead (see
    auth_routes._issue_recovery_reenroll_grant), covering the case
    where that login used the admin's LAST unused code, which would
    otherwise leave them unable to self-service replace their
    authenticator at all. Returns None if authorized, or an error
    response tuple if not."""
    grant_token = data.get("recovery_grant_token")
    if grant_token:
        payload = decode_interim_token(grant_token, "mfa_recovery_grant")
        if not payload or payload.get("admin_id") != admin_id:
            return error_response("This recovery authorization is invalid or has expired.", status_code=400)
        if payload.get("jti") and is_pending_token_used(payload["jti"]):
            return error_response("This recovery authorization has already been used.", status_code=400)
        return None

    recovery_code = data.get("recovery_code")
    if recovery_code:
        if not recovery_code_is_valid(cursor, admin_id, recovery_code):
            return error_response("Invalid or already-used recovery code", status_code=400)
        return None

    return error_response("recovery_code or recovery_grant_token is required", status_code=400)


def _consume_reenroll_authorization(cursor, admin_id, data):
    """Call at confirm time, after the new TOTP code has already been
    verified - atomically consumes whichever authorization was used
    (closing the race if it was used elsewhere between start and
    confirm), mirroring consume_recovery_code's atomicity for the
    recovery_code case and the mfa_pending jti pattern for the grant
    case. Returns None on success, or an error response tuple."""
    grant_token = data.get("recovery_grant_token")
    if grant_token:
        payload = decode_interim_token(grant_token, "mfa_recovery_grant")
        if not payload or payload.get("admin_id") != admin_id:
            return error_response("This recovery authorization is invalid or has expired.", status_code=400)
        if payload.get("jti") and not consume_pending_token_jti(payload["jti"], payload["exp"]):
            return error_response("This recovery authorization has already been used.", status_code=400)
        return None

    recovery_code = data.get("recovery_code")
    if recovery_code:
        if not consume_recovery_code(cursor, admin_id, recovery_code):
            return error_response("Invalid or already-used recovery code", status_code=400)
        return None

    return error_response("recovery_code or recovery_grant_token is required", status_code=400)


@settings_bp.route("/settings/mfa/reenroll/start", methods=["POST"])
@require_auth
@block_demo_account
def start_mfa_reenroll():
    """Step 1 of replacing an existing authenticator (lost device, or a
    deliberate switch) - authorized by submitting one currently-unused
    recovery code, per the "do not just show a new QR after a password"
    rule (or, for an admin who just logged in with their last unused
    code, the short-lived grant issued by that login instead - see
    _check_reenroll_authorization). Nothing is persisted here: the
    authorization is only validated, not consumed, and no new secret is
    stored yet - an abandoned attempt leaves the existing secret and
    existing codes completely untouched."""
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    admin_id = request.current_admin["admin_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT mfa_enabled, email FROM admins WHERE admin_id = %s", (admin_id,))
        admin = cursor.fetchone()

        if not admin:
            return not_found_response("Admin not found")

        if not admin["mfa_enabled"]:
            return error_response("MFA is not enabled for your account", status_code=400)

        auth_error = _check_reenroll_authorization(cursor, admin_id, data)
        if auth_error:
            return auth_error

        secret = generate_totp_secret()
        return success_response(data={"secret": secret, "otpauth_uri": get_totp_uri(secret, admin["email"])})

    except pymysql.MySQLError as e:
        print(f"Start MFA reenroll error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/mfa/reenroll/confirm", methods=["POST"])
@require_auth
@block_demo_account
def confirm_mfa_reenroll():
    """Step 2: re-validates the same authorization used in /start (a
    recovery code must still be unused - it was only checked, not
    consumed, there; a grant token is likewise only checked again here)
    and the new TOTP code, then atomically replaces the secret and the
    entire recovery code set in one go. A failed TOTP code here does
    not consume the authorization, so the admin can retry without
    losing it."""
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    secret = data.get("secret")
    code = data.get("code")

    if not secret or not code:
        return error_response("secret and code are required", status_code=400)

    if not verify_totp_code(secret, code):
        return error_response("Invalid verification code", status_code=400)

    admin_id = request.current_admin["admin_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT mfa_enabled FROM admins WHERE admin_id = %s", (admin_id,))
        admin = cursor.fetchone()

        if not admin:
            return not_found_response("Admin not found")

        if not admin["mfa_enabled"]:
            return error_response("MFA is not enabled for your account", status_code=400)

        auth_error = _consume_reenroll_authorization(cursor, admin_id, data)
        if auth_error:
            return auth_error

        cursor.execute(
            "UPDATE admins SET mfa_secret = %s, mfa_enrolled_at = NOW() WHERE admin_id = %s",
            (encrypt_mfa_secret(secret), admin_id)
        )
        recovery_codes = replace_recovery_codes(cursor, admin_id)
        log_action(cursor, admin_id, "update", "admin_mfa", admin_id, details="MFA re-enrolled")
        connection.commit()

        return success_response("Authenticator replaced successfully", data={"recovery_codes": recovery_codes})

    except pymysql.MySQLError as e:
        print(f"Confirm MFA reenroll error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/google/link", methods=["POST"])
@require_auth
@block_demo_account
def link_google_account():
    """Links the currently authenticated admin's account to a Google
    identity. Must be called from an authenticated session - Google
    SSO login (auth_routes.py) never creates or links an account on
    its own, only this explicit action does."""
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    code = data.get("code")
    code_verifier = data.get("code_verifier")
    nonce = data.get("nonce")

    if not code or not code_verifier or not nonce:
        return error_response("code, code_verifier and nonce are required", status_code=400)

    claims = exchange_code_for_claims(code, code_verifier, nonce)
    if not claims:
        return error_response("Google verification failed. Please try again.", status_code=401)

    admin_id = request.current_admin["admin_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute("SELECT admin_id FROM admins WHERE google_sub = %s", (claims["sub"],))
        existing = cursor.fetchone()
        if existing and existing["admin_id"] != admin_id:
            return error_response("This Google account is already linked to a different admin account.", status_code=409)

        cursor.execute("UPDATE admins SET google_sub = %s WHERE admin_id = %s", (claims["sub"], admin_id))
        log_action(cursor, admin_id, "update", "admin_google_link", admin_id)
        connection.commit()

        return success_response("Google account linked successfully")

    except pymysql.MySQLError as e:
        print(f"Google link error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@settings_bp.route("/settings/activity-log", methods=["GET"])
@require_permission("activity_log.view")
def get_activity_log():
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)

    errors = {}
    if page < 1:
        errors["page"] = "page must be greater than or equal to 1"
    if page_size < 1:
        errors["pageSize"] = "pageSize must be greater than or equal to 1"
    if page_size > 100:
        errors["pageSize"] = "pageSize cannot be greater than 100"

    if errors:
        return validation_error_response(errors)

    offset = (page - 1) * page_size

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT COUNT(*) AS total FROM audit_logs")
        total = cursor.fetchone()["total"]

        cursor.execute(
            """SELECT al.log_id, al.action, al.entity, al.record_id, al.details, al.created_at,
                      a.name AS admin_name,
                      CASE al.entity
                          WHEN 'department' THEN d.department_name
                          WHEN 'role' THEN r.role_name
                          WHEN 'grade' THEN g.grade_name
                          WHEN 'shift' THEN s.shift_name
                          WHEN 'employee' THEN CONCAT(e.first_name, ' ', e.last_name)
                      END AS record_name,
                      e.employee_code AS record_code
               FROM audit_logs al
               LEFT JOIN admins a ON al.admin_id = a.admin_id
               LEFT JOIN departments d ON al.entity = 'department' AND al.record_id = d.department_id
               LEFT JOIN roles r ON al.entity = 'role' AND al.record_id = r.role_id
               LEFT JOIN grades g ON al.entity = 'grade' AND al.record_id = g.grade_id
               LEFT JOIN shifts s ON al.entity = 'shift' AND al.record_id = s.shift_id
               LEFT JOIN employees e ON al.entity = 'employee' AND al.record_id = e.employee_id
               ORDER BY al.log_id DESC LIMIT %s OFFSET %s""",
            (page_size, offset)
        )
        logs = cursor.fetchall()

        # created_at is stored and read as a naive DATETIME (no timezone info).
        # It is formatted here as a plain string so Flask's JSON encoder never
        # relabels it as UTC/GMT, which would cause the frontend to shift it
        # again when displaying. The value shown is exactly what is stored.
        for log in logs:
            if log["created_at"]:
                log["created_at"] = log["created_at"].strftime("%Y-%m-%d %H:%M:%S")

            # Entities like documents can be permanently deleted, so the live
            # join above won't resolve a name for them. Fall back to the
            # snapshot text captured at the time of the action.
            if not log["record_name"] and log["details"]:
                log["record_name"] = log["details"]
            del log["details"]

        return success_response(data={
            "records": logs,
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get activity log error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()