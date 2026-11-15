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
from utils.email_sender import send_email
from config import settings

asset_bp = Blueprint("asset", __name__)

VALID_TYPE_STATUSES = ("Active", "Inactive")
VALID_ASSET_STATUSES = ("Available", "Assigned", "Under Repair", "Retired", "Lost")
# Statuses settable through the generic edit endpoint - 'Assigned' is
# deliberately excluded, it can only be reached through assign_asset().
EDITABLE_ASSET_STATUSES = ("Available", "Under Repair", "Retired", "Lost")
VALID_RETURN_CONDITIONS = ("Good", "Damaged", "Missing Parts", "Non-functional")
VALID_CONDITIONS = ("New", "Good", "Fair", "Poor")


# ---------------------------------------------------------------------
# Local notification helpers (duplicated from the pattern established in
# leave_routes.py rather than shared, since Leave is a completed/locked
# module - see project notes). Same commit-then-email safety rule:
# create_notification() runs pre-commit as part of the DB transaction;
# send_asset_email() must only ever be called after connection.commit()
# has already succeeded, and never lets a failure surface as an error
# for an already-successful asset action.
# ---------------------------------------------------------------------

def queue_asset_notification(cursor, recipient_employee_id, notif_type, title, message, link, related_entity_id):
    create_notification(
        cursor, recipient_employee_id, notif_type, title, message,
        link=link, related_entity_type="asset_assignment", related_entity_id=related_entity_id
    )


def send_asset_email(recipient_email, recipient_first_name, title, message, link):
    try:
        send_email(
            recipient_email,
            title,
            f"Hi {recipient_first_name},\n\n{message}\n\n"
            f"View it here: {settings.FRONTEND_BASE_URL}{link}"
        )
    except Exception as e:
        print(f"Failed to send asset notification email to {recipient_email}: {e}")


# ---------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------

def get_employee_record(cursor, employee_id):
    cursor.execute(
        "SELECT employee_id, department_id, is_archived, email, first_name, last_name "
        "FROM employees WHERE employee_id = %s",
        (employee_id,)
    )
    return cursor.fetchone()


def get_asset_type_record(cursor, asset_type_id):
    cursor.execute(
        "SELECT asset_type_id, type_code, is_archived FROM asset_types WHERE asset_type_id = %s",
        (asset_type_id,)
    )
    return cursor.fetchone()


def generate_asset_tag(cursor, type_code):
    """
    Tags are per-type sequential: LAP-001, LAP-002... Numbers are never
    reused - computed from the max existing suffix for this type_code
    (archived/returned assets included) - so a tag can never collide.
    """
    cursor.execute("SELECT asset_tag FROM assets WHERE asset_tag LIKE %s", (f"{type_code}-%",))
    max_number = 0
    prefix_len = len(type_code) + 1
    for row in cursor.fetchall():
        suffix = row["asset_tag"][prefix_len:]
        if suffix.isdigit():
            max_number = max(max_number, int(suffix))
    return f"{type_code}-{max_number + 1:03d}"


ASSET_SELECT = """
    SELECT a.asset_id, a.asset_type_id, a.asset_tag, a.serial_number, a.manufacturer, a.model,
           a.`condition`, a.status,
           a.current_employee_id, a.purchase_date, a.purchase_cost, a.vendor, a.warranty_expiry,
           a.notes, a.is_archived, a.created_at, a.updated_at,
           t.type_name, t.type_code,
           e.employee_code AS current_employee_code, e.first_name AS current_employee_first_name,
           e.last_name AS current_employee_last_name, e.department_id AS current_employee_department_id,
           d.department_name AS current_employee_department_name
    FROM assets a
    JOIN asset_types t ON a.asset_type_id = t.asset_type_id
    LEFT JOIN employees e ON a.current_employee_id = e.employee_id
    LEFT JOIN departments d ON e.department_id = d.department_id
"""

ASSIGNMENT_SELECT = """
    SELECT ass.assignment_id, ass.asset_id, ass.employee_id, ass.assigned_by_admin_id,
           ass.returned_by_admin_id, ass.assigned_date, ass.returned_date, ass.assignment_notes,
           ass.return_condition, ass.return_notes,
           a.asset_tag, t.type_name,
           e.employee_code, e.first_name, e.last_name,
           ab.name AS assigned_by_name, rb.name AS returned_by_name
    FROM asset_assignments ass
    JOIN assets a ON ass.asset_id = a.asset_id
    JOIN asset_types t ON a.asset_type_id = t.asset_type_id
    JOIN employees e ON ass.employee_id = e.employee_id
    LEFT JOIN admins ab ON ass.assigned_by_admin_id = ab.admin_id
    LEFT JOIN admins rb ON ass.returned_by_admin_id = rb.admin_id
"""


def format_asset(asset):
    if asset:
        if asset.get("purchase_date"):
            asset["purchase_date"] = asset["purchase_date"].strftime("%Y-%m-%d")
        if asset.get("warranty_expiry"):
            asset["warranty_expiry"] = asset["warranty_expiry"].strftime("%Y-%m-%d")
        if asset.get("purchase_cost") is not None:
            asset["purchase_cost"] = float(asset["purchase_cost"])
        if asset.get("created_at"):
            asset["created_at"] = asset["created_at"].strftime("%Y-%m-%d %H:%M:%S")
        if asset.get("updated_at"):
            asset["updated_at"] = asset["updated_at"].strftime("%Y-%m-%d %H:%M:%S")
    return asset


def format_assignment(entry):
    if entry:
        if entry.get("assigned_date"):
            entry["assigned_date"] = entry["assigned_date"].strftime("%Y-%m-%d %H:%M:%S")
        if entry.get("returned_date"):
            entry["returned_date"] = entry["returned_date"].strftime("%Y-%m-%d %H:%M:%S")
    return entry


class AssetOperationError(Exception):
    """Raised by assign_asset()/return_asset() for a business-rule violation - callers catch this and turn it into a 400 response."""
    pass


def assign_asset(cursor, asset_id, employee_id, admin_id, assignment_notes=None):
    """
    Core assign logic. Reusable by future modules (e.g. Onboarding) -
    takes an existing cursor and does not commit; the caller controls
    the transaction boundary. Returns (assignment_id, asset, employee).
    """
    cursor.execute("SELECT * FROM assets WHERE asset_id = %s", (asset_id,))
    asset = cursor.fetchone()
    if not asset:
        raise AssetOperationError("Asset not found")
    if asset["is_archived"]:
        raise AssetOperationError(f"Asset {asset['asset_tag']} is archived")
    if asset["status"] != "Available":
        raise AssetOperationError(f"Asset {asset['asset_tag']} is not available (status: {asset['status']})")

    employee = get_employee_record(cursor, employee_id)
    if not employee:
        raise AssetOperationError("Selected employee does not exist")
    if employee["is_archived"]:
        raise AssetOperationError("Selected employee is archived")

    cursor.execute(
        "INSERT INTO asset_assignments (asset_id, employee_id, assigned_by_admin_id, assignment_notes) "
        "VALUES (%s, %s, %s, %s)",
        (asset_id, employee_id, admin_id, assignment_notes)
    )
    assignment_id = cursor.lastrowid

    cursor.execute(
        "UPDATE assets SET status = 'Assigned', current_employee_id = %s WHERE asset_id = %s",
        (employee_id, asset_id)
    )

    return assignment_id, asset, employee


def return_asset(cursor, asset_id, admin_id, return_condition, return_notes=None):
    """
    Core return logic. Same reuse intent as assign_asset(). Returns
    (assignment_id, asset, employee) - employee is who had it, for
    notification purposes.
    """
    cursor.execute("SELECT * FROM assets WHERE asset_id = %s", (asset_id,))
    asset = cursor.fetchone()
    if not asset:
        raise AssetOperationError("Asset not found")
    if asset["status"] != "Assigned":
        raise AssetOperationError(f"Asset {asset['asset_tag']} is not currently assigned")

    cursor.execute(
        "SELECT * FROM asset_assignments WHERE asset_id = %s AND returned_date IS NULL "
        "ORDER BY assignment_id DESC LIMIT 1",
        (asset_id,)
    )
    open_assignment = cursor.fetchone()
    if not open_assignment:
        raise AssetOperationError("No open assignment record found for this asset")

    employee = get_employee_record(cursor, open_assignment["employee_id"])

    cursor.execute(
        "UPDATE asset_assignments SET returned_date = NOW(), returned_by_admin_id = %s, "
        "return_condition = %s, return_notes = %s WHERE assignment_id = %s",
        (admin_id, return_condition, return_notes, open_assignment["assignment_id"])
    )

    new_status = "Available" if return_condition == "Good" else "Under Repair"
    cursor.execute(
        "UPDATE assets SET status = %s, current_employee_id = NULL WHERE asset_id = %s",
        (new_status, asset_id)
    )

    return open_assignment["assignment_id"], asset, employee


# ---------------------------------------------------------------------
# asset_types (catalog) - mirrors shift_routes.py exactly
# ---------------------------------------------------------------------

@asset_bp.route("/asset-types", methods=["GET"])
@require_permission("asset.view")
def get_asset_types():
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
        cursor.execute(f"SELECT COUNT(*) AS total FROM asset_types {where_clause}")
        total = cursor.fetchone()["total"]

        cursor.execute(
            f"SELECT * FROM asset_types {where_clause} ORDER BY asset_type_id DESC LIMIT %s OFFSET %s",
            (page_size, offset)
        )
        asset_types = cursor.fetchall()

        return success_response(data={
            "records": asset_types,
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get asset types error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/asset-types/<int:asset_type_id>", methods=["GET"])
@require_permission("asset.view")
def get_asset_type(asset_type_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM asset_types WHERE asset_type_id = %s", (asset_type_id,))
        asset_type = cursor.fetchone()

        if not asset_type:
            return not_found_response("Asset type not found")

        return success_response(data=asset_type)

    except pymysql.MySQLError as e:
        print(f"Get asset type error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/asset-types", methods=["POST"])
@require_permission("asset.create")
def create_asset_type():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    type_name = data.get("type_name")
    type_code = data.get("type_code")
    status = data.get("status", "Active")

    errors = {}
    if not type_name or not type_name.strip():
        errors["type_name"] = "Type name is required"
    if not type_code or not type_code.strip():
        errors["type_code"] = "Type code is required"
    if status not in VALID_TYPE_STATUSES:
        errors["status"] = "Status must be Active or Inactive"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "INSERT INTO asset_types (type_name, type_code, status) VALUES (%s, %s, %s)",
            (type_name.strip(), type_code.strip().upper(), status)
        )
        log_action(cursor, request.current_admin["admin_id"], "create", "asset_type", cursor.lastrowid)
        connection.commit()

        cursor.execute("SELECT * FROM asset_types WHERE asset_type_id = %s", (cursor.lastrowid,))
        asset_type = cursor.fetchone()

        return created_response("Asset type created successfully", data=asset_type)

    except pymysql.err.IntegrityError:
        return error_response("Type code already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create asset type error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/asset-types/<int:asset_type_id>", methods=["PUT"])
@require_permission("asset.update")
def update_asset_type(asset_type_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    type_name = data.get("type_name")
    type_code = data.get("type_code")
    status = data.get("status")

    errors = {}
    if not type_name or not type_name.strip():
        errors["type_name"] = "Type name is required"
    if not type_code or not type_code.strip():
        errors["type_code"] = "Type code is required"
    if status not in VALID_TYPE_STATUSES:
        errors["status"] = "Status must be Active or Inactive"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM asset_types WHERE asset_type_id = %s", (asset_type_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Asset type not found")

        if existing["is_archived"]:
            return error_response("Cannot edit an archived asset type - restore it first", status_code=400)

        # Note: changing type_code does not retroactively rename already
        # generated asset tags - they keep whatever prefix was current
        # when they were created, same as employee_code/department_code
        # are never renumbered elsewhere in this system.
        cursor.execute(
            "UPDATE asset_types SET type_name = %s, type_code = %s, status = %s WHERE asset_type_id = %s",
            (type_name.strip(), type_code.strip().upper(), status, asset_type_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "asset_type", asset_type_id)
        connection.commit()

        cursor.execute("SELECT * FROM asset_types WHERE asset_type_id = %s", (asset_type_id,))
        asset_type = cursor.fetchone()

        return success_response("Asset type updated successfully", data=asset_type)

    except pymysql.err.IntegrityError:
        return error_response("Type code already exists", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Update asset type error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/asset-types/<int:asset_type_id>", methods=["DELETE"])
@require_permission("asset.archive")
def archive_asset_type(asset_type_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM asset_types WHERE asset_type_id = %s", (asset_type_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Asset type not found")

        if existing["is_archived"]:
            return error_response("Asset type is already archived", status_code=400)

        cursor.execute("UPDATE asset_types SET is_archived = TRUE WHERE asset_type_id = %s", (asset_type_id,))
        log_action(cursor, request.current_admin["admin_id"], "archive", "asset_type", asset_type_id)
        connection.commit()

        return success_response("Asset type archived successfully")

    except pymysql.MySQLError as e:
        print(f"Archive asset type error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/asset-types/<int:asset_type_id>/restore", methods=["PUT"])
@require_permission("asset.restore")
def restore_asset_type(asset_type_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM asset_types WHERE asset_type_id = %s", (asset_type_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Asset type not found")

        if not existing["is_archived"]:
            return error_response("Asset type is not archived", status_code=400)

        cursor.execute("UPDATE asset_types SET is_archived = FALSE WHERE asset_type_id = %s", (asset_type_id,))
        log_action(cursor, request.current_admin["admin_id"], "restore", "asset_type", asset_type_id)
        connection.commit()

        cursor.execute("SELECT * FROM asset_types WHERE asset_type_id = %s", (asset_type_id,))
        asset_type = cursor.fetchone()

        return success_response("Asset type restored successfully", data=asset_type)

    except pymysql.MySQLError as e:
        print(f"Restore asset type error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/asset-types/<int:asset_type_id>/permanent", methods=["DELETE"])
@require_permission("asset.delete")
def permanently_delete_asset_type(asset_type_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM asset_types WHERE asset_type_id = %s", (asset_type_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Asset type not found")

        if not existing["is_archived"]:
            return error_response("Only archived asset types can be permanently deleted", status_code=400)

        cursor.execute("DELETE FROM asset_types WHERE asset_type_id = %s", (asset_type_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "asset_type", asset_type_id,
            details=existing["type_name"]
        )
        connection.commit()

        return success_response("Asset type permanently deleted")

    except pymysql.err.IntegrityError:
        return error_response(
            "This asset type still has inventory items and cannot be permanently deleted",
            status_code=409
        )

    except pymysql.MySQLError as e:
        print(f"Permanently delete asset type error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# assets (inventory)
# ---------------------------------------------------------------------

@asset_bp.route("/assets", methods=["GET"])
@require_permission("asset.view")
def get_assets():
    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", 10, type=int)
    include_archived = request.args.get("include_archived", "false").lower() == "true"
    asset_type_id = request.args.get("asset_type_id", type=int)
    status = request.args.get("status")
    department_id = request.args.get("department_id", type=int)
    employee_id = request.args.get("employee_id", type=int)

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

    conditions = [] if include_archived else ["a.is_archived = FALSE"]
    params = []

    if asset_type_id:
        conditions.append("a.asset_type_id = %s")
        params.append(asset_type_id)
    if status:
        conditions.append("a.status = %s")
        params.append(status)
    if department_id:
        conditions.append("e.department_id = %s")
        params.append(department_id)
    if employee_id:
        conditions.append("a.current_employee_id = %s")
        params.append(employee_id)

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            f"""SELECT COUNT(*) AS total FROM assets a
                LEFT JOIN employees e ON a.current_employee_id = e.employee_id
                {where_clause}""",
            params
        )
        total = cursor.fetchone()["total"]

        cursor.execute(
            f"{ASSET_SELECT} {where_clause} ORDER BY a.asset_id DESC LIMIT %s OFFSET %s",
            params + [page_size, offset]
        )
        assets = cursor.fetchall()

        return success_response(data={
            "records": [format_asset(a) for a in assets],
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get assets error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/assets/<int:asset_id>", methods=["GET"])
@require_permission("asset.view")
def get_asset(asset_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(f"{ASSET_SELECT} WHERE a.asset_id = %s", (asset_id,))
        asset = cursor.fetchone()

        if not asset:
            return not_found_response("Asset not found")

        return success_response(data=format_asset(asset))

    except pymysql.MySQLError as e:
        print(f"Get asset error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/assets/<int:asset_id>/history", methods=["GET"])
@require_permission("asset.view")
def get_asset_history(asset_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT asset_id FROM assets WHERE asset_id = %s", (asset_id,))
        if not cursor.fetchone():
            return not_found_response("Asset not found")

        cursor.execute(
            f"{ASSIGNMENT_SELECT} WHERE ass.asset_id = %s ORDER BY ass.assigned_date DESC",
            (asset_id,)
        )
        history = cursor.fetchall()

        return success_response(data=[format_assignment(h) for h in history])

    except pymysql.MySQLError as e:
        print(f"Get asset history error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/assets", methods=["POST"])
@require_permission("asset.create")
def create_asset():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    asset_type_id = data.get("asset_type_id")
    serial_number = data.get("serial_number")
    manufacturer = data.get("manufacturer")
    model = data.get("model")
    condition = data.get("condition") or None
    purchase_date = data.get("purchase_date") or None
    purchase_cost = data.get("purchase_cost") or None
    vendor = data.get("vendor")
    warranty_expiry = data.get("warranty_expiry") or None
    notes = data.get("notes")

    errors = {}
    if not asset_type_id:
        errors["asset_type_id"] = "Asset type is required"
    if condition and condition not in VALID_CONDITIONS:
        errors["condition"] = "Condition must be New, Good, Fair, or Poor"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        asset_type = get_asset_type_record(cursor, asset_type_id)
        if not asset_type:
            return error_response("Selected asset type does not exist", status_code=400)
        if asset_type["is_archived"]:
            return error_response("Selected asset type is archived", status_code=400)

        asset_tag = generate_asset_tag(cursor, asset_type["type_code"])

        cursor.execute(
            "INSERT INTO assets (asset_type_id, asset_tag, serial_number, manufacturer, model, `condition`, "
            "purchase_date, purchase_cost, vendor, warranty_expiry, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (asset_type_id, asset_tag, serial_number, manufacturer, model, condition, purchase_date,
             purchase_cost, vendor, warranty_expiry, notes)
        )
        asset_id = cursor.lastrowid
        log_action(cursor, request.current_admin["admin_id"], "create", "asset", asset_id)
        connection.commit()

        cursor.execute(f"{ASSET_SELECT} WHERE a.asset_id = %s", (asset_id,))
        return created_response("Asset created successfully", data=format_asset(cursor.fetchone()))

    except pymysql.err.IntegrityError:
        return error_response("Asset tag already exists, please try again", status_code=409)

    except pymysql.MySQLError as e:
        print(f"Create asset error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/assets/<int:asset_id>", methods=["PUT"])
@require_permission("asset.update")
def update_asset(asset_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    serial_number = data.get("serial_number")
    manufacturer = data.get("manufacturer")
    model = data.get("model")
    condition = data.get("condition") or None
    status = data.get("status")
    purchase_date = data.get("purchase_date") or None
    purchase_cost = data.get("purchase_cost") or None
    vendor = data.get("vendor")
    warranty_expiry = data.get("warranty_expiry") or None
    notes = data.get("notes")

    if status not in EDITABLE_ASSET_STATUSES:
        return validation_error_response(
            {"status": "Status must be Available, Under Repair, Retired, or Lost - "
                       "use the assign/return actions to change assignment state"}
        )
    if condition and condition not in VALID_CONDITIONS:
        return validation_error_response({"condition": "Condition must be New, Good, Fair, or Poor"})

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM assets WHERE asset_id = %s", (asset_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Asset not found")

        if existing["is_archived"]:
            return error_response("Cannot edit an archived asset - restore it first", status_code=400)

        if existing["status"] == "Assigned":
            return error_response(
                "This asset is currently assigned - process a return before changing its status",
                status_code=400
            )

        # asset_type_id and asset_tag are immutable after creation.
        cursor.execute(
            "UPDATE assets SET serial_number = %s, manufacturer = %s, model = %s, `condition` = %s, "
            "status = %s, purchase_date = %s, purchase_cost = %s, vendor = %s, warranty_expiry = %s, "
            "notes = %s WHERE asset_id = %s",
            (serial_number, manufacturer, model, condition, status, purchase_date, purchase_cost,
             vendor, warranty_expiry, notes, asset_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "asset", asset_id)
        connection.commit()

        cursor.execute(f"{ASSET_SELECT} WHERE a.asset_id = %s", (asset_id,))
        return success_response("Asset updated successfully", data=format_asset(cursor.fetchone()))

    except pymysql.MySQLError as e:
        print(f"Update asset error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/assets/<int:asset_id>", methods=["DELETE"])
@require_permission("asset.archive")
def archive_asset(asset_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM assets WHERE asset_id = %s", (asset_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Asset not found")

        if existing["is_archived"]:
            return error_response("Asset is already archived", status_code=400)

        if existing["status"] == "Assigned":
            return error_response(
                "This asset is currently assigned and cannot be archived - process a return first",
                status_code=400
            )

        cursor.execute("UPDATE assets SET is_archived = TRUE WHERE asset_id = %s", (asset_id,))
        log_action(cursor, request.current_admin["admin_id"], "archive", "asset", asset_id)
        connection.commit()

        return success_response("Asset archived successfully")

    except pymysql.MySQLError as e:
        print(f"Archive asset error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/assets/<int:asset_id>/restore", methods=["PUT"])
@require_permission("asset.restore")
def restore_asset(asset_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM assets WHERE asset_id = %s", (asset_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Asset not found")

        if not existing["is_archived"]:
            return error_response("Asset is not archived", status_code=400)

        cursor.execute("UPDATE assets SET is_archived = FALSE WHERE asset_id = %s", (asset_id,))
        log_action(cursor, request.current_admin["admin_id"], "restore", "asset", asset_id)
        connection.commit()

        cursor.execute(f"{ASSET_SELECT} WHERE a.asset_id = %s", (asset_id,))
        return success_response("Asset restored successfully", data=format_asset(cursor.fetchone()))

    except pymysql.MySQLError as e:
        print(f"Restore asset error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/assets/<int:asset_id>/permanent", methods=["DELETE"])
@require_permission("asset.delete")
def permanently_delete_asset(asset_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM assets WHERE asset_id = %s", (asset_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Asset not found")

        if not existing["is_archived"]:
            return error_response("Only archived assets can be permanently deleted", status_code=400)

        cursor.execute("DELETE FROM assets WHERE asset_id = %s", (asset_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "asset", asset_id,
            details=existing["asset_tag"]
        )
        connection.commit()

        return success_response("Asset permanently deleted")

    except pymysql.err.IntegrityError:
        # ON DELETE RESTRICT blocks this if assignment history still references the asset -
        # assignment history is never lost, per requirement.
        return error_response(
            "This asset has assignment history and cannot be permanently deleted",
            status_code=409
        )

    except pymysql.MySQLError as e:
        print(f"Permanently delete asset error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Assign / Return / Bulk assign
# ---------------------------------------------------------------------

@asset_bp.route("/assets/<int:asset_id>/assign", methods=["POST"])
@require_permission("asset.assign")
def assign_asset_route(asset_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    employee_id = data.get("employee_id")
    assignment_notes = data.get("assignment_notes")

    if not employee_id:
        return validation_error_response({"employee_id": "Employee is required"})

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        try:
            assignment_id, asset, employee = assign_asset(
                cursor, asset_id, employee_id, request.current_admin["admin_id"], assignment_notes
            )
        except AssetOperationError as e:
            return error_response(str(e), status_code=400)

        log_action(cursor, request.current_admin["admin_id"], "create", "asset_assignment", assignment_id)

        title = "Asset assigned to you"
        message = f"{asset['asset_tag']} has been assigned to you."
        link = "/employee/assets"
        queue_asset_notification(cursor, employee["employee_id"], "asset_assigned", title, message, link, assignment_id)

        notify_all_admins(
            cursor,
            "asset_assigned",
            "Asset assigned",
            f"{asset['asset_tag']} has been assigned to {employee['first_name']} {employee['last_name']}.",
            link="/admin/assets",
            related_entity_type="asset_assignment",
            related_entity_id=assignment_id,
        )

        connection.commit()

        send_asset_email(employee["email"], employee["first_name"], title, message, link)

        cursor.execute(f"{ASSET_SELECT} WHERE a.asset_id = %s", (asset_id,))
        return success_response("Asset assigned successfully", data=format_asset(cursor.fetchone()))

    except pymysql.MySQLError as e:
        print(f"Assign asset error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/assets/<int:asset_id>/return", methods=["POST"])
@require_permission("asset.return")
def return_asset_route(asset_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    return_condition = data.get("return_condition")
    return_notes = data.get("return_notes")

    if return_condition not in VALID_RETURN_CONDITIONS:
        return validation_error_response(
            {"return_condition": "Return condition must be Good, Damaged, Missing Parts, or Non-functional"}
        )

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        try:
            assignment_id, asset, employee = return_asset(
                cursor, asset_id, request.current_admin["admin_id"], return_condition, return_notes
            )
        except AssetOperationError as e:
            return error_response(str(e), status_code=400)

        log_action(cursor, request.current_admin["admin_id"], "update", "asset_assignment", assignment_id)

        pending_email = None
        if employee:
            title = "Asset return processed"
            message = f"Your return of {asset['asset_tag']} has been processed (condition: {return_condition})."
            link = "/employee/assets"
            queue_asset_notification(
                cursor, employee["employee_id"], "asset_returned", title, message, link, assignment_id
            )
            pending_email = (employee["email"], employee["first_name"], title, message, link)

        notify_all_admins(
            cursor,
            "asset_returned",
            "Asset return processed",
            f"{asset['asset_tag']} has been returned (condition: {return_condition}).",
            link="/admin/assets",
            related_entity_type="asset_assignment",
            related_entity_id=assignment_id,
        )

        connection.commit()

        if pending_email:
            send_asset_email(*pending_email)

        cursor.execute(f"{ASSET_SELECT} WHERE a.asset_id = %s", (asset_id,))
        return success_response("Asset return processed successfully", data=format_asset(cursor.fetchone()))

    except pymysql.MySQLError as e:
        print(f"Return asset error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@asset_bp.route("/assets/bulk-assign", methods=["POST"])
@require_permission("asset.assign")
def bulk_assign_assets():
    """
    All-or-nothing: every asset/employee pair is fully validated before
    any write happens, and every write shares the same transaction (one
    commit at the end) - so a failure partway through can never leave
    some assets assigned and others not.
    """
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    assignments = data.get("assignments")
    if not assignments or not isinstance(assignments, list):
        return validation_error_response({"assignments": "At least one asset/employee pair is required"})

    asset_ids_seen = set()
    for i, item in enumerate(assignments):
        if not item.get("asset_id") or not item.get("employee_id"):
            return validation_error_response(
                {"assignments": f"Row {i + 1}: asset and employee are both required"}
            )
        if item["asset_id"] in asset_ids_seen:
            return validation_error_response(
                {"assignments": f"Row {i + 1}: this asset is used more than once in this batch"}
            )
        asset_ids_seen.add(item["asset_id"])

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        # Pre-validate every pair before writing anything.
        for i, item in enumerate(assignments):
            cursor.execute("SELECT * FROM assets WHERE asset_id = %s", (item["asset_id"],))
            asset = cursor.fetchone()
            if not asset:
                return validation_error_response({"assignments": f"Row {i + 1}: asset not found"})
            if asset["is_archived"]:
                return validation_error_response(
                    {"assignments": f"Row {i + 1}: asset {asset['asset_tag']} is archived"}
                )
            if asset["status"] != "Available":
                return validation_error_response(
                    {"assignments": f"Row {i + 1}: asset {asset['asset_tag']} is not available"}
                )

            employee = get_employee_record(cursor, item["employee_id"])
            if not employee:
                return validation_error_response({"assignments": f"Row {i + 1}: employee not found"})
            if employee["is_archived"]:
                return validation_error_response({"assignments": f"Row {i + 1}: employee is archived"})

        # All valid - perform every assignment within the same transaction.
        pending_emails = []
        assigned_count = 0
        for item in assignments:
            assignment_id, asset, employee = assign_asset(
                cursor, item["asset_id"], item["employee_id"],
                request.current_admin["admin_id"], item.get("assignment_notes")
            )
            log_action(cursor, request.current_admin["admin_id"], "create", "asset_assignment", assignment_id)

            title = "Asset assigned to you"
            message = f"{asset['asset_tag']} has been assigned to you."
            link = "/employee/assets"
            queue_asset_notification(
                cursor, employee["employee_id"], "asset_assigned", title, message, link, assignment_id
            )
            pending_emails.append((employee["email"], employee["first_name"], title, message, link))
            assigned_count += 1

        connection.commit()

        for email_args in pending_emails:
            send_asset_email(*email_args)

        return created_response(
            f"{assigned_count} asset(s) assigned successfully", data={"assigned": assigned_count}
        )

    except pymysql.MySQLError as e:
        print(f"Bulk assign assets error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Employee self-service
# ---------------------------------------------------------------------

@asset_bp.route("/employee/assets", methods=["GET"])
@require_employee_auth
def get_my_assets():
    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(
            f"{ASSET_SELECT} WHERE a.current_employee_id = %s AND a.is_archived = FALSE ORDER BY a.asset_tag",
            (employee_id,)
        )
        current_assets = cursor.fetchall()

        # Past (returned) assignments only - kept clearly separate from
        # what's currently assigned, per requirement.
        cursor.execute(
            f"{ASSIGNMENT_SELECT} WHERE ass.employee_id = %s AND ass.returned_date IS NOT NULL "
            f"ORDER BY ass.returned_date DESC",
            (employee_id,)
        )
        history = cursor.fetchall()

        return success_response(data={
            "current_assets": [format_asset(a) for a in current_assets],
            "assignment_history": [format_assignment(h) for h in history],
        })

    except pymysql.MySQLError as e:
        print(f"Get my assets error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()