import pymysql
from flask import Blueprint, request

from database.connection import get_db_connection
from utils.response_helpers import success_response, error_response, not_found_response
from utils.auth_helper import require_employee_auth

employee_notification_bp = Blueprint("employee_notification", __name__)

NOTIFICATION_LIST_LIMIT = 50


@employee_notification_bp.route("/employee/notifications", methods=["GET"])
@require_employee_auth
def get_my_notifications():
    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """SELECT notification_id, type, title, message, link, related_entity_type, related_entity_id,
                      is_read, created_at
               FROM employee_notifications
               WHERE recipient_employee_id = %s
               ORDER BY created_at DESC
               LIMIT %s""",
            (employee_id, NOTIFICATION_LIST_LIMIT)
        )
        notifications = cursor.fetchall()

        for n in notifications:
            n["created_at"] = n["created_at"].strftime("%Y-%m-%d %H:%M:%S")

        return success_response(data=notifications)

    except pymysql.MySQLError as e:
        print(f"Get my notifications error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_notification_bp.route("/employee/notifications/unread-count", methods=["GET"])
@require_employee_auth
def get_my_unread_notification_count():
    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS count FROM employee_notifications "
            "WHERE recipient_employee_id = %s AND is_read = FALSE",
            (employee_id,)
        )
        count = cursor.fetchone()["count"]

        return success_response(data={"count": count})

    except pymysql.MySQLError as e:
        print(f"Get unread notification count error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_notification_bp.route("/employee/notifications/<int:notification_id>/read", methods=["PUT"])
@require_employee_auth
def mark_notification_read(notification_id):
    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "SELECT notification_id FROM employee_notifications "
            "WHERE notification_id = %s AND recipient_employee_id = %s",
            (notification_id, employee_id)
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
        print(f"Mark notification read error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@employee_notification_bp.route("/employee/notifications/mark-all-read", methods=["PUT"])
@require_employee_auth
def mark_all_notifications_read():
    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            "UPDATE employee_notifications SET is_read = TRUE "
            "WHERE recipient_employee_id = %s AND is_read = FALSE",
            (employee_id,)
        )
        connection.commit()

        return success_response("All notifications marked as read")

    except pymysql.MySQLError as e:
        print(f"Mark all notifications read error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()