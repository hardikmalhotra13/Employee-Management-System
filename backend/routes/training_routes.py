import uuid
from datetime import datetime, date, timedelta

import pymysql
from flask import Blueprint, request
from werkzeug.utils import secure_filename

from config import settings
from database.connection import get_db_connection
from utils.response_helpers import (
    success_response,
    created_response,
    error_response,
    validation_error_response,
    not_found_response,
)
from utils.auth_helper import require_permission, require_employee_auth, block_demo_account, is_demo_account
from utils.audit_helper import log_action
from utils.notification_helper import create_notification, notify_all_admins
from utils.storage_helper import save_file, delete_file
from utils.code_helper import insert_with_generated_code
from routes.document_routes import is_allowed_extension, get_file_size

training_bp = Blueprint("training", __name__)

VALID_PROGRAM_STATUSES = ("Active", "Inactive")
VALID_PROGRAM_TYPES = ("Training", "Certification")
VALID_RECORD_STATUSES = ("Assigned", "Completed")

DAYS_IN_MONTH = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)

TRAINING_RECORD_SELECT = """
    SELECT tr.record_id, tr.employee_id, tr.program_id, tr.status, tr.assigned_date, tr.due_date,
           tr.completion_date, tr.expiry_date, tr.document_id, tr.completion_comment,
           tr.assigned_by_admin_id, tr.assigned_by_employee_id,
           tr.completed_by_admin_id, tr.completed_by_employee_id,
           tr.created_at, tr.updated_at,
           e.employee_code, e.first_name, e.last_name,
           p.program_name, p.program_type, p.validity_months,
           d.document_name,
           aa.name AS assigned_by_admin_name,
           ae.first_name AS assigned_by_employee_first_name, ae.last_name AS assigned_by_employee_last_name,
           ca.name AS completed_by_admin_name,
           ce.first_name AS completed_by_employee_first_name, ce.last_name AS completed_by_employee_last_name
    FROM employee_training_records tr
    JOIN employees e ON tr.employee_id = e.employee_id
    JOIN training_programs p ON tr.program_id = p.program_id
    LEFT JOIN employee_documents d ON tr.document_id = d.document_id
    LEFT JOIN admins aa ON tr.assigned_by_admin_id = aa.admin_id
    LEFT JOIN employees ae ON tr.assigned_by_employee_id = ae.employee_id
    LEFT JOIN admins ca ON tr.completed_by_admin_id = ca.admin_id
    LEFT JOIN employees ce ON tr.completed_by_employee_id = ce.employee_id
"""


def is_leap_year(year):
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def add_months(base_date, months):
    """Add a whole number of months to a date, clamping the day to the
    target month's length (e.g. Jan 31 + 1 month = Feb 28/29). Written
    by hand rather than pulling in a new dependency (no date library is
    already used anywhere in this project)."""
    month_index = base_date.month - 1 + months
    year = base_date.year + month_index // 12
    month = month_index % 12 + 1
    max_day = DAYS_IN_MONTH[month - 1]
    if month == 2 and is_leap_year(year):
        max_day = 29
    day = min(base_date.day, max_day)
    return date(year, month, day)


def compute_expiry_label(expiry_date):
    if not expiry_date:
        return None
    today = date.today()
    if expiry_date < today:
        return "Expired"
    if expiry_date <= today + timedelta(days=30):
        return "Expiring Soon"
    return "Valid"


def format_record_entry(entry):
    if entry:
        entry["expiry_label"] = compute_expiry_label(entry.get("expiry_date"))
        for field in ("assigned_date", "due_date", "completion_date", "expiry_date"):
            if entry.get(field):
                entry[field] = entry[field].strftime("%Y-%m-%d")
        for field in ("created_at", "updated_at"):
            if entry.get(field):
                entry[field] = entry[field].strftime("%Y-%m-%d %H:%M:%S")
    return entry


def fetch_record_entry(cursor, record_id):
    cursor.execute(f"{TRAINING_RECORD_SELECT} WHERE tr.record_id = %s", (record_id,))
    return format_record_entry(cursor.fetchone())


def get_employee_record(cursor, employee_id):
    cursor.execute(
        "SELECT employee_id, reporting_manager_id, is_archived, status, first_name, last_name "
        "FROM employees WHERE employee_id = %s",
        (employee_id,)
    )
    return cursor.fetchone()


def lock_program(cursor, program_id):
    """
    Locks the program row until the transaction ends. Every way of assigning a
    program (one employee, or everyone) takes this lock as its FIRST statement,
    so two assignments of the same program run one after the other and the
    "already has an open record" check below always sees the first one's
    record. (It must come first: reads made before the lock could use an
    older snapshot of the data.)
    """
    cursor.execute("SELECT program_id FROM training_programs WHERE program_id = %s FOR UPDATE", (program_id,))
    cursor.fetchone()


def get_active_program(cursor, program_id):
    cursor.execute(
        "SELECT * FROM training_programs WHERE program_id = %s AND is_archived = FALSE AND status = 'Active'",
        (program_id,)
    )
    return cursor.fetchone()


def completion_date_error(completion_date, assigned_date):
    """
    assigned_date <= completion_date <= today, enforced server-side for
    every completion path (employee, manager, admin) - not just in the
    frontend forms. "Today" is the server's local date, same as the
    assigned_date that date.today() stamps when a record is created.
    """
    if completion_date < assigned_date:
        return "Completion date cannot be before the assigned date"
    if completion_date > date.today():
        return "Completion date cannot be in the future"
    return None


def parse_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def notify_training_assigned(cursor, employee_id, program_name):
    create_notification(
        cursor,
        employee_id,
        "training_assigned",
        "New training assigned",
        f"You have been assigned to {program_name}.",
        link="/employee/training",
        related_entity_type="training_record",
        related_entity_id=None,
    )


def validate_program_payload(data):
    errors = {}

    program_name = data.get("program_name")
    program_type = data.get("program_type")
    validity_months_raw = data.get("validity_months")
    status = data.get("status", "Active")

    if not program_name or not program_name.strip():
        errors["program_name"] = "Program name is required"

    if program_type not in VALID_PROGRAM_TYPES:
        errors["program_type"] = "Program type must be Training or Certification"

    validity_months = None
    if program_type == "Training":
        if validity_months_raw not in (None, ""):
            errors["validity_months"] = "Training programs cannot have a validity period"
    elif program_type == "Certification":
        if validity_months_raw not in (None, ""):
            try:
                validity_months = int(validity_months_raw)
                if validity_months <= 0:
                    errors["validity_months"] = "Validity (months) must be a positive whole number"
                    validity_months = None
            except (TypeError, ValueError):
                errors["validity_months"] = "Validity (months) must be a positive whole number"

    if status not in VALID_PROGRAM_STATUSES:
        errors["status"] = "Status must be Active or Inactive"

    return program_name, program_type, validity_months, status, errors


# ---------------------------------------------------------------------
# training_programs (catalog)
# ---------------------------------------------------------------------

@training_bp.route("/training-programs", methods=["GET"])
@require_permission("training.view")
def get_training_programs():
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
        cursor.execute(f"SELECT COUNT(*) AS total FROM training_programs {where_clause}")
        total = cursor.fetchone()["total"]

        cursor.execute(
            f"SELECT * FROM training_programs {where_clause} ORDER BY program_id DESC LIMIT %s OFFSET %s",
            (page_size, offset)
        )
        programs = cursor.fetchall()

        return success_response(data={
            "records": programs,
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get training programs error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@training_bp.route("/training-programs", methods=["POST"])
@require_permission("training.manage")
def create_training_program():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    program_name, program_type, validity_months, status, errors = validate_program_payload(data)
    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        # If two programs are created at the same moment and pick the same code,
        # the UNIQUE constraint rejects one and it is retried.
        def insert_program(program_code):
            cursor.execute(
                "INSERT INTO training_programs (program_code, program_name, program_type, validity_months, status) "
                "VALUES (%s, %s, %s, %s, %s)",
                (program_code, program_name.strip(), program_type, validity_months, status)
            )
            return cursor.lastrowid

        new_program_id = insert_with_generated_code(
            connection, cursor,
            "SELECT MAX(program_id) AS max_id FROM training_programs",
            "TRN", "program_code", insert_program
        )
        log_action(
            cursor, request.current_admin["admin_id"], "create", "training_program", new_program_id,
            details=program_name.strip()
        )
        connection.commit()

        cursor.execute("SELECT * FROM training_programs WHERE program_id = %s", (new_program_id,))
        program = cursor.fetchone()

        return created_response("Training program created successfully", data=program)

    except pymysql.MySQLError as e:
        print(f"Create training program error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@training_bp.route("/training-programs/<int:program_id>", methods=["PUT"])
@require_permission("training.manage")
def update_training_program(program_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    program_name, program_type, validity_months, status, errors = validate_program_payload(data)
    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM training_programs WHERE program_id = %s", (program_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Training program not found")

        if program_type != existing["program_type"]:
            cursor.execute(
                "SELECT COUNT(*) AS cnt FROM employee_training_records WHERE program_id = %s", (program_id,)
            )
            if cursor.fetchone()["cnt"] > 0:
                return error_response(
                    "Program type cannot be changed once employee records exist for this program",
                    status_code=400
                )

        cursor.execute(
            "UPDATE training_programs SET program_name = %s, program_type = %s, validity_months = %s, "
            "status = %s WHERE program_id = %s",
            (program_name.strip(), program_type, validity_months, status, program_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "training_program", program_id)
        connection.commit()

        cursor.execute("SELECT * FROM training_programs WHERE program_id = %s", (program_id,))
        program = cursor.fetchone()

        return success_response("Training program updated successfully", data=program)

    except pymysql.MySQLError as e:
        print(f"Update training program error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@training_bp.route("/training-programs/<int:program_id>", methods=["DELETE"])
@require_permission("training.manage")
def archive_training_program(program_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM training_programs WHERE program_id = %s", (program_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Training program not found")

        cursor.execute("UPDATE training_programs SET is_archived = TRUE WHERE program_id = %s", (program_id,))
        log_action(cursor, request.current_admin["admin_id"], "archive", "training_program", program_id)
        connection.commit()

        return success_response("Training program archived successfully")

    except pymysql.MySQLError as e:
        print(f"Archive training program error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@training_bp.route("/training-programs/<int:program_id>/restore", methods=["PUT"])
@require_permission("training.manage")
def restore_training_program(program_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM training_programs WHERE program_id = %s", (program_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Training program not found")

        if not existing["is_archived"]:
            return error_response("Training program is not archived", status_code=400)

        cursor.execute("UPDATE training_programs SET is_archived = FALSE WHERE program_id = %s", (program_id,))
        log_action(cursor, request.current_admin["admin_id"], "restore", "training_program", program_id)
        connection.commit()

        cursor.execute("SELECT * FROM training_programs WHERE program_id = %s", (program_id,))
        program = cursor.fetchone()

        return success_response("Training program restored successfully", data=program)

    except pymysql.MySQLError as e:
        print(f"Restore training program error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@training_bp.route("/training-programs/<int:program_id>/permanent", methods=["DELETE"])
@require_permission("training.manage")
def permanently_delete_training_program(program_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM training_programs WHERE program_id = %s", (program_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Training program not found")

        if not existing["is_archived"]:
            return error_response("Only archived training programs can be permanently deleted", status_code=400)

        cursor.execute("DELETE FROM training_programs WHERE program_id = %s", (program_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "training_program", program_id,
            details=existing["program_name"]
        )
        connection.commit()

        return success_response("Training program permanently deleted")

    except pymysql.err.IntegrityError:
        # ON DELETE RESTRICT blocks this if any employee training record still references the program
        return error_response(
            "This program is still used by one or more employee training records and cannot be permanently deleted",
            status_code=409
        )

    except pymysql.MySQLError as e:
        print(f"Permanently delete training program error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Shared internal helpers used by admin and manager routes
# ---------------------------------------------------------------------

def _assign_training(cursor, employee_id, program, due_date, admin_id=None, employee_reviewer_id=None):
    """Assumes the employee/program/ownership/duplicate checks have
    already been done by the caller. Inserts the record and sends the
    assignment notification; does not commit."""
    cursor.execute(
        "INSERT INTO employee_training_records "
        "(employee_id, program_id, assigned_date, due_date, assigned_by_admin_id, assigned_by_employee_id) "
        "VALUES (%s, %s, %s, %s, %s, %s)",
        (employee_id, program["program_id"], date.today(), due_date, admin_id, employee_reviewer_id)
    )
    new_record_id = cursor.lastrowid

    if admin_id is not None:
        log_action(cursor, admin_id, "create", "training_record", new_record_id)

    notify_training_assigned(cursor, employee_id, program["program_name"])

    return new_record_id


def _create_training_record(employee_id, admin_id=None, employee_reviewer_id=None):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    program_id = data.get("program_id")
    due_date = parse_date(data.get("due_date")) if data.get("due_date") else None
    if data.get("due_date") and not due_date:
        return validation_error_response({"due_date": "due_date must be a valid date (YYYY-MM-DD)"})
    if not program_id:
        return validation_error_response({"program_id": "program_id is required"})

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        lock_program(cursor, program_id)

        employee = get_employee_record(cursor, employee_id)
        if not employee:
            return not_found_response("Employee not found")

        if employee["is_archived"] or employee["status"] == "Inactive":
            return error_response(
                "Cannot assign training to an archived or inactive employee", status_code=400
            )

        if employee_reviewer_id is not None and employee["reporting_manager_id"] != employee_reviewer_id:
            return not_found_response("Employee not found")

        program = get_active_program(cursor, program_id)
        if not program:
            return error_response("Training program not found or is not active", status_code=400)

        cursor.execute(
            "SELECT record_id FROM employee_training_records WHERE employee_id = %s AND program_id = %s "
            "AND status = 'Assigned'",
            (employee_id, program_id)
        )
        if cursor.fetchone():
            return error_response(
                "This employee already has an open (Assigned) record for this program", status_code=409
            )

        new_record_id = _assign_training(
            cursor, employee_id, program, due_date, admin_id=admin_id, employee_reviewer_id=employee_reviewer_id
        )

        notify_all_admins(
            cursor,
            "training_assigned",
            "Training assigned",
            f"{employee['first_name']} {employee['last_name']} was assigned to \"{program['program_name']}\".",
            link=f"/admin/employees/{employee_id}",
            related_entity_type="training_record",
            related_entity_id=new_record_id,
        )

        connection.commit()

        return created_response("Training assigned successfully", data=fetch_record_entry(cursor, new_record_id))

    except pymysql.MySQLError as e:
        print(f"Assign training error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


def _complete_training_record(record_id, admin_id=None, manager_employee_id=None):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    completion_date = parse_date(data.get("completion_date"))
    document_id = data.get("document_id")

    if not completion_date:
        return validation_error_response(
            {"completion_date": "A valid completion date (YYYY-MM-DD) is required"}
        )

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        # FOR UPDATE: two completions of the same record run one after the other,
        # so the second one sees it is no longer Assigned.
        cursor.execute(
            "SELECT * FROM employee_training_records WHERE record_id = %s FOR UPDATE", (record_id,)
        )
        record = cursor.fetchone()

        if not record:
            return not_found_response("Training record not found")

        employee = get_employee_record(cursor, record["employee_id"])

        if manager_employee_id is not None:
            if not employee or employee["reporting_manager_id"] != manager_employee_id:
                return not_found_response("Training record not found")

        if record["status"] != "Assigned":
            return error_response("Only Assigned records can be marked complete", status_code=400)

        date_error = completion_date_error(completion_date, record["assigned_date"])
        if date_error:
            return validation_error_response({"completion_date": date_error})

        cursor.execute("SELECT * FROM training_programs WHERE program_id = %s", (record["program_id"],))
        program = cursor.fetchone()

        if document_id:
            if program["program_type"] != "Certification":
                return error_response(
                    "Certificates can only be attached to Certification records", status_code=400
                )
            cursor.execute("SELECT employee_id FROM employee_documents WHERE document_id = %s", (document_id,))
            document = cursor.fetchone()
            if not document or document["employee_id"] != record["employee_id"]:
                return error_response("Document does not belong to this employee", status_code=400)
        else:
            document_id = None

        expiry_date = None
        if program["program_type"] == "Certification" and program["validity_months"]:
            expiry_date = add_months(completion_date, program["validity_months"])

        cursor.execute(
            "UPDATE employee_training_records SET status = 'Completed', completion_date = %s, expiry_date = %s, "
            "document_id = %s, completed_by_admin_id = %s, completed_by_employee_id = %s WHERE record_id = %s",
            (completion_date, expiry_date, document_id, admin_id, manager_employee_id, record_id)
        )

        if admin_id is not None:
            log_action(cursor, admin_id, "update", "training_record", record_id, details="Completed")

        if employee:
            notify_all_admins(
                cursor,
                "training_completed",
                "Training completed",
                f"{employee['first_name']} {employee['last_name']} has completed the "
                f"\"{program['program_name']}\" {program['program_type'].lower()}.",
                link=f"/admin/employees/{record['employee_id']}",
                related_entity_type="training_record",
                related_entity_id=record_id,
            )

        connection.commit()

        return success_response("Training record marked complete", data=fetch_record_entry(cursor, record_id))

    except pymysql.MySQLError as e:
        print(f"Complete training record error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Admin/HR routes
# ---------------------------------------------------------------------

@training_bp.route("/employees/<int:employee_id>/training-records", methods=["GET"])
@require_permission("training.view")
def get_employee_training_records(employee_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        employee = get_employee_record(cursor, employee_id)
        if not employee:
            return not_found_response("Employee not found")

        cursor.execute(f"{TRAINING_RECORD_SELECT} WHERE tr.employee_id = %s ORDER BY tr.created_at DESC", (employee_id,))
        records = [format_record_entry(r) for r in cursor.fetchall()]

        return success_response(data=records)

    except pymysql.MySQLError as e:
        print(f"Get employee training records error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@training_bp.route("/employees/<int:employee_id>/training-records", methods=["POST"])
@require_permission("training.manage")
def create_employee_training_record(employee_id):
    return _create_training_record(employee_id, admin_id=request.current_admin["admin_id"])


@training_bp.route("/training-records/<int:record_id>/complete", methods=["PUT"])
@require_permission("training.manage")
def complete_training_record(record_id):
    return _complete_training_record(record_id, admin_id=request.current_admin["admin_id"])


@training_bp.route("/training-programs/<int:program_id>/assign-all", methods=["POST"])
@require_permission("training.manage")
def assign_training_to_all(program_id):
    data = request.get_json(silent=True) or {}
    due_date = parse_date(data.get("due_date")) if data.get("due_date") else None
    if data.get("due_date") and not due_date:
        return validation_error_response({"due_date": "due_date must be a valid date (YYYY-MM-DD)"})

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        lock_program(cursor, program_id)

        program = get_active_program(cursor, program_id)
        if not program:
            return error_response("Training program not found or is not active", status_code=400)

        cursor.execute(
            "SELECT employee_id FROM employees WHERE is_archived = FALSE AND status != 'Inactive'"
        )
        eligible_ids = {row["employee_id"] for row in cursor.fetchall()}

        cursor.execute(
            "SELECT DISTINCT employee_id FROM employee_training_records WHERE program_id = %s AND status = 'Assigned'",
            (program_id,)
        )
        already_assigned_ids = {row["employee_id"] for row in cursor.fetchall()}

        to_assign_ids = eligible_ids - already_assigned_ids
        admin_id = request.current_admin["admin_id"]

        for employee_id in to_assign_ids:
            _assign_training(cursor, employee_id, program, due_date, admin_id=admin_id)

        if to_assign_ids:
            notify_all_admins(
                cursor,
                "training_assigned",
                "Training assigned",
                f"\"{program['program_name']}\" was assigned to {len(to_assign_ids)} employee(s).",
                link="/admin/training-programs",
                related_entity_type="training_program",
                related_entity_id=program_id,
            )

        connection.commit()

        return created_response(
            f"Assigned to {len(to_assign_ids)} employee(s); {len(already_assigned_ids)} already had an "
            f"open assignment for this program",
            data={"assigned": len(to_assign_ids), "skipped_already_assigned": len(already_assigned_ids)}
        )

    except pymysql.MySQLError as e:
        print(f"Assign training to all error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Manager (self-service auth, scoped to direct reports) routes
# ---------------------------------------------------------------------

@training_bp.route("/manager/training-programs", methods=["GET"])
@require_employee_auth
def get_manager_training_programs():
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT program_id, program_name, program_type, validity_months FROM training_programs "
            "WHERE is_archived = FALSE AND status = 'Active' ORDER BY program_name"
        )
        programs = cursor.fetchall()

        return success_response(data=programs)

    except pymysql.MySQLError as e:
        print(f"Get manager training programs error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@training_bp.route("/manager/team/training-records", methods=["GET"])
@require_employee_auth
def get_team_training_records():
    manager_id = request.current_employee["employee_id"]

    search = request.args.get("search")
    record_type = request.args.get("type")
    status = request.args.get("status")
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)

    errors = {}
    if page < 1:
        errors["page"] = "page must be greater than or equal to 1"
    if page_size < 1 or page_size > 100:
        errors["pageSize"] = "pageSize must be between 1 and 100"
    if record_type and record_type not in VALID_PROGRAM_TYPES:
        errors["type"] = "Invalid type"
    if status and status not in VALID_RECORD_STATUSES:
        errors["status"] = "Invalid status"
    if errors:
        return validation_error_response(errors)

    # Direct-report scoping - unchanged, still the only thing that decides
    # which employees' training records a manager can see or act on here.
    conditions = ["e.reporting_manager_id = %s"]
    params = [manager_id]

    if search:
        conditions.append(
            "(e.first_name LIKE %s OR e.last_name LIKE %s "
            "OR CONCAT_WS(' ', e.first_name, e.last_name) LIKE %s "
            "OR e.employee_code LIKE %s OR p.program_name LIKE %s)"
        )
        like = f"%{search}%"
        params.extend([like, like, like, like, like])
    if record_type:
        conditions.append("p.program_type = %s")
        params.append(record_type)
    if status:
        conditions.append("tr.status = %s")
        params.append(status)

    where_clause = "WHERE " + " AND ".join(conditions)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(
            f"SELECT COUNT(*) AS total FROM employee_training_records tr "
            f"JOIN employees e ON tr.employee_id = e.employee_id "
            f"JOIN training_programs p ON tr.program_id = p.program_id {where_clause}",
            params
        )
        total = cursor.fetchone()["total"]

        offset = (page - 1) * page_size
        cursor.execute(
            f"""{TRAINING_RECORD_SELECT} {where_clause}
                ORDER BY tr.created_at DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset]
        )
        records = [format_record_entry(r) for r in cursor.fetchall()]

        # Summary reflects every record for the manager's direct reports,
        # not just the current filtered/paginated view - matches the
        # summary cards shown above the table, which stay stable while the
        # table below is filtered or paged.
        cursor.execute(
            """SELECT
                   COUNT(*) AS total,
                   SUM(CASE WHEN tr.status = 'Assigned' AND (tr.due_date IS NULL OR tr.due_date >= CURDATE())
                            THEN 1 ELSE 0 END) AS assigned,
                   SUM(CASE WHEN tr.status = 'Completed' THEN 1 ELSE 0 END) AS completed,
                   SUM(CASE WHEN tr.status = 'Assigned' AND tr.due_date IS NOT NULL AND tr.due_date < CURDATE()
                            THEN 1 ELSE 0 END) AS overdue
               FROM employee_training_records tr
               JOIN employees e ON tr.employee_id = e.employee_id
               WHERE e.reporting_manager_id = %s""",
            (manager_id,)
        )
        summary = cursor.fetchone()

        return success_response(data={"records": records, "total": total, "summary": summary})

    except pymysql.MySQLError as e:
        print(f"Get team training records error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@training_bp.route("/manager/team/employees/<int:employee_id>/training-records", methods=["POST"])
@require_employee_auth
def create_team_training_record(employee_id):
    return _create_training_record(employee_id, employee_reviewer_id=request.current_employee["employee_id"])


@training_bp.route("/manager/team/training-records/<int:record_id>/complete", methods=["PUT"])
@require_employee_auth
def complete_team_training_record(record_id):
    return _complete_training_record(record_id, manager_employee_id=request.current_employee["employee_id"])


# ---------------------------------------------------------------------
# Employee self-service (read-only)
# ---------------------------------------------------------------------

@training_bp.route("/employee/training-records", methods=["GET"])
@require_employee_auth
def get_my_training_records():
    employee_id = request.current_employee["employee_id"]

    search = request.args.get("search")
    record_type = request.args.get("type")
    status = request.args.get("status")
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)

    errors = {}
    if page < 1:
        errors["page"] = "page must be greater than or equal to 1"
    if page_size < 1 or page_size > 100:
        errors["pageSize"] = "pageSize must be between 1 and 100"
    if record_type and record_type not in VALID_PROGRAM_TYPES:
        errors["type"] = "Invalid type"
    if status and status not in VALID_RECORD_STATUSES:
        errors["status"] = "Invalid status"
    if errors:
        return validation_error_response(errors)

    conditions = ["tr.employee_id = %s"]
    params = [employee_id]

    if search:
        conditions.append("p.program_name LIKE %s")
        params.append(f"%{search}%")
    if record_type:
        conditions.append("p.program_type = %s")
        params.append(record_type)
    if status:
        conditions.append("tr.status = %s")
        params.append(status)

    where_clause = "WHERE " + " AND ".join(conditions)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(
            f"SELECT COUNT(*) AS total FROM employee_training_records tr "
            f"JOIN training_programs p ON tr.program_id = p.program_id {where_clause}",
            params
        )
        total = cursor.fetchone()["total"]

        offset = (page - 1) * page_size
        cursor.execute(
            f"""{TRAINING_RECORD_SELECT} {where_clause}
                ORDER BY tr.created_at DESC
                LIMIT %s OFFSET %s""",
            params + [page_size, offset]
        )
        records = [format_record_entry(r) for r in cursor.fetchall()]

        # Same as Team Training: reflects every one of the employee's own
        # records, not just the current filtered/paginated view.
        cursor.execute(
            """SELECT
                   COUNT(*) AS total,
                   SUM(CASE WHEN status = 'Assigned' AND (due_date IS NULL OR due_date >= CURDATE())
                            THEN 1 ELSE 0 END) AS assigned,
                   SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
                   SUM(CASE WHEN status = 'Assigned' AND due_date IS NOT NULL AND due_date < CURDATE()
                            THEN 1 ELSE 0 END) AS overdue
               FROM employee_training_records
               WHERE employee_id = %s""",
            (employee_id,)
        )
        summary = cursor.fetchone()

        return success_response(data={"records": records, "total": total, "summary": summary})

    except pymysql.MySQLError as e:
        print(f"Get my training records error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()

@training_bp.route("/employee/training-records/<int:record_id>/certificate", methods=["POST"])
@require_employee_auth
@block_demo_account
def upload_my_training_certificate(record_id):
    """
    Lets an employee attach a certificate to one of their own Completed
    Certification records, separately from Mark Complete (which stays
    completion-date-only). Only allowed when the record is the caller's
    own, its program is a Certification, its status is Completed, and it
    doesn't already have a document attached - uploading a second time
    over an existing certificate is rejected rather than silently
    replacing it and orphaning the old file. Reuses upload_my_document's
    exact file validation/storage pattern (same folder layout, same
    extension/size rules, same employee_documents table).
    """
    employee_id = request.current_employee["employee_id"]
    file = request.files.get("file")

    errors = {}
    if not file or not file.filename:
        errors["file"] = "A file is required"
    elif not is_allowed_extension(file.filename):
        errors["file"] = "Only PDF, JPG, JPEG, and PNG files are allowed"
    elif get_file_size(file) > settings.MAX_DOCUMENT_SIZE_BYTES:
        errors["file"] = "File size cannot be greater than 10 MB"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    saved_file_path = None
    try:
        cursor = connection.cursor()

        # Lock the record first, so two uploads for the same record run one after
        # the other and the second one sees that a certificate is already attached.
        cursor.execute(
            "SELECT record_id FROM employee_training_records WHERE record_id = %s FOR UPDATE", (record_id,)
        )
        cursor.fetchone()

        # The record must be this employee's own - this is what stops an
        # employee from attaching a certificate to anyone else's record;
        # not-found rather than forbidden, same as everywhere else here.
        cursor.execute(
            """SELECT tr.record_id, tr.employee_id, tr.status, tr.document_id,
                      p.program_name, p.program_type
               FROM employee_training_records tr
               JOIN training_programs p ON tr.program_id = p.program_id
               WHERE tr.record_id = %s""",
            (record_id,)
        )
        record = cursor.fetchone()

        if not record or record["employee_id"] != employee_id:
            return not_found_response("Training record not found")

        if record["program_type"] != "Certification":
            return error_response("Only Certification records can have a certificate attached", status_code=400)
        if record["status"] != "Completed":
            return error_response(
                "This record must be marked Completed before a certificate can be attached", status_code=400
            )
        if record["document_id"] is not None:
            return error_response(
                "A certificate is already attached to this record", status_code=400
            )

        stored_filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
        relative_path = f"employee_documents/{employee_id}/{stored_filename}"
        save_file(relative_path, file)
        saved_file_path = relative_path
        document_name = f"{record['program_name']} Certificate"

        cursor.execute(
            "INSERT INTO employee_documents (employee_id, document_name, file_path, uploaded_by_admin_id) "
            "VALUES (%s, %s, %s, %s)",
            (employee_id, document_name, relative_path, None)
        )
        new_document_id = cursor.lastrowid

        cursor.execute(
            "UPDATE employee_training_records SET document_id = %s WHERE record_id = %s",
            (new_document_id, record_id)
        )

        employee = get_employee_record(cursor, employee_id)
        notify_all_admins(
            cursor,
            "document_uploaded",
            "Certificate uploaded",
            f"{employee['first_name']} {employee['last_name']} uploaded a certificate for \"{record['program_name']}\".",
            link=f"/admin/employees/{employee_id}",
            related_entity_type="document",
            related_entity_id=new_document_id,
        )

        connection.commit()

        return success_response(
            "Certificate uploaded successfully",
            data=fetch_record_entry(cursor, record_id)
        )

    except pymysql.MySQLError as e:
        print(f"Upload training certificate error: {e}")
        # The database step failed after the certificate was stored: remove it.
        if saved_file_path:
            try:
                delete_file(saved_file_path)
            except OSError as cleanup_error:
                print(f"Could not remove orphaned certificate file: {cleanup_error}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@training_bp.route("/employee/training-records/<int:record_id>/complete", methods=["POST"])
@require_employee_auth
def complete_my_training_record(record_id):
    """
    Lets an employee mark their own Assigned training/certification
    record Completed. Kept separate from _complete_training_record
    (the admin/manager path) rather than extended to cover this too -
    that function expects a JSON body referencing an already-uploaded
    document_id, while this one accepts the completion date and, for a
    Certification, the certificate file itself in one multipart
    submission (reusing upload_my_training_certificate's exact storage
    pattern) so the employee doesn't need a separate upload step.
    completed_by_employee_id is set to the employee's own id, the same
    column the manager path already uses for "who completed this" -
    completed_by_admin_id stays NULL either way.
    """
    employee_id = request.current_employee["employee_id"]

    completion_date = parse_date(request.form.get("completion_date"))
    file = request.files.get("file")
    completion_comment = (request.form.get("completion_comment") or "").strip() or None

    errors = {}
    if not completion_date:
        errors["completion_date"] = "A valid completion date (YYYY-MM-DD) is required"
    if completion_comment and len(completion_comment) > 500:
        errors["completion_comment"] = "Comment cannot be longer than 500 characters"
    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    saved_file_path = None
    try:
        cursor = connection.cursor()

        # FOR UPDATE: two completions of the same record run one after the other,
        # so the second one sees it is no longer Assigned (and does not upload
        # a second certificate).
        cursor.execute(
            "SELECT * FROM employee_training_records WHERE record_id = %s FOR UPDATE", (record_id,)
        )
        record = cursor.fetchone()

        if not record or record["employee_id"] != employee_id:
            return not_found_response("Training record not found")

        if record["status"] != "Assigned":
            return error_response("Only Assigned records can be marked complete", status_code=400)

        date_error = completion_date_error(completion_date, record["assigned_date"])
        if date_error:
            return validation_error_response({"completion_date": date_error})

        cursor.execute("SELECT * FROM training_programs WHERE program_id = %s", (record["program_id"],))
        program = cursor.fetchone()

        is_certification = program["program_type"] == "Certification"

        if is_certification:
            if is_demo_account(request.current_employee["email"]):
                return error_response("This action is disabled for the public demo account", status_code=403)
            if not file or not file.filename:
                return validation_error_response(
                    {"file": "A certificate is required to complete a Certification"}
                )
            if not is_allowed_extension(file.filename):
                return validation_error_response(
                    {"file": "Only PDF, JPG, JPEG, and PNG files are allowed"}
                )
            if get_file_size(file) > settings.MAX_DOCUMENT_SIZE_BYTES:
                return validation_error_response({"file": "File size cannot be greater than 10 MB"})
        elif file and file.filename:
            return error_response("Certificates can only be attached to Certification records", status_code=400)

        document_id = None
        if is_certification:
            stored_filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
            relative_path = f"employee_documents/{employee_id}/{stored_filename}"
            save_file(relative_path, file)
            saved_file_path = relative_path
            document_name = f"{program['program_name']} Certificate"

            cursor.execute(
                "INSERT INTO employee_documents (employee_id, document_name, file_path, uploaded_by_admin_id) "
                "VALUES (%s, %s, %s, %s)",
                (employee_id, document_name, relative_path, None)
            )
            document_id = cursor.lastrowid

        expiry_date = None
        if is_certification and program["validity_months"]:
            expiry_date = add_months(completion_date, program["validity_months"])

        cursor.execute(
            "UPDATE employee_training_records SET status = 'Completed', completion_date = %s, expiry_date = %s, "
            "document_id = %s, completion_comment = %s, completed_by_admin_id = NULL, "
            "completed_by_employee_id = %s WHERE record_id = %s",
            (completion_date, expiry_date, document_id, completion_comment, employee_id, record_id)
        )

        employee = get_employee_record(cursor, employee_id)
        notify_all_admins(
            cursor,
            "training_completed",
            "Training completed",
            f"{employee['first_name']} {employee['last_name']} has completed the "
            f"\"{program['program_name']}\" {program['program_type'].lower()}.",
            link=f"/admin/employees/{employee_id}",
            related_entity_type="training_record",
            related_entity_id=record_id,
        )

        connection.commit()

        return success_response(
            "Training record marked complete",
            data=fetch_record_entry(cursor, record_id)
        )

    except pymysql.MySQLError as e:
        print(f"Complete my training record error: {e}")
        # The database step failed after the certificate was stored: remove it.
        if saved_file_path:
            try:
                delete_file(saved_file_path)
            except OSError as cleanup_error:
                print(f"Could not remove orphaned certificate file: {cleanup_error}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()