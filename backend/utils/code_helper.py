"""
Sequential, system-generated record codes (EMP0001, TRN0001 ...).

The next code is derived from the highest existing id, so two requests creating
a record at the same moment can pick the same code. The column has a UNIQUE
constraint, so the second INSERT fails instead of creating a duplicate; this
helper then simply tries again with a fresh code.
"""

import pymysql

MAX_ATTEMPTS = 5


def insert_with_generated_code(connection, cursor, max_id_sql, prefix, unique_key_name, insert_fn):
    """
    Calls insert_fn(code) with the next code ("<prefix><max id + 1, 4 digits>")
    and returns whatever it returns (normally the new row's id).

    max_id_sql must select one column named max_id. unique_key_name is the
    name of the UNIQUE code column (for example "employee_code"); only a
    duplicate on that column is retried, any other IntegrityError (duplicate
    email, phone...) is raised unchanged for the caller to report.

    Call it before the transaction has written anything: a retry rolls the
    transaction back so that the next attempt reads the newly committed rows.
    """
    for attempt in range(1, MAX_ATTEMPTS + 1):
        cursor.execute(max_id_sql)
        max_id = cursor.fetchone()["max_id"] or 0
        code = f"{prefix}{max_id + 1:04d}"

        try:
            return insert_fn(code)
        except pymysql.err.IntegrityError as e:
            if unique_key_name not in str(e).lower() or attempt == MAX_ATTEMPTS:
                raise
            connection.rollback()