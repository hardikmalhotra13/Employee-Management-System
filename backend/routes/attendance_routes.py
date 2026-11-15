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
from routes.shift_routes import format_time
from routes.roster_routes import fetch_employee_today_schedule
from utils.calendar_helper import (
    load_exceptions,
    get_day_info,
    get_day_info_for,
    annotate_day_kind,
    special_days,
    non_working_dates,
)
from utils.validation_helper import is_valid_id, parse_date_str, parse_datetime_str
from utils.attendance_audit_helper import AUTO_ABSENT_DETAILS

attendance_bp = Blueprint("attendance", __name__)

GRACE_PERIOD_MINUTES = 15
HISTORY_WINDOW_MONTHS = 2

ATTENDANCE_SELECT = """
    SELECT a.attendance_id, a.employee_id, a.shift_id, a.attendance_date,
           a.check_in_time, a.check_out_time, a.status, a.leave_request_id,
           e.employee_code, e.first_name, e.last_name,
           d.department_id, d.department_name,
           s.shift_name, s.start_time, s.end_time
    FROM attendance a
    JOIN employees e ON a.employee_id = e.employee_id
    JOIN departments d ON e.department_id = d.department_id
    LEFT JOIN shifts s ON a.shift_id = s.shift_id
"""


def earliest_allowed_history_date(today=None):
    """
    The 2-month rule from the spec is an access/display window, not a
    deletion rule - old rows are never touched. "2 months" is anchored to
    the History filter options (This Month / Last Month), so the floor is
    the 1st of the month before last month's start: e.g. if today is in
    September, the earliest visible date is 1 August.
    """
    today = today or datetime.now().date()
    first_of_this_month = today.replace(day=1)
    last_month_end = first_of_this_month - timedelta(days=1)
    return last_month_end.replace(day=1)


def compute_working_hours(check_in_dt, check_out_dt):
    if not check_in_dt or not check_out_dt:
        return None
    delta = check_out_dt - check_in_dt
    if delta.total_seconds() <= 0:
        return None
    return round(delta.total_seconds() / 3600, 2)


def compute_is_early_departure(attendance_date, check_out_dt, shift_start_time, shift_end_time):
    """
    True if the employee checked out before their shift's scheduled end,
    correctly accounting for an overnight shift (end <= start means the
    shift ends the next calendar day).
    """
    if not check_out_dt or shift_start_time is None or shift_end_time is None:
        return False

    shift_end_dt = datetime.combine(attendance_date, datetime.min.time()) + shift_end_time
    if shift_end_time <= shift_start_time:
        shift_end_dt += timedelta(days=1)

    return check_out_dt < shift_end_dt


def format_attendance_entry(entry):
    if entry:
        # Raw datetimes are needed for working-hours/early-departure math
        # before they get stringified for the JSON response below.
        raw_check_in = entry.get("check_in_time")
        raw_check_out = entry.get("check_out_time")
        raw_date = entry.get("attendance_date")

        # display_status/remarks: approved leave is stored as status
        # 'Absent' (full-day) or 'Half Day' with leave_request_id set -
        # the DB status model is intentionally left as-is (see
        # apply_leave_to_attendance in leave_routes.py); only full-day
        # leave is relabeled "On Leave" for display, since a half-day
        # leave row is still genuinely a half-day attendance record and
        # the two are tracked as separate summary buckets.
        if entry.get("leave_request_id") and entry.get("status") == "Absent":
            entry["display_status"] = "On Leave"
        else:
            entry["display_status"] = entry.get("status")
        entry["remarks"] = "Approved Leave" if entry.get("leave_request_id") else None

        entry["working_hours"] = compute_working_hours(raw_check_in, raw_check_out)
        entry["is_late"] = entry.get("status") == "Late"
        entry["is_early_departure"] = (
            compute_is_early_departure(raw_date, raw_check_out, entry.get("start_time"), entry.get("end_time"))
            if raw_date else False
        )
        entry["is_missing_checkout"] = bool(raw_check_in) and not raw_check_out

        if raw_date:
            entry["attendance_date"] = raw_date.strftime("%Y-%m-%d")
        if raw_check_in:
            entry["check_in_time"] = raw_check_in.strftime("%Y-%m-%d %H:%M:%S")
        if raw_check_out:
            entry["check_out_time"] = raw_check_out.strftime("%Y-%m-%d %H:%M:%S")
        entry["start_time"] = format_time(entry.get("start_time"))
        entry["end_time"] = format_time(entry.get("end_time"))
    return entry


def fetch_attendance_entry(cursor, attendance_id):
    cursor.execute(f"{ATTENDANCE_SELECT} WHERE a.attendance_id = %s", (attendance_id,))
    return format_attendance_entry(cursor.fetchone())


def get_employee_record(cursor, employee_id):
    cursor.execute(
        "SELECT employee_id, department_id, is_archived FROM employees WHERE employee_id = %s",
        (employee_id,)
    )
    return cursor.fetchone()


def get_shift_record(cursor, shift_id):
    cursor.execute(
        "SELECT shift_id, start_time, end_time, is_archived FROM shifts WHERE shift_id = %s",
        (shift_id,)
    )
    return cursor.fetchone()


def get_effective_shift(cursor, employee_id, attendance_date):
    """
    Roster override for this date if one exists, else the employee's
    default shift - the same resolution order fetch_employee_today_schedule
    (roster_routes.py) already uses for display. Used by check-in so the
    shift actually snapshotted onto the attendance row (and the
    late/present derivation) is consistent with what the employee is
    shown as "their shift today" even on a day with no explicit roster
    entry.
    """
    rostered_shift = get_rostered_shift(cursor, employee_id, attendance_date)
    if rostered_shift:
        return rostered_shift

    cursor.execute("SELECT shift_id FROM employees WHERE employee_id = %s", (employee_id,))
    employee = cursor.fetchone()
    if not employee or not employee["shift_id"]:
        return None

    return get_shift_record(cursor, employee["shift_id"])


def get_rostered_shift(cursor, employee_id, attendance_date):
    """
    Looks up the employee's scheduled shift for a given date from
    shift_rosters, if one exists. Returns the shift row (with start_time
    and end_time) or None - attendance is not gated on a roster entry
    existing.
    """
    cursor.execute(
        """SELECT s.shift_id, s.start_time, s.end_time
           FROM shift_rosters r
           JOIN shifts s ON r.shift_id = s.shift_id
           WHERE r.employee_id = %s AND r.roster_date = %s""",
        (employee_id, attendance_date)
    )
    return cursor.fetchone()


def derive_attendance_status(check_in_time, shift_start_time):
    """
    Server-side source of truth for Present/Late/Absent. shift_start_time
    comes back from PyMySQL as a timedelta (MySQL TIME type).

    - No check-in at all -> Absent.
    - Check-in within GRACE_PERIOD_MINUTES of shift start -> Present.
    - Check-in after that -> Late.
    - No scheduled shift to compare against -> Present (can't be late
      against nothing), unless there's no check-in either, which is
      still Absent.
    """
    if check_in_time is None:
        return "Absent"

    if shift_start_time is None:
        return "Present"

    shift_start = datetime.combine(check_in_time.date(), datetime.min.time()) + shift_start_time
    if check_in_time <= shift_start + timedelta(minutes=GRACE_PERIOD_MINUTES):
        return "Present"
    return "Late"


def shift_duration(shift_start_time, shift_end_time):
    """
    Duration of a shift as a timedelta, correctly handling an overnight
    shift (end_time <= start_time means the shift ends the next day).
    """
    duration = shift_end_time - shift_start_time
    if duration <= timedelta(0):
        duration += timedelta(days=1)
    return duration


def half_shift_elapsed(roster_date, shift_start_time, shift_end_time, now):
    """
    True once at least half of the shift's scheduled duration has passed
    since its start on roster_date - e.g. a 9:00-17:00 shift (8h) is
    "half elapsed" at 13:00; an overnight 18:00-02:00 shift (8h) is half
    elapsed at 22:00 the same calendar day.
    """
    shift_start_dt = datetime.combine(roster_date, datetime.min.time()) + shift_start_time
    half_duration = shift_duration(shift_start_time, shift_end_time) / 2
    return now >= shift_start_dt + half_duration


# A date covered by an APPROVED leave must never be auto-marked Absent. Leave
# approval writes an attendance row for each working day in the range, which
# already stops reconciliation - but a date that was a weekend/holiday when the
# leave was approved has no row, and can later become a working day (a holiday
# is deleted, or a weekend is overridden as a working day). This check covers it.
NOT_ON_APPROVED_LEAVE = (
    "NOT EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.employee_id = {employee} "
    "AND lr.status = 'Approved' AND {day} BETWEEN lr.start_date AND lr.end_date)"
)


def exclude_non_working_absences(cursor, start_date, end_date, prefix=""):
    """
    SQL fragment + params for the attendance summary counts that leaves
    out rows which are only a leftover of the system treating a weekend
    or holiday as a working day: status 'Absent', no check-in, no leave,
    sitting on a date that is a non-working day. Before the holiday
    calendar existed, reconcile_absences auto-created these every
    Saturday/Sunday.

    This only affects what the summary cards count. The rows themselves
    are never modified or deleted, and still appear (badged Weekend/
    Holiday) in the attendance lists. Rows with a check-in, a leave
    request, or any other status are always counted.
    """
    dates = non_working_dates(cursor, start_date, end_date)
    if not dates:
        return "", []
    placeholders = ", ".join(["%s"] * len(dates))
    clause = (
        f" AND NOT ({prefix}status = 'Absent' AND {prefix}leave_request_id IS NULL "
        f"AND {prefix}check_in_time IS NULL AND {prefix}attendance_date IN ({placeholders}))"
    )
    return clause, dates


def reconcile_absences(cursor, admin_id, start_date, end_date, employee_ids=None):
    """
    Request-time reconciliation: for every rostered (employee, date) in
    range with no attendance row yet, once half of that employee's
    scheduled shift duration has elapsed, insert an Absent record. No
    scheduler involved - this runs inline whenever an attendance list is
    requested (admin, employee, or manager - see employee_ids below).

    - Never processes roster dates after today (nothing in the future can
      have "elapsed" yet).
    - Effective shift: a roster entry wins; for today only, an employee
      with no roster entry is also reconciled against their default shift
      (employees.shift_id). Past dates without a roster entry are not
      back-filled.
    - Non-working days (a default Saturday/Sunday that has not been
      overridden as a working day, or an office holiday - see
      utils/calendar_helper.py) are skipped: nobody is auto-marked Absent
      on them, even if a roster entry or default shift falls on one.
      Employees can still check in and admin/HR can still record
      attendance manually on those days.
    - Only employees who can be expected to work that day are reconciled:
      not archived, not Inactive (an Inactive employee cannot log in, so
      cannot check in), on/after their joining date, and not covered by an
      approved leave. Existing attendance rows are never touched or deleted.
    - The LEFT JOIN only considers rosters with NO existing attendance
      row, so this never overwrites an existing record and, since an
      approved leave already creates an attendance row for that date
      (see apply_leave_to_attendance in leave_routes.py), employees with
      applicable approved leave are naturally skipped.
    - The UNIQUE KEY on (employee_id, attendance_date) plus the
      IntegrityError guard below prevent duplicates even under
      concurrent requests.
    - employee_ids optionally scopes this to a specific list of employees
      (a single employee viewing their own attendance, or a manager's
      whole team) instead of reconciling every roster in range (the admin
      attendance list's existing behavior, unchanged when omitted).
      admin_id is nullable in audit_logs, so a system-triggered
      reconciliation (not tied to any admin action) logs with admin_id
      NULL rather than needing a manufactured actor.
    """
    today = datetime.now().date()
    effective_end = min(end_date, today)
    if start_date > effective_end:
        return

    conditions = [
        "r.roster_date BETWEEN %s AND %s", "a.attendance_id IS NULL",
        "e.is_archived = FALSE", "e.status != 'Inactive'", "e.joining_date <= r.roster_date",
        NOT_ON_APPROVED_LEAVE.format(employee="r.employee_id", day="r.roster_date"),
    ]
    params = [start_date, effective_end]
    if employee_ids is not None:
        if not employee_ids:
            return
        placeholders = ", ".join(["%s"] * len(employee_ids))
        conditions.append(f"r.employee_id IN ({placeholders})")
        params.extend(employee_ids)

    cursor.execute(
        f"""SELECT r.employee_id, r.roster_date, s.shift_id, s.start_time, s.end_time
           FROM shift_rosters r
           JOIN employees e ON e.employee_id = r.employee_id
           JOIN shifts s ON r.shift_id = s.shift_id
           LEFT JOIN attendance a
             ON a.employee_id = r.employee_id AND a.attendance_date = r.roster_date
           WHERE {' AND '.join(conditions)}""",
        params
    )
    candidates = list(cursor.fetchall())

    if effective_end == today:
        default_conditions = [
            "r.roster_id IS NULL", "a.attendance_id IS NULL",
            "e.is_archived = FALSE", "e.status != 'Inactive'", "e.joining_date <= %s",
            NOT_ON_APPROVED_LEAVE.format(employee="e.employee_id", day="%s"),
        ]
        default_params = [today, today, today, today]
        if employee_ids is not None:
            placeholders = ", ".join(["%s"] * len(employee_ids))
            default_conditions.append(f"e.employee_id IN ({placeholders})")
            default_params.extend(employee_ids)

        cursor.execute(
            f"""SELECT e.employee_id, s.shift_id, s.start_time, s.end_time
               FROM employees e
               JOIN shifts s ON e.shift_id = s.shift_id
               LEFT JOIN shift_rosters r
                 ON r.employee_id = e.employee_id AND r.roster_date = %s
               LEFT JOIN attendance a
                 ON a.employee_id = e.employee_id AND a.attendance_date = %s
               WHERE {' AND '.join(default_conditions)}""",
            default_params
        )
        for row in cursor.fetchall():
            row["roster_date"] = today
            candidates.append(row)

    exceptions = load_exceptions(cursor, start_date, effective_end)

    now = datetime.now()
    for row in candidates:
        if not get_day_info(row["roster_date"], exceptions)["is_working_day"]:
            continue

        if not half_shift_elapsed(row["roster_date"], row["start_time"], row["end_time"], now):
            continue

        try:
            cursor.execute(
                "INSERT INTO attendance (employee_id, shift_id, attendance_date, status) "
                "VALUES (%s, %s, %s, 'Absent')",
                (row["employee_id"], row["shift_id"], row["roster_date"])
            )
            log_action(
                cursor, admin_id, "create", "attendance", cursor.lastrowid,
                details=AUTO_ABSENT_DETAILS
            )
        except pymysql.err.IntegrityError:
            # Another request already reconciled this employee/date - skip.
            pass


def resolve_attendance_date(cursor, employee_id, now):
    """
    Which attendance_date a check-in/check-out happening right now
    belongs to - correctly handling an overnight shift (e.g. Evening
    18:00-02:00) that crosses midnight.

    Scope: this only resolves to "yesterday" when yesterday's row is
    already checked in but not checked out (an overnight shift still in
    progress) - covering the explicitly-required case of checking out
    after midnight. A first check-in that only happens after midnight for
    a shift scheduled the previous evening is a rarer edge case not
    covered here; deliberately not handled to avoid speculative logic
    beyond what's asked.
    """
    yesterday = now.date() - timedelta(days=1)

    cursor.execute(
        "SELECT * FROM attendance WHERE employee_id = %s AND attendance_date = %s",
        (employee_id, yesterday)
    )
    y_row = cursor.fetchone()

    if y_row and y_row["check_in_time"] and not y_row["check_out_time"] and y_row["shift_id"]:
        shift = get_shift_record(cursor, y_row["shift_id"])
        if shift and shift["end_time"] <= shift["start_time"]:  # overnight
            shift_end_dt = datetime.combine(yesterday, datetime.min.time()) + shift["end_time"] + timedelta(days=1)
            if now <= shift_end_dt:
                return yesterday

    return now.date()


# ---------------------------------------------------------------------
# Employee self-service
# ---------------------------------------------------------------------

@attendance_bp.route("/employee/attendance/check-in", methods=["POST"])
@require_employee_auth
def check_in():
    employee_id = request.current_employee["employee_id"]
    now = datetime.now()

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        today = resolve_attendance_date(cursor, employee_id, now)
        cursor.execute(
            "SELECT * FROM attendance WHERE employee_id = %s AND attendance_date = %s",
            (employee_id, today)
        )
        existing = cursor.fetchone()

        if existing and existing["check_in_time"]:
            return error_response("You have already checked in today", status_code=400)

        if existing and existing["leave_request_id"]:
            return error_response("You have an approved leave for today and cannot check in", status_code=400)

        effective_shift = get_effective_shift(cursor, employee_id, today)
        shift_id = effective_shift["shift_id"] if effective_shift else None
        shift_start_time = effective_shift["start_time"] if effective_shift else None
        status = derive_attendance_status(now, shift_start_time)

        if existing:
            cursor.execute(
                "UPDATE attendance SET check_in_time = %s, shift_id = %s, status = %s WHERE attendance_id = %s",
                (now, shift_id, status, existing["attendance_id"])
            )
            attendance_id = existing["attendance_id"]
        else:
            cursor.execute(
                "INSERT INTO attendance (employee_id, shift_id, attendance_date, check_in_time, status) "
                "VALUES (%s, %s, %s, %s, %s)",
                (employee_id, shift_id, today, now, status)
            )
            attendance_id = cursor.lastrowid

        connection.commit()

        return success_response("Checked in successfully", data=fetch_attendance_entry(cursor, attendance_id))

    except pymysql.MySQLError as e:
        print(f"Check-in error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@attendance_bp.route("/employee/attendance/check-out", methods=["POST"])
@require_employee_auth
def check_out():
    employee_id = request.current_employee["employee_id"]
    now = datetime.now()

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        today = resolve_attendance_date(cursor, employee_id, now)
        cursor.execute(
            "SELECT * FROM attendance WHERE employee_id = %s AND attendance_date = %s",
            (employee_id, today)
        )
        existing = cursor.fetchone()

        if not existing or not existing["check_in_time"]:
            return error_response("You have not checked in today", status_code=400)

        if existing["check_out_time"]:
            return error_response("You have already checked out today", status_code=400)

        cursor.execute(
            "UPDATE attendance SET check_out_time = %s WHERE attendance_id = %s",
            (now, existing["attendance_id"])
        )
        connection.commit()

        return success_response(
            "Checked out successfully", data=fetch_attendance_entry(cursor, existing["attendance_id"])
        )

    except pymysql.MySQLError as e:
        print(f"Check-out error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@attendance_bp.route("/employee/attendance", methods=["GET"])
@require_employee_auth
def get_my_attendance():
    employee_id = request.current_employee["employee_id"]
    today = datetime.now().date()

    start_date_str = request.args.get("start_date")
    end_date_str = request.args.get("end_date")
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)

    errors = {}
    if page < 1:
        errors["page"] = "page must be greater than or equal to 1"
    if page_size < 1 or page_size > 100:
        errors["pageSize"] = "pageSize must be between 1 and 100"

    # No range given -> the page must open on today only, never full/unfiltered
    # history (this is the API-level guarantee behind the "always opens on
    # the current date" requirement, independent of whatever the frontend
    # happens to request).
    if not start_date_str and not end_date_str:
        start_date = end_date = today
    else:
        try:
            start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date() if start_date_str else today
            end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date() if end_date_str else today
        except ValueError:
            return validation_error_response({"start_date": "Dates must be in YYYY-MM-DD format"})

    if start_date > end_date:
        return validation_error_response({"start_date": "start_date cannot be after end_date"})

    # 2-month display window - access/display restriction only, never a
    # deletion of older rows. Silently clamp rather than reject, so a
    # request spanning into disallowed territory (e.g. Custom Range picked
    # too far back) still returns the allowed portion instead of erroring.
    earliest_allowed = earliest_allowed_history_date(today)
    if start_date < earliest_allowed:
        start_date = earliest_allowed
    if end_date > today:
        end_date = today
    if start_date > end_date:
        start_date = end_date

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        # Keep this employee's own records reconciled without depending on
        # an admin having loaded the admin attendance page for this range.
        reconcile_absences(cursor, None, start_date, end_date, employee_ids=[employee_id])

        # The window is at most ~2 months (see the clamp above), so the whole range is read and
        # paged here: that lets weekends/holidays with no attendance row appear in the list too.
        cursor.execute(
            f"""{ATTENDANCE_SELECT}
                WHERE a.employee_id = %s AND a.attendance_date BETWEEN %s AND %s""",
            (employee_id, start_date, end_date)
        )
        entries = [format_attendance_entry(e) for e in cursor.fetchall()]
        annotate_day_kind(cursor, entries)

        calendar = special_days(cursor, start_date, end_date)

        # A non-working day gets a placeholder row only when the employee has no attendance row
        # for it AND is not specifically rostered to work it - a rostered employee is expected in,
        # so calling that date a holiday for them would be wrong. Real rows (an absence, a leave,
        # a check-in made on a holiday ...) are never replaced or hidden.
        cursor.execute(
            "SELECT roster_date FROM shift_rosters WHERE employee_id = %s AND roster_date BETWEEN %s AND %s",
            (employee_id, start_date, end_date)
        )
        rostered_dates = {row["roster_date"].strftime("%Y-%m-%d") for row in cursor.fetchall()}
        recorded_dates = {entry["attendance_date"] for entry in entries}
        for day in calendar:
            if day["is_working_day"] or day["date"] in recorded_dates or day["date"] in rostered_dates:
                continue
            entries.append({
                "attendance_id": None,
                "employee_id": employee_id,
                "attendance_date": day["date"],
                "shift_name": None,
                "check_in_time": None,
                "check_out_time": None,
                "status": None,
                "display_status": day["kind"],
                "remarks": day["title"] if day["kind"] == "Holiday" else None,
                "working_hours": None,
                "is_late": False,
                "is_early_departure": False,
                "is_missing_checkout": False,
                "is_placeholder": True,
            })

        entries.sort(key=lambda entry: entry["attendance_date"], reverse=True)
        total = len(entries)
        offset = (page - 1) * page_size
        entries = entries[offset:offset + page_size]

        connection.commit()

        return success_response(data={
            "records": entries,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d"),
            "calendar": calendar,
        })

    except pymysql.MySQLError as e:
        print(f"Get my attendance error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@attendance_bp.route("/employee/attendance/today", methods=["GET"])
@require_employee_auth
def get_my_today_attendance():
    """
    Powers the Today card, which must show the assigned shift/timing even
    before the employee has checked in (i.e. before any attendance row
    exists) - reuses fetch_employee_today_schedule (roster override, else
    default shift) rather than re-deriving shift resolution here.
    """
    employee_id = request.current_employee["employee_id"]
    today = datetime.now().date()

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        schedule = fetch_employee_today_schedule(cursor, employee_id, today)

        cursor.execute(
            f"{ATTENDANCE_SELECT} WHERE a.employee_id = %s AND a.attendance_date = %s",
            (employee_id, today)
        )
        attendance = format_attendance_entry(cursor.fetchone())

        return success_response(data={
            "schedule": schedule,
            "attendance": attendance,
            "today_day": get_day_info_for(cursor, today),
        })

    except pymysql.MySQLError as e:
        print(f"Get my today attendance error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@attendance_bp.route("/employee/attendance/summary", methods=["GET"])
@require_employee_auth
def get_my_attendance_summary():
    employee_id = request.current_employee["employee_id"]
    today = datetime.now().date()

    start_date_str = request.args.get("start_date")
    end_date_str = request.args.get("end_date")

    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date() if start_date_str else today.replace(day=1)
        end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date() if end_date_str else today
    except ValueError:
        return validation_error_response({"start_date": "Dates must be in YYYY-MM-DD format"})

    earliest_allowed = earliest_allowed_history_date(today)
    start_date = max(start_date, earliest_allowed)
    end_date = min(end_date, today)
    if start_date > end_date:
        start_date = end_date

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        reconcile_absences(cursor, None, start_date, end_date, employee_ids=[employee_id])

        # Working Days here means "days with an attendance record in the
        # range" (Present/Late/Absent/Half Day/On Leave combined), not
        # counting leftover auto-Absent rows on weekends/holidays (see
        # exclude_non_working_absences).
        orphan_clause, orphan_params = exclude_non_working_absences(cursor, start_date, end_date)
        cursor.execute(
            """SELECT
                   COUNT(*) AS working_days,
                   SUM(CASE WHEN status IN ('Present', 'Late') THEN 1 ELSE 0 END) AS present,
                   SUM(CASE WHEN status = 'Absent' AND leave_request_id IS NULL THEN 1 ELSE 0 END) AS absent,
                   SUM(CASE WHEN status = 'Half Day' THEN 1 ELSE 0 END) AS half_day,
                   SUM(CASE WHEN status = 'On Leave'
                             OR (status = 'Absent' AND leave_request_id IS NOT NULL) THEN 1 ELSE 0 END) AS on_leave
               FROM attendance
               WHERE employee_id = %s AND attendance_date BETWEEN %s AND %s""" + orphan_clause,
            (employee_id, start_date, end_date, *orphan_params)
        )
        summary = cursor.fetchone()
        connection.commit()

        for key in ("working_days", "present", "absent", "half_day", "on_leave"):
            summary[key] = summary[key] or 0

        return success_response(data=summary)

    except pymysql.MySQLError as e:
        print(f"Get my attendance summary error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Manager - view only, own team only
# ---------------------------------------------------------------------

@attendance_bp.route("/manager/team/attendance", methods=["GET"])
@require_employee_auth
def get_team_attendance():
    manager_id = request.current_employee["employee_id"]
    today = datetime.now().date()

    start_date_str = request.args.get("start_date")
    end_date_str = request.args.get("end_date")
    search = request.args.get("search", "").strip()
    status = request.args.get("status", "").strip()
    shift_id = request.args.get("shift_id", type=int)
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)

    errors = {}
    if page < 1:
        errors["page"] = "page must be greater than or equal to 1"
    if page_size < 1 or page_size > 100:
        errors["pageSize"] = "pageSize must be between 1 and 100"

    if not start_date_str and not end_date_str:
        start_date = end_date = today
    else:
        try:
            start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date() if start_date_str else today
            end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date() if end_date_str else today
        except ValueError:
            return validation_error_response({"start_date": "Dates must be in YYYY-MM-DD format"})

    if start_date > end_date:
        return validation_error_response({"start_date": "start_date cannot be after end_date"})

    earliest_allowed = earliest_allowed_history_date(today)
    if start_date < earliest_allowed:
        start_date = earliest_allowed
    if end_date > today:
        end_date = today
    if start_date > end_date:
        start_date = end_date

    if errors:
        return validation_error_response(errors)

    # For a single day that is today the list is driven by the team (every
    # active direct report), not by attendance rows, so employees who
    # haven't checked in yet still show up as "Not Checked In". Any other
    # range stays attendance-row-based, same as before.
    today_only = start_date == end_date == today

    if today_only:
        conditions = ["e.reporting_manager_id = %s", "e.is_archived = FALSE"]
        params = [manager_id]
        shift_column = "COALESCE(a.shift_id, r.shift_id, e.shift_id)"
    else:
        conditions = ["e.reporting_manager_id = %s", "a.attendance_date BETWEEN %s AND %s"]
        params = [manager_id, start_date, end_date]
        shift_column = "a.shift_id"

    if search:
        conditions.append(
            "(e.first_name LIKE %s OR e.last_name LIKE %s "
            "OR CONCAT_WS(' ', e.first_name, e.last_name) LIKE %s OR e.employee_code LIKE %s)"
        )
        like = f"%{search}%"
        params.extend([like, like, like, like])
    if status == "Not Checked In" and today_only:
        conditions.append("a.attendance_id IS NULL")
    elif status == "On Leave":
        # display_status "On Leave" is computed from Absent + leave_request_id
        # (see format_attendance_entry) - the raw status column is never
        # actually 'On Leave' in practice, so filtering on the raw column
        # directly would silently match nothing.
        conditions.append("a.status = 'Absent' AND a.leave_request_id IS NOT NULL")
    elif status == "Absent":
        # A genuine Absent filter should exclude leave-driven rows, which
        # display as "On Leave" instead - same distinction the summary
        # counts already make.
        conditions.append("a.status = 'Absent' AND a.leave_request_id IS NULL")
    elif status:
        conditions.append("a.status = %s")
        params.append(status)
    if shift_id:
        conditions.append(f"{shift_column} = %s")
        params.append(shift_id)

    where_clause = "WHERE " + " AND ".join(conditions)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(
            "SELECT employee_id FROM employees WHERE reporting_manager_id = %s AND is_archived = FALSE",
            (manager_id,)
        )
        team_ids = [row["employee_id"] for row in cursor.fetchall()]
        reconcile_absences(cursor, None, start_date, end_date, employee_ids=team_ids)

        offset = (page - 1) * page_size

        if today_only:
            # Effective shift: the attendance row's own snapshot if there is
            # one, else today's roster shift, else the default shift.
            team_from = """
                FROM employees e
                JOIN departments d ON e.department_id = d.department_id
                LEFT JOIN attendance a ON a.employee_id = e.employee_id AND a.attendance_date = %s
                LEFT JOIN shift_rosters r ON r.employee_id = e.employee_id AND r.roster_date = %s
                LEFT JOIN shifts s ON s.shift_id = COALESCE(a.shift_id, r.shift_id, e.shift_id)
            """
            today_params = [today, today] + params

            cursor.execute(f"SELECT COUNT(*) AS total {team_from} {where_clause}", today_params)
            total = cursor.fetchone()["total"]

            cursor.execute(
                f"""SELECT a.attendance_id, e.employee_id, s.shift_id, a.attendance_date,
                           a.check_in_time, a.check_out_time, a.status, a.leave_request_id,
                           e.employee_code, e.first_name, e.last_name,
                           d.department_id, d.department_name,
                           s.shift_name, s.start_time, s.end_time
                    {team_from}
                    {where_clause}
                    ORDER BY e.first_name, e.last_name
                    LIMIT %s OFFSET %s""",
                today_params + [page_size, offset]
            )
            entries = [format_attendance_entry(e) for e in cursor.fetchall()]
            today_info = get_day_info_for(cursor, today)
            for entry in entries:
                if entry["attendance_id"] is None:
                    # On a weekend/holiday nobody is expected in, so show that
                    # instead of "Not Checked In".
                    entry["display_status"] = "Not Checked In" if today_info["is_working_day"] else today_info["kind"]
        else:
            cursor.execute(
                f"SELECT COUNT(*) AS total FROM attendance a JOIN employees e ON a.employee_id = e.employee_id {where_clause}",
                params
            )
            total = cursor.fetchone()["total"]

            cursor.execute(
                f"""{ATTENDANCE_SELECT}
                    {where_clause}
                    ORDER BY a.attendance_date DESC, e.first_name, e.last_name
                    LIMIT %s OFFSET %s""",
                params + [page_size, offset]
            )
            entries = [format_attendance_entry(e) for e in cursor.fetchall()]

        annotate_day_kind(cursor, entries)

        connection.commit()

        return success_response(data={
            "records": entries,
            "total": total,
            "page": page,
            "pageSize": page_size,
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d"),
            "calendar": special_days(cursor, start_date, end_date),
        })

    except pymysql.MySQLError as e:
        print(f"Get team attendance error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@attendance_bp.route("/manager/team/attendance/summary", methods=["GET"])
@require_employee_auth
def get_team_attendance_summary():
    """
    The 6 team summary cards. "Not Checked In" only has a real meaning
    for a single day that is today (an interim state - not yet resolved
    to Present/Late/Absent because the shift, or half of it, hasn't
    elapsed yet); for any other range it's reported as 0 rather than a
    fabricated number.
    """
    manager_id = request.current_employee["employee_id"]
    today = datetime.now().date()

    start_date_str = request.args.get("start_date")
    end_date_str = request.args.get("end_date")

    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date() if start_date_str else today
        end_date = datetime.strptime(end_date_str, "%Y-%m-%d").date() if end_date_str else today
    except ValueError:
        return validation_error_response({"start_date": "Dates must be in YYYY-MM-DD format"})

    earliest_allowed = earliest_allowed_history_date(today)
    start_date = max(start_date, earliest_allowed)
    end_date = min(end_date, today)
    if start_date > end_date:
        start_date = end_date

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(
            "SELECT employee_id FROM employees WHERE reporting_manager_id = %s AND is_archived = FALSE",
            (manager_id,)
        )
        team_ids = [row["employee_id"] for row in cursor.fetchall()]
        team_members = len(team_ids)

        reconcile_absences(cursor, None, start_date, end_date, employee_ids=team_ids)

        orphan_clause, orphan_params = exclude_non_working_absences(cursor, start_date, end_date, prefix="a.")
        cursor.execute(
            """SELECT
                   SUM(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE 0 END) AS present,
                   SUM(CASE WHEN a.status = 'Absent' AND a.leave_request_id IS NULL THEN 1 ELSE 0 END) AS absent,
                   SUM(CASE WHEN a.status = 'Half Day' THEN 1 ELSE 0 END) AS half_day,
                   SUM(CASE WHEN a.status = 'On Leave'
                             OR (a.status = 'Absent' AND a.leave_request_id IS NOT NULL) THEN 1 ELSE 0 END) AS on_leave
               FROM attendance a
               JOIN employees e ON a.employee_id = e.employee_id
               WHERE e.reporting_manager_id = %s AND a.attendance_date BETWEEN %s AND %s""" + orphan_clause,
            (manager_id, start_date, end_date, *orphan_params)
        )
        summary = cursor.fetchone()
        for key in ("present", "absent", "half_day", "on_leave"):
            summary[key] = summary[key] or 0

        not_checked_in = 0
        if start_date == end_date == today and team_ids and get_day_info_for(cursor, today)["is_working_day"]:
            placeholders = ", ".join(["%s"] * len(team_ids))
            cursor.execute(
                f"""SELECT COUNT(*) AS count FROM employees e
                    LEFT JOIN attendance a ON a.employee_id = e.employee_id AND a.attendance_date = %s
                    WHERE e.employee_id IN ({placeholders}) AND a.attendance_id IS NULL""",
                [today] + team_ids
            )
            not_checked_in = cursor.fetchone()["count"]

        connection.commit()

        summary["team_members"] = team_members
        summary["not_checked_in"] = not_checked_in

        return success_response(data=summary)

    except pymysql.MySQLError as e:
        print(f"Get team attendance summary error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@attendance_bp.route("/manager/team/attendance/exceptions", methods=["GET"])
@require_employee_auth
def get_team_attendance_exceptions():
    """
    Today-only exceptions for the manager's direct reports: late
    arrivals, early departures (checked out before shift end), and
    missing checkouts (checked in, shift over, still no checkout).
    No "Pending Corrections" tile - there is no correction-REQUEST
    workflow/entity anywhere in this system today (only a direct admin
    edit via PUT /attendance/<id>), so that count would have nothing
    real to report.
    """
    manager_id = request.current_employee["employee_id"]
    today = datetime.now().date()

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(
            f"{ATTENDANCE_SELECT} WHERE e.reporting_manager_id = %s AND a.attendance_date = %s",
            (manager_id, today)
        )
        entries = [format_attendance_entry(e) for e in cursor.fetchall()]

        late_arrivals = sum(1 for e in entries if e["is_late"])
        early_departures = sum(1 for e in entries if e["is_early_departure"])
        missing_checkouts = sum(1 for e in entries if e["is_missing_checkout"])

        return success_response(data={
            "late_arrivals": late_arrivals,
            "early_departures": early_departures,
            "missing_checkouts": missing_checkouts,
        })

    except pymysql.MySQLError as e:
        print(f"Get team attendance exceptions error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Admin / HR
# ---------------------------------------------------------------------

@attendance_bp.route("/attendance", methods=["GET"])
@require_permission("attendance.view")
def get_attendance():
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

    conditions = ["a.attendance_date BETWEEN %s AND %s"]
    params = [start_date, end_date]

    if department_id:
        conditions.append("e.department_id = %s")
        params.append(department_id)

    if employee_id:
        conditions.append("a.employee_id = %s")
        params.append(employee_id)

    where_clause = "WHERE " + " AND ".join(conditions)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        try:
            reconcile_absences(
                cursor,
                request.current_admin["admin_id"],
                datetime.strptime(start_date, "%Y-%m-%d").date(),
                datetime.strptime(end_date, "%Y-%m-%d").date(),
            )
            connection.commit()
        except ValueError:
            pass  # malformed date strings - skip reconciliation, still return the list

        cursor.execute(
            f"{ATTENDANCE_SELECT} {where_clause} ORDER BY a.attendance_date DESC, e.first_name, e.last_name",
            params
        )
        entries = [format_attendance_entry(e) for e in cursor.fetchall()]
        annotate_day_kind(cursor, entries)

        return success_response(data=entries)

    except pymysql.MySQLError as e:
        print(f"Get attendance error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@attendance_bp.route("/attendance", methods=["POST"])
@require_permission("attendance.create")
def create_attendance():
    """
    Manual "Mark Absent" / "Mark Half Day" - the only two statuses an
    admin can directly set. Present/Late are always derived server-side
    from an actual check-in, never chosen manually here.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return error_response("Invalid request body", status_code=400)

    employee_id = data.get("employee_id")
    attendance_date = data.get("attendance_date")
    status = data.get("status")
    reason = data.get("reason")
    reason = reason.strip() if isinstance(reason, str) else ""

    errors = {}
    if not employee_id:
        errors["employee_id"] = "Employee is required"
    elif not is_valid_id(employee_id):
        errors["employee_id"] = "Employee is invalid"

    if not attendance_date:
        errors["attendance_date"] = "Date is required"
    else:
        parsed_date = parse_date_str(attendance_date)
        if parsed_date is None:
            errors["attendance_date"] = "Date must be a valid date in YYYY-MM-DD format"
        elif parsed_date > datetime.now().date():
            errors["attendance_date"] = "Cannot mark attendance for a future date"

    if not status:
        errors["status"] = "Status is required"
    elif status not in ("Absent", "Half Day"):
        errors["status"] = "Status must be Absent or Half Day"
    if not reason:
        errors["reason"] = "Reason is required"

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

        # Checked before the existing-row check so the admin is told it is the
        # leave that conflicts. This also covers a date inside an approved leave
        # that has no attendance row of its own (see NOT_ON_APPROVED_LEAVE).
        cursor.execute(
            "SELECT leave_request_id FROM leave_requests "
            "WHERE employee_id = %s AND status = 'Approved' AND %s BETWEEN start_date AND end_date LIMIT 1",
            (employee_id, attendance_date)
        )
        if cursor.fetchone():
            return validation_error_response(
                {"attendance_date": "This employee has approved leave on this date"}
            )

        rostered_shift = get_rostered_shift(cursor, employee_id, attendance_date)
        shift_id = rostered_shift["shift_id"] if rostered_shift else None

        cursor.execute(
            "SELECT attendance_id FROM attendance WHERE employee_id = %s AND attendance_date = %s",
            (employee_id, attendance_date)
        )
        if cursor.fetchone():
            return validation_error_response(
                {"attendance_date": "This employee already has an attendance record on this date"}
            )

        cursor.execute(
            "INSERT INTO attendance (employee_id, shift_id, attendance_date, status) "
            "VALUES (%s, %s, %s, %s)",
            (employee_id, shift_id, attendance_date, status)
        )
        log_action(cursor, request.current_admin["admin_id"], "create", "attendance", cursor.lastrowid, details=reason)
        connection.commit()

        return created_response(
            "Attendance record created successfully", data=fetch_attendance_entry(cursor, cursor.lastrowid)
        )

    except pymysql.err.IntegrityError:
        return error_response("This employee already has an attendance record on this date", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create attendance error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@attendance_bp.route("/attendance/<int:attendance_id>", methods=["PUT"])
@require_permission("attendance.update")
def update_attendance(attendance_id):
    """
    "Correct Attendance" - admin can correct the shift/check-in/check-out
    for an existing record, with a mandatory reason. Status is always
    recalculated here from the (corrected) check-in time against the
    shift's start time and the 15-minute grace period - with one narrow
    exception: "Half Day" can't be derived from a timestamp (it's a
    judgment call, same as the manual Mark Half Day action), so it's the
    only status value the client may explicitly request. Any other
    client-supplied status is ignored; Present/Late/Absent are never
    accepted directly.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return error_response("Invalid request body", status_code=400)

    check_in_time = data.get("check_in_time") or None
    check_out_time = data.get("check_out_time") or None
    shift_id = data.get("shift_id") or None
    requested_status = data.get("status")
    reason = data.get("reason")
    reason = reason.strip() if isinstance(reason, str) else ""

    errors = {}
    if not reason:
        errors["reason"] = "Correction reason is required"

    check_in_dt = check_out_dt = None
    if check_in_time is not None:
        check_in_dt = parse_datetime_str(check_in_time)
        if check_in_dt is None:
            errors["check_in_time"] = "Check-in time must be a valid date and time"
    if check_out_time is not None:
        check_out_dt = parse_datetime_str(check_out_time)
        if check_out_dt is None:
            errors["check_out_time"] = "Check-out time must be a valid date and time"
    if check_in_dt and check_out_dt and check_out_dt < check_in_dt:
        errors["check_out_time"] = "Check-out time cannot be before check-in time"
    if shift_id is not None and not is_valid_id(shift_id):
        errors["shift_id"] = "Shift is invalid"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM attendance WHERE attendance_id = %s", (attendance_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Attendance record not found")

        effective_shift_id = shift_id or existing["shift_id"]
        shift_start_time = None

        if effective_shift_id:
            shift = get_shift_record(cursor, effective_shift_id)
            if not shift:
                return error_response("Selected shift does not exist", status_code=400)
            if shift_id and shift["is_archived"]:
                return error_response("Selected shift is archived", status_code=400)
            shift_start_time = shift["start_time"]

        if requested_status == "Half Day":
            status = "Half Day"
        else:
            status = derive_attendance_status(check_in_dt, shift_start_time)

        # This is a manual admin/HR edit, so it always clears leave_request_id -
        # this is what leave reversal checks to know a leave-generated row has
        # since been manually overridden and must not be touched or deleted.
        cursor.execute(
            "UPDATE attendance SET shift_id = %s, check_in_time = %s, check_out_time = %s, status = %s, "
            "leave_request_id = NULL WHERE attendance_id = %s",
            (effective_shift_id, check_in_time, check_out_time, status, attendance_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "attendance", attendance_id, details=reason)
        connection.commit()

        return success_response(
            "Attendance record updated successfully", data=fetch_attendance_entry(cursor, attendance_id)
        )

    except pymysql.MySQLError as e:
        print(f"Update attendance error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()