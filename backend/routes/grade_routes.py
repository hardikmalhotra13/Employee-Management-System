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

grade_bp = Blueprint("grade", __name__)

VALID_STATUSES = ("Active", "Inactive")
VALID_GRADES = ("A", "B", "C", "D")


@grade_bp.route("/grades", methods=["GET"])
@require_permission("grades.view")
def get_grades():
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
        cursor.execute(f"SELECT COUNT(*) AS total FROM grades {where_clause}")
        total = cursor.fetchone()["total"]

        cursor.execute(
            f"SELECT * FROM grades {where_clause} ORDER BY grade_id DESC LIMIT %s OFFSET %s",
            (page_size, offset)
        )
        grades = cursor.fetchall()

        return success_response(data={
            "records": grades,
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get grades error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@grade_bp.route("/grades/<int:grade_id>", methods=["GET"])
@require_permission("grades.view")
def get_grade(grade_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM grades WHERE grade_id = %s", (grade_id,))
        grade = cursor.fetchone()

        if not grade:
            return not_found_response("Grade not found")

        return success_response(data=grade)

    except pymysql.MySQLError as e:
        print(f"Get grade error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@grade_bp.route("/grades", methods=["POST"])
@require_permission("grades.create")
def create_grade():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    grade_name = data.get("grade_name")
    status = data.get("status", "Active")

    errors = {}
    if not grade_name or grade_name not in VALID_GRADES:
        errors["grade_name"] = "Grade name must be one of A, B, C, D"
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

        # grade_code is system-generated and never accepted from the client
        cursor.execute("SELECT MAX(grade_id) AS max_id FROM grades")
        max_id = cursor.fetchone()["max_id"] or 0
        grade_code = f"GRD{max_id + 1:04d}"

        cursor.execute(
            "INSERT INTO grades (grade_code, grade_name, status) VALUES (%s, %s, %s)",
            (grade_code, grade_name, status)
        )
        log_action(cursor, request.current_admin["admin_id"], "create", "grade", cursor.lastrowid)
        connection.commit()

        cursor.execute("SELECT * FROM grades WHERE grade_id = %s", (cursor.lastrowid,))
        grade = cursor.fetchone()

        return created_response("Grade created successfully", data=grade)

    except pymysql.err.IntegrityError:
        return error_response("Grade name already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create grade error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@grade_bp.route("/grades/<int:grade_id>", methods=["PUT"])
@require_permission("grades.update")
def update_grade(grade_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    grade_name = data.get("grade_name")
    status = data.get("status")

    errors = {}
    if not grade_name or grade_name not in VALID_GRADES:
        errors["grade_name"] = "Grade name must be one of A, B, C, D"
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
        cursor.execute("SELECT * FROM grades WHERE grade_id = %s", (grade_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Grade not found")

        # grade_code is never updated here, only name and status
        cursor.execute(
            "UPDATE grades SET grade_name = %s, status = %s WHERE grade_id = %s",
            (grade_name, status, grade_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "grade", grade_id)
        connection.commit()

        cursor.execute("SELECT * FROM grades WHERE grade_id = %s", (grade_id,))
        grade = cursor.fetchone()

        return success_response("Grade updated successfully", data=grade)

    except pymysql.err.IntegrityError:
        return error_response("Grade name already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Update grade error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@grade_bp.route("/grades/<int:grade_id>", methods=["DELETE"])
@require_permission("grades.archive")
def delete_grade(grade_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM grades WHERE grade_id = %s", (grade_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Grade not found")

        # Grades are archived rather than deleted, so existing employee
        # references are unaffected and the record can be restored later.
        cursor.execute("UPDATE grades SET is_archived = TRUE WHERE grade_id = %s", (grade_id,))
        log_action(cursor, request.current_admin["admin_id"], "archive", "grade", grade_id)
        connection.commit()

        return success_response("Grade archived successfully")

    except pymysql.MySQLError as e:
        print(f"Archive grade error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@grade_bp.route("/grades/<int:grade_id>/restore", methods=["PUT"])
@require_permission("grades.restore")
def restore_grade(grade_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM grades WHERE grade_id = %s", (grade_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Grade not found")

        if not existing["is_archived"]:
            return error_response("Grade is not archived", status_code=400)

        cursor.execute("UPDATE grades SET is_archived = FALSE WHERE grade_id = %s", (grade_id,))
        log_action(cursor, request.current_admin["admin_id"], "restore", "grade", grade_id)
        connection.commit()

        cursor.execute("SELECT * FROM grades WHERE grade_id = %s", (grade_id,))
        grade = cursor.fetchone()

        return success_response("Grade restored successfully", data=grade)

    except pymysql.MySQLError as e:
        print(f"Restore grade error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@grade_bp.route("/grades/<int:grade_id>/permanent", methods=["DELETE"])
@require_permission("grades.delete")
def permanently_delete_grade(grade_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM grades WHERE grade_id = %s", (grade_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Grade not found")

        if not existing["is_archived"]:
            return error_response("Only archived grades can be permanently deleted", status_code=400)

        cursor.execute("DELETE FROM grades WHERE grade_id = %s", (grade_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "grade", grade_id,
            details=existing["grade_name"]
        )
        connection.commit()

        return success_response("Grade permanently deleted")

    except pymysql.err.IntegrityError:
        # ON DELETE RESTRICT blocks this if employees still reference the grade
        return error_response(
            "This grade is still assigned to one or more employees and cannot be permanently deleted",
            status_code=409
        )

    except pymysql.MySQLError as e:
        print(f"Permanently delete grade error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()