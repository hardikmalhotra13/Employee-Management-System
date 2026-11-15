import os
import uuid

import pymysql
from flask import Blueprint, request, send_file
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
from utils.auth_helper import require_permission, require_employee_auth, block_demo_account
from utils.audit_helper import log_action
from utils.notification_helper import notify_all_admins
from utils.storage_helper import save_file, get_file, delete_file

document_bp = Blueprint("document", __name__)


def is_allowed_extension(filename):
    if "." not in filename:
        return False
    extension = filename.rsplit(".", 1)[-1].lower()
    return extension in settings.ALLOWED_DOCUMENT_EXTENSIONS


def get_file_size(file):
    file.stream.seek(0, os.SEEK_END)
    size = file.stream.tell()
    file.stream.seek(0)
    return size


def get_employee_label(cursor, employee_id):
    """Small helper used only to build a readable audit-log snapshot string."""
    cursor.execute(
        "SELECT first_name, last_name, employee_code FROM employees WHERE employee_id = %s",
        (employee_id,)
    )
    employee = cursor.fetchone()
    if not employee:
        return f"Employee #{employee_id}"
    return f"{employee['first_name']} {employee['last_name']} ({employee['employee_code']})"


@document_bp.route("/employees/<int:employee_id>/documents", methods=["GET"])
@require_permission("documents.view")
def get_employee_documents(employee_id):
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
            """SELECT ed.*, a.name AS uploaded_by_name
               FROM employee_documents ed
               LEFT JOIN admins a ON ed.uploaded_by_admin_id = a.admin_id
               WHERE ed.employee_id = %s
               ORDER BY ed.document_id DESC""",
            (employee_id,)
        )
        documents = cursor.fetchall()

        return success_response(data=documents)

    except pymysql.MySQLError as e:
        print(f"Get employee documents error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@document_bp.route("/employees/<int:employee_id>/documents", methods=["POST"])
@require_permission("documents.upload")
def upload_employee_document(employee_id):
    document_name = request.form.get("document_name", "").strip()
    file = request.files.get("file")

    errors = {}
    if not document_name:
        errors["document_name"] = "Document name is required"
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
        cursor.execute("SELECT employee_id FROM employees WHERE employee_id = %s", (employee_id,))
        if not cursor.fetchone():
            return not_found_response("Employee not found")

        stored_filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
        relative_path = f"employee_documents/{employee_id}/{stored_filename}"
        save_file(relative_path, file)
        saved_file_path = relative_path

        cursor.execute(
            "INSERT INTO employee_documents (employee_id, document_name, file_path, uploaded_by_admin_id) "
            "VALUES (%s, %s, %s, %s)",
            (employee_id, document_name, relative_path, request.current_admin["admin_id"])
        )
        new_document_id = cursor.lastrowid

        employee_label = get_employee_label(cursor, employee_id)
        log_action(
            cursor, request.current_admin["admin_id"], "upload", "document", new_document_id,
            details=f"{document_name} \u2014 {employee_label}"
        )

        notify_all_admins(
            cursor,
            "document_uploaded",
            "Document uploaded",
            f"\"{document_name}\" was uploaded for {employee_label}.",
            link=f"/admin/employees/{employee_id}",
            related_entity_type="document",
            related_entity_id=new_document_id,
        )

        connection.commit()

        cursor.execute(
            """SELECT ed.*, a.name AS uploaded_by_name
               FROM employee_documents ed
               LEFT JOIN admins a ON ed.uploaded_by_admin_id = a.admin_id
               WHERE ed.document_id = %s""",
            (new_document_id,)
        )
        document = cursor.fetchone()

        return created_response("Document uploaded successfully", data=document)

    except pymysql.MySQLError as e:
        print(f"Upload employee document error: {e}")
        # The file may already have been written to disk before the
        # database step failed - remove it so it doesn't become orphaned.
        if saved_file_path:
            try:
                delete_file(saved_file_path)
            except OSError as cleanup_error:
                print(f"Could not remove orphaned document file: {cleanup_error}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@document_bp.route("/documents/<int:document_id>/download", methods=["GET"])
@require_permission("documents.view")
def download_employee_document(document_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM employee_documents WHERE document_id = %s", (document_id,))
        document = cursor.fetchone()

        if not document:
            return not_found_response("Document not found")

        stored_file = get_file(document["file_path"])
        if not stored_file:
            return not_found_response("Document file could not be found")
        file_data, content_type = stored_file

        extension = document["file_path"].rsplit(".", 1)[-1]
        download_name = secure_filename(f"{document['document_name']}.{extension}")

        return send_file(file_data, mimetype=content_type, as_attachment=True, download_name=download_name)

    except pymysql.MySQLError as e:
        print(f"Download employee document error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@document_bp.route("/documents/<int:document_id>", methods=["DELETE"])
@require_permission("documents.delete")
def delete_employee_document(document_id):
    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute("SELECT * FROM employee_documents WHERE document_id = %s", (document_id,))
        document = cursor.fetchone()

        if not document:
            return not_found_response("Document not found")

        employee_label = get_employee_label(cursor, document["employee_id"])

        cursor.execute("DELETE FROM employee_documents WHERE document_id = %s", (document_id,))
        log_action(
            cursor, request.current_admin["admin_id"], "delete", "document", document_id,
            details=f"{document['document_name']} \u2014 {employee_label}"
        )
        connection.commit()

        try:
            delete_file(document["file_path"])
        except OSError as e:
            # DB record is already removed; a leftover stored file is not
            # worth failing the request over.
            print(f"Could not remove document file from disk: {e}")

        return success_response("Document deleted successfully")

    except pymysql.MySQLError as e:
        print(f"Delete employee document error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


# ---------------------------------------------------------------------
# Employee self-service - list/download/upload the caller's own
# documents. Written into the same employee_documents table admin uses,
# so an employee's own upload automatically shows up in the existing
# Admin -> Employee Profile -> Documents section with no admin-side
# change needed. uploaded_by_admin_id is left NULL for these rows (it's
# already nullable, ON DELETE SET NULL). NULL is not a reliable signal
# that a document was specifically self-uploaded by the employee - it's
# also the column's natural state for any document whose uploader isn't
# on record (e.g. legacy/pre-existing rows), so nothing here or on the
# frontend should infer "employee self-upload" from NULL alone. These
# are employee actions, not admin activity, so - unlike the admin
# routes above - they are deliberately not written to audit_logs (whose
# admin_id column exists specifically for admin accountability). They
# do reuse notify_all_admins() with the same "document_uploaded" type
# as the admin-upload path, since it's the same real event either way
# (a document being on file for an employee) - no new notification type
# is introduced.
# ---------------------------------------------------------------------

@document_bp.route("/employee/documents", methods=["GET"])
@require_employee_auth
def get_my_documents():
    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """SELECT ed.*, a.name AS uploaded_by_name
               FROM employee_documents ed
               LEFT JOIN admins a ON ed.uploaded_by_admin_id = a.admin_id
               WHERE ed.employee_id = %s
               ORDER BY ed.document_id DESC""",
            (employee_id,)
        )
        documents = cursor.fetchall()

        return success_response(data=documents)

    except pymysql.MySQLError as e:
        print(f"Get my documents error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@document_bp.route("/employee/documents/<int:document_id>/download", methods=["GET"])
@require_employee_auth
def download_my_document(document_id):
    employee_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        # employee_id = employee_id is both the existence check and the
        # authorization check in one, same pattern already used in
        # manager_routes.py's get_team_member - a document that exists
        # but belongs to someone else is treated as not found, not
        # forbidden, so its existence isn't confirmed to the caller.
        cursor.execute(
            "SELECT * FROM employee_documents WHERE document_id = %s AND employee_id = %s",
            (document_id, employee_id)
        )
        document = cursor.fetchone()

        if not document:
            return not_found_response("Document not found")

        stored_file = get_file(document["file_path"])
        if not stored_file:
            return not_found_response("Document file could not be found")
        file_data, content_type = stored_file

        extension = document["file_path"].rsplit(".", 1)[-1]
        download_name = secure_filename(f"{document['document_name']}.{extension}")

        return send_file(file_data, mimetype=content_type, as_attachment=True, download_name=download_name)

    except pymysql.MySQLError as e:
        print(f"Download my document error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@document_bp.route("/manager/team/documents/<int:document_id>/download", methods=["GET"])
@require_employee_auth
def download_team_member_document(document_id):
    """
    Minimum manager-scoped equivalent of download_my_document above, added
    only so a manager can view a direct report's attached training
    certificate (Team Training's View Certificate action) - not a general
    "view any document belonging to my reports" endpoint. Same
    not-found-not-forbidden pattern, same file-serving logic. Two things
    must both be true: the document's owning employee is a direct report
    of the caller, AND the document is actually attached to one of that
    employee's training records via its document_id (not just uploaded
    under the same employee for some unrelated purpose, e.g. in My
    Documents).
    """
    manager_id = request.current_employee["employee_id"]

    connection = get_db_connection()
    if not connection:
        return error_response("Database connection failed", status_code=500)

    cursor = None
    try:
        cursor = connection.cursor()
        cursor.execute(
            """SELECT ed.* FROM employee_documents ed
               JOIN employees e ON ed.employee_id = e.employee_id
               WHERE ed.document_id = %s AND e.reporting_manager_id = %s
                 AND EXISTS (
                     SELECT 1 FROM employee_training_records tr
                     WHERE tr.document_id = ed.document_id AND tr.employee_id = ed.employee_id
                 )""",
            (document_id, manager_id)
        )
        document = cursor.fetchone()

        if not document:
            return not_found_response("Document not found")

        stored_file = get_file(document["file_path"])
        if not stored_file:
            return not_found_response("Document file could not be found")
        file_data, content_type = stored_file

        extension = document["file_path"].rsplit(".", 1)[-1]
        download_name = secure_filename(f"{document['document_name']}.{extension}")

        return send_file(file_data, mimetype=content_type, as_attachment=True, download_name=download_name)

    except pymysql.MySQLError as e:
        print(f"Download team member document error: {e}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()


@document_bp.route("/employee/documents", methods=["POST"])
@require_employee_auth
@block_demo_account
def upload_my_document():
    employee_id = request.current_employee["employee_id"]
    document_name = request.form.get("document_name", "").strip()
    file = request.files.get("file")

    errors = {}
    if not document_name:
        errors["document_name"] = "Document name is required"
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

        stored_filename = f"{uuid.uuid4().hex}_{secure_filename(file.filename)}"
        relative_path = f"employee_documents/{employee_id}/{stored_filename}"
        save_file(relative_path, file)
        saved_file_path = relative_path

        cursor.execute(
            "INSERT INTO employee_documents (employee_id, document_name, file_path, uploaded_by_admin_id) "
            "VALUES (%s, %s, %s, %s)",
            (employee_id, document_name, relative_path, None)
        )
        new_document_id = cursor.lastrowid

        employee_label = get_employee_label(cursor, employee_id)
        notify_all_admins(
            cursor,
            "document_uploaded",
            "Document uploaded",
            f"\"{document_name}\" was uploaded by {employee_label}.",
            link=f"/admin/employees/{employee_id}",
            related_entity_type="document",
            related_entity_id=new_document_id,
        )

        connection.commit()

        cursor.execute(
            """SELECT ed.*, a.name AS uploaded_by_name
               FROM employee_documents ed
               LEFT JOIN admins a ON ed.uploaded_by_admin_id = a.admin_id
               WHERE ed.document_id = %s""",
            (new_document_id,)
        )
        document = cursor.fetchone()

        return created_response("Document uploaded successfully", data=document)

    except pymysql.MySQLError as e:
        print(f"Upload my document error: {e}")
        if saved_file_path:
            try:
                delete_file(saved_file_path)
            except OSError as cleanup_error:
                print(f"Could not remove orphaned document file: {cleanup_error}")
        return error_response("Something went wrong, please try again", status_code=500)

    finally:
        if cursor:
            cursor.close()
        connection.close()