import pymysql
from flask import Blueprint, request

from database.connection import get_db_connection
from utils.response_helpers import (
    success_response,
    created_response,
    error_response,
    validation_error_response,
    not_found_response,
)
from utils.auth_helper import require_permission
from utils.audit_helper import log_action

role_bp = Blueprint("role", __name__)

VALID_STATUSES = ("Active", "Inactive")


@role_bp.route("/roles", methods=["GET"])
@require_permission("roles.view")
def get_roles():
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)
    include_archived = request.args.get("include_archived", "false").lower() == "true"

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

    where_clause = "" if include_archived else "WHERE is_archived = FALSE"

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(f"SELECT COUNT(*) AS total FROM roles {where_clause}")
        total = cursor.fetchone()["total"]

        cursor.execute(
            f"SELECT * FROM roles {where_clause} ORDER BY role_id DESC LIMIT %s OFFSET %s",
            (page_size, offset)
        )
        roles = cursor.fetchall()

        return success_response(data={
            "records": roles,
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get roles error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@role_bp.route("/roles/<int:role_id>", methods=["GET"])
@require_permission("roles.view")
def get_role(role_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM roles WHERE role_id = %s", (role_id,))
        role = cursor.fetchone()

        if not role:
            return not_found_response("Role not found")

        return success_response(data=role)

    except pymysql.MySQLError as e:
        print(f"Get role error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@role_bp.route("/roles", methods=["POST"])
@require_permission("roles.create")
def create_role():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    role_name = data.get("role_name")
    status = data.get("status", "Active")

    errors = {}
    if not role_name or not role_name.strip():
        errors["role_name"] = "Role name is required"
    if status not in VALID_STATUSES:
        errors["status"] = "Status must be Active or Inactive"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        # role_code is system-generated and never accepted from the client
        cursor.execute("SELECT MAX(role_id) AS max_id FROM roles")
        max_id = cursor.fetchone()["max_id"] or 0
        role_code = f"ROL{max_id + 1:04d}"

        cursor.execute(
            "INSERT INTO roles (role_code, role_name, status) VALUES (%s, %s, %s)",
            (role_code, role_name.strip(), status)
        )
        log_action(cursor, request.current_admin["admin_id"], "create", "role", cursor.lastrowid)
        connection.commit()

        cursor.execute("SELECT * FROM roles WHERE role_id = %s", (cursor.lastrowid,))
        role = cursor.fetchone()

        return created_response("Role created successfully", data=role)

    except pymysql.err.IntegrityError:
        return error_response("Role name already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create role error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@role_bp.route("/roles/<int:role_id>", methods=["PUT"])
@require_permission("roles.update")
def update_role(role_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    role_name = data.get("role_name")
    status = data.get("status")

    errors = {}
    if not role_name or not role_name.strip():
        errors["role_name"] = "Role name is required"
    if status not in VALID_STATUSES:
        errors["status"] = "Status must be Active or Inactive"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM roles WHERE role_id = %s", (role_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Role not found")

        # role_code is never updated here, only name and status
        cursor.execute(
            "UPDATE roles SET role_name = %s, status = %s WHERE role_id = %s",
            (role_name.strip(), status, role_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "role", role_id)
        connection.commit()

        cursor.execute("SELECT * FROM roles WHERE role_id = %s", (role_id,))
        role = cursor.fetchone()

        return success_response("Role updated successfully", data=role)

    except pymysql.err.IntegrityError:
        return error_response("Role name already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Update role error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@role_bp.route("/roles/<int:role_id>", methods=["DELETE"])
@require_permission("roles.archive")
def delete_role(role_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM roles WHERE role_id = %s", (role_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Role not found")

        # Roles are archived rather than deleted, so existing employee
        # references are unaffected and the record can be restored later.
        cursor.execute("UPDATE roles SET is_archived = TRUE WHERE role_id = %s", (role_id,))
        log_action(cursor, request.current_admin["admin_id"], "archive", "role", role_id)
        connection.commit()

        return success_response("Role archived successfully")

    except pymysql.MySQLError as e:
        print(f"Archive role error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@role_bp.route("/roles/<int:role_id>/restore", methods=["PUT"])
@require_permission("roles.restore")
def restore_role(role_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM roles WHERE role_id = %s", (role_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Role not found")

        if not existing["is_archived"]:
            return error_response("Role is not archived", status_code=400)

        cursor.execute("UPDATE roles SET is_archived = FALSE WHERE role_id = %s", (role_id,))
        log_action(cursor, request.current_admin["admin_id"], "restore", "role", role_id)
        connection.commit()

        cursor.execute("SELECT * FROM roles WHERE role_id = %s", (role_id,))
        role = cursor.fetchone()

        return success_response("Role restored successfully", data=role)

    except pymysql.MySQLError as e:
        print(f"Restore role error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@role_bp.route("/roles/<int:role_id>/permanent", methods=["DELETE"])
@require_permission("roles.delete")
def permanently_delete_role(role_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM roles WHERE role_id = %s", (role_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Role not found")

        if not existing["is_archived"]:
            return error_response("Only archived roles can be permanently deleted", status_code=400)

        cursor.execute("DELETE FROM roles WHERE role_id = %s", (role_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "role", role_id,
            details=existing["role_name"]
        )
        connection.commit()

        return success_response("Role permanently deleted")

    except pymysql.err.IntegrityError:
        # ON DELETE RESTRICT blocks this if employees still reference the role
        return error_response(
            "This role is still assigned to one or more employees and cannot be permanently deleted",
            status_code=409
        )

    except pymysql.MySQLError as e:
        print(f"Permanently delete role error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()