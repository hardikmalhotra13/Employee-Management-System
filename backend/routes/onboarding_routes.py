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

onboarding_bp = Blueprint("onboarding", __name__)

VALID_STATUSES = ("Active", "Inactive")


def get_employee_record(cursor, employee_id):
    cursor.execute(
        "SELECT employee_id, first_name, last_name, employee_code, is_archived, status, onboarding_completed_at "
        "FROM employees WHERE employee_id = %s",
        (employee_id,)
    )
    return cursor.fetchone()


# ---------------------------------------------------------------------
# onboarding_checklist_items (catalog) - mirrors asset_types.py, with
# is_required/display_order added and ordered by display_order rather
# than newest-first, since display_order exists specifically to control
# the order items are shown/snapshotted in.
# ---------------------------------------------------------------------

@onboarding_bp.route("/onboarding-items", methods=["GET"])
@require_permission("onboarding.view")
def get_onboarding_items():
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
        cursor.execute(f"SELECT COUNT(*) AS total FROM onboarding_checklist_items {where_clause}")
        total = cursor.fetchone()["total"]

        cursor.execute(
            f"SELECT * FROM onboarding_checklist_items {where_clause} "
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
        print(f"Get onboarding items error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@onboarding_bp.route("/onboarding-items", methods=["POST"])
@require_permission("onboarding.manage")
def create_onboarding_item():
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
            cursor.execute("SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM onboarding_checklist_items")
            display_order = cursor.fetchone()["next_order"]

        # item_code is system-generated and never accepted from the client
        cursor.execute("SELECT MAX(item_id) AS max_id FROM onboarding_checklist_items")
        max_id = cursor.fetchone()["max_id"] or 0
        item_code = f"ONB{max_id + 1:04d}"

        cursor.execute(
            "INSERT INTO onboarding_checklist_items (item_code, item_name, is_required, display_order, status) "
            "VALUES (%s, %s, %s, %s, %s)",
            (item_code, item_name.strip(), is_required, display_order, status)
        )
        new_item_id = cursor.lastrowid
        log_action(
            cursor, request.current_admin["admin_id"], "create", "onboarding_item", new_item_id,
            details=item_name.strip()
        )
        connection.commit()

        cursor.execute("SELECT * FROM onboarding_checklist_items WHERE item_id = %s", (new_item_id,))
        item = cursor.fetchone()

        return created_response("Onboarding checklist item created successfully", data=item)

    except pymysql.MySQLError as e:
        print(f"Create onboarding item error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@onboarding_bp.route("/onboarding-items/<int:item_id>", methods=["PUT"])
@require_permission("onboarding.manage")
def update_onboarding_item(item_id):
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
        cursor.execute("SELECT * FROM onboarding_checklist_items WHERE item_id = %s", (item_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Onboarding checklist item not found")

        # item_code is never updated here, only name, requirement, order, and status
        cursor.execute(
            "UPDATE onboarding_checklist_items SET item_name = %s, is_required = %s, display_order = %s, "
            "status = %s WHERE item_id = %s",
            (item_name.strip(), is_required, display_order, status, item_id)
        )
        log_action(cursor, request.current_admin["admin_id"], "update", "onboarding_item", item_id)
        connection.commit()

        cursor.execute("SELECT * FROM onboarding_checklist_items WHERE item_id = %s", (item_id,))
        item = cursor.fetchone()

        return success_response("Onboarding checklist item updated successfully", data=item)

    except pymysql.MySQLError as e:
        print(f"Update onboarding item error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@onboarding_bp.route("/onboarding-items/<int:item_id>", methods=["DELETE"])
@require_permission("onboarding.manage")
def archive_onboarding_item(item_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM onboarding_checklist_items WHERE item_id = %s", (item_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Onboarding checklist item not found")

        cursor.execute("UPDATE onboarding_checklist_items SET is_archived = TRUE WHERE item_id = %s", (item_id,))
        log_action(cursor, request.current_admin["admin_id"], "archive", "onboarding_item", item_id)
        connection.commit()

        return success_response("Onboarding checklist item archived successfully")

    except pymysql.MySQLError as e:
        print(f"Archive onboarding item error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@onboarding_bp.route("/onboarding-items/<int:item_id>/restore", methods=["PUT"])
@require_permission("onboarding.manage")
def restore_onboarding_item(item_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM onboarding_checklist_items WHERE item_id = %s", (item_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Onboarding checklist item not found")

        if not existing["is_archived"]:
            return error_response("Onboarding checklist item is not archived", status_code=400)

        cursor.execute("UPDATE onboarding_checklist_items SET is_archived = FALSE WHERE item_id = %s", (item_id,))
        log_action(cursor, request.current_admin["admin_id"], "restore", "onboarding_item", item_id)
        connection.commit()

        cursor.execute("SELECT * FROM onboarding_checklist_items WHERE item_id = %s", (item_id,))
        item = cursor.fetchone()

        return success_response("Onboarding checklist item restored successfully", data=item)

    except pymysql.MySQLError as e:
        print(f"Restore onboarding item error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@onboarding_bp.route("/onboarding-items/<int:item_id>/permanent", methods=["DELETE"])
@require_permission("onboarding.manage")
def permanently_delete_onboarding_item(item_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM onboarding_checklist_items WHERE item_id = %s", (item_id,))
        existing = cursor.fetchone()

        if not existing:
            return not_found_response("Onboarding checklist item not found")

        if not existing["is_archived"]:
            return error_response("Only archived checklist items can be permanently deleted", status_code=400)

        cursor.execute("DELETE FROM onboarding_checklist_items WHERE item_id = %s", (item_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "onboarding_item", item_id,
            details=existing["item_name"]
        )
        connection.commit()

        return success_response("Onboarding checklist item permanently deleted")

    except pymysql.err.IntegrityError:
        # ON DELETE RESTRICT blocks this if any employee's onboarding still references the item
        return error_response(
            "This checklist item is still used in one or more employees' onboarding and cannot be permanently deleted",
            status_code=409
        )

    except pymysql.MySQLError as e:
        print(f"Permanently delete onboarding item error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Per-employee onboarding
# ---------------------------------------------------------------------

@onboarding_bp.route("/employees/<int:employee_id>/onboarding", methods=["GET"])
@require_permission("onboarding.view")
def get_employee_onboarding(employee_id):
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
            "SELECT * FROM employee_onboarding_tasks WHERE employee_id = %s ORDER BY display_order, task_id",
            (employee_id,)
        )
        tasks = cursor.fetchall()

        for task in tasks:
            if task.get("completed_at"):
                task["completed_at"] = task["completed_at"].strftime("%Y-%m-%d %H:%M:%S")

        required_total = sum(1 for t in tasks if t["is_required"])
        required_completed = sum(1 for t in tasks if t["is_required"] and t["is_completed"])
        is_completed = bool(employee["onboarding_completed_at"])

        if not tasks:
            state = "Not Started"
        elif is_completed:
            state = "Completed"
        else:
            state = "In Progress"

        completed_at = employee["onboarding_completed_at"]
        if completed_at:
            completed_at = completed_at.strftime("%Y-%m-%d %H:%M:%S")

        return success_response(data={
            "is_started": len(tasks) > 0,
            "state": state,
            "is_completed": is_completed,
            "completed_at": completed_at,
            "tasks": tasks,
            "total": len(tasks),
            "completed": sum(1 for t in tasks if t["is_completed"]),
            "required_total": required_total,
            "required_completed": required_completed,
            "can_complete": len(tasks) > 0 and required_completed == required_total and not is_completed,
        })

    except pymysql.MySQLError as e:
        print(f"Get employee onboarding error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@onboarding_bp.route("/employees/<int:employee_id>/onboarding/start", methods=["POST"])
@require_permission("onboarding.manage")
def start_employee_onboarding(employee_id):
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
            return error_response("Cannot start onboarding for an archived employee", status_code=400)

        cursor.execute("SELECT task_id FROM employee_onboarding_tasks WHERE employee_id = %s LIMIT 1", (employee_id,))
        has_existing_tasks = cursor.fetchone() is not None

        if has_existing_tasks and not employee["onboarding_completed_at"]:
            return error_response("Onboarding has already been started for this employee", status_code=409)

        cursor.execute(
            "SELECT item_id, item_name, is_required, display_order FROM onboarding_checklist_items "
            "WHERE is_archived = FALSE AND status = 'Active' ORDER BY display_order, item_id"
        )
        active_items = cursor.fetchall()

        if not active_items:
            return error_response("No active onboarding checklist items are configured", status_code=400)

        if has_existing_tasks:
            # A prior cycle exists but was completed - clear its tasks so
            # the checklist reflects only the new cycle being started.
            cursor.execute("DELETE FROM employee_onboarding_tasks WHERE employee_id = %s", (employee_id,))

        for item in active_items:
            cursor.execute(
                "INSERT INTO employee_onboarding_tasks (employee_id, item_id, item_name, is_required, display_order) "
                "VALUES (%s, %s, %s, %s, %s)",
                (employee_id, item["item_id"], item["item_name"], item["is_required"], item["display_order"])
            )

        cursor.execute(
            "UPDATE employees SET onboarding_completed_at = NULL WHERE employee_id = %s", (employee_id,)
        )

        log_action(cursor, request.current_admin["admin_id"], "create", "employee_onboarding", employee_id)

        notify_all_admins(
            cursor,
            "onboarding_started",
            "Onboarding started",
            f"Onboarding has been started for {employee['first_name']} {employee['last_name']} "
            f"({employee['employee_code']}) with {len(active_items)} task(s).",
            link=f"/admin/employees/{employee_id}",
            related_entity_type="employee_onboarding",
            related_entity_id=employee_id,
        )

        connection.commit()

        return created_response(f"Onboarding started with {len(active_items)} task(s)")

    except pymysql.MySQLError as e:
        print(f"Start employee onboarding error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@onboarding_bp.route("/employees/<int:employee_id>/onboarding/tasks/<int:task_id>", methods=["PUT"])
@require_permission("onboarding.manage")
def update_onboarding_task(employee_id, task_id):
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

        if employee["onboarding_completed_at"]:
            return error_response(
                "This employee's onboarding has already been completed and is read-only", status_code=400
            )

        cursor.execute(
            "SELECT * FROM employee_onboarding_tasks WHERE task_id = %s AND employee_id = %s",
            (task_id, employee_id)
        )
        task = cursor.fetchone()

        if not task:
            return not_found_response("Onboarding task not found")

        if is_completed:
            cursor.execute(
                "UPDATE employee_onboarding_tasks SET is_completed = TRUE, completed_by_admin_id = %s, "
                "completed_at = NOW() WHERE task_id = %s",
                (request.current_admin["admin_id"], task_id)
            )
        else:
            cursor.execute(
                "UPDATE employee_onboarding_tasks SET is_completed = FALSE, completed_by_admin_id = NULL, "
                "completed_at = NULL WHERE task_id = %s",
                (task_id,)
            )

        log_action(
            cursor, request.current_admin["admin_id"], "update", "employee_onboarding_task", task_id,
            details=f"{task['item_name']} ({'completed' if is_completed else 'reopened'})"
        )
        connection.commit()

        cursor.execute("SELECT * FROM employee_onboarding_tasks WHERE task_id = %s", (task_id,))
        updated_task = cursor.fetchone()
        if updated_task.get("completed_at"):
            updated_task["completed_at"] = updated_task["completed_at"].strftime("%Y-%m-%d %H:%M:%S")

        return success_response("Onboarding task updated successfully", data=updated_task)

    except pymysql.MySQLError as e:
        print(f"Update onboarding task error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@onboarding_bp.route("/employees/<int:employee_id>/onboarding/complete", methods=["PUT"])
@require_permission("onboarding.manage")
def complete_employee_onboarding(employee_id):
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
            return error_response("Cannot complete onboarding for an archived employee", status_code=400)

        cursor.execute(
            "SELECT is_required, is_completed FROM employee_onboarding_tasks WHERE employee_id = %s",
            (employee_id,)
        )
        tasks = cursor.fetchall()

        if not tasks:
            return error_response("Onboarding has not been started for this employee", status_code=400)

        if employee["onboarding_completed_at"]:
            return error_response("Onboarding has already been completed for this employee", status_code=409)

        incomplete_required = [t for t in tasks if t["is_required"] and not t["is_completed"]]
        if incomplete_required:
            return error_response(
                f"{len(incomplete_required)} required onboarding task(s) are still incomplete",
                status_code=400
            )

        cursor.execute(
            "UPDATE employees SET onboarding_completed_at = NOW() WHERE employee_id = %s", (employee_id,)
        )

        # On Probation is the only status this transitions - Active is left
        # unchanged, and any other status (On Notice, Inactive) is left
        # unchanged since onboarding completion doesn't override it.
        if employee["status"] == "On Probation":
            cursor.execute("UPDATE employees SET status = 'Active' WHERE employee_id = %s", (employee_id,))

        log_action(cursor, request.current_admin["admin_id"], "update", "employee_onboarding", employee_id)

        notify_all_admins(
            cursor,
            "onboarding_completed",
            "Onboarding completed",
            f"Onboarding has been completed for {employee['first_name']} {employee['last_name']} "
            f"({employee['employee_code']}).",
            link=f"/admin/employees/{employee_id}",
            related_entity_type="employee_onboarding",
            related_entity_id=employee_id,
        )

        connection.commit()

        return success_response("Onboarding completed successfully")

    except pymysql.MySQLError as e:
        print(f"Complete employee onboarding error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()