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

department_bp = Blueprint("department", __name__)

VALID_STATUSES = ("Active", "Inactive")


def get_employee_record(cursor, employee_id):
    cursor.execute(
        "SELECT employee_id, department_id, is_archived FROM employees WHERE employee_id = %s",
        (employee_id,)
    )
    return cursor.fetchone()


def validate_department_head(cursor, department_head_id, department_id):
    """
    Returns an error message if department_head_id is not a valid head for
    this department, else None. The head must be an existing, non-archived
    employee who already belongs to the department they are being assigned
    to head.
    """
    head = get_employee_record(cursor, department_head_id)

    if not head:
        return "Selected department head does not exist"

    if head["is_archived"]:
        return "Selected department head is archived"

    if head["department_id"] != department_id:
        return "Department head must belong to this department"

    return None


def get_department_record(cursor, department_id):
    cursor.execute(
        "SELECT department_id, department_name, parent_department_id, is_archived "
        "FROM departments WHERE department_id = %s",
        (department_id,)
    )
    return cursor.fetchone()


def would_create_department_cycle(cursor, department_id, proposed_parent_id, max_depth=50):
    """
    Same bounded chain-walk approach as the employee reporting-manager
    cycle check, but for department parents.
    """
    current_id = proposed_parent_id
    depth = 0

    while current_id and depth < max_depth:
        if str(current_id) == str(department_id):
            return True

        cursor.execute(
            "SELECT parent_department_id FROM departments WHERE department_id = %s",
            (current_id,)
        )
        row = cursor.fetchone()
        current_id = row["parent_department_id"] if row else None
        depth += 1

    return False


@department_bp.route("/departments", methods=["GET"])
@require_permission("departments.view")
def get_departments():
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

    where_clause = "" if include_archived else "WHERE d.is_archived = FALSE"

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(f"SELECT COUNT(*) AS total FROM departments d {where_clause}")
        total = cursor.fetchone()["total"]

        cursor.execute(
            f"""SELECT d.*, h.first_name AS head_first_name, h.last_name AS head_last_name,
                       p.department_name AS parent_department_name
                FROM departments d
                LEFT JOIN employees h ON d.department_head_id = h.employee_id
                LEFT JOIN departments p ON d.parent_department_id = p.department_id
                {where_clause}
                ORDER BY d.department_id DESC LIMIT %s OFFSET %s""",
            (page_size, offset)
        )
        departments = cursor.fetchall()

        return success_response(data={
            "records": departments,
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get departments error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@department_bp.route("/departments/<int:department_id>", methods=["GET"])
@require_permission("departments.view")
def get_department(department_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """SELECT d.*, h.first_name AS head_first_name, h.last_name AS head_last_name,
                      p.department_name AS parent_department_name
               FROM departments d
               LEFT JOIN employees h ON d.department_head_id = h.employee_id
               LEFT JOIN departments p ON d.parent_department_id = p.department_id
               WHERE d.department_id = %s""",
            (department_id,)
        )
        department = cursor.fetchone()

        if not department:
            return not_found_response("Department not found")

        return success_response(data=department)

    except pymysql.MySQLError as e:
        print(f"Get department error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@department_bp.route("/departments", methods=["POST"])
@require_permission("departments.create")
def create_department():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    department_name = data.get("department_name")
    status = data.get("status", "Active")
    parent_department_id = data.get("parent_department_id") or None

    errors = {}
    if not department_name or not department_name.strip():
        errors["department_name"] = "Department name is required"
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

        if parent_department_id:
            parent = get_department_record(cursor, parent_department_id)

            if not parent:
                return validation_error_response(
                    {"parent_department_id": "Selected parent department does not exist"}
                )

            if parent["is_archived"]:
                return validation_error_response(
                    {"parent_department_id": "Selected parent department is archived"}
                )

            if parent["department_name"].strip().lower() == department_name.strip().lower():
                return validation_error_response(
                    {"parent_department_id": "Parent department cannot have the same name as this department"}
                )

        # department_code is system-generated and never accepted from the client
        cursor.execute("SELECT MAX(department_id) AS max_id FROM departments")
        max_id = cursor.fetchone()["max_id"] or 0
        department_code = f"DEP{max_id + 1:04d}"

        # department_head_id is never accepted here - a department can't
        # have a head until an employee actually belongs to it, so the
        # head can only be assigned afterwards, through update_department.
        cursor.execute(
            "INSERT INTO departments (department_code, department_name, status, parent_department_id) "
            "VALUES (%s, %s, %s, %s)",
            (department_code, department_name.strip(), status, parent_department_id)
        )
        new_department_id = cursor.lastrowid

        log_action(cursor, request.current_admin["admin_id"], "create", "department", new_department_id)
        connection.commit()

        cursor.execute("SELECT * FROM departments WHERE department_id = %s", (new_department_id,))
        department = cursor.fetchone()

        return created_response("Department created successfully", data=department)

    except pymysql.err.IntegrityError:
        return error_response("Department name already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create department error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@department_bp.route("/departments/<int:department_id>", methods=["PUT"])
@require_permission("departments.update")
def update_department(department_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    department_name = data.get("department_name")
    status = data.get("status")
    department_head_id = data.get("department_head_id") or None
    parent_department_id = data.get("parent_department_id") or None

    errors = {}
    if not department_name or not department_name.strip():
        errors["department_name"] = "Department name is required"
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
        cursor.execute("SELECT * FROM departments WHERE department_id = %s", (department_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Department not found")

        if department_head_id:
            head_error = validate_department_head(cursor, department_head_id, department_id)
            if head_error:
                return validation_error_response({"department_head_id": head_error})

        if parent_department_id:
            if str(parent_department_id) == str(department_id):
                return validation_error_response(
                    {"parent_department_id": "A department cannot be its own parent"}
                )

            parent = get_department_record(cursor, parent_department_id)

            if not parent:
                return validation_error_response(
                    {"parent_department_id": "Selected parent department does not exist"}
                )

            if parent["is_archived"]:
                return validation_error_response(
                    {"parent_department_id": "Selected parent department is archived"}
                )

            if parent["department_name"].strip().lower() == department_name.strip().lower():
                return validation_error_response(
                    {"parent_department_id": "Parent department cannot have the same name as this department"}
                )

            if would_create_department_cycle(cursor, department_id, parent_department_id):
                return validation_error_response(
                    {"parent_department_id": "This assignment would create a department hierarchy cycle"}
                )

        # department_code is never updated here, only name, status, head, and parent
        cursor.execute(
            "UPDATE departments SET department_name = %s, status = %s, department_head_id = %s, "
            "parent_department_id = %s WHERE department_id = %s",
            (department_name.strip(), status, department_head_id, parent_department_id, department_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "department", department_id)
        connection.commit()

        cursor.execute("SELECT * FROM departments WHERE department_id = %s", (department_id,))
        department = cursor.fetchone()

        return success_response("Department updated successfully", data=department)

    except pymysql.err.IntegrityError:
        return error_response("Department name already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Update department error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@department_bp.route("/departments/<int:department_id>", methods=["DELETE"])
@require_permission("departments.archive")
def delete_department(department_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM departments WHERE department_id = %s", (department_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Department not found")

        # Departments are archived rather than deleted, so existing employee
        # references are unaffected and the record can be restored later.
        cursor.execute("UPDATE departments SET is_archived = TRUE WHERE department_id = %s", (department_id,))
        log_action(cursor, request.current_admin["admin_id"], "archive", "department", department_id)
        connection.commit()

        return success_response("Department archived successfully")

    except pymysql.MySQLError as e:
        print(f"Archive department error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@department_bp.route("/departments/<int:department_id>/restore", methods=["PUT"])
@require_permission("departments.restore")
def restore_department(department_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM departments WHERE department_id = %s", (department_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Department not found")

        if not existing["is_archived"]:
            return error_response("Department is not archived", status_code=400)

        cursor.execute("UPDATE departments SET is_archived = FALSE WHERE department_id = %s", (department_id,))
        log_action(cursor, request.current_admin["admin_id"], "restore", "department", department_id)
        connection.commit()

        cursor.execute("SELECT * FROM departments WHERE department_id = %s", (department_id,))
        department = cursor.fetchone()

        return success_response("Department restored successfully", data=department)

    except pymysql.MySQLError as e:
        print(f"Restore department error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@department_bp.route("/departments/<int:department_id>/permanent", methods=["DELETE"])
@require_permission("departments.delete")
def permanently_delete_department(department_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM departments WHERE department_id = %s", (department_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Department not found")

        if not existing["is_archived"]:
            return error_response("Only archived departments can be permanently deleted", status_code=400)

        cursor.execute("DELETE FROM departments WHERE department_id = %s", (department_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "department", department_id,
            details=existing["department_name"]
        )
        connection.commit()

        return success_response("Department permanently deleted")

    except pymysql.err.IntegrityError:
        # ON DELETE RESTRICT blocks this if employees still reference the department
        return error_response(
            "This department is still assigned to one or more employees and cannot be permanently deleted",
            status_code=409
        )

    except pymysql.MySQLError as e:
        print(f"Permanently delete department error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()