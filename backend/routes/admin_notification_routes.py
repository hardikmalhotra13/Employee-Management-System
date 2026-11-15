import pymysql
from flask import Blueprint, request

from database.connection import get_db_connection
from utils.response_helpers import success_response, error_response, not_found_response, validation_error_response
from utils.auth_helper import require_auth

admin_notification_bp = Blueprint("admin_notification", __name__)

DEFAULT_PAGE_SIZE = 10
MAX_PAGE_SIZE = 100


@admin_notification_bp.route("/admin/notifications", methods=["GET"])
@require_auth
def get_my_admin_notifications():
    """
    Paginated list of the logged-in admin's notifications (broadcast rows
    with recipient_admin_id = this admin), newest first. Unlike the
    employee notification list (a flat top-50, no paging), this endpoint
    takes page/pageSize - same query-param names and bounds as the
    existing paginated list endpoints (e.g. department_routes.py).
    """
    admin_id = request.current_admin["admin_id"]

    page = request.args.get("page", 1, type=int)
    page_size = request.args.get("pageSize", DEFAULT_PAGE_SIZE, type=int)

    errors = {}
    if page < 1:
        errors["page"] = "page must be greater than or equal to 1"
    if page_size < 1:
        errors["pageSize"] = "pageSize must be greater than or equal to 1"
    if page_size > MAX_PAGE_SIZE:
        errors["pageSize"] = f"pageSize cannot be greater than {MAX_PAGE_SIZE}"

    if errors:
        return validation_error_response(errors)

    offset = (page - 1) * page_size

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()

        cursor.execute(
            "SELECT COUNT(*) AS total FROM employee_notifications WHERE recipient_admin_id = %s",
            (admin_id,)
        )
        total = cursor.fetchone()["total"]

        cursor.execute(
            """SELECT notification_id, type, title, message, link, related_entity_type, related_entity_id,
                      is_read, created_at
               FROM employee_notifications
               WHERE recipient_admin_id = %s
               ORDER BY created_at DESC, notification_id DESC
               LIMIT %s OFFSET %s""",
            (admin_id, page_size, offset)
        )
        notifications = cursor.fetchall()

        for n in notifications:
            n["created_at"] = n["created_at"].strftime("%Y-%m-%d %H:%M:%S")

        return success_response(data={
            "records": notifications,
            "total": total,
            "page": page,
            "pageSize": page_size
        })

    except pymysql.MySQLError as e:
        print(f"Get admin notifications error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@admin_notification_bp.route("/admin/notifications/unread-count", methods=["GET"])
@require_auth
def get_my_admin_unread_notification_count():
    admin_id = request.current_admin["admin_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS count FROM employee_notifications "
            "WHERE recipient_admin_id = %s AND is_read = FALSE",
            (admin_id,)
        )
        count = cursor.fetchone()["count"]

        return success_response(data={"count": count})

    except pymysql.MySQLError as e:
        print(f"Get admin unread notification count error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@admin_notification_bp.route("/admin/notifications/<int:notification_id>/read", methods=["PUT"])
@require_auth
def mark_admin_notification_read(notification_id):
    admin_id = request.current_admin["admin_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT notification_id FROM employee_notifications "
            "WHERE notification_id = %s AND recipient_admin_id = %s",
            (notification_id, admin_id)
        )
        if not cursor.fetchone():
            return not_found_response("Notification not found")

        cursor.execute(
            "UPDATE employee_notifications SET is_read = TRUE WHERE notification_id = %s",
            (notification_id,)
        )
        connection.commit()

        return success_response("Notification marked as read")

    except pymysql.MySQLError as e:
        print(f"Mark admin notification read error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@admin_notification_bp.route("/admin/notifications/mark-all-read", methods=["PUT"])
@require_auth
def mark_all_admin_notifications_read():
    admin_id = request.current_admin["admin_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "UPDATE employee_notifications SET is_read = TRUE "
            "WHERE recipient_admin_id = %s AND is_read = FALSE",
            (admin_id,)
        )
        connection.commit()

        return success_response("All notifications marked as read")

    except pymysql.MySQLError as e:
        print(f"Mark all admin notifications read error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()