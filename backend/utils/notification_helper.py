def create_notification(
    cursor,
    recipient_employee_id,
    type,
    title,
    message,
    link=None,
    related_entity_type=None,
    related_entity_id=None,
    recipient_admin_id=None,
):
    """
    Writes one row to the shared employee_notifications feed. Exactly one
    of recipient_employee_id / recipient_admin_id must be provided - this
    is enforced here (application layer) rather than as a DB constraint,
    matching this codebase's existing preference for that kind of rule
    (see the table comment in schema.sql). Existing call sites are
    unaffected: recipient_admin_id is new and keyword-only, defaulting to
    None, so every pre-existing positional call (recipient_employee_id
    set, recipient_admin_id omitted) behaves exactly as before.
    """
    if (recipient_employee_id is None) == (recipient_admin_id is None):
        raise ValueError(
            "create_notification requires exactly one of recipient_employee_id or recipient_admin_id"
        )

    cursor.execute(
        "INSERT INTO employee_notifications "
        "(recipient_employee_id, recipient_admin_id, type, title, message, link, "
        "related_entity_type, related_entity_id) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            recipient_employee_id, recipient_admin_id, type, title, message,
            link, related_entity_type, related_entity_id
        )
    )


def notify_all_admins(cursor, type, title, message, link=None, related_entity_type=None, related_entity_id=None):
    """
    Broadcasts one notification row to every admin account. "All admins"
    means literally every row currently in admins - no permission-based
    targeting, and the admin who performed the triggering action (if any)
    is included, not excluded. Callers follow the same pre-commit,
    same-transaction convention as create_notification() elsewhere in
    this codebase.
    """
    cursor.execute("SELECT admin_id FROM admins")
    admin_ids = [row["admin_id"] for row in cursor.fetchall()]

    for admin_id in admin_ids:
        create_notification(
            cursor,
            None,
            type,
            title,
            message,
            link=link,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
            recipient_admin_id=admin_id,
        )


def notify_all_employees(cursor, type, title, message, link=None, related_entity_type=None, related_entity_id=None):
    """
    Broadcasts one notification row to every employee who can currently use
    the system: not archived and not Inactive (the same eligibility the
    employee login and roster assignment already apply). Each employee gets
    exactly one row per call. Callers follow the same pre-commit,
    same-transaction convention as create_notification() elsewhere in this
    codebase, so the notifications commit or roll back with the change they
    describe.
    """
    cursor.execute("SELECT employee_id FROM employees WHERE is_archived = FALSE AND status != 'Inactive'")
    employee_ids = [row["employee_id"] for row in cursor.fetchall()]

    for employee_id in employee_ids:
        create_notification(
            cursor,
            employee_id,
            type,
            title,
            message,
            link=link,
            related_entity_type=related_entity_type,
            related_entity_id=related_entity_id,
        )