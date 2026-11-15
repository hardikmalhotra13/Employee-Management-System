import uuid

import jwt
import pymysql
from datetime import datetime, timedelta, timezone
from flask import Blueprint, request, jsonify, send_file
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from config import settings
from database.connection import get_db_connection
from utils.token_helper import hash_token, generate_token, get_expiry
from utils.email_sender import send_email
from utils.login_attempts import is_locked_out, record_failed_attempt, reset_attempts
from utils.password_helper import validate_password_strength
from utils.auth_helper import require_permission, require_employee_auth, block_demo_account, is_demo_account
from utils.rate_limiter import is_rate_limited, record_event, check_and_record, rate_limited_response
from utils.google_oauth_helper import exchange_code_for_claims
from utils.mfa_helper import (
    generate_totp_secret, get_totp_uri, verify_totp_code, encrypt_mfa_secret, decrypt_mfa_secret,
    is_pending_token_used, consume_pending_token_jti, decode_interim_token,
    replace_employee_recovery_codes, consume_employee_recovery_code,
)
from utils.response_helpers import (
    success_response,
    error_response,
    not_found_response,
    validation_error_response,
)
from utils.storage_helper import save_file, get_file, delete_file
from routes.employee_routes import is_valid_phone
from routes.document_routes import get_file_size

employee_auth_bp = Blueprint("employee_auth", __name__)


def _build_employee_session(employee):
    """Single place the employee JWT + login response are built, shared by
    password login and both MFA verify steps."""
    payload = {
        "employee_id": employee["employee_id"],
        "email": employee["email"],
        "type": "employee",
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRATION_HOURS)
    }
    token = jwt.encode(payload, settings.EMPLOYEE_JWT_SECRET_KEY, algorithm="HS256")

    return {"success": True, "message": "Login successful", "token": token}


def _issue_employee_mfa_challenge(employee):
    """Password was correct and MFA is on: a short-lived token carrying
    only the employee_id, exchanged for the real session once a valid code
    is submitted. Its type is not "employee", so require_employee_auth
    rejects it on every protected route. Carries a jti so it can be used
    once."""
    pending_payload = {
        "employee_id": employee["employee_id"],
        "type": "employee_mfa_pending",
        "jti": uuid.uuid4().hex,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=5)
    }
    pending_token = jwt.encode(pending_payload, settings.EMPLOYEE_JWT_SECRET_KEY, algorithm="HS256")

    return {"success": True, "mfa_required": True, "pending_token": pending_token}


def _decode_employee_pending_token(token):
    return decode_interim_token(token, "employee_mfa_pending", settings.EMPLOYEE_JWT_SECRET_KEY)


def _employee_can_login(employee):
    return employee and not employee["is_archived"] and employee["status"] != "Inactive"


@employee_auth_bp.route("/employee/google/callback", methods=["POST"])
def employee_google_login_callback():
    """
    Google SSO login for employees. Mirrors the admin version
    (auth_routes.google_login_callback): only succeeds for a Google
    identity already explicitly linked to an employee account (google_sub
    match, linked from Settings) - a valid Google account is never, by
    itself, sufficient, and no account is created or linked here. Applies
    the same account-state rule as password login and then the same
    2-Step Verification step, so signing in with Google never bypasses
    MFA for an employee who has turned it on.
    """
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
        cursor.execute("SELECT * FROM employees WHERE google_sub = %s", (claims["sub"],))
        employee = cursor.fetchone()

        # Unlinked, archived and Inactive all get the same answer, so this
        # doesn't reveal the state of an account that isn't allowed in.
        if not _employee_can_login(employee):
            return jsonify({
                "success": False,
                "message": "This Google account is not linked to any employee account. Please log in with your "
                            "password and link your Google account from Settings."
            }), 401

        if employee["mfa_enabled"]:
            return jsonify(_issue_employee_mfa_challenge(employee)), 200

        return jsonify(_build_employee_session(employee)), 200

    except pymysql.MySQLError as e:
        print(f"Employee Google login error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/mfa/verify", methods=["POST"])
def employee_verify_mfa():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "message": "Invalid request body"}), 400

    pending_token = data.get("pending_token")
    code = data.get("code")

    if not pending_token or not code:
        return jsonify({"success": False, "message": "pending_token and code are required"}), 400

    payload = _decode_employee_pending_token(pending_token)
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
        cursor.execute("SELECT * FROM employees WHERE employee_id = %s", (payload["employee_id"],))
        employee = cursor.fetchone()

        if not _employee_can_login(employee) or not employee["mfa_enabled"]:
            return jsonify({"success": False, "message": "This login session is invalid or has expired. Please log in again."}), 401

        mfa_attempt_key = f"employee_mfa:{employee['email']}"
        locked_out, minutes_remaining = is_locked_out(mfa_attempt_key)
        if locked_out:
            return jsonify({
                "success": False,
                "message": f"Too many failed codes. Please try again in {minutes_remaining} minute(s)."
            }), 429

        secret = decrypt_mfa_secret(employee["mfa_secret"])
        if not secret or not verify_totp_code(secret, code):
            record_failed_attempt(mfa_attempt_key)
            return jsonify({"success": False, "message": "Invalid verification code"}), 400

        reset_attempts(mfa_attempt_key)

        if jti and not consume_pending_token_jti(jti, payload["exp"]):
            return jsonify({"success": False, "message": "This login session has already been used. Please log in again."}), 401

        return jsonify(_build_employee_session(employee)), 200

    except pymysql.MySQLError as e:
        print(f"Employee MFA verify error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/mfa/verify-recovery", methods=["POST"])
def employee_verify_mfa_recovery():
    """Separate, explicit endpoint for logging in with a recovery code
    instead of an authenticator code. Only the one code used is consumed;
    the authenticator secret is left alone."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "message": "Invalid request body"}), 400

    pending_token = data.get("pending_token")
    recovery_code = data.get("recovery_code")

    if not pending_token or not recovery_code:
        return jsonify({"success": False, "message": "pending_token and recovery_code are required"}), 400

    payload = _decode_employee_pending_token(pending_token)
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
        cursor.execute("SELECT * FROM employees WHERE employee_id = %s", (payload["employee_id"],))
        employee = cursor.fetchone()

        if not _employee_can_login(employee) or not employee["mfa_enabled"]:
            return jsonify({"success": False, "message": "This login session is invalid or has expired. Please log in again."}), 401

        mfa_attempt_key = f"employee_mfa:{employee['email']}"
        locked_out, minutes_remaining = is_locked_out(mfa_attempt_key)
        if locked_out:
            return jsonify({
                "success": False,
                "message": f"Too many failed codes. Please try again in {minutes_remaining} minute(s)."
            }), 429

        if not consume_employee_recovery_code(cursor, employee["employee_id"], recovery_code):
            record_failed_attempt(mfa_attempt_key)
            return jsonify({"success": False, "message": "Invalid or already-used recovery code"}), 400

        reset_attempts(mfa_attempt_key)

        if jti and not consume_pending_token_jti(jti, payload["exp"]):
            return jsonify({"success": False, "message": "This login session has already been used. Please log in again."}), 401

        connection.commit()

        session = _build_employee_session(employee)
        session["used_recovery_code"] = True
        return jsonify(session), 200

    except pymysql.MySQLError as e:
        print(f"Employee MFA recovery verify error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/login", methods=["POST"])
def employee_login():
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
        cursor.execute("SELECT * FROM employees WHERE email = %s", (email,))
        employee = cursor.fetchone()

        if not employee:
            record_failed_attempt(email)
            record_event("login")
            return jsonify({"success": False, "message": "Invalid email or password"}), 401

        if employee["is_archived"]:
            return jsonify({"success": False, "message": "Invalid email or password"}), 401

        if employee["status"] == "Inactive":
            return jsonify({"success": False, "message": "Invalid email or password"}), 401

        if employee["password"] is None:
            return jsonify({
                "success": False,
                "message": "Account not yet activated. Please check your email to set your password."
            }), 401

        password_matches = check_password_hash(employee["password"], password)

        if not password_matches:
            record_failed_attempt(email)
            record_event("login")
            return jsonify({"success": False, "message": "Invalid email or password"}), 401

        reset_attempts(email)

        # Only employees who turned 2-Step Verification on themselves get
        # the extra step; everyone else logs in exactly as before.
        if employee["mfa_enabled"]:
            return jsonify(_issue_employee_mfa_challenge(employee)), 200

        return jsonify(_build_employee_session(employee)), 200

    except pymysql.MySQLError as e:
        print(f"Employee login DB error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/forgot-password", methods=["POST"])
def employee_forgot_password():
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
        cursor.execute("SELECT * FROM employees WHERE email = %s AND is_archived = FALSE", (email,))
        employee = cursor.fetchone()

        if not employee:
            return jsonify({"success": True, "message": generic_message}), 200

        cursor.execute(
            "UPDATE employee_password_tokens SET used_at = NOW() WHERE employee_id = %s AND used_at IS NULL",
            (employee["employee_id"],)
        )

        raw_token = generate_token()
        token_hash = hash_token(raw_token)
        expires_at = get_expiry("reset")

        cursor.execute(
            "INSERT INTO employee_password_tokens (employee_id, token_hash, token_type, expires_at) "
            "VALUES (%s, %s, %s, %s)",
            (employee["employee_id"], token_hash, "reset", expires_at)
        )
        connection.commit()

        reset_link = f"{settings.FRONTEND_BASE_URL}/employee/set-password?token={raw_token}"
        send_email(
            employee["email"],
            "Reset your Employee Management System password",
            f"Hi {employee['first_name']},\n\n"
            f"We received a request to reset your password. Click the link below to set a new one:\n\n"
            f"{reset_link}\n\n"
            f"This link expires in 1 hour. If you didn't request this, you can safely ignore this email."
        )

        return jsonify({"success": True, "message": generic_message}), 200

    except pymysql.MySQLError as e:
        print(f"Employee forgot password error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/validate-token", methods=["GET"])
def employee_validate_token():
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
            "SELECT * FROM employee_password_tokens WHERE token_hash = %s AND used_at IS NULL",
            (hash_token(token),)
        )
        token_row = cursor.fetchone()

        if not token_row or token_row["expires_at"] < datetime.utcnow():
            return jsonify({"success": False, "message": "This link is invalid or has expired"}), 400

        return jsonify({"success": True, "message": "Token is valid"}), 200

    except pymysql.MySQLError as e:
        print(f"Employee validate token error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/set-password", methods=["POST"])
def employee_set_password():
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
            "SELECT * FROM employee_password_tokens WHERE token_hash = %s AND used_at IS NULL",
            (hash_token(token),)
        )
        token_row = cursor.fetchone()

        if not token_row or token_row["expires_at"] < datetime.utcnow():
            return jsonify({"success": False, "message": "This link is invalid or has expired"}), 400

        new_password_hash = generate_password_hash(new_password)

        cursor.execute(
            "UPDATE employees SET password = %s, has_logged_in = TRUE WHERE employee_id = %s",
            (new_password_hash, token_row["employee_id"])
        )
        cursor.execute(
            "UPDATE employee_password_tokens SET used_at = NOW() WHERE token_id = %s",
            (token_row["token_id"],)
        )
        connection.commit()

        return jsonify({"success": True, "message": "Password set successfully"}), 200

    except pymysql.MySQLError as e:
        print(f"Employee set password error: {e}")
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/me", methods=["GET"])
@require_employee_auth
def get_my_profile():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """SELECT e.employee_id, e.employee_code, e.first_name, e.last_name, e.email, e.phone,
                      e.address, e.gender, e.date_of_birth, e.joining_date, e.status, e.profile_photo,
                      d.department_name, r.role_name, g.grade_name, s.shift_name,
                      m.first_name AS manager_first_name, m.last_name AS manager_last_name
               FROM employees e
               JOIN departments d ON e.department_id = d.department_id
               JOIN roles r ON e.role_id = r.role_id
               JOIN grades g ON e.grade_id = g.grade_id
               JOIN shifts s ON e.shift_id = s.shift_id
               LEFT JOIN employees m ON e.reporting_manager_id = m.employee_id
               WHERE e.employee_id = %s""",
            (request.current_employee["employee_id"],)
        )
        employee = cursor.fetchone()

        if not employee:
            return not_found_response("Employee not found")

        if employee.get("date_of_birth"):
            employee["date_of_birth"] = employee["date_of_birth"].strftime("%Y-%m-%d")
        if employee.get("joining_date"):
            employee["joining_date"] = employee["joining_date"].strftime("%Y-%m-%d")

        return success_response(data=employee)

    except pymysql.MySQLError as e:
        print(f"Get my profile error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/me", methods=["PUT"])
@require_employee_auth
@block_demo_account
def update_my_profile():
    """
    Employee self-service profile update. Deliberately accepts only
    phone and address from the request body - every other field on the
    employee record (name, department, role, grade, shift, joining date,
    reporting manager, status, etc.) is HR-controlled and is not read
    from the body at all here, so a crafted request can't change them
    either; this isn't just a frontend restriction.
    """
    employee_id = request.current_employee["employee_id"]
    data = request.get_json() or {}

    phone = str(data.get("phone", "")).strip()
    address = data.get("address")
    if address is not None:
        address = str(address).strip()

    errors = {}
    if not phone:
        errors["phone"] = "Phone number is required"
    elif not is_valid_phone(phone):
        errors["phone"] = "Phone number must be exactly 10 digits"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "UPDATE employees SET phone = %s, address = %s WHERE employee_id = %s",
            (phone, address, employee_id)
        )
        connection.commit()

        cursor.execute(
            "SELECT employee_id, phone, address FROM employees WHERE employee_id = %s",
            (employee_id,)
        )
        updated = cursor.fetchone()

        return success_response("Profile updated successfully", data=updated)

    except pymysql.err.IntegrityError as e:
        message = str(e).lower()
        if "phone" in message:
            return error_response("Phone number already exists", status_code=409)
        return error_response("Duplicate or invalid data", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Update my profile error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


def _is_allowed_photo_extension(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in settings.ALLOWED_PHOTO_EXTENSIONS
    )


@employee_auth_bp.route("/employee/me/photo", methods=["GET"])
@require_employee_auth
def get_my_photo():
    """
    Serves the employee's own profile photo inline (not as an
    attachment), so the frontend can render it directly in an <img> tag
    after fetching it as an authenticated blob - same technique already
    used for document downloads, just without Content-Disposition:
    attachment. There's no public/static file serving anywhere in this
    project, so this stays behind require_employee_auth like every other
    uploaded file.
    """
    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT profile_photo FROM employees WHERE employee_id = %s",
            (employee_id,)
        )
        employee = cursor.fetchone()

        if not employee or not employee["profile_photo"]:
            return not_found_response("No profile photo on file")

        stored_file = get_file(employee["profile_photo"])
        if not stored_file:
            return not_found_response("Profile photo file could not be found")
        file_data, content_type = stored_file

        return send_file(file_data, mimetype=content_type)

    except pymysql.MySQLError as e:
        print(f"Get my photo error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/me/photo", methods=["POST"])
@require_employee_auth
@block_demo_account
def upload_my_photo():
    """
    Uploads/replaces the employee's own profile photo. Reuses
    employees.profile_photo (already an existing, already-nullable
    column - no schema change) and the same
    upload-folder-per-employee/random-filename convention documents
    already use. The DB update is committed before the old file (if
    any) is removed from disk, same ordering document deletion already
    uses, so a mid-request failure can never leave the DB pointing at a
    file that no longer exists.
    """
    employee_id = request.current_employee["employee_id"]
    file = request.files.get("file")

    errors = {}
    if not file or not file.filename:
        errors["file"] = "A photo file is required"
    elif not _is_allowed_photo_extension(file.filename):
        errors["file"] = "Only JPG, JPEG, and PNG files are allowed"
    elif get_file_size(file) > settings.MAX_PHOTO_SIZE_BYTES:
        errors["file"] = "Photo size cannot be greater than 2 MB"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    saved_file_path = None
    try:
        cursor = connection.cursor()

        cursor.execute(
            "SELECT profile_photo FROM employees WHERE employee_id = %s",
            (employee_id,)
        )
        current = cursor.fetchone()
        old_relative_path = current["profile_photo"] if current else None

        stored_filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
        relative_path = f"employee_photos/{employee_id}/{stored_filename}"
        save_file(relative_path, file)
        saved_file_path = relative_path

        cursor.execute(
            "UPDATE employees SET profile_photo = %s WHERE employee_id = %s",
            (relative_path, employee_id)
        )
        connection.commit()

        if old_relative_path:
            try:
                delete_file(old_relative_path)
            except OSError as cleanup_error:
                print(f"Could not remove replaced profile photo: {cleanup_error}")

        return success_response("Profile photo updated successfully", data={"profile_photo": relative_path})

    except pymysql.MySQLError as e:
        print(f"Upload my photo error: {e}")
        if saved_file_path:
            try:
                delete_file(saved_file_path)
            except OSError as cleanup_error:
                print(f"Could not remove orphaned profile photo file: {cleanup_error}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/me/photo", methods=["DELETE"])
@require_employee_auth
@block_demo_account
def remove_my_photo():
    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT profile_photo FROM employees WHERE employee_id = %s",
            (employee_id,)
        )
        current = cursor.fetchone()

        if not current or not current["profile_photo"]:
            return not_found_response("No profile photo on file")

        old_relative_path = current["profile_photo"]

        cursor.execute(
            "UPDATE employees SET profile_photo = NULL WHERE employee_id = %s",
            (employee_id,)
        )
        connection.commit()

        try:
            delete_file(old_relative_path)
        except OSError as cleanup_error:
            print(f"Could not remove profile photo file: {cleanup_error}")

        return success_response("Profile photo removed successfully")

    except pymysql.MySQLError as e:
        print(f"Remove my photo error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employees/<int:employee_id>/invite", methods=["POST"])
@require_permission("employees.update")
def invite_employee(employee_id):
    """
    Admin-invoked: sends (or resends) a self-service portal invite to an
    existing employee record. Kept separate from employee creation so
    every employee doesn't automatically get a portal account the moment
    their HR record is added.
    """
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM employees WHERE employee_id = %s", (employee_id,))
        employee = cursor.fetchone()

        if not employee:
            return not_found_response("Employee not found")

        if employee["is_archived"]:
            return error_response("Cannot invite an archived employee", status_code=400)

        cursor.execute(
            "UPDATE employee_password_tokens SET used_at = NOW() WHERE employee_id = %s AND used_at IS NULL",
            (employee_id,)
        )

        raw_token = generate_token()
        token_hash = hash_token(raw_token)
        expires_at = get_expiry("invite")

        cursor.execute(
            "INSERT INTO employee_password_tokens (employee_id, token_hash, token_type, expires_at) "
            "VALUES (%s, %s, %s, %s)",
            (employee_id, token_hash, "invite", expires_at)
        )
        connection.commit()

        set_password_link = f"{settings.FRONTEND_BASE_URL}/employee/set-password?token={raw_token}"
        email_sent = send_email(
            employee["email"],
            "You've been invited to Employee Management System",
            f"Hi {employee['first_name']},\n\n"
            f"You can now access the employee self-service portal. "
            f"Click the link below to set your password and log in:\n\n"
            f"{set_password_link}\n\n"
            f"This link expires in 24 hours."
        )

        message = "Invite sent successfully"
        if not email_sent:
            message = "Employee found, but the invitation email could not be sent"

        return success_response(message)

    except pymysql.MySQLError as e:
        print(f"Invite employee error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Employee Settings -> Security (2-Step Verification, Change Password)
# ---------------------------------------------------------------------

@employee_auth_bp.route("/employee/settings/security", methods=["GET"])
@require_employee_auth
def get_employee_security_status():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT mfa_enabled, google_sub FROM employees WHERE employee_id = %s",
            (request.current_employee["employee_id"],)
        )
        employee = cursor.fetchone()

        if not employee:
            return not_found_response("Employee not found")

        # Only whether a Google account is linked - never the id itself.
        return success_response(data={
            "mfa_enabled": bool(employee["mfa_enabled"]),
            "google_linked": employee["google_sub"] is not None,
        })

    except pymysql.MySQLError as e:
        print(f"Employee security status error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/settings/google/link", methods=["POST"])
@require_employee_auth
@block_demo_account
def link_employee_google_account():
    """
    Links the logged-in employee's account to a Google identity, mirroring
    settings_routes.link_google_account for admins. Must be called from an
    authenticated session - Google sign-in itself never creates or links an
    account, only this explicit action does. A Google account already
    linked to a different employee is refused.
    """
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

    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute("SELECT employee_id FROM employees WHERE google_sub = %s", (claims["sub"],))
        existing = cursor.fetchone()
        if existing and existing["employee_id"] != employee_id:
            return error_response(
                "This Google account is already linked to a different employee account.", status_code=409
            )

        cursor.execute("UPDATE employees SET google_sub = %s WHERE employee_id = %s", (claims["sub"], employee_id))
        connection.commit()

        return success_response("Google account linked successfully")

    except pymysql.MySQLError as e:
        print(f"Employee Google link error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/settings/mfa/setup/start", methods=["POST"])
@require_employee_auth
@block_demo_account
def start_employee_mfa_setup():
    """Generates a secret for the authenticator app. Nothing is saved
    until /setup/confirm proves the employee can produce a valid code -
    same approach as the admin flow."""
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT email, mfa_enabled FROM employees WHERE employee_id = %s",
            (request.current_employee["employee_id"],)
        )
        employee = cursor.fetchone()

        if not employee:
            return not_found_response("Employee not found")

        if employee["mfa_enabled"]:
            return error_response("2-Step Verification is already turned on for your account", status_code=409)

        secret = generate_totp_secret()
        return success_response(data={
            "secret": secret,
            "otpauth_uri": get_totp_uri(secret, employee["email"])
        })

    except pymysql.MySQLError as e:
        print(f"Employee MFA setup start error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/settings/mfa/setup/confirm", methods=["POST"])
@require_employee_auth
@block_demo_account
def confirm_employee_mfa_setup():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    secret = data.get("secret")
    code = data.get("code")

    if not secret or not code:
        return error_response("secret and code are required", status_code=400)

    if not verify_totp_code(secret, code):
        return error_response("Invalid verification code", status_code=400)

    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT mfa_enabled FROM employees WHERE employee_id = %s", (employee_id,))
        employee = cursor.fetchone()

        if not employee:
            return not_found_response("Employee not found")

        # Never overwrite an already-enrolled secret through this flow.
        if employee["mfa_enabled"]:
            return error_response("2-Step Verification is already turned on for your account", status_code=409)

        cursor.execute(
            "UPDATE employees SET mfa_secret = %s, mfa_enabled = TRUE, mfa_enrolled_at = NOW() WHERE employee_id = %s",
            (encrypt_mfa_secret(secret), employee_id)
        )
        recovery_codes = replace_employee_recovery_codes(cursor, employee_id)
        connection.commit()

        return success_response("2-Step Verification turned on", data={"recovery_codes": recovery_codes})

    except pymysql.MySQLError as e:
        print(f"Employee MFA setup confirm error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/settings/mfa/disable", methods=["POST"])
@require_employee_auth
@block_demo_account
def disable_employee_mfa():
    """Being logged in is not enough to turn 2-Step Verification off: it
    needs a current authenticator code or an unused recovery code (exactly
    one of the two)."""
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    code = data.get("code")
    recovery_code = data.get("recovery_code")
    if bool(code) == bool(recovery_code):
        return error_response("Provide either an authenticator code or a recovery code", status_code=400)

    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT email, mfa_enabled, mfa_secret FROM employees WHERE employee_id = %s", (employee_id,))
        employee = cursor.fetchone()

        if not employee:
            return not_found_response("Employee not found")

        if not employee["mfa_enabled"]:
            return error_response("2-Step Verification is not turned on for your account", status_code=400)

        mfa_attempt_key = f"employee_mfa:{employee['email']}"
        locked_out, minutes_remaining = is_locked_out(mfa_attempt_key)
        if locked_out:
            return error_response(
                f"Too many failed codes. Please try again in {minutes_remaining} minute(s).", status_code=429
            )

        if code:
            secret = decrypt_mfa_secret(employee["mfa_secret"])
            if not secret or not verify_totp_code(secret, code):
                record_failed_attempt(mfa_attempt_key)
                return error_response("Invalid verification code", status_code=400)
        elif not consume_employee_recovery_code(cursor, employee_id, recovery_code):
            record_failed_attempt(mfa_attempt_key)
            return error_response("Invalid or already-used recovery code", status_code=400)

        reset_attempts(mfa_attempt_key)

        cursor.execute(
            "UPDATE employees SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_enrolled_at = NULL WHERE employee_id = %s",
            (employee_id,)
        )
        cursor.execute("DELETE FROM employee_mfa_recovery_codes WHERE employee_id = %s", (employee_id,))
        connection.commit()

        return success_response("2-Step Verification has been turned off")

    except pymysql.MySQLError as e:
        print(f"Employee MFA disable error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_auth_bp.route("/employee/settings/change-password", methods=["PUT"])
@require_employee_auth
@block_demo_account
def change_employee_password():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

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

    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT password FROM employees WHERE employee_id = %s", (employee_id,))
        employee = cursor.fetchone()

        if not employee:
            return not_found_response("Employee not found")

        if not employee["password"] or not check_password_hash(employee["password"], current_password):
            return error_response("Current password is incorrect", status_code=400)

        cursor.execute(
            "UPDATE employees SET password = %s WHERE employee_id = %s",
            (generate_password_hash(new_password), employee_id)
        )
        connection.commit()

        return success_response("Password changed successfully")

    except pymysql.MySQLError as e:
        print(f"Employee change password error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()