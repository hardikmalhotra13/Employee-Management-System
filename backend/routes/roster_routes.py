from datetime import datetime, timedelta

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
from utils.auth_helper import require_permission, require_employee_auth
from utils.audit_helper import log_action
from routes.shift_routes import format_time
from utils.calendar_helper import load_exceptions, get_day_info
from utils.validation_helper import is_valid_id, parse_date_str

roster_bp = Blueprint("roster", __name__)

ROSTER_SELECT = """
    SELECT r.roster_id, r.employee_id, r.shift_id, r.roster_date,
           e.employee_code, e.first_name, e.last_name,
           d.department_id, d.department_name,
           s.shift_name, s.start_time, s.end_time
    FROM shift_rosters r
    JOIN employees e ON r.employee_id = e.employee_id
    JOIN departments d ON e.department_id = d.department_id
    JOIN shifts s ON r.shift_id = s.shift_id
"""


def format_roster_entry(entry):
    if entry:
        if entry.get("roster_date"):
            entry["roster_date"] = entry["roster_date"].strftime("%Y-%m-%d")
        entry["start_time"] = format_time(entry["start_time"])
        entry["end_time"] = format_time(entry["end_time"])
    return entry


def fetch_roster_entry(cursor, roster_id):
    cursor.execute(f"{ROSTER_SELECT} WHERE r.roster_id = %s", (roster_id,))
    return format_roster_entry(cursor.fetchone())


def get_employee_record(cursor, employee_id):
    cursor.execute(
        "SELECT employee_id, department_id, is_archived, status FROM employees WHERE employee_id = %s",
        (employee_id,)
    )
    return cursor.fetchone()


def get_shift_record(cursor, shift_id):
    cursor.execute(
        "SELECT shift_id, is_archived, status FROM shifts WHERE shift_id = %s",
        (shift_id,)
    )
    return cursor.fetchone()


@roster_bp.route("/roster", methods=["GET"])
@require_permission("roster.view")
def get_roster():
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    department_id = request.args.get("department_id", type=int)
    employee_id = request.args.get("employee_id", type=int)

    errors = {}
    if not start_date:
        errors["start_date"] = "start_date is required"
    if not end_date:
        errors["end_date"] = "end_date is required"

    if errors:
        return validation_error_response(errors)

    conditions = ["r.roster_date BETWEEN %s AND %s"]
    params = [start_date, end_date]

    if department_id:
        conditions.append("e.department_id = %s")
        params.append(department_id)

    if employee_id:
        conditions.append("r.employee_id = %s")
        params.append(employee_id)

    where_clause = "WHERE " + " AND ".join(conditions)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            f"{ROSTER_SELECT} {where_clause} ORDER BY r.roster_date, e.first_name, e.last_name",
            params
        )
        entries = cursor.fetchall()

        return success_response(data=[format_roster_entry(e) for e in entries])

    except pymysql.MySQLError as e:
        print(f"Get roster error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@roster_bp.route("/roster", methods=["POST"])
@require_permission("roster.create")
def create_roster_entry():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return error_response("Invalid request body", status_code=400)

    employee_id = data.get("employee_id")
    shift_id = data.get("shift_id")
    roster_date = data.get("roster_date")

    errors = {}
    if not employee_id:
        errors["employee_id"] = "Employee is required"
    elif not is_valid_id(employee_id):
        errors["employee_id"] = "Employee is invalid"
    if not shift_id:
        errors["shift_id"] = "Shift is required"
    elif not is_valid_id(shift_id):
        errors["shift_id"] = "Shift is invalid"
    if not roster_date:
        errors["roster_date"] = "Date is required"
    elif parse_date_str(roster_date) is None:
        errors["roster_date"] = "Date must be a valid date in YYYY-MM-DD format"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        employee = get_employee_record(cursor, employee_id)
        if not employee:
            return error_response("Selected employee does not exist", status_code=400)
        if employee["is_archived"]:
            return error_response("Selected employee is archived", status_code=400)
        if employee["status"] == "Inactive":
            return error_response("Selected employee is inactive", status_code=400)

        shift = get_shift_record(cursor, shift_id)
        if not shift:
            return error_response("Selected shift does not exist", status_code=400)
        if shift["is_archived"]:
            return error_response("Selected shift is archived", status_code=400)
        if shift["status"] == "Inactive":
            return error_response("Selected shift is inactive", status_code=400)

        cursor.execute(
            "SELECT roster_id FROM shift_rosters WHERE employee_id = %s AND roster_date = %s",
            (employee_id, roster_date)
        )
        if cursor.fetchone():
            return validation_error_response(
                {"roster_date": "This employee already has a shift assigned on this date"}
            )

        cursor.execute(
            "INSERT INTO shift_rosters (employee_id, shift_id, roster_date) VALUES (%s, %s, %s)",
            (employee_id, shift_id, roster_date)
        )
        log_action(cursor, request.current_admin["admin_id"], "create", "roster", cursor.lastrowid)
        connection.commit()

        return created_response("Shift assigned successfully", data=fetch_roster_entry(cursor, cursor.lastrowid))

    except pymysql.err.IntegrityError:
        return error_response("This employee already has a shift assigned on this date", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create roster entry error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@roster_bp.route("/roster/<int:roster_id>", methods=["PUT"])
@require_permission("roster.update")
def update_roster_entry(roster_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return error_response("Invalid request body", status_code=400)

    shift_id = data.get("shift_id")
    roster_date = data.get("roster_date")

    errors = {}
    if not shift_id:
        errors["shift_id"] = "Shift is required"
    elif not is_valid_id(shift_id):
        errors["shift_id"] = "Shift is invalid"
    if not roster_date:
        errors["roster_date"] = "Date is required"
    elif parse_date_str(roster_date) is None:
        errors["roster_date"] = "Date must be a valid date in YYYY-MM-DD format"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM shift_rosters WHERE roster_id = %s", (roster_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Roster entry not found")

        shift = get_shift_record(cursor, shift_id)
        if not shift:
            return error_response("Selected shift does not exist", status_code=400)
        if shift["is_archived"]:
            return error_response("Selected shift is archived", status_code=400)

        # An edit that changes the shift or the date is a new assignment, so it must meet the
        # same eligibility rules as creating one. An edit that changes nothing is left alone, and
        # entries already on the roster stay visible if the employee or shift later goes Inactive.
        if int(shift_id) != existing["shift_id"] or parse_date_str(roster_date) != existing["roster_date"]:
            employee = get_employee_record(cursor, existing["employee_id"])
            if employee and employee["is_archived"]:
                return error_response("Selected employee is archived", status_code=400)
            if employee and employee["status"] == "Inactive":
                return error_response("Selected employee is inactive", status_code=400)
            if shift["status"] == "Inactive":
                return error_response("Selected shift is inactive", status_code=400)

        # employee_id is not editable here - reassigning to a different
        # employee is a different assignment, not an edit of this one.
        cursor.execute(
            "SELECT roster_id FROM shift_rosters WHERE employee_id = %s AND roster_date = %s AND roster_id != %s",
            (existing["employee_id"], roster_date, roster_id)
        )
        if cursor.fetchone():
            return validation_error_response(
                {"roster_date": "This employee already has a shift assigned on this date"}
            )

        cursor.execute(
            "UPDATE shift_rosters SET shift_id = %s, roster_date = %s WHERE roster_id = %s",
            (shift_id, roster_date, roster_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "roster", roster_id)
        connection.commit()

        return success_response("Roster entry updated successfully", data=fetch_roster_entry(cursor, roster_id))

    except pymysql.err.IntegrityError:
        return error_response("This employee already has a shift assigned on this date", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Update roster entry error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@roster_bp.route("/roster/<int:roster_id>", methods=["DELETE"])
@require_permission("roster.delete")
def delete_roster_entry(roster_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM shift_rosters WHERE roster_id = %s", (roster_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Roster entry not found")

        # Roster entries are hard-deleted, not archived - see schema comment.
        cursor.execute("DELETE FROM shift_rosters WHERE roster_id = %s", (roster_id,))
        log_action(cursor, request.current_admin["admin_id"], "delete", "roster", roster_id)
        connection.commit()

        return success_response("Roster entry removed successfully")

    except pymysql.MySQLError as e:
        print(f"Delete roster entry error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@roster_bp.route("/roster/bulk", methods=["POST"])
@require_permission("roster.create")
def bulk_assign_roster():
    """
    Assigns one shift to either a single employee or every active (not archived,
    not Inactive) employee in a department, across a date range. Existing assignments are never
    overwritten - any employee+date combination that already has a roster
    entry is skipped, and the response summarizes how many were assigned
    versus skipped so the admin can see exactly what happened.

    Non-working days (a default Saturday/Sunday not overridden as a working
    day, or an office holiday) are skipped too and reported separately.
    A shift can still be assigned on such a day one at a time through
    POST /roster when it is genuinely needed.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return error_response("Invalid request body", status_code=400)

    shift_id = data.get("shift_id")
    start_date = data.get("start_date")
    end_date = data.get("end_date")
    employee_id = data.get("employee_id")
    department_id = data.get("department_id")

    errors = {}
    if not shift_id:
        errors["shift_id"] = "Shift is required"
    if not start_date:
        errors["start_date"] = "Start date is required"
    if not end_date:
        errors["end_date"] = "End date is required"
    if not employee_id and not department_id:
        errors["employee_id"] = "Provide either an employee or a department"
    if employee_id and department_id:
        errors["employee_id"] = "Provide only one of employee or department, not both"
    if shift_id and not is_valid_id(shift_id):
        errors["shift_id"] = "Shift is invalid"
    if employee_id and "employee_id" not in errors and not is_valid_id(employee_id):
        errors["employee_id"] = "Employee is invalid"
    if department_id and "employee_id" not in errors and not is_valid_id(department_id):
        errors["department_id"] = "Department is invalid"

    if errors:
        return validation_error_response(errors)

    start = parse_date_str(start_date)
    end = parse_date_str(end_date)
    if start is None or end is None:
        return validation_error_response({"start_date": "Dates must be in YYYY-MM-DD format"})

    if end < start:
        return validation_error_response({"end_date": "End date cannot be before start date"})

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        shift = get_shift_record(cursor, shift_id)
        if not shift:
            return error_response("Selected shift does not exist", status_code=400)
        if shift["is_archived"]:
            return error_response("Selected shift is archived", status_code=400)
        if shift["status"] == "Inactive":
            return error_response("Selected shift is inactive", status_code=400)

        if employee_id:
            employee = get_employee_record(cursor, employee_id)
            if not employee:
                return error_response("Selected employee does not exist", status_code=400)
            if employee["is_archived"]:
                return error_response("Selected employee is archived", status_code=400)
            if employee["status"] == "Inactive":
                return error_response("Selected employee is inactive", status_code=400)

            cursor.execute(
                "SELECT employee_id, first_name, last_name FROM employees WHERE employee_id = %s",
                (employee_id,)
            )
            target_employees = cursor.fetchall()

        else:
            cursor.execute(
                "SELECT department_id, is_archived FROM departments WHERE department_id = %s",
                (department_id,)
            )
            department = cursor.fetchone()

            if not department:
                return error_response("Selected department does not exist", status_code=400)
            if department["is_archived"]:
                return error_response("Selected department is archived", status_code=400)

            cursor.execute(
                "SELECT employee_id, first_name, last_name FROM employees "
                "WHERE department_id = %s AND is_archived = FALSE AND status != 'Inactive'",
                (department_id,)
            )
            target_employees = cursor.fetchall()

        if not target_employees:
            return error_response("No active employees found to assign", status_code=400)

        dates = []
        current = start
        while current <= end:
            dates.append(current.strftime("%Y-%m-%d"))
            current += timedelta(days=1)

        exceptions = load_exceptions(cursor, start, end)
        working_dates = [d for d in dates if get_day_info(d, exceptions)["is_working_day"]]
        skipped_non_working_dates = [d for d in dates if d not in working_dates]

        employee_ids = [e["employee_id"] for e in target_employees]
        placeholders = ",".join(["%s"] * len(employee_ids))
        cursor.execute(
            f"SELECT employee_id, roster_date FROM shift_rosters "
            f"WHERE employee_id IN ({placeholders}) AND roster_date BETWEEN %s AND %s",
            employee_ids + [start_date, end_date]
        )
        existing_pairs = {
            (row["employee_id"], row["roster_date"].strftime("%Y-%m-%d"))
            for row in cursor.fetchall()
        }

        assigned_count = 0
        skipped = []

        for employee in target_employees:
            for date_str in working_dates:
                if (employee["employee_id"], date_str) in existing_pairs:
                    skipped.append({
                        "employee_id": employee["employee_id"],
                        "first_name": employee["first_name"],
                        "last_name": employee["last_name"],
                        "roster_date": date_str,
                    })
                    continue

                cursor.execute(
                    "INSERT INTO shift_rosters (employee_id, shift_id, roster_date) VALUES (%s, %s, %s)",
                    (employee["employee_id"], shift_id, date_str)
                )
                assigned_count += 1

        log_action(
            cursor, request.current_admin["admin_id"], "create", "roster", 0,
            details=(
                f"Bulk assign: {assigned_count} created, {len(skipped)} skipped, "
                f"{len(skipped_non_working_dates)} weekend/holiday date(s) skipped"
            )
        )
        connection.commit()

        message = f"{assigned_count} shift(s) assigned, {len(skipped)} skipped (already scheduled)"
        if skipped_non_working_dates:
            message += f", {len(skipped_non_working_dates)} weekend/holiday date(s) skipped"

        return created_response(
            message,
            data={
                "assigned": assigned_count,
                "skipped": len(skipped),
                "skipped_details": skipped,
                "skipped_non_working_dates": skipped_non_working_dates,
            }
        )

    except pymysql.MySQLError as e:
        print(f"Bulk assign roster error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


def fetch_employee_today_schedule(cursor, employee_id, today):
    """
    Shared by the standalone GET /employee/roster/today endpoint and the
    consolidated GET /employee/dashboard endpoint, so the override/
    fallback logic lives in exactly one place. Returns None if the
    employee has no shift on record at all.
    """
    cursor.execute(
        """SELECT s.shift_name, s.start_time, s.end_time
           FROM shift_rosters r
           JOIN shifts s ON r.shift_id = s.shift_id
           WHERE r.employee_id = %s AND r.roster_date = %s""",
        (employee_id, today)
    )
    schedule = cursor.fetchone()
    is_override = schedule is not None

    if not schedule:
        cursor.execute(
            """SELECT s.shift_name, s.start_time, s.end_time
               FROM employees e
               JOIN shifts s ON e.shift_id = s.shift_id
               WHERE e.employee_id = %s""",
            (employee_id,)
        )
        schedule = cursor.fetchone()

    if not schedule:
        return None

    schedule["start_time"] = format_time(schedule["start_time"])
    schedule["end_time"] = format_time(schedule["end_time"])
    schedule["is_override"] = is_override

    return schedule


@roster_bp.route("/employee/roster/today", methods=["GET"])
@require_employee_auth
def get_my_today_roster():
    """
    The employee dashboard's "Today's Schedule": today's shift_rosters
    override if one exists for this employee, otherwise their default
    shift from employees.shift_id. No schema change - just reads the
    two sources that already exist and picks whichever is more specific.
    """
    employee_id = request.current_employee["employee_id"]
    today = datetime.now().strftime("%Y-%m-%d")

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        schedule = fetch_employee_today_schedule(cursor, employee_id, today)
        return success_response(data=schedule)

    except pymysql.MySQLError as e:
        print(f"Get my today roster error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()