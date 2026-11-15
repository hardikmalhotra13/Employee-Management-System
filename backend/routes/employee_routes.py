import re
import csv
import io
from datetime import datetime, date

import pymysql
from flask import Blueprint, request, Response

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
from utils.storage_helper import delete_file
from utils.code_helper import insert_with_generated_code

employee_bp = Blueprint("employee", __name__)

VALID_STATUSES = ("Active", "On Probation", "On Notice", "Inactive")
VALID_GENDERS = ("Male", "Female", "Other")

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_valid_email(email):
    return bool(EMAIL_PATTERN.match(email))


def is_valid_phone(phone):
    return phone.isdigit() and len(phone) == 10


def parse_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def get_master_record(cursor, table, id_column, id_value):
    cursor.execute(f"SELECT * FROM {table} WHERE {id_column} = %s", (id_value,))
    return cursor.fetchone()


def would_create_cycle(cursor, employee_id, proposed_manager_id, max_depth=50):
    """
    Walks up the reporting chain starting at proposed_manager_id to see if
    it ever leads back to employee_id, which would make the assignment a
    cycle (e.g. A -> B -> C -> A). max_depth is just a safety bound for a
    simple chain walk, not a full graph-validation system - a real
    reporting chain should never come close to it. If the walk hits that
    bound without reaching the top of the chain, the assignment is refused
    (returns True) rather than allowed: a chain that long cannot be shown to
    be safe, and may already contain a loop.
    """
    current_id = proposed_manager_id
    depth = 0

    while current_id and depth < max_depth:
        if str(current_id) == str(employee_id):
            return True

        cursor.execute(
            "SELECT reporting_manager_id FROM employees WHERE employee_id = %s",
            (current_id,)
        )
        row = cursor.fetchone()
        current_id = row["reporting_manager_id"] if row else None
        depth += 1

    # Still walking after max_depth steps -> could not prove it is safe.
    return bool(current_id)


def format_employee_dates(employee):
    """
    date_of_birth/joining_date come back from PyMySQL as datetime.date
    objects. Left unformatted, Flask's default JSON encoder serializes
    them as an RFC 1123 string (e.g. "Sun, 23 Aug 2026 00:00:00 GMT")
    instead of a plain "YYYY-MM-DD" string. That breaks the profile page's
    date display and, more importantly, silently empties the edit form's
    <input type="date"> fields since they only accept strict ISO dates.
    Formatting explicitly here avoids both problems at the source.

    Also strips the password hash (added for employee self-service login)
    from the dict, since this is the shared choke point every outgoing
    employee record passes through before being returned to the admin app.
    """
    if employee.get("date_of_birth"):
        employee["date_of_birth"] = employee["date_of_birth"].strftime("%Y-%m-%d")
    if employee.get("joining_date"):
        employee["joining_date"] = employee["joining_date"].strftime("%Y-%m-%d")
    if employee.get("last_working_date"):
        employee["last_working_date"] = employee["last_working_date"].strftime("%Y-%m-%d")
    employee.pop("password", None)
    # Same reason as the password hash: the encrypted 2-Step Verification
    # secret must never leave the server. Only the on/off flag is exposed.
    employee.pop("mfa_secret", None)
    employee.pop("google_sub", None)
    if "mfa_enabled" in employee:
        employee["mfa_enabled"] = bool(employee["mfa_enabled"])
    return employee


def validate_employee_data(data):
    errors = {}

    required_fields = [
        "first_name", "last_name", "email", "phone", "gender",
        "date_of_birth", "joining_date", "department_id",
        "role_id", "grade_id", "shift_id"
    ]

    for field in required_fields:
        if not data.get(field):
            errors[field] = f"{field} is required"

    if errors:
        return errors

    if not is_valid_email(data["email"]):
        errors["email"] = "Invalid email format"

    if not is_valid_phone(str(data["phone"])):
        errors["phone"] = "Phone number must be exactly 10 digits"

    if data["gender"] not in VALID_GENDERS:
        errors["gender"] = "Gender must be Male, Female, or Other"

    dob = parse_date(data["date_of_birth"])
    if dob is None:
        errors["date_of_birth"] = "Date of birth must be a valid date (YYYY-MM-DD)"
    elif dob > date.today():
        errors["date_of_birth"] = "Date of birth cannot be a future date"

    joining_date = parse_date(data["joining_date"])
    if joining_date is None:
        errors["joining_date"] = "Joining date must be a valid date (YYYY-MM-DD)"
    elif joining_date > date.today():
        errors["joining_date"] = "Joining date cannot be a future date"

    status = data.get("status", "Active")
    if status not in VALID_STATUSES:
        errors["status"] = "Status must be Active, On Probation, On Notice, or Inactive"

    return errors


@employee_bp.route("/employees", methods=["GET"])
@require_permission("employees.view")
def get_employees():
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)
    search = request.args.get("search", "").strip()
    department_id = request.args.get("department_id", type=int)
    role_id = request.args.get("role_id", type=int)
    status = request.args.get("status")
    include_archived = request.args.get("include_archived", "false").lower() == "true"

    errors = {}
    if page < 1:
        errors["page"] = "page must be greater than or equal to 1"
    if page_size < 1:
        errors["pageSize"] = "pageSize must be greater than or equal to 1"
    if page_size > 100:
        errors["pageSize"] = "pageSize cannot be greater than 100"
    if status and status not in VALID_STATUSES:
        errors["status"] = "Status must be Active, On Probation, On Notice, or Inactive"

    if errors:
        return validation_error_response(errors)

    offset = (page - 1) * page_size

    conditions = []
    params = []

    if not include_archived:
        conditions.append("e.is_archived = FALSE")

    if search:
        like = f"%{search}%"
        conditions.append(
            "(e.employee_code LIKE %s OR e.first_name LIKE %s OR e.last_name LIKE %s "
            "OR e.email LIKE %s OR e.phone LIKE %s)"
        )
        params.extend([like, like, like, like, like])

    if department_id:
        conditions.append("e.department_id = %s")
        params.append(department_id)

    if role_id:
        conditions.append("e.role_id = %s")
        params.append(role_id)

    if status:
        conditions.append("e.status = %s")
        params.append(status)

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(f"SELECT COUNT(*) AS total FROM employees e {where_clause}", params)
        total = cursor.fetchone()["total"]

        cursor.execute(
            f"""SELECT e.*, d.department_name, r.role_name, g.grade_name, s.shift_name,
                       m.first_name AS manager_first_name, m.last_name AS manager_last_name
                FROM employees e
                JOIN departments d ON e.department_id = d.department_id
                JOIN roles r ON e.role_id = r.role_id
                JOIN grades g ON e.grade_id = g.grade_id
                JOIN shifts s ON e.shift_id = s.shift_id
                LEFT JOIN employees m ON e.reporting_manager_id = m.employee_id
                {where_clause}
                ORDER BY e.employee_id DESC LIMIT %s OFFSET %s""",
            params + [page_size, offset]
        )
        employees = cursor.fetchall()

        return success_response(data={
            "records": [format_employee_dates(e) for e in employees],
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get employees error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_bp.route("/employees/export", methods=["GET"])
@require_permission("employees.export")
def export_employees():
    search = request.args.get("search", "").strip()
    department_id = request.args.get("department_id", type=int)
    role_id = request.args.get("role_id", type=int)
    status = request.args.get("status")
    include_archived = request.args.get("include_archived", "false").lower() == "true"

    if status and status not in VALID_STATUSES:
        return validation_error_response({
            "status": "Status must be Active, On Probation, On Notice, or Inactive"
        })

    conditions = []
    params = []

    if not include_archived:
        conditions.append("e.is_archived = FALSE")

    if search:
        like = f"%{search}%"
        conditions.append(
            "(e.employee_code LIKE %s OR e.first_name LIKE %s OR e.last_name LIKE %s "
            "OR e.email LIKE %s OR e.phone LIKE %s)"
        )
        params.extend([like, like, like, like, like])

    if department_id:
        conditions.append("e.department_id = %s")
        params.append(department_id)

    if role_id:
        conditions.append("e.role_id = %s")
        params.append(role_id)

    if status:
        conditions.append("e.status = %s")
        params.append(status)

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        # No pagination here - export always covers every record matching
        # the current filters, not just the page the admin is viewing.
        cursor.execute(
            f"""SELECT e.*, d.department_name, r.role_name, g.grade_name, s.shift_name
                FROM employees e
                JOIN departments d ON e.department_id = d.department_id
                JOIN roles r ON e.role_id = r.role_id
                JOIN grades g ON e.grade_id = g.grade_id
                JOIN shifts s ON e.shift_id = s.shift_id
                {where_clause}
                ORDER BY e.employee_id DESC""",
            params
        )
        employees = cursor.fetchall()

        if not employees:
            return not_found_response("No employees found matching the current filters")

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Employee Code", "First Name", "Last Name", "Email", "Phone", "Gender",
            "Date of Birth", "Department", "Role", "Grade", "Shift", "Joining Date",
            "Status", "Archived"
        ])

        for emp in employees:
            writer.writerow([
                emp["employee_code"],
                emp["first_name"],
                emp["last_name"],
                emp["email"],
                emp["phone"],
                emp["gender"],
                emp["date_of_birth"],
                emp["department_name"],
                emp["role_name"],
                emp["grade_name"],
                emp["shift_name"],
                emp["joining_date"],
                emp["status"],
                "Yes" if emp["is_archived"] else "No",
            ])

        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=employees.csv"}
        )

    except pymysql.MySQLError as e:
        print(f"Export employees error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_bp.route("/employees/<int:employee_id>", methods=["GET"])
@require_permission("employees.view")
def get_employee(employee_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """SELECT e.*, d.department_name, r.role_name, g.grade_name, s.shift_name,
                      m.first_name AS manager_first_name, m.last_name AS manager_last_name
               FROM employees e
               JOIN departments d ON e.department_id = d.department_id
               JOIN roles r ON e.role_id = r.role_id
               JOIN grades g ON e.grade_id = g.grade_id
               JOIN shifts s ON e.shift_id = s.shift_id
               LEFT JOIN employees m ON e.reporting_manager_id = m.employee_id
               WHERE e.employee_id = %s""",
            (employee_id,)
        )
        employee = cursor.fetchone()

        if not employee:
            return not_found_response("Employee not found")

        return success_response(data=format_employee_dates(employee))

    except pymysql.MySQLError as e:
        print(f"Get employee error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_bp.route("/employees/<int:employee_id>/direct-reports", methods=["GET"])
@require_permission("employees.view")
def get_direct_reports(employee_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT employee_id FROM employees WHERE employee_id = %s", (employee_id,))
        if not cursor.fetchone():
            return not_found_response("Employee not found")

        cursor.execute(
            """SELECT e.*, d.department_name, r.role_name, g.grade_name, s.shift_name
               FROM employees e
               JOIN departments d ON e.department_id = d.department_id
               JOIN roles r ON e.role_id = r.role_id
               JOIN grades g ON e.grade_id = g.grade_id
               JOIN shifts s ON e.shift_id = s.shift_id
               WHERE e.reporting_manager_id = %s AND e.is_archived = FALSE
               ORDER BY e.first_name, e.last_name""",
            (employee_id,)
        )
        reports = cursor.fetchall()

        return success_response(data=[format_employee_dates(r) for r in reports])

    except pymysql.MySQLError as e:
        print(f"Get direct reports error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_bp.route("/employees/<int:employee_id>/manager-chain", methods=["GET"])
@require_permission("employees.view")
def get_manager_chain(employee_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT reporting_manager_id FROM employees WHERE employee_id = %s", (employee_id,))
        row = cursor.fetchone()

        if not row:
            return not_found_response("Employee not found")

        # Walks up the chain one manager at a time. max_depth is the same
        # simple safety bound used in would_create_cycle - a real org chart
        # never comes close to it.
        chain = []
        current_id = row["reporting_manager_id"]
        depth = 0
        max_depth = 50

        while current_id and depth < max_depth:
            cursor.execute(
                """SELECT e.*, d.department_name, r.role_name, g.grade_name, s.shift_name
                   FROM employees e
                   JOIN departments d ON e.department_id = d.department_id
                   JOIN roles r ON e.role_id = r.role_id
                   JOIN grades g ON e.grade_id = g.grade_id
                   JOIN shifts s ON e.shift_id = s.shift_id
                   WHERE e.employee_id = %s""",
                (current_id,)
            )
            manager = cursor.fetchone()

            if not manager:
                break

            chain.append(format_employee_dates(manager))
            current_id = manager["reporting_manager_id"]
            depth += 1

        return success_response(data=chain)

    except pymysql.MySQLError as e:
        print(f"Get manager chain error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_bp.route("/employees", methods=["POST"])
@require_permission("employees.create")
def create_employee():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    errors = validate_employee_data(data)
    if errors:
        return validation_error_response(errors)

    if data.get("status", "Active") == "Inactive":
        return error_response(
            "A new employee cannot be created as Inactive. Inactive is only set through Offboarding.",
            status_code=400
        )

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        master_checks = [
            ("departments", "department_id", "department"),
            ("roles", "role_id", "role"),
            ("grades", "grade_id", "grade"),
            ("shifts", "shift_id", "shift"),
        ]

        for table, id_field, label in master_checks:
            record = get_master_record(cursor, table, id_field, data[id_field])

            if not record:
                return error_response(f"Selected {label} does not exist", status_code=400)

            if record["status"] != "Active":
                return error_response(f"Selected {label} is inactive", status_code=400)

        # A brand new employee has no reports of its own yet, so a cycle
        # can never occur here - only existence/archived needs checking.
        reporting_manager_id = data.get("reporting_manager_id") or None
        if reporting_manager_id:
            manager = get_master_record(cursor, "employees", "employee_id", reporting_manager_id)

            if not manager:
                return error_response("Selected reporting manager does not exist", status_code=400)

            if manager["is_archived"]:
                return error_response("Selected reporting manager is archived", status_code=400)

        # employee_code is system-generated and never accepted from the client.
        # If two employees are created at the same moment and pick the same
        # code, the UNIQUE constraint rejects one and it is retried.
        def insert_employee(employee_code):
            cursor.execute(
                """INSERT INTO employees
                   (employee_code, first_name, last_name, profile_photo, email, phone, address,
                    gender, date_of_birth, joining_date, department_id, role_id, grade_id, shift_id,
                    reporting_manager_id, status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    employee_code,
                    data["first_name"].strip(),
                    data["last_name"].strip(),
                    data.get("profile_photo"),
                    data["email"].strip(),
                    data["phone"].strip(),
                    data.get("address"),
                    data["gender"],
                    data["date_of_birth"],
                    data["joining_date"],
                    data["department_id"],
                    data["role_id"],
                    data["grade_id"],
                    data["shift_id"],
                    reporting_manager_id,
                    data.get("status", "Active")
                )
            )
            return cursor.lastrowid

        new_employee_id = insert_with_generated_code(
            connection, cursor,
            "SELECT MAX(employee_id) AS max_id FROM employees",
            "EMP", "employee_code", insert_employee
        )
        log_action(cursor, request.current_admin["admin_id"], "create", "employee", new_employee_id)
        connection.commit()

        cursor.execute("SELECT * FROM employees WHERE employee_id = %s", (new_employee_id,))
        employee = cursor.fetchone()

        return created_response("Employee created successfully", data=format_employee_dates(employee))

    except pymysql.err.IntegrityError as e:
        message = str(e).lower()
        if "email" in message:
            return error_response("Email already exists", status_code=409)
        if "phone" in message:
            return error_response("Phone number already exists", status_code=409)
        return error_response("Duplicate or invalid data", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create employee error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_bp.route("/employees/<int:employee_id>", methods=["PUT"])
@require_permission("employees.update")
def update_employee(employee_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    errors = validate_employee_data(data)
    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute("SELECT * FROM employees WHERE employee_id = %s", (employee_id,))
        current = cursor.fetchone()

        if not current:
            return not_found_response("Employee not found")

        # Deactivating an employee goes through Offboarding (task and asset-return
        # checks, archiving). Setting the status directly would skip all of that.
        # An employee who is already Inactive can still be edited or reactivated.
        if data.get("status", current["status"]) == "Inactive" and current["status"] != "Inactive":
            return error_response(
                "An employee cannot be set to Inactive here. Use Offboarding to deactivate an employee.",
                status_code=409
            )

        master_checks = [
            ("departments", "department_id", "department"),
            ("roles", "role_id", "role"),
            ("grades", "grade_id", "grade"),
            ("shifts", "shift_id", "shift"),
        ]

        for table, id_field, label in master_checks:
            new_value = data[id_field]
            record = get_master_record(cursor, table, id_field, new_value)

            if not record:
                return error_response(f"Selected {label} does not exist", status_code=400)

            is_same_as_current = (new_value == current[id_field])
            if record["status"] != "Active" and not is_same_as_current:
                return error_response(f"Selected {label} is inactive", status_code=400)

        reporting_manager_id = data.get("reporting_manager_id") or None
        if reporting_manager_id:
            if str(reporting_manager_id) == str(employee_id):
                return error_response("An employee cannot report to themselves", status_code=400)

            manager = get_master_record(cursor, "employees", "employee_id", reporting_manager_id)

            if not manager:
                return error_response("Selected reporting manager does not exist", status_code=400)

            if manager["is_archived"]:
                return error_response("Selected reporting manager is archived", status_code=400)

            if would_create_cycle(cursor, employee_id, reporting_manager_id):
                return error_response(
                    "This assignment would create a reporting cycle "
                    "(or the reporting chain is too deep to verify)", status_code=400
                )

        # employee_code is never updated here
        cursor.execute(
            """UPDATE employees SET
               first_name = %s, last_name = %s, profile_photo = %s, email = %s, phone = %s,
               address = %s, gender = %s, date_of_birth = %s, joining_date = %s,
               department_id = %s, role_id = %s, grade_id = %s, shift_id = %s,
               reporting_manager_id = %s, status = %s
               WHERE employee_id = %s""",
            (
                data["first_name"].strip(),
                data["last_name"].strip(),
                data.get("profile_photo"),
                data["email"].strip(),
                data["phone"].strip(),
                data.get("address"),
                data["gender"],
                data["date_of_birth"],
                data["joining_date"],
                data["department_id"],
                data["role_id"],
                data["grade_id"],
                data["shift_id"],
                reporting_manager_id,
                data.get("status", current["status"]),
                employee_id
            )
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "employee", employee_id)
        connection.commit()

        cursor.execute("SELECT * FROM employees WHERE employee_id = %s", (employee_id,))
        employee = cursor.fetchone()

        return success_response("Employee updated successfully", data=format_employee_dates(employee))

    except pymysql.err.IntegrityError as e:
        message = str(e).lower()
        if "email" in message:
            return error_response("Email already exists", status_code=409)
        if "phone" in message:
            return error_response("Phone number already exists", status_code=409)
        return error_response("Duplicate or invalid data", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Update employee error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_bp.route("/employees/<int:employee_id>", methods=["DELETE"])
@require_permission("employees.archive")
def delete_employee(employee_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM employees WHERE employee_id = %s", (employee_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Employee not found")

        # Archiving is now exclusively performed by Complete Offboarding
        # (see offboarding_routes.py complete_employee_offboarding), which
        # owns required-task validation, asset-return validation, setting
        # status to Inactive, and setting is_archived. This generic endpoint
        # no longer archives on its own, so that workflow cannot be bypassed.
        return error_response(
            "This employee cannot be archived directly. Please complete Offboarding for this employee first.",
            status_code=409
        )

    except pymysql.MySQLError as e:
        print(f"Archive employee error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_bp.route("/employees/<int:employee_id>/restore", methods=["PUT"])
@require_permission("employees.restore")
def restore_employee(employee_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM employees WHERE employee_id = %s", (employee_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Employee not found")

        if not existing["is_archived"]:
            return error_response("Employee is not archived", status_code=400)

        cursor.execute("UPDATE employees SET is_archived = FALSE WHERE employee_id = %s", (employee_id,))
        log_action(cursor, request.current_admin["admin_id"], "restore", "employee", employee_id)
        connection.commit()

        cursor.execute("SELECT * FROM employees WHERE employee_id = %s", (employee_id,))
        employee = cursor.fetchone()

        return success_response("Employee restored successfully", data=format_employee_dates(employee))

    except pymysql.MySQLError as e:
        print(f"Restore employee error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_bp.route("/employees/<int:employee_id>/mfa/reset", methods=["PUT"])
@require_permission("employees.mfa_reset")
def reset_employee_mfa(employee_id):
    """Turns 2-Step Verification off for an employee who has lost both
    their authenticator and their recovery codes. They can then log in
    with just their password and set it up again from Settings."""
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT employee_id, first_name, last_name, employee_code, mfa_enabled FROM employees WHERE employee_id = %s",
            (employee_id,)
        )
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Employee not found")

        if not existing["mfa_enabled"]:
            return error_response("2-Step Verification is not enabled for this employee", status_code=400)

        cursor.execute(
            "UPDATE employees SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_enrolled_at = NULL WHERE employee_id = %s",
            (employee_id,)
        )
        cursor.execute("DELETE FROM employee_mfa_recovery_codes WHERE employee_id = %s", (employee_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "update", "employee_mfa", employee_id,
            details=f"2-Step Verification reset for {existing['first_name']} {existing['last_name']} ({existing['employee_code']})"
        )
        connection.commit()

        return success_response(
            "2-Step Verification has been reset for this employee. They can log in with their password and turn it on again from Settings."
        )

    except pymysql.MySQLError as e:
        print(f"Reset employee MFA error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_bp.route("/employees/<int:employee_id>/permanent", methods=["DELETE"])
@require_permission("employees.delete")
def permanently_delete_employee(employee_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM employees WHERE employee_id = %s", (employee_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Employee not found")

        if not existing["is_archived"]:
            return error_response("Only archived employees can be permanently deleted", status_code=400)

        # employee_documents rows are removed automatically via ON DELETE
        # CASCADE; their files on disk are not, so the paths are collected
        # here and cleaned up after the database delete has committed.
        cursor.execute("SELECT file_path FROM employee_documents WHERE employee_id = %s", (employee_id,))
        document_paths = [row["file_path"] for row in cursor.fetchall()]

        # Break the employee_documents -> employee_training_records SET NULL
        # path before it can collide with the direct CASCADE delete of the
        # same training-record rows below (see comment above).
        cursor.execute(
            "UPDATE employee_training_records SET document_id = NULL WHERE employee_id = %s AND document_id IS NOT NULL",
            (employee_id,)
        )

        cursor.execute("DELETE FROM employees WHERE employee_id = %s", (employee_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "employee", employee_id,
            details=f"{existing['first_name']} {existing['last_name']} ({existing['employee_code']})"
        )
        connection.commit()

        for relative_path in document_paths:
            try:
                delete_file(relative_path)
            except OSError as e:
                print(f"Could not remove document file from storage: {e}")

        return success_response("Employee permanently deleted")

    except pymysql.MySQLError as e:
        print(f"Permanently delete employee error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()