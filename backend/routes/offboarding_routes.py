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
from utils.auth_helper import require_permission
from utils.audit_helper import log_action
from utils.notification_helper import notify_all_admins

offboarding_bp = Blueprint("offboarding", __name__)

VALID_STATUSES = ("Active", "Inactive")


def get_employee_record(cursor, employee_id):
    cursor.execute(
        "SELECT employee_id, first_name, last_name, employee_code, is_archived, last_working_date "
        "FROM employees WHERE employee_id = %s",
        (employee_id,)
    )
    return cursor.fetchone()


def parse_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------
# offboarding_checklist_items (catalog) - mirrors onboarding_routes.py
# ---------------------------------------------------------------------

@offboarding_bp.route("/offboarding-items", methods=["GET"])
@require_permission("offboarding.view")
def get_offboarding_items():
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
        cursor.execute(f"SELECT COUNT(*) AS total FROM offboarding_checklist_items {where_clause}")
        total = cursor.fetchone()["total"]

        cursor.execute(
            f"SELECT * FROM offboarding_checklist_items {where_clause} "
            f"ORDER BY display_order, item_id LIMIT %s OFFSET %s",
            (page_size, offset)
        )
        items = cursor.fetchall()

        return success_response(data={
            "records": items,
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get offboarding items error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@offboarding_bp.route("/offboarding-items", methods=["POST"])
@require_permission("offboarding.manage")
def create_offboarding_item():
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    item_name = data.get("item_name")
    is_required = bool(data.get("is_required", True))
    display_order = data.get("display_order")
    status = data.get("status", "Active")

    errors = {}
    if not item_name or not item_name.strip():
        errors["item_name"] = "Item name is required"
    if status not in VALID_STATUSES:
        errors["status"] = "Status must be Active or Inactive"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        # Blank/omitted display_order appends to the end of the list;
        # an explicit value (0 included) is used as given.
        if display_order is None or display_order == "":
            cursor.execute("SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM offboarding_checklist_items")
            display_order = cursor.fetchone()["next_order"]

        # item_code is system-generated and never accepted from the client
        cursor.execute("SELECT MAX(item_id) AS max_id FROM offboarding_checklist_items")
        max_id = cursor.fetchone()["max_id"] or 0
        item_code = f"OFF{max_id + 1:04d}"

        cursor.execute(
            "INSERT INTO offboarding_checklist_items (item_code, item_name, is_required, display_order, status) "
            "VALUES (%s, %s, %s, %s, %s)",
            (item_code, item_name.strip(), is_required, display_order, status)
        )
        new_item_id = cursor.lastrowid
        log_action(
            cursor, request.current_admin["admin_id"], "create", "offboarding_item", new_item_id,
            details=item_name.strip()
        )
        connection.commit()

        cursor.execute("SELECT * FROM offboarding_checklist_items WHERE item_id = %s", (new_item_id,))
        item = cursor.fetchone()

        return created_response("Offboarding checklist item created successfully", data=item)

    except pymysql.MySQLError as e:
        print(f"Create offboarding item error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@offboarding_bp.route("/offboarding-items/<int:item_id>", methods=["PUT"])
@require_permission("offboarding.manage")
def update_offboarding_item(item_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    item_name = data.get("item_name")
    is_required = bool(data.get("is_required", True))
    display_order = data.get("display_order", 0)
    status = data.get("status")

    errors = {}
    if not item_name or not item_name.strip():
        errors["item_name"] = "Item name is required"
    if status not in VALID_STATUSES:
        errors["status"] = "Status must be Active or Inactive"

    if errors:
        return validation_error_response(errors)

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM offboarding_checklist_items WHERE item_id = %s", (item_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Offboarding checklist item not found")

        # item_code is never updated here, only name, requirement, order, and status
        cursor.execute(
            "UPDATE offboarding_checklist_items SET item_name = %s, is_required = %s, display_order = %s, "
            "status = %s WHERE item_id = %s",
            (item_name.strip(), is_required, display_order, status, item_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "offboarding_item", item_id)
        connection.commit()

        cursor.execute("SELECT * FROM offboarding_checklist_items WHERE item_id = %s", (item_id,))
        item = cursor.fetchone()

        return success_response("Offboarding checklist item updated successfully", data=item)

    except pymysql.MySQLError as e:
        print(f"Update offboarding item error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@offboarding_bp.route("/offboarding-items/<int:item_id>", methods=["DELETE"])
@require_permission("offboarding.manage")
def archive_offboarding_item(item_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM offboarding_checklist_items WHERE item_id = %s", (item_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Offboarding checklist item not found")

        cursor.execute("UPDATE offboarding_checklist_items SET is_archived = TRUE WHERE item_id = %s", (item_id,))
        log_action(cursor, request.current_admin["admin_id"], "archive", "offboarding_item", item_id)
        connection.commit()

        return success_response("Offboarding checklist item archived successfully")

    except pymysql.MySQLError as e:
        print(f"Archive offboarding item error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@offboarding_bp.route("/offboarding-items/<int:item_id>/restore", methods=["PUT"])
@require_permission("offboarding.manage")
def restore_offboarding_item(item_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM offboarding_checklist_items WHERE item_id = %s", (item_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Offboarding checklist item not found")

        if not existing["is_archived"]:
            return error_response("Offboarding checklist item is not archived", status_code=400)

        cursor.execute("UPDATE offboarding_checklist_items SET is_archived = FALSE WHERE item_id = %s", (item_id,))
        log_action(cursor, request.current_admin["admin_id"], "restore", "offboarding_item", item_id)
        connection.commit()

        cursor.execute("SELECT * FROM offboarding_checklist_items WHERE item_id = %s", (item_id,))
        item = cursor.fetchone()

        return success_response("Offboarding checklist item restored successfully", data=item)

    except pymysql.MySQLError as e:
        print(f"Restore offboarding item error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@offboarding_bp.route("/offboarding-items/<int:item_id>/permanent", methods=["DELETE"])
@require_permission("offboarding.manage")
def permanently_delete_offboarding_item(item_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM offboarding_checklist_items WHERE item_id = %s", (item_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Offboarding checklist item not found")

        if not existing["is_archived"]:
            return error_response("Only archived checklist items can be permanently deleted", status_code=400)

        cursor.execute("DELETE FROM offboarding_checklist_items WHERE item_id = %s", (item_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "offboarding_item", item_id,
            details=existing["item_name"]
        )
        connection.commit()

        return success_response("Offboarding checklist item permanently deleted")

    except pymysql.err.IntegrityError:
        # ON DELETE RESTRICT blocks this if any employee's offboarding still references the item
        return error_response(
            "This checklist item is still used in one or more employees' offboarding and cannot be permanently deleted",
            status_code=409
        )

    except pymysql.MySQLError as e:
        print(f"Permanently delete offboarding item error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Per-employee offboarding
# ---------------------------------------------------------------------

@offboarding_bp.route("/employees/<int:employee_id>/offboarding", methods=["GET"])
@require_permission("offboarding.view")
def get_employee_offboarding(employee_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        employee = get_employee_record(cursor, employee_id)
        if not employee:
            return not_found_response("Employee not found")

        cursor.execute(
            "SELECT * FROM employee_offboarding_tasks WHERE employee_id = %s ORDER BY display_order, task_id",
            (employee_id,)
        )
        tasks = cursor.fetchall()

        for task in tasks:
            if task.get("completed_at"):
                task["completed_at"] = task["completed_at"].strftime("%Y-%m-%d %H:%M:%S")

        required_total = sum(1 for t in tasks if t["is_required"])
        required_completed = sum(1 for t in tasks if t["is_required"] and t["is_completed"])

        cursor.execute(
            "SELECT COUNT(*) AS open_count FROM asset_assignments WHERE employee_id = %s AND returned_date IS NULL",
            (employee_id,)
        )
        open_assets = cursor.fetchone()["open_count"]

        return success_response(data={
            "is_started": len(tasks) > 0,
            "last_working_date": employee["last_working_date"].strftime("%Y-%m-%d")
                if employee["last_working_date"] else None,
            "tasks": tasks,
            "total": len(tasks),
            "completed": sum(1 for t in tasks if t["is_completed"]),
            "required_total": required_total,
            "required_completed": required_completed,
            "open_assets": open_assets,
            "can_complete": len(tasks) > 0 and required_completed == required_total and open_assets == 0,
        })

    except pymysql.MySQLError as e:
        print(f"Get employee offboarding error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@offboarding_bp.route("/employees/<int:employee_id>/offboarding/start", methods=["POST"])
@require_permission("offboarding.manage")
def start_employee_offboarding(employee_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    last_working_date = data.get("last_working_date")
    if not last_working_date or parse_date(last_working_date) is None:
        return validation_error_response(
            {"last_working_date": "A valid last working date (YYYY-MM-DD) is required"}
        )

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        employee = get_employee_record(cursor, employee_id)
        if not employee:
            return not_found_response("Employee not found")

        if employee["is_archived"]:
            return error_response("Cannot start offboarding for an archived employee", status_code=400)

        cursor.execute("SELECT task_id FROM employee_offboarding_tasks WHERE employee_id = %s LIMIT 1", (employee_id,))
        if cursor.fetchone():
            return error_response("Offboarding has already been started for this employee", status_code=409)

        cursor.execute(
            "SELECT item_id, item_name, is_required, display_order FROM offboarding_checklist_items "
            "WHERE is_archived = FALSE AND status = 'Active' ORDER BY display_order, item_id"
        )
        active_items = cursor.fetchall()

        if not active_items:
            return error_response("No active offboarding checklist items are configured", status_code=400)

        cursor.execute(
            "UPDATE employees SET last_working_date = %s WHERE employee_id = %s",
            (last_working_date, employee_id)
        )

        for item in active_items:
            cursor.execute(
                "INSERT INTO employee_offboarding_tasks (employee_id, item_id, item_name, is_required, display_order) "
                "VALUES (%s, %s, %s, %s, %s)",
                (employee_id, item["item_id"], item["item_name"], item["is_required"], item["display_order"])
            )

        log_action(cursor, request.current_admin["admin_id"], "create", "employee_offboarding", employee_id)

        notify_all_admins(
            cursor,
            "offboarding_started",
            "Offboarding started",
            f"Offboarding has been started for {employee['first_name']} {employee['last_name']} "
            f"({employee['employee_code']}), last working date {last_working_date}.",
            link=f"/admin/employees/{employee_id}",
            related_entity_type="employee_offboarding",
            related_entity_id=employee_id,
        )

        connection.commit()

        return created_response(f"Offboarding started with {len(active_items)} task(s)")

    except pymysql.MySQLError as e:
        print(f"Start employee offboarding error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@offboarding_bp.route("/employees/<int:employee_id>/offboarding/tasks/<int:task_id>", methods=["PUT"])
@require_permission("offboarding.manage")
def update_offboarding_task(employee_id, task_id):
    data = request.get_json(silent=True)
    if not data:
        return error_response("Invalid request body", status_code=400)

    is_completed = bool(data.get("is_completed"))

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        employee = get_employee_record(cursor, employee_id)
        if not employee:
            return not_found_response("Employee not found")

        if employee["is_archived"]:
            return error_response(
                "This employee's offboarding has already been completed and is read-only", status_code=400
            )

        cursor.execute(
            "SELECT * FROM employee_offboarding_tasks WHERE task_id = %s AND employee_id = %s",
            (task_id, employee_id)
        )
        task = cursor.fetchone()

        if not task:
            return not_found_response("Offboarding task not found")

        if is_completed:
            cursor.execute(
                "UPDATE employee_offboarding_tasks SET is_completed = TRUE, completed_by_admin_id = %s, "
                "completed_at = NOW() WHERE task_id = %s",
                (request.current_admin["admin_id"], task_id)
            )
        else:
            cursor.execute(
                "UPDATE employee_offboarding_tasks SET is_completed = FALSE, completed_by_admin_id = NULL, "
                "completed_at = NULL WHERE task_id = %s",
                (task_id,)
            )

        log_action(
            cursor, request.current_admin["admin_id"], "update", "employee_offboarding_task", task_id,
            details=f"{task['item_name']} ({'completed' if is_completed else 'reopened'})"
        )
        connection.commit()

        cursor.execute("SELECT * FROM employee_offboarding_tasks WHERE task_id = %s", (task_id,))
        updated_task = cursor.fetchone()
        if updated_task.get("completed_at"):
            updated_task["completed_at"] = updated_task["completed_at"].strftime("%Y-%m-%d %H:%M:%S")

        return success_response("Offboarding task updated successfully", data=updated_task)

    except pymysql.MySQLError as e:
        print(f"Update offboarding task error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@offboarding_bp.route("/employees/<int:employee_id>/offboarding/complete", methods=["PUT"])
@require_permission("offboarding.complete")
def complete_employee_offboarding(employee_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        employee = get_employee_record(cursor, employee_id)
        if not employee:
            return not_found_response("Employee not found")

        if employee["is_archived"]:
            return error_response("This employee has already been offboarded", status_code=400)

        cursor.execute(
            "SELECT is_required, is_completed FROM employee_offboarding_tasks WHERE employee_id = %s",
            (employee_id,)
        )
        tasks = cursor.fetchall()

        if not tasks:
            return error_response("Offboarding has not been started for this employee", status_code=400)

        incomplete_required = [t for t in tasks if t["is_required"] and not t["is_completed"]]
        if incomplete_required:
            return error_response(
                f"{len(incomplete_required)} required offboarding task(s) are still incomplete",
                status_code=400
            )

        # Reuses the existing Asset Management data model directly (no new
        # table/column) - an employee cannot be offboarded while any asset
        # assignment is still open (returned_date IS NULL), regardless of
        # whether the "Return assigned assets" checklist item was ticked.
        cursor.execute(
            "SELECT COUNT(*) AS open_count FROM asset_assignments WHERE employee_id = %s AND returned_date IS NULL",
            (employee_id,)
        )
        open_assets = cursor.fetchone()["open_count"]
        if open_assets:
            return error_response(
                f"This employee still has {open_assets} asset(s) assigned. "
                "Return all assets via Asset Management before completing offboarding.",
                status_code=400
            )

        # Same archive mechanism as employees.delete_employee (is_archived = TRUE,
        # record preserved and hidden from the active list) - status is also set
        # to Inactive here specifically for the offboarding completion flow.
        cursor.execute(
            "UPDATE employees SET status = 'Inactive', is_archived = TRUE WHERE employee_id = %s",
            (employee_id,)
        )
        log_action(
            cursor, request.current_admin["admin_id"], "archive", "employee", employee_id,
            details=f"{employee['first_name']} {employee['last_name']} ({employee['employee_code']}) - offboarding completed"
        )

        notify_all_admins(
            cursor,
            "offboarding_completed",
            "Offboarding completed",
            f"Offboarding has been completed for {employee['first_name']} {employee['last_name']} "
            f"({employee['employee_code']}) and the employee has been archived.",
            link=f"/admin/employees/{employee_id}",
            related_entity_type="employee_offboarding",
            related_entity_id=employee_id,
        )

        connection.commit()

        return success_response("Offboarding completed - employee has been archived")

    except pymysql.MySQLError as e:
        print(f"Complete employee offboarding error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()