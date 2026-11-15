import math
import pymysql
from datetime import datetime, timedelta
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
from utils.notification_helper import create_notification, notify_all_admins
from utils.email_sender import send_email
from utils.calendar_helper import load_exceptions, get_day_info, get_day_info_for, count_working_days
from utils.attendance_audit_helper import (
    is_system_generated_absent,
    leave_row_origin,
    LEAVE_CREATED_DETAILS,
    LEAVE_RELABELED_DETAILS,
    LEAVE_RESTORED_DETAILS,
    LEAVE_REMOVED_DETAILS,
)
from config import settings

leave_bp = Blueprint("leave", __name__)

LEAVE_TYPES = ("CL", "EL")

# leave_quotas.annual_quota is DECIMAL(4,1), so 999.9 is the largest value it can store.
MAX_ANNUAL_QUOTA = 999.9
LEAVE_STATUSES = ("Pending", "Approved", "Rejected", "Cancelled")

LEAVE_SELECT = """
    SELECT l.leave_request_id, l.employee_id, l.leave_type, l.start_date, l.end_date, l.is_half_day,
           l.half_day_period, l.reason, l.status, l.rejection_reason,
           l.reviewed_by_employee_id, l.reviewed_by_admin_id, l.reviewed_at, l.created_at,
           e.employee_code, e.first_name, e.last_name, e.department_id, d.department_name,
           rm.first_name AS reviewer_employee_first_name, rm.last_name AS reviewer_employee_last_name,
           ra.name AS reviewer_admin_name
    FROM leave_requests l
    JOIN employees e ON l.employee_id = e.employee_id
    JOIN departments d ON e.department_id = d.department_id
    LEFT JOIN employees rm ON l.reviewed_by_employee_id = rm.employee_id
    LEFT JOIN admins ra ON l.reviewed_by_admin_id = ra.admin_id
"""


def format_leave_entry(entry):
    if entry:
        if entry.get("start_date"):
            entry["start_date"] = entry["start_date"].strftime("%Y-%m-%d")
        if entry.get("end_date"):
            entry["end_date"] = entry["end_date"].strftime("%Y-%m-%d")
        if entry.get("reviewed_at"):
            entry["reviewed_at"] = entry["reviewed_at"].strftime("%Y-%m-%d %H:%M:%S")
    return entry


def fetch_leave_entry(cursor, leave_request_id):
    cursor.execute(f"{LEAVE_SELECT} WHERE l.leave_request_id = %s", (leave_request_id,))
    return format_leave_entry(cursor.fetchone())


def get_employee_record(cursor, employee_id, for_update=False):
    """for_update=True takes a row lock held until the transaction ends, used to
    serialise requests that must not run at the same time for one employee."""
    cursor.execute(
        "SELECT employee_id, reporting_manager_id, is_archived, status, email, first_name, last_name "
        "FROM employees WHERE employee_id = %s" + (" FOR UPDATE" if for_update else ""),
        (employee_id,)
    )
    return cursor.fetchone()


def get_quota(cursor, leave_type):
    cursor.execute("SELECT annual_quota FROM leave_quotas WHERE leave_type = %s", (leave_type,))
    row = cursor.fetchone()
    return float(row["annual_quota"]) if row else 0.0


def day_count(cursor, start_date, end_date, is_half_day):
    """
    Leave days actually charged: Saturdays/Sundays (unless overridden as
    working days) and office holidays inside the range are not counted.
    A half-day request on a non-working day counts as 0. This is derived
    on every read, so adding or removing a holiday immediately changes
    the balance of requests that span it; no stored leave data is edited.
    """
    start = datetime.strptime(start_date, "%Y-%m-%d").date() if isinstance(start_date, str) else start_date
    end = datetime.strptime(end_date, "%Y-%m-%d").date() if isinstance(end_date, str) else end_date
    if is_half_day:
        return 0.5 if get_day_info_for(cursor, start)["is_working_day"] else 0
    return count_working_days(cursor, start, end)


def annotate_leave_days(cursor, entries):
    """Adds leave_days (days actually charged) to each formatted leave entry for the Duration column."""
    for entry in entries:
        entry["leave_days"] = day_count(cursor, entry["start_date"], entry["end_date"], entry["is_half_day"])
    return entries


def compute_used_days(cursor, employee_id, leave_type, year, statuses=("Pending", "Approved")):
    """
    Approved + Pending both count against the balance by default, per
    decision - so submitting doesn't let an employee over-commit while
    requests are still awaiting review. Scoped to start_date's year (a
    request spanning a year boundary is credited to its start year).
    `statuses` lets a caller ask for just one of the two (e.g. the balance
    card's separate Used/Pending figures) without changing this default.
    """
    placeholders = ", ".join(["%s"] * len(statuses))
    cursor.execute(
        f"""SELECT start_date, end_date, is_half_day FROM leave_requests
           WHERE employee_id = %s AND leave_type = %s AND status IN ({placeholders})
             AND YEAR(start_date) = %s""",
        (employee_id, leave_type, *statuses, year)
    )
    return sum(day_count(cursor, row["start_date"], row["end_date"], row["is_half_day"]) for row in cursor.fetchall())


def overlaps(cursor, employee_id, start_date, end_date, exclude_id=None):
    query = (
        "SELECT leave_request_id FROM leave_requests "
        "WHERE employee_id = %s AND status IN ('Pending', 'Approved') "
        "AND start_date <= %s AND end_date >= %s"
    )
    params = [employee_id, end_date, start_date]

    if exclude_id:
        query += " AND leave_request_id != %s"
        params.append(exclude_id)

    cursor.execute(query, params)
    return cursor.fetchone() is not None


def apply_leave_to_attendance(cursor, leave):
    """
    Creates attendance rows for the WORKING dates in the leave's range
    (weekends/holidays are skipped) with 'Absent' (full-day) or 'Half Day'
    (single-day half), tagging each row with leave_request_id.

    An existing row is only ever relabelled when it is PROVABLY system-generated:
    an auto-marked Absent that nobody has touched (see attendance_audit_helper).
    Everything else is left exactly as it is, so approving a leave can never
    overwrite attendance a person recorded:
      - a row with a real check_in_time (the employee genuinely attended),
      - a manually recorded Absent / Half Day (or any status) without a check-in,
      - a row whose audit history is missing or unclear,
      - a row already linked to a leave request.
    Each row this function creates or relabels is audited with a marker so that
    remove_leave_from_attendance can later undo exactly that and nothing else.
    """
    status = "Half Day" if leave["is_half_day"] else "Absent"
    current = leave["start_date"]
    end = leave["end_date"]
    exceptions = load_exceptions(cursor, current, end)

    while current <= end:
        if not get_day_info(current, exceptions)["is_working_day"]:
            # A weekend/holiday inside the range is not a leave day - no row is created for it.
            current += timedelta(days=1)
            continue

        cursor.execute(
            "SELECT attendance_id, status, check_in_time, leave_request_id, created_at "
            "FROM attendance WHERE employee_id = %s AND attendance_date = %s",
            (leave["employee_id"], current)
        )
        existing = cursor.fetchone()

        if existing:
            if (
                existing["check_in_time"] is None
                and existing["leave_request_id"] is None
                and existing["status"] == "Absent"
                and is_system_generated_absent(cursor, existing)
            ):
                cursor.execute(
                    "UPDATE attendance SET status = %s, leave_request_id = %s WHERE attendance_id = %s",
                    (status, leave["leave_request_id"], existing["attendance_id"])
                )
                log_action(
                    cursor, None, "update", "attendance", existing["attendance_id"],
                    details=LEAVE_RELABELED_DETAILS.format(leave["leave_request_id"])
                )
            # else: attendance a person recorded, genuine attendance, or history that cannot prove the
            # row is automatic - leave it exactly as it is.
        else:
            cursor.execute(
                "INSERT INTO attendance (employee_id, attendance_date, status, leave_request_id) "
                "VALUES (%s, %s, %s, %s)",
                (leave["employee_id"], current, status, leave["leave_request_id"])
            )
            log_action(
                cursor, None, "create", "attendance", cursor.lastrowid,
                details=LEAVE_CREATED_DETAILS.format(leave["leave_request_id"])
            )

        current += timedelta(days=1)


def remove_leave_from_attendance(cursor, leave_request_id):
    """
    Undoes what apply_leave_to_attendance did for this leave request, and only
    that. Of the rows still tagged with it (a manual admin/HR edit via
    PUT /attendance/<id> clears the tag, so an overridden row is never seen here):
      - a row the leave created from nothing is deleted;
      - a row the leave relabelled from a system-generated auto-Absent is put
        back to that Absent and untagged (not deleted);
      - a row with a check-in/out time, or whose audit history cannot prove which
        of the above applies, is left exactly as it is.
    """
    cursor.execute(
        "SELECT attendance_id, status, check_in_time, check_out_time, created_at "
        "FROM attendance WHERE leave_request_id = %s",
        (leave_request_id,)
    )
    for row in cursor.fetchall():
        if row["check_in_time"] is not None or row["check_out_time"] is not None:
            continue

        origin = leave_row_origin(cursor, row, leave_request_id)
        if origin == "created":
            cursor.execute(
                "DELETE FROM attendance WHERE attendance_id = %s AND leave_request_id = %s",
                (row["attendance_id"], leave_request_id)
            )
            log_action(
                cursor, None, "delete", "attendance", row["attendance_id"],
                details=LEAVE_REMOVED_DETAILS.format(leave_request_id)
            )
        elif origin == "converted":
            cursor.execute(
                "UPDATE attendance SET status = 'Absent', leave_request_id = NULL "
                "WHERE attendance_id = %s AND leave_request_id = %s",
                (row["attendance_id"], leave_request_id)
            )
            log_action(
                cursor, None, "update", "attendance", row["attendance_id"],
                details=LEAVE_RESTORED_DETAILS.format(leave_request_id)
            )


def queue_leave_notification(cursor, recipient_employee, notif_type, title, message, link, leave_request_id):
    """
    Writes the in-app notification row only. This runs before commit, as
    part of the same transaction as the leave/attendance changes it
    describes - so it either commits together with them or rolls back
    together with them, never independently.
    """
    create_notification(
        cursor, recipient_employee["employee_id"], notif_type, title, message,
        link=link, related_entity_type="leave_request", related_entity_id=leave_request_id
    )


def send_leave_email(recipient_employee, title, message, link):
    """
    Sends the email side of a leave notification. Callers must only
    invoke this AFTER connection.commit() has already succeeded, so an
    email is never sent for a leave/attendance change that didn't
    actually persist. Wrapped in its own try/except as a backstop: by
    the time this runs the leave action has already succeeded and been
    committed, so any failure here (email delivery or otherwise) must never
    surface as an error response for what is already a successful
    action - it's caught and logged only.
    """
    try:
        send_email(
            recipient_employee["email"],
            title,
            f"Hi {recipient_employee['first_name']},\n\n{message}\n\n"
            f"View it here: {settings.FRONTEND_BASE_URL}{link}"
        )
    except Exception as e:
        print(f"Failed to send leave notification email to {recipient_employee['email']}: {e}")


HALF_DAY_PERIODS = ("First Half", "Second Half")


def parse_strict_date(value):
    """
    Accepts only a YYYY-MM-DD string naming a real calendar date (e.g.
    rejects "2026-13-45"), rather than leaning on MySQL/string comparison
    to catch a malformed date. Returns the date object, or None if value
    isn't a valid date in that exact format.
    """
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def validate_leave_payload(leave_type, start_date, end_date, half_day_period):
    errors = {}

    if leave_type not in LEAVE_TYPES:
        errors["leave_type"] = "Leave type must be CL or EL"

    if not start_date:
        errors["start_date"] = "Start date is required"
    elif parse_strict_date(start_date) is None:
        errors["start_date"] = "Start date must be a valid date in YYYY-MM-DD format"

    if not end_date:
        errors["end_date"] = "End date is required"
    elif parse_strict_date(end_date) is None:
        errors["end_date"] = "End date must be a valid date in YYYY-MM-DD format"

    if half_day_period is not None and half_day_period not in HALF_DAY_PERIODS:
        errors["half_day_period"] = "Half day must be 'First Half' or 'Second Half'"

    if errors:
        return errors

    if end_date < start_date:
        errors["end_date"] = "End date cannot be before start date"
    elif half_day_period is not None and start_date != end_date:
        errors["half_day_period"] = "A half-day request is only allowed for a single-day request"

    return errors


# ---------------------------------------------------------------------
# Employee self-service
# ---------------------------------------------------------------------

@leave_bp.route("/employee/leave", methods=["POST"])
@require_employee_auth
def submit_leave_request():
    employee_id = request.current_employee["employee_id"]
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return error_response("Invalid request body", status_code=400)

    leave_type = data.get("leave_type")
    start_date = data.get("start_date")
    end_date = data.get("end_date")
    half_day_period = data.get("half_day_period") or None
    is_half_day = half_day_period is not None
    reason = data.get("reason")

    errors = validate_leave_payload(leave_type, start_date, end_date, half_day_period)
    if reason is not None and not isinstance(reason, str):
        errors["reason"] = "Reason must be text"
    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        # Re-verify the employee against the DB rather than trusting the
        # token alone - catches an employee archived (offboarded) or
        # otherwise deactivated after their token was issued. "Active
        # employment status" here means not Inactive; On Probation and On
        # Notice are deliberately still allowed through, same as every
        # other employee action - this is not a new eligibility policy,
        # just confirming the account is still a live one.
        #
        # This is also a locking read (and the first statement of the
        # transaction): two submissions from the same employee at the same
        # moment now run one after the other, so the overlap and balance
        # checks below always see the first request's saved leave.
        requester = get_employee_record(cursor, employee_id, for_update=True)
        if not requester or requester["is_archived"] or requester["status"] == "Inactive":
            return error_response("Your account is not active. Please contact HR.", status_code=403)

        if overlaps(cursor, employee_id, start_date, end_date):
            return validation_error_response(
                {"start_date": "You already have a pending or approved leave request that overlaps these dates"}
            )

        requested_days = day_count(cursor, start_date, end_date, is_half_day)
        if requested_days == 0:
            return validation_error_response(
                {"start_date": "The selected date(s) fall entirely on weekends or office holidays - no leave is needed"}
            )
        year = int(start_date[:4])
        quota = get_quota(cursor, leave_type)
        used = compute_used_days(cursor, employee_id, leave_type, year)
        remaining = quota - used

        if requested_days > remaining:
            return validation_error_response(
                {"leave_type": f"Insufficient {leave_type} balance - {remaining:g} day(s) remaining"}
            )

        cursor.execute(
            "INSERT INTO leave_requests "
            "(employee_id, leave_type, start_date, end_date, is_half_day, half_day_period, reason) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (employee_id, leave_type, start_date, end_date, is_half_day, half_day_period, reason)
        )
        leave_request_id = cursor.lastrowid

        pending_email = None
        submitter = requester  # already fetched above, unchanged within this request
        if submitter and submitter["reporting_manager_id"]:
            manager = get_employee_record(cursor, submitter["reporting_manager_id"])
            if manager:
                notification_title = "New leave request awaiting your review"
                notification_message = (
                    f"{submitter['first_name']} {submitter['last_name']} submitted a {leave_type} request "
                    f"for {start_date} to {end_date}."
                )
                notification_link = "/employee/team-leave"
                queue_leave_notification(
                    cursor, manager, "leave_submitted", notification_title, notification_message,
                    notification_link, leave_request_id
                )
                pending_email = (manager, notification_title, notification_message, notification_link)

        if submitter:
            notify_all_admins(
                cursor,
                "leave_submitted",
                "New leave request submitted",
                f"{submitter['first_name']} {submitter['last_name']} submitted a {leave_type} request "
                f"for {start_date} to {end_date}.",
                link="/admin/leave",
                related_entity_type="leave_request",
                related_entity_id=leave_request_id,
            )

        connection.commit()

        if pending_email:
            send_leave_email(*pending_email)

        return created_response(
            "Leave request submitted successfully", data=fetch_leave_entry(cursor, leave_request_id)
        )

    except pymysql.MySQLError as e:
        print(f"Submit leave request error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@leave_bp.route("/employee/leave", methods=["GET"])
@require_employee_auth
def get_my_leave_requests():
    employee_id = request.current_employee["employee_id"]

    status = request.args.get("status")
    leave_type = request.args.get("leave_type")
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)

    errors = {}
    if page < 1:
        errors["page"] = "page must be greater than or equal to 1"
    if page_size < 1 or page_size > 100:
        errors["pageSize"] = "pageSize must be between 1 and 100"
    if status and status not in LEAVE_STATUSES:
        errors["status"] = "Invalid status"
    if leave_type and leave_type not in LEAVE_TYPES:
        errors["leave_type"] = "Invalid leave type"
    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        conditions = ["l.employee_id = %s"]
        params = [employee_id]
        if status:
            conditions.append("l.status = %s")
            params.append(status)
        if leave_type:
            conditions.append("l.leave_type = %s")
            params.append(leave_type)
        if start_date:
            conditions.append("l.end_date >= %s")
            params.append(start_date)
        if end_date:
            conditions.append("l.start_date <= %s")
            params.append(end_date)
        where_clause = "WHERE " + " AND ".join(conditions)

        cursor.execute(f"SELECT COUNT(*) AS total FROM leave_requests l {where_clause}", params)
        total = cursor.fetchone()["total"]

        offset = (page - 1) * page_size
        cursor.execute(
            f"{LEAVE_SELECT} {where_clause} ORDER BY l.created_at DESC LIMIT %s OFFSET %s",
            params + [page_size, offset]
        )
        entries = [format_leave_entry(e) for e in cursor.fetchall()]
        annotate_leave_days(cursor, entries)

        return success_response(data={"records": entries, "total": total})

    except pymysql.MySQLError as e:
        print(f"Get my leave requests error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@leave_bp.route("/employee/leave/balance", methods=["GET"])
@require_employee_auth
def get_my_leave_balance():
    employee_id = request.current_employee["employee_id"]
    year = datetime.now().year

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        balances = []

        for leave_type in LEAVE_TYPES:
            quota = get_quota(cursor, leave_type)
            used = compute_used_days(cursor, employee_id, leave_type, year, statuses=("Approved",))
            pending = compute_used_days(cursor, employee_id, leave_type, year, statuses=("Pending",))
            balances.append({
                "leave_type": leave_type,
                "annual_quota": quota,
                "used": used,
                "pending": pending,
                # Available still reserves Pending days too, same as the
                # balance-blocking check in submit_leave_request - an
                # employee shouldn't see room to over-commit while a
                # request of theirs is still awaiting review.
                "remaining": quota - used - pending,
            })

        return success_response(data=balances)

    except pymysql.MySQLError as e:
        print(f"Get my leave balance error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@leave_bp.route("/employee/leave/<int:leave_request_id>/cancel", methods=["PUT"])
@require_employee_auth
def cancel_my_leave_request(leave_request_id):
    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        # FOR UPDATE: lock the request, so a cancel and a review (or two reviews)
        # arriving together run one after the other and the second one sees
        # the status the first one left.
        cursor.execute(
            "SELECT * FROM leave_requests WHERE leave_request_id = %s FOR UPDATE", (leave_request_id,)
        )
        leave = cursor.fetchone()

        if not leave or leave["employee_id"] != employee_id:
            return not_found_response("Leave request not found")

        if leave["status"] != "Pending":
            return error_response("Only pending leave requests can be cancelled", status_code=400)

        cursor.execute(
            "UPDATE leave_requests SET status = 'Cancelled' WHERE leave_request_id = %s",
            (leave_request_id,)
        )

        pending_email = None
        submitter = get_employee_record(cursor, employee_id)
        if submitter and submitter["reporting_manager_id"]:
            manager = get_employee_record(cursor, submitter["reporting_manager_id"])
            if manager:
                notification_title = "Leave request cancelled"
                notification_message = (
                    f"{submitter['first_name']} {submitter['last_name']} cancelled their {leave['leave_type']} "
                    f"request for {leave['start_date']} to {leave['end_date']}."
                )
                notification_link = "/employee/team-leave"
                queue_leave_notification(
                    cursor, manager, "leave_cancelled", notification_title, notification_message,
                    notification_link, leave_request_id
                )
                pending_email = (manager, notification_title, notification_message, notification_link)

        if submitter:
            notify_all_admins(
                cursor,
                "leave_cancelled",
                "Leave request cancelled",
                f"{submitter['first_name']} {submitter['last_name']} cancelled their {leave['leave_type']} "
                f"request for {leave['start_date']} to {leave['end_date']}.",
                link="/admin/leave",
                related_entity_type="leave_request",
                related_entity_id=leave_request_id,
            )

        connection.commit()

        if pending_email:
            send_leave_email(*pending_email)

        return success_response(
            "Leave request cancelled successfully", data=fetch_leave_entry(cursor, leave_request_id)
        )

    except pymysql.MySQLError as e:
        print(f"Cancel leave request error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Manager - own team only
# ---------------------------------------------------------------------

@leave_bp.route("/manager/team/leave", methods=["GET"])
@require_employee_auth
def get_team_leave_requests():
    manager_id = request.current_employee["employee_id"]

    status = request.args.get("status")
    leave_type = request.args.get("leave_type")
    search = request.args.get("search")
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)

    errors = {}
    if page < 1:
        errors["page"] = "page must be greater than or equal to 1"
    if page_size < 1 or page_size > 100:
        errors["pageSize"] = "pageSize must be between 1 and 100"
    if status and status not in LEAVE_STATUSES:
        errors["status"] = "Invalid status"
    if leave_type and leave_type not in LEAVE_TYPES:
        errors["leave_type"] = "Invalid leave type"
    if errors:
        return validation_error_response(errors)

    # Direct-report scoping - unchanged, still the only thing that decides
    # which employees' requests a manager can see or act on here.
    conditions = ["e.reporting_manager_id = %s"]
    params = [manager_id]

    if status:
        conditions.append("l.status = %s")
        params.append(status)
    if leave_type:
        conditions.append("l.leave_type = %s")
        params.append(leave_type)
    if search:
        conditions.append(
            "(e.first_name LIKE %s OR e.last_name LIKE %s "
            "OR CONCAT_WS(' ', e.first_name, e.last_name) LIKE %s OR e.employee_code LIKE %s)"
        )
        like = f"%{search}%"
        params.extend([like, like, like, like])
    if start_date:
        conditions.append("l.end_date >= %s")
        params.append(start_date)
    if end_date:
        conditions.append("l.start_date <= %s")
        params.append(end_date)

    where_clause = "WHERE " + " AND ".join(conditions)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(f"SELECT COUNT(*) AS total FROM leave_requests l JOIN employees e ON l.employee_id = e.employee_id {where_clause}", params)
        total = cursor.fetchone()["total"]

        offset = (page - 1) * page_size
        cursor.execute(
            f"""{LEAVE_SELECT} {where_clause}
                ORDER BY (l.status = 'Pending') DESC, l.created_at DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset]
        )
        entries = [format_leave_entry(e) for e in cursor.fetchall()]
        annotate_leave_days(cursor, entries)

        return success_response(data={"records": entries, "total": total})

    except pymysql.MySQLError as e:
        print(f"Get team leave requests error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


def _manager_review(leave_request_id, new_status, rejection_reason=None):
    manager_id = request.current_employee["employee_id"]

    if new_status == "Rejected" and not rejection_reason:
        return validation_error_response({"rejection_reason": "A reason is required to reject a leave request"})

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        # FOR UPDATE: lock the request, so a cancel and a review (or two reviews)
        # arriving together run one after the other and the second one sees
        # the status the first one left.
        cursor.execute(
            "SELECT * FROM leave_requests WHERE leave_request_id = %s FOR UPDATE", (leave_request_id,)
        )
        leave = cursor.fetchone()

        if not leave:
            return not_found_response("Leave request not found")

        employee = get_employee_record(cursor, leave["employee_id"])
        if not employee or employee["reporting_manager_id"] != manager_id:
            return not_found_response("Leave request not found")

        if leave["status"] != "Pending":
            return error_response(f"Only pending leave requests can be {new_status.lower()}", status_code=400)

        cursor.execute(
            "UPDATE leave_requests SET status = %s, rejection_reason = %s, "
            "reviewed_by_employee_id = %s, reviewed_at = NOW() WHERE leave_request_id = %s",
            (new_status, rejection_reason, manager_id, leave_request_id)
        )

        if new_status == "Approved":
            leave["status"] = "Approved"
            apply_leave_to_attendance(cursor, leave)

        notification_title = f"Your leave request was {new_status.lower()}"
        notification_message = (
            f"Your {leave['leave_type']} request for {leave['start_date']} to {leave['end_date']} "
            f"was {new_status.lower()} by your manager."
        )
        if new_status == "Rejected":
            notification_message += f" Reason: {rejection_reason}"
        notification_link = "/employee/leave"
        queue_leave_notification(
            cursor, employee, f"leave_{new_status.lower()}", notification_title, notification_message,
            notification_link, leave_request_id
        )

        connection.commit()

        send_leave_email(employee, notification_title, notification_message, notification_link)

        return success_response(
            f"Leave request {new_status.lower()} successfully", data=fetch_leave_entry(cursor, leave_request_id)
        )

    except pymysql.MySQLError as e:
        print(f"Manager review leave request error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@leave_bp.route("/manager/team/leave/<int:leave_request_id>/approve", methods=["PUT"])
@require_employee_auth
def approve_team_leave_request(leave_request_id):
    return _manager_review(leave_request_id, "Approved")


@leave_bp.route("/manager/team/leave/<int:leave_request_id>/reject", methods=["PUT"])
@require_employee_auth
def reject_team_leave_request(leave_request_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}
    reason = data.get("reason")
    reason = reason.strip() if isinstance(reason, str) else ""
    return _manager_review(leave_request_id, "Rejected", rejection_reason=reason or None)


# ---------------------------------------------------------------------
# Admin / HR
# ---------------------------------------------------------------------

@leave_bp.route("/leave/quotas", methods=["GET"])
@require_permission("leave.view")
def get_leave_quotas():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT leave_type, annual_quota FROM leave_quotas")
        rows = cursor.fetchall()

        return success_response(data=[
            {"leave_type": r["leave_type"], "annual_quota": float(r["annual_quota"])} for r in rows
        ])

    except pymysql.MySQLError as e:
        print(f"Get leave quotas error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@leave_bp.route("/leave/quotas", methods=["PUT"])
@require_permission("leave.update")
def update_leave_quotas():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return error_response("Invalid request body", status_code=400)

    errors = {}
    updates = {}

    for leave_type in LEAVE_TYPES:
        value = data.get(leave_type)
        if value is None:
            errors[leave_type] = f"{leave_type} quota is required"
            continue
        if isinstance(value, bool):
            errors[leave_type] = f"{leave_type} quota must be a number"
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            errors[leave_type] = f"{leave_type} quota must be a number"
            continue

        # float() also accepts "nan", "inf" and the JSON literals NaN/Infinity.
        if not math.isfinite(number):
            errors[leave_type] = f"{leave_type} quota must be a number"
        elif number < 0:
            errors[leave_type] = f"{leave_type} quota cannot be negative"
        elif number > MAX_ANNUAL_QUOTA:
            errors[leave_type] = f"{leave_type} quota cannot be more than {MAX_ANNUAL_QUOTA:g}"
        else:
            updates[leave_type] = number

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        for leave_type, quota in updates.items():
            cursor.execute(
                "UPDATE leave_quotas SET annual_quota = %s WHERE leave_type = %s",
                (quota, leave_type)
            )

        log_action(
            cursor, request.current_admin["admin_id"], "update", "leave_quota", 0,
            details=f"CL={updates.get('CL')}, EL={updates.get('EL')}"
        )
        connection.commit()

        cursor.execute("SELECT leave_type, annual_quota FROM leave_quotas")
        rows = cursor.fetchall()

        return success_response("Leave quotas updated successfully", data=[
            {"leave_type": r["leave_type"], "annual_quota": float(r["annual_quota"])} for r in rows
        ])

    except pymysql.MySQLError as e:
        print(f"Update leave quotas error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@leave_bp.route("/leave", methods=["GET"])
@require_permission("leave.view")
def get_all_leave_requests():
    department_id = request.args.get("department_id", type=int)
    employee_id = request.args.get("employee_id", type=int)
    status = request.args.get("status")
    leave_type = request.args.get("leave_type")

    conditions = []
    params = []

    if department_id:
        conditions.append("e.department_id = %s")
        params.append(department_id)
    if employee_id:
        conditions.append("l.employee_id = %s")
        params.append(employee_id)
    if status:
        conditions.append("l.status = %s")
        params.append(status)
    if leave_type:
        conditions.append("l.leave_type = %s")
        params.append(leave_type)

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(f"{LEAVE_SELECT} {where_clause} ORDER BY l.created_at DESC", params)
        entries = cursor.fetchall()

        return success_response(data=[format_leave_entry(e) for e in entries])

    except pymysql.MySQLError as e:
        print(f"Get all leave requests error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@leave_bp.route("/leave", methods=["POST"])
@require_permission("leave.create")
def create_leave_request_admin():
    """
    Disabled by business rule: Admin/HR must not create a leave request on
    an employee's behalf - only the employee themselves can, via
    POST /employee/leave (submit_leave_request), which is unaffected by
    this. The route and leave.create permission are both kept in place
    (leave.create may still be referenced elsewhere in the permission
    system) - only this specific behavior is turned off.
    """
    return error_response(
        "Admins cannot create leave requests on behalf of employees", status_code=403
    )


@leave_bp.route("/leave/<int:leave_request_id>", methods=["PUT"])
@require_permission("leave.update")
def update_leave_request_admin(leave_request_id):
    """
    Disabled by business rule: Admin/HR must not directly edit an
    employee's submitted leave application (type, dates, half-day,
    reason must remain exactly as submitted). Status changes go through
    the dedicated, audited /leave/<id>/approve and /leave/<id>/reject
    routes instead (_admin_review), which now also support reversing a
    prior decision. The route and leave.update permission are both kept
    in place - leave.update still gates PUT /leave/quotas - only this
    specific free-edit behavior is turned off.
    """
    return error_response(
        "Admins cannot directly edit an employee's leave application", status_code=403
    )


def _admin_review(leave_request_id, new_status):
    """
    Same shape as _manager_review, but organization-wide (no reporting-
    manager ownership check) and attributed to the admin, not an
    employee. Gated separately by leave.approve so holding leave.update
    alone is not enough to approve/reject.

    Supports the original Pending->Approved/Rejected review, and also
    reversing an existing decision (Approved->Rejected, Rejected->Approved)
    as a "change decision" action - both use these same two routes, no
    separate endpoint. A non-empty reason is always required and is
    audited via the existing log_action details field. Reversals correctly
    unwind/reapply the attendance side-effects using the existing
    apply_leave_to_attendance / remove_leave_from_attendance helpers,
    which already preserve any genuine check-in on an attendance row.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}
    reason = data.get("reason")
    reason = reason.strip() if isinstance(reason, str) else ""

    if not reason:
        return validation_error_response({"reason": "A reason is required"})

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        # FOR UPDATE: lock the request, so a cancel and a review (or two reviews)
        # arriving together run one after the other and the second one sees
        # the status the first one left.
        cursor.execute(
            "SELECT * FROM leave_requests WHERE leave_request_id = %s FOR UPDATE", (leave_request_id,)
        )
        leave = cursor.fetchone()

        if not leave:
            return not_found_response("Leave request not found")

        current_status = leave["status"]
        allowed_from = {
            "Pending": ("Approved", "Rejected"),
            "Approved": ("Rejected",),
            "Rejected": ("Approved",),
        }.get(current_status, ())

        if new_status not in allowed_from:
            return error_response(
                f"Cannot change a {current_status.lower()} request to {new_status.lower()}", status_code=400
            )

        was_approved = current_status == "Approved"

        # rejection_reason mirrors the reason already required above,
        # visible back to the employee (unlike the audit log below, which
        # only admins can see); cleared on any transition back to
        # Approved so a reversed decision doesn't leave a stale reason.
        cursor.execute(
            "UPDATE leave_requests SET status = %s, rejection_reason = %s, "
            "reviewed_by_admin_id = %s, reviewed_at = NOW() WHERE leave_request_id = %s",
            (new_status, reason if new_status == "Rejected" else None, request.current_admin["admin_id"], leave_request_id)
        )
        log_action(
            cursor, request.current_admin["admin_id"], "update", "leave_request", leave_request_id, details=reason
        )

        if new_status == "Approved":
            leave["status"] = "Approved"
            apply_leave_to_attendance(cursor, leave)
        elif was_approved and new_status == "Rejected":
            remove_leave_from_attendance(cursor, leave_request_id)

        employee = get_employee_record(cursor, leave["employee_id"])
        pending_email = None
        if employee:
            notification_title = f"Your leave request was {new_status.lower()}"
            notification_message = (
                f"Your {leave['leave_type']} request for {leave['start_date']} to {leave['end_date']} "
                f"was {new_status.lower()} by HR/admin."
            )
            notification_link = "/employee/leave"
            queue_leave_notification(
                cursor, employee, f"leave_{new_status.lower()}", notification_title, notification_message,
                notification_link, leave_request_id
            )
            pending_email = (employee, notification_title, notification_message, notification_link)

        connection.commit()

        if pending_email:
            send_leave_email(*pending_email)

        return success_response(
            f"Leave request {new_status.lower()} successfully", data=fetch_leave_entry(cursor, leave_request_id)
        )

    except pymysql.MySQLError as e:
        print(f"Admin review leave request error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@leave_bp.route("/leave/<int:leave_request_id>/approve", methods=["PUT"])
@require_permission("leave.approve")
def approve_leave_request_admin(leave_request_id):
    return _admin_review(leave_request_id, "Approved")


@leave_bp.route("/leave/<int:leave_request_id>/reject", methods=["PUT"])
@require_permission("leave.approve")
def reject_leave_request_admin(leave_request_id):
    return _admin_review(leave_request_id, "Rejected")