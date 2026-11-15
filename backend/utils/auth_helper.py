"""
JWT authentication and capability-based authorization helpers used
across route modules.

require_auth verifies the Authorization header and attaches the decoded
token payload (admin_id, email, role, permissions) to request.current_admin.

require_permission builds on require_auth and checks that the logged-in
admin's permission list (embedded in the JWT at login time) includes the
required permission key for that route.

get_role_permissions is used only at login time to resolve an admin
role's granted permission keys, which are then embedded in the JWT so
every subsequent request can check permissions without a database call.
"""

from functools import wraps

import jwt
import pymysql
from flask import request

from config import settings
from database.connection import get_db_connection
from utils.response_helpers import unauthorized_response, error_response


def _is_valid_id(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _has_valid_admin_claims(payload):
    """A genuine admin session token always has these, with these types."""
    permissions = payload.get("permissions")
    return (
        _is_valid_id(payload.get("admin_id"))
        and isinstance(payload.get("email"), str) and bool(payload["email"])
        and isinstance(permissions, list)
        and all(isinstance(key, str) for key in permissions)
    )


def _has_valid_employee_claims(payload):
    return (
        _is_valid_id(payload.get("employee_id"))
        and isinstance(payload.get("email"), str) and bool(payload["email"])
    )


def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return unauthorized_response("Authentication token is missing")

        token = auth_header.split(" ", 1)[1]

        try:
            payload = jwt.decode(
                token, settings.JWT_SECRET_KEY,
                algorithms=["HS256"], options={"require": ["exp"]}
            )
        except jwt.ExpiredSignatureError:
            return unauthorized_response("Session expired, please log in again")
        except jwt.InvalidTokenError:
            return unauthorized_response("Invalid authentication token")

        # Short-lived interim tokens issued mid-login (mfa_setup, mfa_pending -
        # see auth_routes.py) are signed with this same key but must never be
        # usable as a real session, even if intercepted - they carry a "type"
        # claim that a genuine session token never has, and are rejected here
        # rather than only relying on require_permission's missing-permissions
        # check (which does not protect require_auth-only routes).
        if payload.get("type") is not None:
            return unauthorized_response("Invalid authentication token")

        # Reject a validly signed token with missing or malformed claims
        # instead of letting routes fail later (or, for "permissions", match a
        # string by substring).
        if not _has_valid_admin_claims(payload):
            return unauthorized_response("Invalid authentication token")

        request.current_admin = payload
        return f(*args, **kwargs)

    return wrapper


def require_permission(permission_key):
    def decorator(f):
        @wraps(f)
        @require_auth
        def wrapper(*args, **kwargs):
            granted = request.current_admin.get("permissions", [])
            if permission_key not in granted:
                return error_response(
                    "You do not have permission to perform this action",
                    status_code=403
                )
            return f(*args, **kwargs)

        return wrapper

    return decorator


def require_employee_auth(f):
    
    @wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return unauthorized_response("Authentication token is missing")

        token = auth_header.split(" ", 1)[1]

        try:
            payload = jwt.decode(
                token, settings.EMPLOYEE_JWT_SECRET_KEY,
                algorithms=["HS256"], options={"require": ["exp"]}
            )
        except jwt.ExpiredSignatureError:
            return unauthorized_response("Session expired, please log in again")
        except jwt.InvalidTokenError:
            return unauthorized_response("Invalid authentication token")

        if payload.get("type") != "employee" or not _has_valid_employee_claims(payload):
            return unauthorized_response("Invalid authentication token")

        connection = get_db_connection()
        if not connection:
            return error_response("Database connection failed", status_code=500)

        cursor = None
        try:
            cursor = connection.cursor()
            cursor.execute(
                "SELECT is_archived, status FROM employees WHERE employee_id = %s",
                (payload["employee_id"],)
            )
            employee = cursor.fetchone()
        except pymysql.MySQLError as e:
            print(f"Employee auth check DB error: {e}")
            return error_response("Something went wrong, please try again", status_code=500)
        finally:
            if cursor:
                cursor.close()
            connection.close()

        if not employee or employee["is_archived"] or employee["status"] == "Inactive":
            return unauthorized_response("Your account is no longer active")

        request.current_employee = payload
        return f(*args, **kwargs)

    return wrapper


def is_demo_account(email):
    """True if the email belongs to one of the public demo accounts (DEMO_ACCOUNT_EMAILS)."""
    return bool(email) and email.strip().lower() in settings.DEMO_ACCOUNT_EMAILS


def block_demo_account(f):
    """
    Blocks the public demo accounts from self-service actions that would let a
    visitor lock everyone else out of the shared login (changing the password,
    MFA, Google link or profile) or use the app as free file hosting (uploads).

    Place it directly below require_auth / require_employee_auth, which attach
    the logged-in user to the request.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = getattr(request, "current_admin", None) or getattr(request, "current_employee", None) or {}
        if is_demo_account(user.get("email")):
            return error_response("This action is disabled for the public demo account", status_code=403)
        return f(*args, **kwargs)

    return wrapper


def get_role_permissions(admin_role_id):
    """
    Used only at login to resolve which permission keys a role grants.
    Returns None (not []) if permissions could not be resolved due to a
    database problem, so the caller can tell that apart from a role that
    legitimately has zero permissions assigned.
    """
    connection = get_db_connection()
    if not connection:
        return None

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """SELECT p.permission_key
               FROM admin_role_permissions arp
               JOIN admin_permissions p ON arp.permission_id = p.permission_id
               WHERE arp.admin_role_id = %s""",
            (admin_role_id,)
        )
        return [row["permission_key"] for row in cursor.fetchall()]
    except pymysql.MySQLError:
        return None
    finally:
        if cursor:
            cursor.close()
        connection.close()