"""
Creates the accounts used to log in to the app.

seed_data.sql contains no accounts and no passwords, so run this once after
loading the schema and seed data. Credentials come from environment variables
(or backend/.env, which is never committed), so nothing secret lives in the
repository.

Run it from the backend/ folder, with the DB_* variables pointing at the
database you want to set up:

    python scripts/provision_accounts.py

Each account is handled independently, and only if its variables are set:

    SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_NAME (optional)
        The private Super Admin. Never publish these. Does not need any demo
        variable.

    DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD
        Public Demo Admin. Gets the built-in "Read-only" role (view/export only).

    DEMO_EMPLOYEE_EMAIL, DEMO_EMPLOYEE_PASSWORD
        Public Demo Employee for the employee portal (Morning shift, no manager).

    DEMO_ACCOUNT_EMAILS
        Required whenever a demo account is provisioned: it must list the demo
        emails (comma separated). It is the same setting the backend uses to
        block demo accounts from changing passwords/MFA/profile/uploads and
        from receiving real email, so the script refuses to create a demo
        account that would not be restricted.

The script NEVER modifies an existing account by default: an account whose
email already exists is left untouched and reported as skipped. To deliberately
reset the password of an account this script manages, add an explicit option:

    --reset-super-admin     reset the password of the existing Super Admin
    --reset-demo-accounts   reset the password of the existing demo accounts

Even with a reset option only the password changes, and only for an account
that really is what it claims to be (a Super Admin, the "Demo Admin", the
"Demo Employee" that has the reserved demo phone number). A real person's
account is never converted into a demo or admin account, whatever the variables
say.

Admin and employee emails must be different: on every path that creates or
resets an account (Super Admin, Demo Admin and Demo Employee alike) the script
refuses an email that is already used in the other table (admins vs employees).
"""

import argparse
import os
import re
import sys

# Allow "python scripts/provision_accounts.py" from the backend/ folder.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from werkzeug.security import generate_password_hash

from config import settings
from database.connection import get_db_connection
from utils.code_helper import insert_with_generated_code
from utils.password_helper import validate_password_strength

# Same pattern the application uses to validate email addresses.
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Master data the demo employee is attached to. Department, role and shift are
# found by their codes from seed_data.sql. The grade is found by its NAME, not
# its code: grade codes differ between databases (GRD0002 in seed_data.sql, other
# numbers where grades were created or recreated through the app).
DEMO_EMPLOYEE_DEPARTMENT_CODE = "DEP0002"   # Information Technology
DEMO_EMPLOYEE_ROLE_CODE = "ROL0001"         # Software Developer
DEMO_EMPLOYEE_GRADE_NAME = "B"
DEMO_EMPLOYEE_SHIFT_CODE = "SHF0001"        # Morning

# Fake phone number (the column is NOT NULL and unique). It passes the app's
# own "10 digits" check but starts with 0, which no real mobile number does.
DEMO_EMPLOYEE_PHONE = "0000000001"

DEMO_ADMIN_NAME = "Demo Admin"
DEMO_ADMIN_ROLE = "Read-only"
DEMO_EMPLOYEE_FIRST_NAME = "Demo"
DEMO_EMPLOYEE_LAST_NAME = "Employee"


class Refused(Exception):
    """A configuration or data problem; the account is left exactly as it was."""


# ---------------------------------------------------------------------
# Reading and validating the configuration (before touching the database)
# ---------------------------------------------------------------------

def read_account(label, email_var, password_var, errors):
    """Returns (email, password) if both variables are set, None if neither is."""
    email = os.getenv(email_var, "").strip()
    password = os.getenv(password_var, "")

    if not email and not password:
        return None

    if not email or not password:
        errors.append(f"{label}: set both {email_var} and {password_var} (or neither)")
        return None

    if not EMAIL_PATTERN.match(email) or len(email) > 150:
        errors.append(f"{label}: {email_var} is not a valid email address")

    password_error = validate_password_strength(password)
    if password_error:
        errors.append(f"{label}: {password_error}")

    return email, password


def validate_combination(super_admin, demo_admin, demo_employee, errors):
    """Checks that the accounts do not overlap and that demo accounts will be restricted."""
    demo_emails = [account[0].lower() for account in (demo_admin, demo_employee) if account]

    if len(demo_emails) == 2 and demo_emails[0] == demo_emails[1]:
        errors.append("Demo Admin and Demo Employee must use different email addresses")

    if super_admin:
        super_email = super_admin[0].lower()
        if super_email in demo_emails:
            errors.append("The Super Admin email must not be the same as a demo account email")
        if super_email in settings.DEMO_ACCOUNT_EMAILS:
            errors.append("The Super Admin email must not be listed in DEMO_ACCOUNT_EMAILS")

    for label, account in (("Demo Admin", demo_admin), ("Demo Employee", demo_employee)):
        if account and account[0].lower() not in settings.DEMO_ACCOUNT_EMAILS:
            errors.append(
                f"{label}: {account[0]} must be listed in DEMO_ACCOUNT_EMAILS, otherwise the account "
                f"would not be restricted (set it in backend/.env and on the backend host)"
            )


# ---------------------------------------------------------------------
# Database work: one account at a time, one transaction per account
# ---------------------------------------------------------------------

def find_admin(cursor, email):
    cursor.execute(
        """SELECT a.admin_id, a.name, r.role_name
           FROM admins a JOIN admin_roles r ON a.admin_role_id = r.admin_role_id
           WHERE a.email = %s""",
        (email,)
    )
    return cursor.fetchone()


def find_employee(cursor, email):
    cursor.execute(
        "SELECT employee_id, first_name, last_name, phone FROM employees WHERE email = %s", (email,)
    )
    return cursor.fetchone()


def require_email_not_used_by_employee(cursor, email):
    """Admin emails (Super Admin, Demo Admin) must not also be an employee's email."""
    if find_employee(cursor, email):
        raise Refused(f"{email} already belongs to an employee; admin and employee emails must be different - use a different email")


def require_email_not_used_by_admin(cursor, email):
    """The Demo Employee's email must not also be an admin's email."""
    if find_admin(cursor, email):
        raise Refused(f"{email} already belongs to an admin; admin and employee emails must be different - use a different email")


def find_role_id(cursor, role_name):
    cursor.execute("SELECT admin_role_id FROM admin_roles WHERE role_name = %s", (role_name,))
    role = cursor.fetchone()
    if not role:
        raise Refused(f"Admin role '{role_name}' not found - load seed_data.sql first")
    return role["admin_role_id"]


def find_master_id(cursor, sql, code, what):
    cursor.execute(sql, (code,))
    row = cursor.fetchone()
    if not row:
        raise Refused(f"{what} '{code}' not found - load seed_data.sql first")
    return list(row.values())[0]


def provision_super_admin(cursor, email, password, name, reset):
    existing = find_admin(cursor, email)
    if existing:
        if not reset:
            return "skipped - already exists, nothing changed (use --reset-super-admin to reset its password)"
        if existing["role_name"] != "Super Admin":
            raise Refused(f"{email} exists but is not a Super Admin ({existing['role_name']}); refusing to change it")
        require_email_not_used_by_employee(cursor, email)
        cursor.execute("UPDATE admins SET password = %s WHERE admin_id = %s",
                       (generate_password_hash(password), existing["admin_id"]))
        return "password reset"

    require_email_not_used_by_employee(cursor, email)
    role_id = find_role_id(cursor, "Super Admin")
    cursor.execute(
        "INSERT INTO admins (name, email, password, admin_role_id) VALUES (%s, %s, %s, %s)",
        (name, email, generate_password_hash(password), role_id)
    )
    return "created"


def provision_demo_admin(cursor, email, password, reset):
    existing = find_admin(cursor, email)
    if existing:
        if not reset:
            return "skipped - already exists, nothing changed (use --reset-demo-accounts to reset its password)"
        if existing["name"] != DEMO_ADMIN_NAME or existing["role_name"] != DEMO_ADMIN_ROLE:
            raise Refused(f"{email} exists but is not the demo admin account; refusing to change it")
        require_email_not_used_by_employee(cursor, email)
        cursor.execute("UPDATE admins SET password = %s WHERE admin_id = %s",
                       (generate_password_hash(password), existing["admin_id"]))
        return "password reset"

    # A real employee must never become a "demo" account just by sharing an email.
    require_email_not_used_by_employee(cursor, email)

    role_id = find_role_id(cursor, DEMO_ADMIN_ROLE)
    cursor.execute(
        "INSERT INTO admins (name, email, password, admin_role_id) VALUES (%s, %s, %s, %s)",
        (DEMO_ADMIN_NAME, email, generate_password_hash(password), role_id)
    )
    return f"created ({DEMO_ADMIN_ROLE} role)"


def provision_demo_employee(connection, cursor, email, password, reset):
    existing = find_employee(cursor, email)
    if existing:
        if not reset:
            return "skipped - already exists, nothing changed (use --reset-demo-accounts to reset its password)"
        # The name alone could match a real person; the reserved demo phone number
        # (which no real record has) is what marks the account as the demo employee.
        if (existing["first_name"] != DEMO_EMPLOYEE_FIRST_NAME
                or existing["last_name"] != DEMO_EMPLOYEE_LAST_NAME
                or existing["phone"] != DEMO_EMPLOYEE_PHONE):
            raise Refused(f"{email} exists but is not the demo employee account; refusing to change it")
        require_email_not_used_by_admin(cursor, email)
        cursor.execute("UPDATE employees SET password = %s WHERE employee_id = %s",
                       (generate_password_hash(password), existing["employee_id"]))
        return "password reset"

    require_email_not_used_by_admin(cursor, email)

    cursor.execute("SELECT employee_id FROM employees WHERE phone = %s", (DEMO_EMPLOYEE_PHONE,))
    if cursor.fetchone():
        raise Refused(f"Phone number {DEMO_EMPLOYEE_PHONE} is already used by another employee")

    department_id = find_master_id(cursor, "SELECT department_id FROM departments WHERE department_code = %s",
                                   DEMO_EMPLOYEE_DEPARTMENT_CODE, "Department")
    role_id = find_master_id(cursor, "SELECT role_id FROM roles WHERE role_code = %s",
                             DEMO_EMPLOYEE_ROLE_CODE, "Job role")
    # grade_name is not unique, so use the oldest ACTIVE, non-archived grade with
    # that name: always the same one, and never an archived or inactive grade.
    grade_id = find_master_id(cursor,
                              "SELECT grade_id FROM grades WHERE grade_name = %s "
                              "AND status = 'Active' AND is_archived = FALSE ORDER BY grade_id LIMIT 1",
                              DEMO_EMPLOYEE_GRADE_NAME, "Active grade")
    shift_id = find_master_id(cursor, "SELECT shift_id FROM shifts WHERE shift_code = %s",
                              DEMO_EMPLOYEE_SHIFT_CODE, "Shift")
    password_hash = generate_password_hash(password)

    # Same code format as the app; retried if another employee is being created
    # at the same moment and takes the same code.
    def insert_employee(employee_code):
        cursor.execute(
            """INSERT INTO employees
               (employee_code, first_name, last_name, email, phone, gender, date_of_birth, joining_date,
                department_id, role_id, grade_id, shift_id, reporting_manager_id, password, has_logged_in, status)
               VALUES (%s, %s, %s, %s, %s, 'Other', '1995-01-01', '2024-01-01',
                       %s, %s, %s, %s, NULL, %s, TRUE, 'Active')""",
            (employee_code, DEMO_EMPLOYEE_FIRST_NAME, DEMO_EMPLOYEE_LAST_NAME, email, DEMO_EMPLOYEE_PHONE,
             department_id, role_id, grade_id, shift_id, password_hash)
        )

    insert_with_generated_code(
        connection, cursor, "SELECT MAX(employee_id) AS max_id FROM employees",
        "EMP", "employee_code", insert_employee
    )
    return "created"


def run_one(label, action):
    """Runs one account in its own transaction; returns True if it did not fail."""
    connection = get_db_connection()
    if not connection:
        print(f"{label}: ERROR - could not connect to the database (check the DB_* settings)")
        return False

    cursor = connection.cursor()
    try:
        result = action(connection, cursor)
        connection.commit()
        print(f"{label}: {result}")
        return True
    except Refused as e:
        connection.rollback()
        print(f"{label}: REFUSED - {e}")
        return False
    except Exception as e:
        connection.rollback()
        print(f"{label}: ERROR - nothing was saved: {e}")
        return False
    finally:
        cursor.close()
        connection.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create the Super Admin and optional public demo accounts.")
    parser.add_argument("--reset-super-admin", action="store_true",
                        help="reset the password of the EXISTING Super Admin named by SUPER_ADMIN_EMAIL")
    parser.add_argument("--reset-demo-accounts", action="store_true",
                        help="reset the password of the EXISTING demo accounts")
    args = parser.parse_args(argv)

    errors = []
    super_admin = read_account("Super Admin", "SUPER_ADMIN_EMAIL", "SUPER_ADMIN_PASSWORD", errors)
    demo_admin = read_account("Demo Admin", "DEMO_ADMIN_EMAIL", "DEMO_ADMIN_PASSWORD", errors)
    demo_employee = read_account("Demo Employee", "DEMO_EMPLOYEE_EMAIL", "DEMO_EMPLOYEE_PASSWORD", errors)

    if not (super_admin or demo_admin or demo_employee) and not errors:
        errors.append("Nothing to do: set the SUPER_ADMIN_* and/or DEMO_* variables (see the top of this file)")

    validate_combination(super_admin, demo_admin, demo_employee, errors)

    if args.reset_super_admin and not super_admin:
        errors.append("--reset-super-admin needs SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD")
    if args.reset_demo_accounts and not (demo_admin or demo_employee):
        errors.append("--reset-demo-accounts needs the DEMO_* variables")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        sys.exit(1)

    ok = True
    if super_admin:
        name = os.getenv("SUPER_ADMIN_NAME", "").strip() or "Super Admin"
        ok &= run_one(
            f"Super Admin ({super_admin[0]})",
            lambda connection, cursor: provision_super_admin(
                cursor, super_admin[0], super_admin[1], name, args.reset_super_admin)
        )
    if demo_admin:
        ok &= run_one(
            f"Demo Admin ({demo_admin[0]})",
            lambda connection, cursor: provision_demo_admin(
                cursor, demo_admin[0], demo_admin[1], args.reset_demo_accounts)
        )
    if demo_employee:
        ok &= run_one(
            f"Demo Employee ({demo_employee[0]})",
            lambda connection, cursor: provision_demo_employee(
                connection, cursor, demo_employee[0], demo_employee[1], args.reset_demo_accounts)
        )

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()