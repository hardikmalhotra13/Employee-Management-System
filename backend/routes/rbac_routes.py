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

rbac_bp = Blueprint("rbac", __name__)


@rbac_bp.route("/admin-roles", methods=["GET"])
@require_permission("users.view")
def get_admin_roles():
    """
    Lightweight role list (id + name only) used by the User Management
    role dropdown. Anyone who can reach User Management can see the list
    of role names; only rbac.manage can see/change what a role grants.
    """
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT admin_role_id, role_name, is_system FROM admin_roles ORDER BY admin_role_id")
        roles = cursor.fetchall()

        return success_response(data=roles)

    except pymysql.MySQLError as e:
        print(f"Get admin roles error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@rbac_bp.route("/admin-roles/<int:admin_role_id>", methods=["GET"])
@require_permission("rbac.manage")
def get_admin_role(admin_role_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM admin_roles WHERE admin_role_id = %s", (admin_role_id,))
        role = cursor.fetchone()

        if not role:
            return not_found_response("Role not found")

        cursor.execute(
            "SELECT permission_id FROM admin_role_permissions WHERE admin_role_id = %s",
            (admin_role_id,)
        )
        role["permission_ids"] = [row["permission_id"] for row in cursor.fetchall()]

        return success_response(data=role)

    except pymysql.MySQLError as e:
        print(f"Get admin role error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@rbac_bp.route("/permissions", methods=["GET"])
@require_permission("rbac.manage")
def get_permissions():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM admin_permissions ORDER BY module, permission_id")
        permissions = cursor.fetchall()

        return success_response(data=permissions)

    except pymysql.MySQLError as e:
        print(f"Get permissions error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@rbac_bp.route("/admin-roles", methods=["POST"])
@require_permission("rbac.manage")
def create_admin_role():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    role_name = data.get("role_name")
    permission_ids = data.get("permission_ids", [])

    errors = {}
    if not role_name or not role_name.strip():
        errors["role_name"] = "Role name is required"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        if permission_ids:
            cursor.execute("SELECT permission_id FROM admin_permissions")
            valid_ids = {row["permission_id"] for row in cursor.fetchall()}
            invalid_ids = [pid for pid in permission_ids if pid not in valid_ids]
            if invalid_ids:
                return validation_error_response({
                    "permission_ids": f"Unknown permission id(s): {invalid_ids}"
                })

        cursor.execute(
            "INSERT INTO admin_roles (role_name, is_system) VALUES (%s, FALSE)",
            (role_name.strip(),)
        )
        new_role_id = cursor.lastrowid

        for permission_id in permission_ids:
            cursor.execute(
                "INSERT INTO admin_role_permissions (admin_role_id, permission_id) VALUES (%s, %s)",
                (new_role_id, permission_id)
            )

        log_action(
            cursor, request.current_admin["admin_id"], "create", "admin_role", new_role_id,
            details=f"{role_name.strip()} ({len(permission_ids)} permission(s) granted)"
        )
        connection.commit()

        cursor.execute("SELECT * FROM admin_roles WHERE admin_role_id = %s", (new_role_id,))
        role = cursor.fetchone()

        return created_response("Role created successfully", data=role)

    except pymysql.err.IntegrityError:
        return error_response("A role with this name already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create admin role error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@rbac_bp.route("/admin-roles/<int:admin_role_id>", methods=["PUT"])
@require_permission("rbac.manage")
def update_admin_role(admin_role_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    role_name = data.get("role_name")
    permission_ids = data.get("permission_ids", [])

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM admin_roles WHERE admin_role_id = %s", (admin_role_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Role not found")

        # System roles (Super Admin, HR Admin, Read-only) can have their
        # granted permissions changed, but their name is fixed so nothing
        # elsewhere in the app that keys off the name silently breaks.
        if existing["is_system"]:
            if role_name and role_name.strip() != existing["role_name"]:
                return error_response("System roles cannot be renamed", status_code=400)
        elif not role_name or not role_name.strip():
            return validation_error_response({"role_name": "Role name is required"})
        else:
            cursor.execute(
                "UPDATE admin_roles SET role_name = %s WHERE admin_role_id = %s",
                (role_name.strip(), admin_role_id)
            )

        if permission_ids:
            cursor.execute("SELECT permission_id FROM admin_permissions")
            valid_ids = {row["permission_id"] for row in cursor.fetchall()}
            invalid_ids = [pid for pid in permission_ids if pid not in valid_ids]
            if invalid_ids:
                return validation_error_response({
                    "permission_ids": f"Unknown permission id(s): {invalid_ids}"
                })

        # Prevent removing the last remaining source of rbac.manage, which
        # would make it impossible for anyone to manage roles/permissions
        # afterward (including the admin making this exact change).
        cursor.execute("SELECT permission_id FROM admin_permissions WHERE permission_key = 'rbac.manage'")
        rbac_permission_row = cursor.fetchone()
        rbac_permission_id = rbac_permission_row["permission_id"] if rbac_permission_row else None

        if rbac_permission_id and rbac_permission_id not in permission_ids:
            cursor.execute(
                """SELECT COUNT(*) AS count FROM admin_role_permissions
                   WHERE permission_id = %s AND admin_role_id != %s""",
                (rbac_permission_id, admin_role_id)
            )
            if cursor.fetchone()["count"] == 0:
                return error_response(
                    "At least one role must keep the permission to manage roles and permissions",
                    status_code=409
                )

        cursor.execute("DELETE FROM admin_role_permissions WHERE admin_role_id = %s", (admin_role_id,))
        for permission_id in permission_ids:
            cursor.execute(
                "INSERT INTO admin_role_permissions (admin_role_id, permission_id) VALUES (%s, %s)",
                (admin_role_id, permission_id)
            )

        log_action(
            cursor, request.current_admin["admin_id"], "update", "admin_role", admin_role_id,
            details=f"{existing['role_name']} (now has {len(permission_ids)} permission(s))"
        )
        connection.commit()

        cursor.execute("SELECT * FROM admin_roles WHERE admin_role_id = %s", (admin_role_id,))
        role = cursor.fetchone()

        return success_response("Role updated successfully", data=role)

    except pymysql.err.IntegrityError:
        return error_response("A role with this name already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Update admin role error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@rbac_bp.route("/admin-roles/<int:admin_role_id>", methods=["DELETE"])
@require_permission("rbac.manage")
def delete_admin_role(admin_role_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM admin_roles WHERE admin_role_id = %s", (admin_role_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Role not found")

        if existing["is_system"]:
            return error_response("System roles cannot be deleted", status_code=400)

        cursor.execute("SELECT COUNT(*) AS admin_count FROM admins WHERE admin_role_id = %s", (admin_role_id,))
        if cursor.fetchone()["admin_count"] > 0:
            return error_response(
                "This role is assigned to one or more admin users and cannot be deleted",
                status_code=409
            )

        cursor.execute("DELETE FROM admin_roles WHERE admin_role_id = %s", (admin_role_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "admin_role", admin_role_id,
            details=existing["role_name"]
        )
        connection.commit()

        return success_response("Role deleted successfully")

    except pymysql.MySQLError as e:
        print(f"Delete admin role error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()