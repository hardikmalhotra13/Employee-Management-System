import pymysql
from datetime import datetime
from flask import Blueprint, request

from database.connection import get_db_connection
from utils.auth_helper import require_employee_auth
from utils.response_helpers import success_response, error_response, not_found_response
from routes.attendance_routes import earliest_allowed_history_date

manager_bp = Blueprint("manager", __name__)


@manager_bp.route("/manager/team", methods=["GET"])
@require_employee_auth
def get_my_team():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """SELECT e.employee_id, e.employee_code, e.first_name, e.last_name,
                      e.email, e.status,
                      d.department_name, r.role_name, s.shift_id, s.shift_name
               FROM employees e
               JOIN departments d ON e.department_id = d.department_id
               JOIN roles r ON e.role_id = r.role_id
               JOIN shifts s ON e.shift_id = s.shift_id
               WHERE e.reporting_manager_id = %s AND e.is_archived = FALSE
               ORDER BY e.first_name, e.last_name""",
            (request.current_employee["employee_id"],)
        )
        team = cursor.fetchall()

        return success_response(data=team)

    except pymysql.MySQLError as e:
        print(f"Get my team error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@manager_bp.route("/manager/team/<int:employee_id>", methods=["GET"])
@require_employee_auth
def get_team_member(employee_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        # reporting_manager_id = the logged-in employee is both the
        # existence check and the authorization check in one - if this
        # employee doesn't report to them, it's treated as not found
        # rather than forbidden, so the id's existence isn't confirmed.
        cursor.execute(
            """SELECT e.employee_id, e.employee_code, e.first_name, e.last_name, e.email, e.phone,
                      e.address, e.gender, e.date_of_birth, e.joining_date, e.status,
                      d.department_name, r.role_name, g.grade_name, s.shift_name,
                      m.first_name AS manager_first_name, m.last_name AS manager_last_name
               FROM employees e
               JOIN departments d ON e.department_id = d.department_id
               JOIN roles r ON e.role_id = r.role_id
               JOIN grades g ON e.grade_id = g.grade_id
               JOIN shifts s ON e.shift_id = s.shift_id
               LEFT JOIN employees m ON e.reporting_manager_id = m.employee_id
               WHERE e.employee_id = %s AND e.reporting_manager_id = %s AND e.is_archived = FALSE""",
            (employee_id, request.current_employee["employee_id"])
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
        print(f"Get team member error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@manager_bp.route("/manager/team/shifts", methods=["GET"])
@require_employee_auth
def get_team_shift_options():
    """
    Shift filter options for Team Attendance. Deliberately not just each
    team member's default employees.shift_id - a roster override can put
    someone on a different shift for a given date, and that's exactly
    what actually gets snapshotted onto their attendance row (shift_id),
    the same field the attendance table/filter is matched against. So
    this returns the union of default shifts and any roster-assigned
    shifts for the team within the visible 2-month history window, not
    only default-shift data.
    """
    manager_id = request.current_employee["employee_id"]
    earliest_allowed = earliest_allowed_history_date()

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """SELECT DISTINCT s.shift_id, s.shift_name
               FROM shifts s
               WHERE s.shift_id IN (
                   SELECT e.shift_id FROM employees e
                   WHERE e.reporting_manager_id = %s AND e.is_archived = FALSE
                   UNION
                   SELECT r.shift_id FROM shift_rosters r
                   JOIN employees e ON r.employee_id = e.employee_id
                   WHERE e.reporting_manager_id = %s AND e.is_archived = FALSE
                     AND r.roster_date >= %s
               )
               ORDER BY s.shift_name""",
            (manager_id, manager_id, earliest_allowed)
        )
        shifts = cursor.fetchall()

        return success_response(data=shifts)

    except pymysql.MySQLError as e:
        print(f"Get team shift options error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()