from datetime import timedelta

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

shift_bp = Blueprint("shift", __name__)

VALID_STATUSES = ("Active", "Inactive")


def format_time(value):
    if isinstance(value, timedelta):
        total_seconds = int(value.total_seconds())
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return value


def format_shift(shift):
    if shift:
        shift["start_time"] = format_time(shift["start_time"])
        shift["end_time"] = format_time(shift["end_time"])
    return shift


@shift_bp.route("/shifts", methods=["GET"])
@require_permission("shifts.view")
def get_shifts():
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
        cursor.execute(f"SELECT COUNT(*) AS total FROM shifts {where_clause}")
        total = cursor.fetchone()["total"]

        cursor.execute(
            f"SELECT * FROM shifts {where_clause} ORDER BY shift_id DESC LIMIT %s OFFSET %s",
            (page_size, offset)
        )
        shifts = cursor.fetchall()
        shifts = [format_shift(shift) for shift in shifts]

        return success_response(data={
            "records": shifts,
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get shifts error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@shift_bp.route("/shifts/<int:shift_id>", methods=["GET"])
@require_permission("shifts.view")
def get_shift(shift_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM shifts WHERE shift_id = %s", (shift_id,))
        shift = cursor.fetchone()

        if not shift:
            return not_found_response("Shift not found")

        return success_response(data=format_shift(shift))

    except pymysql.MySQLError as e:
        print(f"Get shift error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@shift_bp.route("/shifts", methods=["POST"])
@require_permission("shifts.create")
def create_shift():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    shift_name = data.get("shift_name")
    start_time = data.get("start_time")
    end_time = data.get("end_time")
    status = data.get("status", "Active")

    errors = {}
    if not shift_name or not shift_name.strip():
        errors["shift_name"] = "Shift name is required"
    if not start_time:
        errors["start_time"] = "Start time is required"
    if not end_time:
        errors["end_time"] = "End time is required"
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

        # shift_code is system-generated and never accepted from the client
        cursor.execute("SELECT MAX(shift_id) AS max_id FROM shifts")
        max_id = cursor.fetchone()["max_id"] or 0
        shift_code = f"SHF{max_id + 1:04d}"

        cursor.execute(
            "INSERT INTO shifts (shift_code, shift_name, start_time, end_time, status) VALUES (%s, %s, %s, %s, %s)",
            (shift_code, shift_name.strip(), start_time, end_time, status)
        )
        log_action(cursor, request.current_admin["admin_id"], "create", "shift", cursor.lastrowid)
        connection.commit()

        cursor.execute("SELECT * FROM shifts WHERE shift_id = %s", (cursor.lastrowid,))
        shift = cursor.fetchone()

        return created_response("Shift created successfully", data=format_shift(shift))

    except pymysql.err.IntegrityError:
        return error_response("Shift name already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create shift error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@shift_bp.route("/shifts/<int:shift_id>", methods=["PUT"])
@require_permission("shifts.update")
def update_shift(shift_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    shift_name = data.get("shift_name")
    start_time = data.get("start_time")
    end_time = data.get("end_time")
    status = data.get("status")

    errors = {}
    if not shift_name or not shift_name.strip():
        errors["shift_name"] = "Shift name is required"
    if not start_time:
        errors["start_time"] = "Start time is required"
    if not end_time:
        errors["end_time"] = "End time is required"
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
        cursor.execute("SELECT * FROM shifts WHERE shift_id = %s", (shift_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Shift not found")

        # shift_code is never updated here, only name, timings and status
        cursor.execute(
            "UPDATE shifts SET shift_name = %s, start_time = %s, end_time = %s, status = %s WHERE shift_id = %s",
            (shift_name.strip(), start_time, end_time, status, shift_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "shift", shift_id)
        connection.commit()

        cursor.execute("SELECT * FROM shifts WHERE shift_id = %s", (shift_id,))
        shift = cursor.fetchone()

        return success_response("Shift updated successfully", data=format_shift(shift))

    except pymysql.err.IntegrityError:
        return error_response("Shift name already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Update shift error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@shift_bp.route("/shifts/<int:shift_id>", methods=["DELETE"])
@require_permission("shifts.archive")
def delete_shift(shift_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM shifts WHERE shift_id = %s", (shift_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Shift not found")

        # Shifts are archived rather than deleted, so existing employee
        # references are unaffected and the record can be restored later.
        cursor.execute("UPDATE shifts SET is_archived = TRUE WHERE shift_id = %s", (shift_id,))
        log_action(cursor, request.current_admin["admin_id"], "archive", "shift", shift_id)
        connection.commit()

        return success_response("Shift archived successfully")

    except pymysql.MySQLError as e:
        print(f"Archive shift error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@shift_bp.route("/shifts/<int:shift_id>/restore", methods=["PUT"])
@require_permission("shifts.restore")
def restore_shift(shift_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM shifts WHERE shift_id = %s", (shift_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Shift not found")

        if not existing["is_archived"]:
            return error_response("Shift is not archived", status_code=400)

        cursor.execute("UPDATE shifts SET is_archived = FALSE WHERE shift_id = %s", (shift_id,))
        log_action(cursor, request.current_admin["admin_id"], "restore", "shift", shift_id)
        connection.commit()

        cursor.execute("SELECT * FROM shifts WHERE shift_id = %s", (shift_id,))
        shift = cursor.fetchone()

        return success_response("Shift restored successfully", data=format_shift(shift))

    except pymysql.MySQLError as e:
        print(f"Restore shift error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@shift_bp.route("/shifts/<int:shift_id>/permanent", methods=["DELETE"])
@require_permission("shifts.delete")
def permanently_delete_shift(shift_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM shifts WHERE shift_id = %s", (shift_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Shift not found")

        if not existing["is_archived"]:
            return error_response("Only archived shifts can be permanently deleted", status_code=400)

        cursor.execute("DELETE FROM shifts WHERE shift_id = %s", (shift_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "shift", shift_id,
            details=existing["shift_name"]
        )
        connection.commit()

        return success_response("Shift permanently deleted")

    except pymysql.err.IntegrityError:
        # ON DELETE RESTRICT blocks this if employees still reference the shift
        return error_response(
            "This shift is still assigned to one or more employees and cannot be permanently deleted",
            status_code=409
        )

    except pymysql.MySQLError as e:
        print(f"Permanently delete shift error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()