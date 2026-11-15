

def log_action(cursor, admin_id, action, entity, record_id, details=None):
    cursor.execute(
        "INSERT INTO audit_logs (admin_id, action, entity, record_id, details) VALUES (%s, %s, %s, %s, %s)",
        (admin_id, action, entity, record_id, details)
    )