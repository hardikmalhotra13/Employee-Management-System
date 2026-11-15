import pymysql
from datetime import datetime
from flask import Blueprint, request

from database.connection import get_db_connection
from utils.response_helpers import success_response, error_response
from utils.auth_helper import require_employee_auth
from routes.attendance_routes import ATTENDANCE_SELECT, format_attendance_entry
from routes.leave_routes import LEAVE_TYPES, get_quota, compute_used_days
from routes.roster_routes import fetch_employee_today_schedule
from utils.calendar_helper import get_day_info_for

employee_dashboard_bp = Blueprint("employee_dashboard", __name__)

RECENT_NOTIFICATIONS_LIMIT = 5
TEAM_OVERVIEW_LIMIT = 6


@employee_dashboard_bp.route("/employee/dashboard", methods=["GET"])
@require_employee_auth
def get_my_dashboard():
    """
    Consolidated read for the Employee Dashboard: one request instead of
    the ~9 separate calls the page previously made on every mount.
    Reuses the exact same query/business logic each module's own
    endpoint already uses (imported, not re-implemented) so this can't
    drift from what My Attendance / My Leave / etc. show on their own
    pages; only shapes the payload lighter where the dashboard genuinely
    needs less than the full page does (counts/latest-only instead of
    full lists).
    """
    employee_id = request.current_employee["employee_id"]
    today = datetime.now().strftime("%Y-%m-%d")
    year = datetime.now().year

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        # Profile - just what the welcome header needs, lighter than the
        # full department/role/grade/shift/manager join GET /employee/me does.
        cursor.execute(
            "SELECT employee_id, first_name, last_name FROM employees WHERE employee_id = %s",
            (employee_id,)
        )
        profile = cursor.fetchone()

        # Today's attendance row - same select/format as GET /employee/attendance.
        cursor.execute(
            f"{ATTENDANCE_SELECT} WHERE a.employee_id = %s AND a.attendance_date = %s",
            (employee_id, today)
        )
        today_attendance = format_attendance_entry(cursor.fetchone())

        # Leave: balance uses the exact same per-type quota/used calculation as
        # GET /employee/leave/balance. Pending count and "on leave today" are
        # computed directly instead of shipping the full leave request history
        # to the frontend just to derive two numbers from it.
        leave_balance = []
        for leave_type in LEAVE_TYPES:
            quota = get_quota(cursor, leave_type)
            used = compute_used_days(cursor, employee_id, leave_type, year)
            leave_balance.append({
                "leave_type": leave_type,
                "annual_quota": quota,
                "used": used,
                "remaining": quota - used,
            })

        cursor.execute(
            "SELECT COUNT(*) AS count FROM leave_requests WHERE employee_id = %s AND status = 'Pending'",
            (employee_id,)
        )
        pending_leave_count = cursor.fetchone()["count"]

        cursor.execute(
            "SELECT COUNT(*) AS count FROM leave_requests WHERE employee_id = %s AND status = 'Approved' "
            "AND start_date <= %s AND end_date >= %s",
            (employee_id, today, today)
        )
        is_on_leave_today = cursor.fetchone()["count"] > 0

        # Training: assigned/completed counts, same status values used everywhere
        # else in this module ('Assigned', 'Completed').
        cursor.execute(
            "SELECT status, COUNT(*) AS count FROM employee_training_records "
            "WHERE employee_id = %s GROUP BY status",
            (employee_id,)
        )
        training_counts = {row["status"]: row["count"] for row in cursor.fetchall()}

        # Assets: how many are currently assigned, same filter as the
        # current_assets half of GET /employee/assets.
        cursor.execute(
            "SELECT COUNT(*) AS count FROM assets WHERE current_employee_id = %s AND is_archived = FALSE",
            (employee_id,)
        )
        current_assets_count = cursor.fetchone()["count"]

        # Performance: most recent submitted review only, same 'Submitted'-only
        # filter as GET /employee/performance-reviews (Draft reviews stay hidden
        # from the employee there too).
        cursor.execute(
            """SELECT pr.review_id, pr.rating, pr.status, pr.submitted_at, c.cycle_name
               FROM performance_reviews pr
               JOIN review_cycles c ON pr.cycle_id = c.cycle_id
               WHERE pr.employee_id = %s AND pr.status = 'Submitted'
               ORDER BY pr.submitted_at DESC
               LIMIT 1""",
            (employee_id,)
        )
        latest_review = cursor.fetchone()

        # Today's schedule - same roster-override-else-default-shift logic as
        # GET /employee/roster/today (shared helper, not duplicated).
        today_schedule = fetch_employee_today_schedule(cursor, employee_id, today)

        # Recent notifications - same table/ordering as GET /employee/notifications,
        # just capped smaller since this is a preview, not the full list.
        cursor.execute(
            """SELECT notification_id, type, title, message, link, is_read, created_at
               FROM employee_notifications
               WHERE recipient_employee_id = %s
               ORDER BY created_at DESC
               LIMIT %s""",
            (employee_id, RECENT_NOTIFICATIONS_LIMIT)
        )
        recent_notifications = cursor.fetchall()
        for n in recent_notifications:
            n["created_at"] = n["created_at"].strftime("%Y-%m-%d %H:%M:%S")

        # Team - direct reports, lighter than GET /manager/team (no department/
        # shift joins - just role_name and status added on top of the bare
        # name fields, since the Team Overview card shows those too).
        # Visibility of the Team Overview card itself is decided on the
        # frontend by whether this list is non-empty, same rule already used
        # for the sidebar's Team nav.
        cursor.execute(
            "SELECT e.employee_id, e.first_name, e.last_name, e.status, r.role_name FROM employees e "
            "JOIN roles r ON e.role_id = r.role_id "
            "WHERE e.reporting_manager_id = %s AND e.is_archived = FALSE "
            "ORDER BY e.first_name, e.last_name",
            (employee_id,)
        )
        team = cursor.fetchall()

        return success_response(data={
            "profile": profile,
            "today_attendance": today_attendance,
            "leave_balance": leave_balance,
            "pending_leave_count": pending_leave_count,
            "is_on_leave_today": is_on_leave_today,
            "training_assigned_count": training_counts.get("Assigned", 0),
            "training_completed_count": training_counts.get("Completed", 0),
            "current_assets_count": current_assets_count,
            "latest_review": latest_review,
            "today_schedule": today_schedule,
            "today_day": get_day_info_for(cursor, today),
            "recent_notifications": recent_notifications,
            "team_count": len(team),
            "team_preview": team[:TEAM_OVERVIEW_LIMIT],
        })

    except pymysql.MySQLError as e:
        print(f"Get my dashboard error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()