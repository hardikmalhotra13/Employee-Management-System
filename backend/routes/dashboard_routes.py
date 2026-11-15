import pymysql
from flask import Blueprint

from database.connection import get_db_connection
from utils.response_helpers import success_response, error_response
from utils.auth_helper import require_auth, require_permission

dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.route("/dashboard/summary", methods=["GET"])
@require_auth
def get_dashboard_summary():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute("SELECT COUNT(*) AS total FROM employees")
        total_employees = cursor.fetchone()["total"]

        cursor.execute("SELECT COUNT(*) AS total FROM employees WHERE status = 'Active'")
        active_employees = cursor.fetchone()["total"]

        cursor.execute("SELECT COUNT(*) AS total FROM departments")
        total_departments = cursor.fetchone()["total"]

        cursor.execute("SELECT COUNT(*) AS total FROM shifts")
        total_shifts = cursor.fetchone()["total"]

        return success_response(data={
            "total_employees": total_employees,
            "active_employees": active_employees,
            "total_departments": total_departments,
            "total_shifts": total_shifts,
        })

    except pymysql.MySQLError as e:
        print(f"Get dashboard summary error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@dashboard_bp.route("/dashboard/charts", methods=["GET"])
@require_auth
def get_dashboard_charts():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(
            """SELECT d.department_name, COUNT(e.employee_id) AS employee_count
               FROM departments d
               LEFT JOIN employees e ON e.department_id = d.department_id
               GROUP BY d.department_id, d.department_name
               ORDER BY d.department_id"""
        )
        employees_by_department = cursor.fetchall()

        cursor.execute("SELECT status, COUNT(*) AS total FROM employees GROUP BY status")
        status_rows = cursor.fetchall()

        active_count = 0
        inactive_count = 0
        for row in status_rows:
            if row["status"] == "Active":
                active_count = row["total"]
            elif row["status"] == "Inactive":
                inactive_count = row["total"]

        cursor.execute(
            """SELECT e.employee_id, e.first_name, e.last_name, e.status,
                      d.department_name, r.role_name
               FROM employees e
               JOIN departments d ON e.department_id = d.department_id
               JOIN roles r ON e.role_id = r.role_id
               ORDER BY e.employee_id DESC
               LIMIT 3"""
        )
        recent_employees = cursor.fetchall()

        return success_response(data={
            "employees_by_department": employees_by_department,
            "active_vs_inactive": {
                "active_count": active_count,
                "inactive_count": inactive_count,
            },
            "recent_employees": recent_employees,
        })

    except pymysql.MySQLError as e:
        print(f"Get dashboard charts error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# How far ahead to look for birthdays/anniversaries. A plain constant is
# enough here - the dashboard has no UI to change this window.
UPCOMING_WINDOW_DAYS = 30


@dashboard_bp.route("/dashboard/upcoming-events", methods=["GET"])
@require_auth
def get_dashboard_upcoming_events():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        # Each employee's birthday this year, rolled forward to next year
        # if it already passed, so days_until is always >= 0.
        cursor.execute(
            f"""SELECT employee_id, first_name, last_name, department_name, days_until
                FROM (
                    SELECT e.employee_id, e.first_name, e.last_name, d.department_name,
                           DATEDIFF(
                               CASE
                                   WHEN DATE_ADD(e.date_of_birth, INTERVAL (YEAR(CURDATE()) - YEAR(e.date_of_birth)) YEAR) >= CURDATE()
                                   THEN DATE_ADD(e.date_of_birth, INTERVAL (YEAR(CURDATE()) - YEAR(e.date_of_birth)) YEAR)
                                   ELSE DATE_ADD(e.date_of_birth, INTERVAL (YEAR(CURDATE()) - YEAR(e.date_of_birth) + 1) YEAR)
                               END,
                               CURDATE()
                           ) AS days_until
                    FROM employees e
                    JOIN departments d ON d.department_id = e.department_id
                    WHERE e.is_archived = FALSE
                ) AS upcoming
                WHERE days_until BETWEEN 0 AND {UPCOMING_WINDOW_DAYS}
                ORDER BY days_until ASC, first_name ASC
                LIMIT 5"""
        )
        upcoming_birthdays = cursor.fetchall()

        # Same idea for joining_date, plus years_of_service for the
        # upcoming occurrence (skip anyone whose first anniversary hasn't
        # happened yet).
        cursor.execute(
            f"""SELECT employee_id, first_name, last_name, department_name, days_until, years_of_service
                FROM (
                    SELECT e.employee_id, e.first_name, e.last_name, d.department_name,
                           DATEDIFF(
                               CASE
                                   WHEN DATE_ADD(e.joining_date, INTERVAL (YEAR(CURDATE()) - YEAR(e.joining_date)) YEAR) >= CURDATE()
                                   THEN DATE_ADD(e.joining_date, INTERVAL (YEAR(CURDATE()) - YEAR(e.joining_date)) YEAR)
                                   ELSE DATE_ADD(e.joining_date, INTERVAL (YEAR(CURDATE()) - YEAR(e.joining_date) + 1) YEAR)
                               END,
                               CURDATE()
                           ) AS days_until,
                           CASE
                               WHEN DATE_ADD(e.joining_date, INTERVAL (YEAR(CURDATE()) - YEAR(e.joining_date)) YEAR) >= CURDATE()
                               THEN YEAR(CURDATE()) - YEAR(e.joining_date)
                               ELSE YEAR(CURDATE()) + 1 - YEAR(e.joining_date)
                           END AS years_of_service
                    FROM employees e
                    JOIN departments d ON d.department_id = e.department_id
                    WHERE e.is_archived = FALSE
                ) AS upcoming
                WHERE days_until BETWEEN 0 AND {UPCOMING_WINDOW_DAYS}
                  AND years_of_service > 0
                ORDER BY days_until ASC, first_name ASC
                LIMIT 5"""
        )
        upcoming_anniversaries = cursor.fetchall()

        return success_response(data={
            "upcoming_birthdays": upcoming_birthdays,
            "upcoming_anniversaries": upcoming_anniversaries,
        })

    except pymysql.MySQLError as e:
        print(f"Get dashboard upcoming events error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@dashboard_bp.route("/dashboard/leave-summary", methods=["GET"])
@require_permission("leave.view")
def get_dashboard_leave_summary():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        # Requests submitted so far this calendar month, grouped by status.
        cursor.execute(
            """SELECT status, COUNT(*) AS total
               FROM leave_requests
               WHERE created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                 AND created_at < DATE_FORMAT(CURDATE() + INTERVAL 1 MONTH, '%Y-%m-01')
               GROUP BY status"""
        )
        rows = cursor.fetchall()

        counts = {"Approved": 0, "Pending": 0, "Rejected": 0, "Cancelled": 0}
        for row in rows:
            if row["status"] in counts:
                counts[row["status"]] = row["total"]

        return success_response(data={
            "total_requests": sum(counts.values()),
            "approved": counts["Approved"],
            "pending": counts["Pending"],
            "rejected": counts["Rejected"],
        })

    except pymysql.MySQLError as e:
        print(f"Get dashboard leave summary error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()