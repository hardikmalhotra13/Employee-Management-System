import re
from datetime import datetime

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
from utils.notification_helper import create_notification, notify_all_admins

performance_bp = Blueprint("performance", __name__)

VALID_CYCLE_STATUSES = ("Active", "Inactive")
REVIEW_STATUSES = ("Draft", "Submitted")

# Presentation-only labels for the 1-5 rating scale already used
# throughout the existing Add/Edit Review UI - not stored in the
# database, computed fresh on every response.
RATING_LABELS = {
    1: "Poor",
    2: "Needs Improvement",
    3: "Meets Expectations",
    4: "Exceeds Expectations",
    5: "Outstanding",
}

REVIEW_SELECT = """
    SELECT pr.review_id, pr.employee_id, pr.cycle_id, pr.rating, pr.comments, pr.status,
           pr.reviewer_employee_id, pr.reviewer_admin_id, pr.submitted_at, pr.created_at, pr.updated_at,
           e.employee_code, e.first_name, e.last_name,
           c.cycle_name, c.start_date, c.end_date,
           rm.first_name AS reviewer_employee_first_name, rm.last_name AS reviewer_employee_last_name,
           ra.name AS reviewer_admin_name
    FROM performance_reviews pr
    JOIN employees e ON pr.employee_id = e.employee_id
    JOIN review_cycles c ON pr.cycle_id = c.cycle_id
    LEFT JOIN employees rm ON pr.reviewer_employee_id = rm.employee_id
    LEFT JOIN admins ra ON pr.reviewer_admin_id = ra.admin_id
"""


def format_review_entry(entry):
    if entry:
        if entry.get("rating") is not None:
            entry["rating_label"] = RATING_LABELS.get(entry["rating"])
        if entry.get("start_date"):
            entry["start_date"] = entry["start_date"].strftime("%Y-%m-%d")
        if entry.get("end_date"):
            entry["end_date"] = entry["end_date"].strftime("%Y-%m-%d")
        if entry.get("submitted_at"):
            entry["submitted_at"] = entry["submitted_at"].strftime("%Y-%m-%d %H:%M:%S")
        if entry.get("created_at"):
            entry["created_at"] = entry["created_at"].strftime("%Y-%m-%d %H:%M:%S")
        if entry.get("updated_at"):
            entry["updated_at"] = entry["updated_at"].strftime("%Y-%m-%d %H:%M:%S")
    return entry


def fetch_review_entry(cursor, review_id):
    cursor.execute(f"{REVIEW_SELECT} WHERE pr.review_id = %s", (review_id,))
    return format_review_entry(cursor.fetchone())


def get_employee_record(cursor, employee_id):
    cursor.execute(
        "SELECT employee_id, reporting_manager_id, is_archived, status, first_name, last_name "
        "FROM employees WHERE employee_id = %s",
        (employee_id,)
    )
    return cursor.fetchone()


def parse_date(value):
    """
    Strict YYYY-MM-DD only. datetime.strptime("%Y-%m-%d") alone is lenient
    about padding (e.g. it happily accepts "2026-4-5"), so the exact
    4-2-2 digit shape is checked first.
    """
    if not isinstance(value, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def validate_rating_and_comments(data):
    errors = {}

    rating = data.get("rating")
    try:
        rating = int(rating)
    except (TypeError, ValueError):
        rating = None

    if rating is None or rating < 1 or rating > 5:
        errors["rating"] = "Rating must be a whole number between 1 and 5"

    comments = data.get("comments")
    if comments and len(comments) > 500:
        errors["comments"] = "Comments must be 500 characters or fewer"

    return rating, comments, errors


def notify_review_submitted(cursor, review):
    create_notification(
        cursor,
        review["employee_id"],
        "performance_review_submitted",
        "Your performance review has been submitted",
        f"Your performance review for {review['cycle_name']} has been submitted.",
        link="/employee/performance",
        related_entity_type="performance_review",
        related_entity_id=review["review_id"],
    )

    notify_all_admins(
        cursor,
        "performance_review_submitted",
        "Performance review submitted",
        f"A performance review for {review['first_name']} {review['last_name']} "
        f"({review['cycle_name']}) has been submitted.",
        link=f"/admin/employees/{review['employee_id']}",
        related_entity_type="performance_review",
        related_entity_id=review["review_id"],
    )


# ---------------------------------------------------------------------
# review_cycles (catalog) - mirrors onboarding/offboarding checklist
# item catalogs, with start_date/end_date instead of is_required/
# display_order.
# ---------------------------------------------------------------------

@performance_bp.route("/review-cycles", methods=["GET"])
@require_permission("performance.view")
def get_review_cycles():
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
        cursor.execute(f"SELECT COUNT(*) AS total FROM review_cycles {where_clause}")
        total = cursor.fetchone()["total"]

        cursor.execute(
            f"SELECT * FROM review_cycles {where_clause} ORDER BY start_date DESC, cycle_id DESC "
            f"LIMIT %s OFFSET %s",
            (page_size, offset)
        )
        cycles = cursor.fetchall()
        for cycle in cycles:
            cycle["start_date"] = cycle["start_date"].strftime("%Y-%m-%d")
            cycle["end_date"] = cycle["end_date"].strftime("%Y-%m-%d")

        return success_response(data={
            "records": cycles,
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get review cycles error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@performance_bp.route("/review-cycles", methods=["POST"])
@require_permission("performance.manage")
def create_review_cycle():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    cycle_name = data.get("cycle_name")
    start_date = parse_date(data.get("start_date"))
    end_date = parse_date(data.get("end_date"))
    status = data.get("status", "Active")

    errors = {}
    if not cycle_name or not cycle_name.strip():
        errors["cycle_name"] = "Cycle name is required"
    if not start_date:
        errors["start_date"] = "A valid start date (YYYY-MM-DD) is required"
    if not end_date:
        errors["end_date"] = "A valid end date (YYYY-MM-DD) is required"
    if start_date and end_date and start_date > end_date:
        errors["end_date"] = "End date cannot be before start date"
    if status not in VALID_CYCLE_STATUSES:
        errors["status"] = "Status must be Active or Inactive"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute("SELECT MAX(cycle_id) AS max_id FROM review_cycles")
        max_id = cursor.fetchone()["max_id"] or 0
        cycle_code = f"CYC{max_id + 1:04d}"

        cursor.execute(
            "INSERT INTO review_cycles (cycle_code, cycle_name, start_date, end_date, status) "
            "VALUES (%s, %s, %s, %s, %s)",
            (cycle_code, cycle_name.strip(), start_date, end_date, status)
        )
        new_cycle_id = cursor.lastrowid
        log_action(cursor, request.current_admin["admin_id"], "create", "review_cycle", new_cycle_id, details=cycle_name.strip())
        connection.commit()

        cursor.execute("SELECT * FROM review_cycles WHERE cycle_id = %s", (new_cycle_id,))
        cycle = cursor.fetchone()
        cycle["start_date"] = cycle["start_date"].strftime("%Y-%m-%d")
        cycle["end_date"] = cycle["end_date"].strftime("%Y-%m-%d")

        return created_response("Review cycle created successfully", data=cycle)

    except pymysql.MySQLError as e:
        print(f"Create review cycle error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@performance_bp.route("/review-cycles/<int:cycle_id>", methods=["PUT"])
@require_permission("performance.manage")
def update_review_cycle(cycle_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    cycle_name = data.get("cycle_name")
    start_date = parse_date(data.get("start_date"))
    end_date = parse_date(data.get("end_date"))
    status = data.get("status")

    errors = {}
    if not cycle_name or not cycle_name.strip():
        errors["cycle_name"] = "Cycle name is required"
    if not start_date:
        errors["start_date"] = "A valid start date (YYYY-MM-DD) is required"
    if not end_date:
        errors["end_date"] = "A valid end date (YYYY-MM-DD) is required"
    if start_date and end_date and start_date > end_date:
        errors["end_date"] = "End date cannot be before start date"
    if status not in VALID_CYCLE_STATUSES:
        errors["status"] = "Status must be Active or Inactive"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM review_cycles WHERE cycle_id = %s", (cycle_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Review cycle not found")

        cursor.execute(
            "UPDATE review_cycles SET cycle_name = %s, start_date = %s, end_date = %s, status = %s "
            "WHERE cycle_id = %s",
            (cycle_name.strip(), start_date, end_date, status, cycle_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "review_cycle", cycle_id)
        connection.commit()

        cursor.execute("SELECT * FROM review_cycles WHERE cycle_id = %s", (cycle_id,))
        cycle = cursor.fetchone()
        cycle["start_date"] = cycle["start_date"].strftime("%Y-%m-%d")
        cycle["end_date"] = cycle["end_date"].strftime("%Y-%m-%d")

        return success_response("Review cycle updated successfully", data=cycle)

    except pymysql.MySQLError as e:
        print(f"Update review cycle error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@performance_bp.route("/review-cycles/<int:cycle_id>", methods=["DELETE"])
@require_permission("performance.manage")
def archive_review_cycle(cycle_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM review_cycles WHERE cycle_id = %s", (cycle_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Review cycle not found")

        cursor.execute("UPDATE review_cycles SET is_archived = TRUE WHERE cycle_id = %s", (cycle_id,))
        log_action(cursor, request.current_admin["admin_id"], "archive", "review_cycle", cycle_id)
        connection.commit()

        return success_response("Review cycle archived successfully")

    except pymysql.MySQLError as e:
        print(f"Archive review cycle error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@performance_bp.route("/review-cycles/<int:cycle_id>/restore", methods=["PUT"])
@require_permission("performance.manage")
def restore_review_cycle(cycle_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM review_cycles WHERE cycle_id = %s", (cycle_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Review cycle not found")

        if not existing["is_archived"]:
            return error_response("Review cycle is not archived", status_code=400)

        cursor.execute("UPDATE review_cycles SET is_archived = FALSE WHERE cycle_id = %s", (cycle_id,))
        log_action(cursor, request.current_admin["admin_id"], "restore", "review_cycle", cycle_id)
        connection.commit()

        cursor.execute("SELECT * FROM review_cycles WHERE cycle_id = %s", (cycle_id,))
        cycle = cursor.fetchone()
        cycle["start_date"] = cycle["start_date"].strftime("%Y-%m-%d")
        cycle["end_date"] = cycle["end_date"].strftime("%Y-%m-%d")

        return success_response("Review cycle restored successfully", data=cycle)

    except pymysql.MySQLError as e:
        print(f"Restore review cycle error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@performance_bp.route("/review-cycles/<int:cycle_id>/permanent", methods=["DELETE"])
@require_permission("performance.manage")
def permanently_delete_review_cycle(cycle_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM review_cycles WHERE cycle_id = %s", (cycle_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Review cycle not found")

        if not existing["is_archived"]:
            return error_response("Only archived review cycles can be permanently deleted", status_code=400)

        cursor.execute("DELETE FROM review_cycles WHERE cycle_id = %s", (cycle_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "review_cycle", cycle_id,
            details=existing["cycle_name"]
        )
        connection.commit()

        return success_response("Review cycle permanently deleted")

    except pymysql.err.IntegrityError:
        # ON DELETE RESTRICT blocks this if any performance review still references the cycle
        return error_response(
            "This review cycle is still used by one or more performance reviews and cannot be permanently deleted",
            status_code=409
        )

    except pymysql.MySQLError as e:
        print(f"Permanently delete review cycle error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Shared internal helpers used by both the admin and manager routes,
# same shape as leave_routes.py's _manager_review / _admin_review split.
# ---------------------------------------------------------------------

def _create_review(employee_id, reviewer_admin_id=None, reviewer_employee_id=None):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    cycle_id = data.get("cycle_id")
    rating, comments, errors = validate_rating_and_comments(data)
    if not cycle_id:
        errors["cycle_id"] = "cycle_id is required"

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
            return not_found_response("Employee not found")

        if employee["is_archived"] or employee["status"] == "Inactive":
            return error_response(
                "Cannot create a performance review for an archived or inactive employee", status_code=400
            )

        if reviewer_employee_id is not None and employee["reporting_manager_id"] != reviewer_employee_id:
            return not_found_response("Employee not found")

        cursor.execute(
            "SELECT * FROM review_cycles WHERE cycle_id = %s AND is_archived = FALSE AND status = 'Active'",
            (cycle_id,)
        )
        cycle = cursor.fetchone()
        if not cycle:
            return error_response("Review cycle not found or is not active", status_code=400)

        cursor.execute(
            "SELECT review_id FROM performance_reviews WHERE employee_id = %s AND cycle_id = %s",
            (employee_id, cycle_id)
        )
        if cursor.fetchone():
            return error_response("A review already exists for this employee for this cycle", status_code=409)

        cursor.execute(
            "INSERT INTO performance_reviews "
            "(employee_id, cycle_id, rating, comments, reviewer_admin_id, reviewer_employee_id) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (employee_id, cycle_id, rating, comments, reviewer_admin_id, reviewer_employee_id)
        )
        new_review_id = cursor.lastrowid

        if reviewer_admin_id is not None:
            log_action(cursor, reviewer_admin_id, "create", "performance_review", new_review_id)

        connection.commit()

        return created_response("Performance review created as Draft", data=fetch_review_entry(cursor, new_review_id))

    except pymysql.err.IntegrityError:
        return error_response("A review already exists for this employee for this cycle", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create performance review error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


def _update_review(review_id, admin_id=None, manager_employee_id=None):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    rating, comments, errors = validate_rating_and_comments(data)
    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM performance_reviews WHERE review_id = %s", (review_id,))
        review = cursor.fetchone()

        if not review:
            return not_found_response("Performance review not found")

        if manager_employee_id is not None:
            employee = get_employee_record(cursor, review["employee_id"])
            if not employee or employee["reporting_manager_id"] != manager_employee_id:
                return not_found_response("Performance review not found")

        if review["status"] != "Draft":
            return error_response("Only Draft reviews can be edited", status_code=400)

        cursor.execute(
            "UPDATE performance_reviews SET rating = %s, comments = %s WHERE review_id = %s",
            (rating, comments, review_id)
        )

        if admin_id is not None:
            log_action(cursor, admin_id, "update", "performance_review", review_id)

        connection.commit()

        return success_response("Performance review updated successfully", data=fetch_review_entry(cursor, review_id))

    except pymysql.MySQLError as e:
        print(f"Update performance review error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


def _submit_review(review_id, admin_id=None, manager_employee_id=None):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM performance_reviews WHERE review_id = %s", (review_id,))
        review = cursor.fetchone()

        if not review:
            return not_found_response("Performance review not found")

        if manager_employee_id is not None:
            employee = get_employee_record(cursor, review["employee_id"])
            if not employee or employee["reporting_manager_id"] != manager_employee_id:
                return not_found_response("Performance review not found")

        if review["status"] != "Draft":
            return error_response("Only Draft reviews can be submitted", status_code=400)

        cursor.execute(
            "UPDATE performance_reviews SET status = 'Submitted', submitted_at = NOW() WHERE review_id = %s",
            (review_id,)
        )

        if admin_id is not None:
            log_action(cursor, admin_id, "update", "performance_review", review_id, details="Submitted")

        submitted_review = fetch_review_entry(cursor, review_id)
        notify_review_submitted(cursor, submitted_review)

        connection.commit()

        return success_response("Performance review submitted successfully", data=submitted_review)

    except pymysql.MySQLError as e:
        print(f"Submit performance review error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


def _delete_review(review_id, admin_id=None, manager_employee_id=None):
    """
    Only a Draft review can be deleted, same lifecycle rule as edit/submit.
    No admin-side route calls this yet (not requested), but it follows the
    same admin_id/manager_employee_id shape as _update_review/_submit_review
    so one could be added later without restructuring this.
    """
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM performance_reviews WHERE review_id = %s", (review_id,))
        review = cursor.fetchone()

        if not review:
            return not_found_response("Performance review not found")

        if manager_employee_id is not None:
            employee = get_employee_record(cursor, review["employee_id"])
            if not employee or employee["reporting_manager_id"] != manager_employee_id:
                return not_found_response("Performance review not found")

        if review["status"] != "Draft":
            return error_response("Only Draft reviews can be deleted", status_code=400)

        cursor.execute("DELETE FROM performance_reviews WHERE review_id = %s", (review_id,))

        if admin_id is not None:
            log_action(cursor, admin_id, "delete", "performance_review", review_id)

        connection.commit()

        return success_response("Performance review deleted successfully")

    except pymysql.MySQLError as e:
        print(f"Delete performance review error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Admin/HR routes
# ---------------------------------------------------------------------

@performance_bp.route("/employees/<int:employee_id>/performance-reviews", methods=["GET"])
@require_permission("performance.view")
def get_employee_performance_reviews(employee_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        employee = get_employee_record(cursor, employee_id)
        if not employee:
            return not_found_response("Employee not found")

        cursor.execute(f"{REVIEW_SELECT} WHERE pr.employee_id = %s ORDER BY c.start_date DESC", (employee_id,))
        reviews = [format_review_entry(r) for r in cursor.fetchall()]

        return success_response(data=reviews)

    except pymysql.MySQLError as e:
        print(f"Get employee performance reviews error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@performance_bp.route("/employees/<int:employee_id>/performance-reviews", methods=["POST"])
@require_permission("performance.manage")
def create_employee_performance_review(employee_id):
    return _create_review(employee_id, reviewer_admin_id=request.current_admin["admin_id"])


@performance_bp.route("/performance-reviews/<int:review_id>", methods=["PUT"])
@require_permission("performance.manage")
def update_performance_review(review_id):
    return _update_review(review_id, admin_id=request.current_admin["admin_id"])


@performance_bp.route("/performance-reviews/<int:review_id>/submit", methods=["PUT"])
@require_permission("performance.manage")
def submit_performance_review(review_id):
    return _submit_review(review_id, admin_id=request.current_admin["admin_id"])


# ---------------------------------------------------------------------
# Manager (self-service auth, scoped to direct reports) routes
# ---------------------------------------------------------------------

@performance_bp.route("/manager/review-cycles", methods=["GET"])
@require_employee_auth
def get_manager_review_cycles():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT cycle_id, cycle_name, start_date, end_date FROM review_cycles "
            "WHERE is_archived = FALSE AND status = 'Active' ORDER BY start_date DESC"
        )
        cycles = cursor.fetchall()
        for cycle in cycles:
            cycle["start_date"] = cycle["start_date"].strftime("%Y-%m-%d")
            cycle["end_date"] = cycle["end_date"].strftime("%Y-%m-%d")

        return success_response(data=cycles)

    except pymysql.MySQLError as e:
        print(f"Get manager review cycles error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@performance_bp.route("/manager/team/performance-reviews", methods=["GET"])
@require_employee_auth
def get_team_performance_reviews():
    manager_id = request.current_employee["employee_id"]

    search = request.args.get("search")
    cycle_id = request.args.get("cycle_id")
    status = request.args.get("status")
    rating = request.args.get("rating")
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)

    errors = {}
    if page < 1:
        errors["page"] = "page must be greater than or equal to 1"
    if page_size < 1 or page_size > 100:
        errors["pageSize"] = "pageSize must be between 1 and 100"
    if status and status not in REVIEW_STATUSES:
        errors["status"] = "Invalid status"
    if rating:
        try:
            rating = int(rating)
            if rating < 1 or rating > 5:
                raise ValueError
        except ValueError:
            errors["rating"] = "Rating must be a whole number between 1 and 5"
    if errors:
        return validation_error_response(errors)

    # Direct-report scoping - unchanged, still the only thing that decides
    # which employees' reviews a manager can see or act on here.
    conditions = ["e.reporting_manager_id = %s"]
    params = [manager_id]

    if search:
        conditions.append(
            "(e.first_name LIKE %s OR e.last_name LIKE %s "
            "OR CONCAT_WS(' ', e.first_name, e.last_name) LIKE %s OR e.employee_code LIKE %s)"
        )
        like = f"%{search}%"
        params.extend([like, like, like, like])
    if cycle_id:
        conditions.append("pr.cycle_id = %s")
        params.append(cycle_id)
    if status:
        conditions.append("pr.status = %s")
        params.append(status)
    if rating:
        conditions.append("pr.rating = %s")
        params.append(rating)

    where_clause = "WHERE " + " AND ".join(conditions)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(
            f"SELECT COUNT(*) AS total FROM performance_reviews pr "
            f"JOIN employees e ON pr.employee_id = e.employee_id {where_clause}",
            params
        )
        total = cursor.fetchone()["total"]

        offset = (page - 1) * page_size
        cursor.execute(
            f"""{REVIEW_SELECT} {where_clause}
                ORDER BY pr.created_at DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset]
        )
        reviews = [format_review_entry(r) for r in cursor.fetchall()]

        return success_response(data={"records": reviews, "total": total})

    except pymysql.MySQLError as e:
        print(f"Get team performance reviews error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@performance_bp.route("/manager/team/employees/<int:employee_id>/performance-reviews", methods=["POST"])
@require_employee_auth
def create_team_performance_review(employee_id):
    return _create_review(employee_id, reviewer_employee_id=request.current_employee["employee_id"])


@performance_bp.route("/manager/team/performance-reviews/<int:review_id>", methods=["PUT"])
@require_employee_auth
def update_team_performance_review(review_id):
    return _update_review(review_id, manager_employee_id=request.current_employee["employee_id"])


@performance_bp.route("/manager/team/performance-reviews/<int:review_id>/submit", methods=["PUT"])
@require_employee_auth
def submit_team_performance_review(review_id):
    return _submit_review(review_id, manager_employee_id=request.current_employee["employee_id"])


@performance_bp.route("/manager/team/performance-reviews/<int:review_id>", methods=["DELETE"])
@require_employee_auth
def delete_team_performance_review(review_id):
    return _delete_review(review_id, manager_employee_id=request.current_employee["employee_id"])


# ---------------------------------------------------------------------
# Employee self-service (read-only, Submitted reviews only)
# ---------------------------------------------------------------------

@performance_bp.route("/employee/performance-reviews", methods=["GET"])
@require_employee_auth
def get_my_performance_reviews():
    employee_id = request.current_employee["employee_id"]

    cycle_id = request.args.get("cycle_id")
    status = request.args.get("status")
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)

    errors = {}
    if page < 1:
        errors["page"] = "page must be greater than or equal to 1"
    if page_size < 1 or page_size > 100:
        errors["pageSize"] = "pageSize must be between 1 and 100"
    if status and status not in REVIEW_STATUSES:
        errors["status"] = "Invalid status"
    if errors:
        return validation_error_response(errors)

    # pr.status = 'Submitted' is a fixed part of this condition, never
    # relaxed by the status filter below - an employee is never shown a
    # Draft review regardless of what status value is requested. The
    # filter is kept for UI consistency with Team Performance even though,
    # given that, it can only ever narrow results to "Submitted" or none.
    conditions = ["pr.employee_id = %s", "pr.status = 'Submitted'"]
    params = [employee_id]

    if cycle_id:
        conditions.append("pr.cycle_id = %s")
        params.append(cycle_id)
    if status:
        conditions.append("pr.status = %s")
        params.append(status)

    where_clause = "WHERE " + " AND ".join(conditions)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(f"SELECT COUNT(*) AS total FROM performance_reviews pr {where_clause}", params)
        total = cursor.fetchone()["total"]

        offset = (page - 1) * page_size
        cursor.execute(
            f"{REVIEW_SELECT} {where_clause} ORDER BY pr.submitted_at DESC LIMIT %s OFFSET %s",
            params + [page_size, offset]
        )
        reviews = [format_review_entry(r) for r in cursor.fetchall()]

        return success_response(data={"records": reviews, "total": total})

    except pymysql.MySQLError as e:
        print(f"Get my performance reviews error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()