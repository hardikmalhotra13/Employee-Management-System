import pymysql
from datetime import datetime, date
from flask import Blueprint, request
from database.connection import get_db_connection
from utils.response_helpers import (
    success_response,
    created_response,
    error_response,
    validation_error_response,
    not_found_response,
)
from utils.auth_helper import require_auth, require_permission, require_employee_auth
from utils.audit_helper import log_action
from utils.notification_helper import notify_all_employees
from utils.calendar_helper import WEEKEND_WEEKDAYS, special_days

holiday_bp = Blueprint("holiday", __name__)

DAY_TYPES = ("Holiday", "Working Day")
MAX_CALENDAR_RANGE_DAYS = 400
HOLIDAY_LINK = "/employee/holidays"


def describe_day(day_type, day):
    label = day.strftime("%a, %d %b %Y")
    if day_type == "Holiday":
        return f"office closed on {label}"
    return f"office open on {label} (a weekend worked as a normal day)"


def notify_holiday_change(cursor, event, holiday_id, new=None, old=None):
    """
    Tells every eligible employee about a declared / updated / cancelled office
    holiday or working-day override: one in-app notification each, written in
    the caller's transaction. `new` / `old` are (day_type, date, title).
    """
    if event == "declared":
        day_type, day, title = new
        heading = "Office holiday declared" if day_type == "Holiday" else "Working day declared"
        message = f"{title}: {describe_day(day_type, day)}."
    elif event == "updated":
        day_type, day, title = new
        old_type, old_day, old_title = old
        heading = "Office holiday updated" if day_type == "Holiday" else "Working day updated"
        message = (
            f"{title}: {describe_day(day_type, day)}. "
            f"Previously: {old_title}, {describe_day(old_type, old_day)}."
        )
    else:  # cancelled
        day_type, day, title = old
        heading = "Office holiday cancelled" if day_type == "Holiday" else "Working day cancelled"
        outcome = "the office is open as usual" if day_type == "Holiday" else "the office stays closed that day"
        message = f"{title} on {day.strftime('%a, %d %b %Y')} has been cancelled - {outcome}."

    notify_all_employees(
        cursor, f"holiday_{event}", heading, message[:500],
        link=HOLIDAY_LINK, related_entity_type="holiday", related_entity_id=holiday_id
    )


def format_holiday(entry):
    if entry:
        if entry.get("holiday_date"):
            entry["holiday_date"] = entry["holiday_date"].strftime("%Y-%m-%d")
        for key in ("created_at", "updated_at"):
            if entry.get(key):
                entry[key] = entry[key].strftime("%Y-%m-%d %H:%M:%S")
    return entry


def fetch_holiday(cursor, holiday_id):
    cursor.execute("SELECT * FROM office_holidays WHERE holiday_id = %s", (holiday_id,))
    return format_holiday(cursor.fetchone())


def validate_holiday_payload(data):
    """Returns (errors, parsed_date, day_type, title)."""
    errors = {}
    holiday_date = data.get("holiday_date")
    day_type = data.get("day_type")
    raw_title = data.get("title")
    title = raw_title.strip() if isinstance(raw_title, str) else ""
    parsed = None

    if not holiday_date:
        errors["holiday_date"] = "Date is required"
    else:
        try:
            parsed = datetime.strptime(holiday_date, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            errors["holiday_date"] = "Date must be a valid date in YYYY-MM-DD format"

    if day_type not in DAY_TYPES:
        errors["day_type"] = "Type must be Holiday or Working Day"

    if raw_title is not None and not isinstance(raw_title, str):
        errors["title"] = "Title must be text"
    elif not title:
        errors["title"] = "Title is required"
    elif len(title) > 100:
        errors["title"] = "Title must be 100 characters or fewer"

    # Saturday/Sunday are already non-working and weekdays are already
    # working, so only the two meaningful combinations are accepted.
    if parsed and day_type in DAY_TYPES:
        is_weekend = parsed.weekday() in WEEKEND_WEEKDAYS
        if day_type == "Holiday" and is_weekend:
            errors["day_type"] = (
                "Saturdays and Sundays are already holidays by default - add a Holiday for a weekday, "
                "or choose Working Day to work a weekend"
            )
        elif day_type == "Working Day" and not is_weekend:
            errors["day_type"] = "Working Day applies only to a Saturday or Sunday - weekdays are already working days"

    return errors, parsed, day_type, title


def parse_range(start_date_str, end_date_str):
    """Returns (errors, start, end) for a calendar-days request."""
    errors = {}
    start = end = None
    if not start_date_str:
        errors["start_date"] = "start_date is required"
    if not end_date_str:
        errors["end_date"] = "end_date is required"
    if errors:
        return errors, None, None
    try:
        start = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        end = datetime.strptime(end_date_str, "%Y-%m-%d").date()
    except ValueError:
        return {"start_date": "Dates must be in YYYY-MM-DD format"}, None, None
    if end < start:
        return {"end_date": "end_date cannot be before start_date"}, None, None
    if (end - start).days + 1 > MAX_CALENDAR_RANGE_DAYS:
        return {"end_date": f"Date range cannot exceed {MAX_CALENDAR_RANGE_DAYS} days"}, None, None
    return {}, start, end


# ---------------------------------------------------------------------
# Admin / HR
# ---------------------------------------------------------------------

@holiday_bp.route("/holidays", methods=["GET"])
@require_permission("holidays.view")
def get_holidays():
    year = request.args.get("year", date.today().year, type=int)
    if year < 2000 or year > 2100:
        return validation_error_response({"year": "year must be between 2000 and 2100"})

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT * FROM office_holidays WHERE holiday_date BETWEEN %s AND %s ORDER BY holiday_date",
            (date(year, 1, 1), date(year, 12, 31))
        )
        return success_response(data=[format_holiday(h) for h in cursor.fetchall()])

    except pymysql.MySQLError as e:
        print(f"Get holidays error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@holiday_bp.route("/holidays", methods=["POST"])
@require_permission("holidays.create")
def create_holiday():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return error_response("Invalid request body", status_code=400)

    errors, parsed_date, day_type, title = validate_holiday_payload(data)
    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute("SELECT holiday_id FROM office_holidays WHERE holiday_date = %s", (parsed_date,))
        if cursor.fetchone():
            return validation_error_response(
                {"holiday_date": "A holiday or working-day override already exists for this date"}
            )

        admin_id = request.current_admin["admin_id"]
        cursor.execute(
            "INSERT INTO office_holidays (holiday_date, day_type, title, created_by) VALUES (%s, %s, %s, %s)",
            (parsed_date, day_type, title, admin_id)
        )
        holiday_id = cursor.lastrowid
        log_action(
            cursor, admin_id, "create", "holiday", holiday_id,
            details=f"{day_type} on {parsed_date}: {title}"
        )
        notify_holiday_change(cursor, "declared", holiday_id, new=(day_type, parsed_date, title))
        connection.commit()

        return created_response("Saved successfully", data=fetch_holiday(cursor, holiday_id))

    except pymysql.err.IntegrityError:
        return validation_error_response(
            {"holiday_date": "A holiday or working-day override already exists for this date"}
        )

    except pymysql.MySQLError as e:
        print(f"Create holiday error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@holiday_bp.route("/holidays/<int:holiday_id>", methods=["PUT"])
@require_permission("holidays.update")
def update_holiday(holiday_id):
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return error_response("Invalid request body", status_code=400)

    errors, parsed_date, day_type, title = validate_holiday_payload(data)
    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute("SELECT * FROM office_holidays WHERE holiday_id = %s", (holiday_id,))
        existing = cursor.fetchone()
        if not existing:
            return not_found_response("Holiday not found")

        cursor.execute(
            "SELECT holiday_id FROM office_holidays WHERE holiday_date = %s AND holiday_id != %s",
            (parsed_date, holiday_id)
        )
        if cursor.fetchone():
            return validation_error_response(
                {"holiday_date": "A holiday or working-day override already exists for this date"}
            )

        cursor.execute(
            "UPDATE office_holidays SET holiday_date = %s, day_type = %s, title = %s WHERE holiday_id = %s",
            (parsed_date, day_type, title, holiday_id)
        )
        log_action(
            cursor, request.current_admin["admin_id"], "update", "holiday", holiday_id,
            details=(
                f"Changed from {existing['day_type']} on {existing['holiday_date']} ({existing['title']}) "
                f"to {day_type} on {parsed_date} ({title})"
            )
        )
        # An edit that changes nothing must not re-notify everyone (this also covers a repeated submit).
        if (existing["day_type"], existing["holiday_date"], existing["title"]) != (day_type, parsed_date, title):
            notify_holiday_change(
                cursor, "updated", holiday_id,
                new=(day_type, parsed_date, title),
                old=(existing["day_type"], existing["holiday_date"], existing["title"]),
            )
        connection.commit()

        return success_response("Updated successfully", data=fetch_holiday(cursor, holiday_id))

    except pymysql.err.IntegrityError:
        return validation_error_response(
            {"holiday_date": "A holiday or working-day override already exists for this date"}
        )

    except pymysql.MySQLError as e:
        print(f"Update holiday error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@holiday_bp.route("/holidays/<int:holiday_id>", methods=["DELETE"])
@require_permission("holidays.delete")
def delete_holiday(holiday_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute("SELECT * FROM office_holidays WHERE holiday_id = %s", (holiday_id,))
        existing = cursor.fetchone()
        if not existing:
            return not_found_response("Holiday not found")

        # Only the calendar exception is removed - attendance, leave and
        # roster rows that already exist for that date are left untouched.
        cursor.execute("DELETE FROM office_holidays WHERE holiday_id = %s", (holiday_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "holiday", holiday_id,
            details=f"Removed {existing['day_type']} on {existing['holiday_date']}: {existing['title']}"
        )
        notify_holiday_change(
            cursor, "cancelled", holiday_id,
            old=(existing["day_type"], existing["holiday_date"], existing["title"])
        )
        connection.commit()

        return success_response("Deleted successfully")

    except pymysql.MySQLError as e:
        print(f"Delete holiday error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@holiday_bp.route("/calendar/days", methods=["GET"])
@require_auth
def get_calendar_days():
    """
    Non-working / overridden days in a date range, for marking columns
    and rows in the admin screens (e.g. the roster grid). Any signed-in
    admin may call this - it needs no holidays.* permission because a
    user with roster/attendance access must be able to see which days
    are holidays.
    """
    errors, start, end = parse_range(request.args.get("start_date"), request.args.get("end_date"))
    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        return success_response(data=special_days(cursor, start, end))

    except pymysql.MySQLError as e:
        print(f"Get calendar days error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Employee self-service
# ---------------------------------------------------------------------

@holiday_bp.route("/employee/holidays", methods=["GET"])
@require_employee_auth
def get_my_holiday_calendar():
    """Every non-working / overridden day of a year, for the employee holiday calendar."""
    year = request.args.get("year", date.today().year, type=int)
    if year < 2000 or year > 2100:
        return validation_error_response({"year": "year must be between 2000 and 2100"})

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        days = special_days(cursor, date(year, 1, 1), date(year, 12, 31))
        return success_response(data={"year": year, "days": days})

    except pymysql.MySQLError as e:
        print(f"Get my holiday calendar error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()