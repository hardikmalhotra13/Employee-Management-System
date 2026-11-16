-- Employee Management System (EMS) - Version 1.0
-- Database schema generated from the approved Software Design Specification

USE employee_ms;

-- ------------------------------------------------------
-- admin_roles
-- System access roles for admin accounts (not to be confused with the
-- employee "roles" master table, which stores job designations).
-- is_system marks the 3 built-in roles, which cannot be renamed or
-- deleted through the RBAC management UI.
-- ------------------------------------------------------
CREATE TABLE admin_roles (
    admin_role_id INT AUTO_INCREMENT PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- admin_permissions
-- Catalog of fine-grained, per-action capability keys (e.g. "employees.create").
-- module groups related keys together for the RBAC management UI.
-- ------------------------------------------------------
CREATE TABLE admin_permissions (
    permission_id INT AUTO_INCREMENT PRIMARY KEY,
    permission_key VARCHAR(100) NOT NULL UNIQUE,
    module VARCHAR(50) NOT NULL,
    description VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- admin_role_permissions
-- Which permissions each admin role currently grants.
-- ------------------------------------------------------
CREATE TABLE admin_role_permissions (
    admin_role_id INT NOT NULL,
    permission_id INT NOT NULL,
    PRIMARY KEY (admin_role_id, permission_id),

    CONSTRAINT fk_arp_role FOREIGN KEY (admin_role_id)
        REFERENCES admin_roles(admin_role_id) ON DELETE CASCADE,
    CONSTRAINT fk_arp_permission FOREIGN KEY (permission_id)
        REFERENCES admin_permissions(permission_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- admins
-- Stores the single Admin account used to log in to the system.
-- ------------------------------------------------------
CREATE TABLE admins (
    admin_id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(255) NULL,               -- stores hashed password only; NULL until an invited user sets one
    phone VARCHAR(15) NULL,
    profile_photo VARCHAR(255) NULL,          -- stores file path, not the image itself
    admin_role_id INT NOT NULL,
    has_logged_in BOOLEAN NOT NULL DEFAULT FALSE,
    google_sub VARCHAR(255) NULL UNIQUE,      -- stable Google OIDC subject id; NULL until explicitly linked
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret VARCHAR(255) NULL,             -- encrypted (reversible), not hashed - TOTP verification needs it back
    mfa_enrolled_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_admins_admin_role FOREIGN KEY (admin_role_id)
        REFERENCES admin_roles(admin_role_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- admin_mfa_recovery_codes
-- Exactly 4 single-use codes issued whenever an admin (re-)enrolls MFA,
-- or via the one-time backfill flow for admins who were already
-- mfa_enabled before this table existed. Only the hash is stored
-- (same one-way approach as invite/reset tokens - hash_token in
-- token_helper.py); the plaintext is shown to the admin exactly once
-- at generation time and never retrievable again. is_used is flipped
-- via an atomic "UPDATE ... WHERE is_used = FALSE" (checking rowcount)
-- rather than a separate check-then-update, so two concurrent attempts
-- to use the same code can never both succeed.
-- ------------------------------------------------------
CREATE TABLE admin_mfa_recovery_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NOT NULL,
    code_hash VARCHAR(64) NOT NULL,            -- SHA-256 hex digest, via hash_token()
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_admin_mfa_recovery_codes_admin FOREIGN KEY (admin_id)
        REFERENCES admins(admin_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- departments
-- Master table for department records used by employees.
-- ------------------------------------------------------
CREATE TABLE departments (
    department_id INT AUTO_INCREMENT PRIMARY KEY,
    department_code VARCHAR(10) NOT NULL UNIQUE,   -- auto-generated, e.g. DEP0001
    department_name VARCHAR(100) NOT NULL,
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    department_head_id INT NULL,                   -- FK added below, once employees is defined
    parent_department_id INT NULL,                 -- parent department in the org's department hierarchy; NULL for top-level departments
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_departments_parent FOREIGN KEY (parent_department_id)
        REFERENCES departments(department_id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- roles
-- Master table for employee job designations (not system access roles).
-- ------------------------------------------------------
CREATE TABLE roles (
    role_id INT AUTO_INCREMENT PRIMARY KEY,
    role_code VARCHAR(10) NOT NULL UNIQUE,         -- auto-generated, e.g. ROL0001
    role_name VARCHAR(100) NOT NULL,
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- grades
-- Master table for employee grades (A is highest, D is lowest).
-- ------------------------------------------------------
CREATE TABLE grades (
    grade_id INT AUTO_INCREMENT PRIMARY KEY,
    grade_code VARCHAR(10) NOT NULL UNIQUE,        -- auto-generated, e.g. GRD0001
    grade_name ENUM('A', 'B', 'C', 'D') NOT NULL,
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- shifts
-- Master table for work shifts. end_time can be earlier than
-- start_time for shifts that cross midnight (e.g. Evening shift).
-- ------------------------------------------------------
CREATE TABLE shifts (
    shift_id INT AUTO_INCREMENT PRIMARY KEY,
    shift_code VARCHAR(10) NOT NULL UNIQUE,        -- auto-generated, e.g. SHF0001
    shift_name VARCHAR(50) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- employees
-- Main employee records. Linked to departments, roles, grades and shifts.
-- A master record cannot be deleted while an employee still references it
-- (ON DELETE RESTRICT). Updates to a master record's key cascade down
-- (ON UPDATE CASCADE).
-- ------------------------------------------------------
CREATE TABLE employees (
    employee_id INT AUTO_INCREMENT PRIMARY KEY,
    employee_code VARCHAR(10) NOT NULL UNIQUE,     -- auto-generated, e.g. EMP0001
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    profile_photo VARCHAR(255) NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    phone VARCHAR(15) NOT NULL UNIQUE,
    address VARCHAR(255) NULL,
    gender ENUM('Male', 'Female', 'Other') NOT NULL,
    date_of_birth DATE NOT NULL,
    joining_date DATE NOT NULL,
    department_id INT NOT NULL,
    role_id INT NOT NULL,
    grade_id INT NOT NULL,
    shift_id INT NOT NULL,
    reporting_manager_id INT NULL,                 -- another employee this one reports to; NULL for top-of-org employees
    password VARCHAR(255) NULL,                    -- self-service login password hash; NULL until the employee sets one
    has_logged_in BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,    -- employee's own choice (Settings -> Security); never forced
    mfa_secret VARCHAR(255) NULL,                  -- encrypted (reversible), not hashed - TOTP verification needs it back
    mfa_enrolled_at DATETIME NULL,
    google_sub VARCHAR(255) NULL UNIQUE,           -- stable Google OIDC subject id; NULL until the employee explicitly links it (Settings -> Security), same as admins.google_sub
    last_working_date DATE NULL,                   -- set when offboarding starts for this employee
    onboarding_completed_at DATETIME NULL,          -- set when the current onboarding cycle is marked complete; cleared on (re-)start
    status ENUM('Active', 'On Probation', 'On Notice', 'Inactive') NOT NULL DEFAULT 'Active',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_employees_department FOREIGN KEY (department_id)
        REFERENCES departments(department_id) ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_employees_role FOREIGN KEY (role_id)
        REFERENCES roles(role_id) ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_employees_grade FOREIGN KEY (grade_id)
        REFERENCES grades(grade_id) ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_employees_shift FOREIGN KEY (shift_id)
        REFERENCES shifts(shift_id) ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT fk_employees_reporting_manager FOREIGN KEY (reporting_manager_id)
        REFERENCES employees(employee_id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- employee_mfa_recovery_codes
-- Employee-portal counterpart of admin_mfa_recovery_codes (kept as a
-- separate table so employees and admins never share ids). Exactly 4
-- single-use codes issued whenever an employee enables 2-Step
-- Verification; only the SHA-256 hash is stored. is_used is flipped via
-- an atomic "UPDATE ... WHERE is_used = FALSE" (checking rowcount).
-- ------------------------------------------------------
CREATE TABLE employee_mfa_recovery_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    code_hash VARCHAR(64) NOT NULL,            -- SHA-256 hex digest, via hash_token()
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_employee_mfa_recovery_codes_employee FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- department_head_id references employees, which is only defined above
-- this point, so its FK is added here instead of inline in the
-- departments table definition.
ALTER TABLE departments
    ADD CONSTRAINT fk_departments_head FOREIGN KEY (department_head_id)
        REFERENCES employees(employee_id) ON UPDATE CASCADE ON DELETE SET NULL;

-- ------------------------------------------------------
-- password_tokens
-- Single-use, expiring tokens for both the "set password" flow
-- (new invited user) and the "reset password" flow (existing user).
-- token_type distinguishes the two; both are validated and consumed
-- through the same backend endpoint.
-- ------------------------------------------------------
CREATE TABLE password_tokens (
    token_id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,   -- SHA-256 hash of the token; the raw token is never stored
    token_type ENUM('invite', 'reset') NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,                     -- NULL = still valid/unused; set once consumed
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_password_tokens_admin FOREIGN KEY (admin_id)
        REFERENCES admins(admin_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- employee_password_tokens
-- Same purpose as password_tokens, but for employee self-service
-- accounts instead of admin accounts. A separate table keeps employee
-- authentication fully independent from admin authentication.
-- ------------------------------------------------------
CREATE TABLE employee_password_tokens (
    token_id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,   -- SHA-256 hash of the token; the raw token is never stored
    token_type ENUM('invite', 'reset') NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,                     -- NULL = still valid/unused; set once consumed
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_employee_password_tokens_employee FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- audit_logs
-- Records who performed create/update/archive/restore actions on
-- employee and master-data records, and when. admin_id is nullable
-- so a log entry is preserved even if the admin account is later removed.
-- ------------------------------------------------------
CREATE TABLE audit_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NULL,
    action ENUM('create', 'update', 'archive', 'restore', 'upload', 'delete') NOT NULL,
    entity VARCHAR(50) NOT NULL,
    record_id INT NOT NULL,
    details VARCHAR(255) NULL,      -- snapshot text for records that can be hard-deleted (e.g. documents)
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_audit_logs_admin FOREIGN KEY (admin_id)
        REFERENCES admins(admin_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- employee_documents
-- Files attached to an employee record (ID proofs, certificates, etc).
-- Deleting an employee removes their documents too; documents themselves
-- are hard-deleted (no archive/restore) when an admin removes one.
-- ------------------------------------------------------
CREATE TABLE employee_documents (
    document_id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    document_name VARCHAR(150) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    uploaded_by_admin_id INT NULL,
    uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_employee_documents_employee FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE,

    CONSTRAINT fk_employee_documents_uploaded_by FOREIGN KEY (uploaded_by_admin_id)
        REFERENCES admins(admin_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- shift_rosters
-- Day-by-day shift assignments: which employee works which shift on
-- which date. Separate from employees.shift_id, which is just an
-- employee's default/catalog shift. A roster entry is a dated
-- assignment, not master data, so - like employee_documents - it is
-- hard-deleted/edited directly rather than archived/restored.
-- One entry per employee per day (see the unique key below); correcting
-- a wrong assignment means updating or deleting the row, not archiving it.
-- ------------------------------------------------------
CREATE TABLE shift_rosters (
    roster_id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    shift_id INT NOT NULL,
    roster_date DATE NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_shift_rosters_employee FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE,

    CONSTRAINT fk_shift_rosters_shift FOREIGN KEY (shift_id)
        REFERENCES shifts(shift_id) ON DELETE RESTRICT,

    UNIQUE KEY uq_shift_rosters_employee_date (employee_id, roster_date)
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- office_holidays
-- One-off, company-wide exceptions to the default weekly pattern.
-- Saturday and Sunday are non-working days by default and are NOT
-- stored here. A row is either:
--   'Holiday'     - the office is closed on that date (a weekday), or
--   'Working Day' - a Saturday/Sunday that is worked as a normal day,
--                     overriding the default weekend.
-- One row per date (see the unique key below). Adding, editing or
-- deleting a row never modifies existing attendance, leave or roster
-- records - those are kept exactly as they were.
-- ------------------------------------------------------
CREATE TABLE office_holidays (
    holiday_id INT AUTO_INCREMENT PRIMARY KEY,
    holiday_date DATE NOT NULL UNIQUE,
    day_type ENUM('Holiday', 'Working Day') NOT NULL,
    title VARCHAR(100) NOT NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_office_holidays_admin FOREIGN KEY (created_by)
        REFERENCES admins(admin_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- attendance
-- One row per employee per day. shift_id is captured once at record
-- creation time from that day's shift_rosters entry (if any), so later
-- reads don't need to re-join the roster. Present/Late are computed
-- automatically on employee self-check-in (see attendance_routes.py);
-- Absent/Half Day are only ever set manually by admin/HR, since there is
-- no scheduled job in this system to detect a missed day automatically.
-- On Leave is set automatically when a leave request is approved (see
-- leave_routes.py). Like shift_rosters, this is a dated transactional
-- record - edited or corrected directly, not archived/restored.
-- ------------------------------------------------------
CREATE TABLE attendance (
    attendance_id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    shift_id INT NULL,
    attendance_date DATE NOT NULL,
    check_in_time DATETIME NULL,
    check_out_time DATETIME NULL,
    status ENUM('Present', 'Late', 'Absent', 'Half Day', 'On Leave') NOT NULL DEFAULT 'Present',
    leave_request_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_attendance_employee FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE,

    CONSTRAINT fk_attendance_shift FOREIGN KEY (shift_id)
        REFERENCES shifts(shift_id) ON DELETE SET NULL,

    UNIQUE KEY uq_attendance_employee_date (employee_id, attendance_date)
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- leave_quotas
-- Exactly two rows (CL, EL). A single global annual quota per leave
-- type, editable by admin/HR - not per-employee. Remaining balance is
-- always computed live from leave_requests (quota minus this employee's
-- Approved+Pending days this year), never stored, so cancelling or
-- reversing a request automatically corrects the balance with no
-- separate restore step.
-- ------------------------------------------------------
CREATE TABLE leave_quotas (
    leave_type ENUM('CL', 'EL') PRIMARY KEY,
    annual_quota DECIMAL(4,1) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- leave_requests
-- is_half_day is only meaningful (and only allowed by the application)
-- when start_date = end_date. reviewed_by_employee_id is set when a
-- manager approves/rejects; reviewed_by_admin_id is set when admin/HR
-- does so instead - at most one of the two is ever populated.
-- ------------------------------------------------------
CREATE TABLE leave_requests (
    leave_request_id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    leave_type ENUM('CL', 'EL') NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_half_day BOOLEAN NOT NULL DEFAULT FALSE,
    -- Which half, only when is_half_day is TRUE. Added after is_half_day
    -- already had data in production, so existing TRUE rows are left NULL
    -- here rather than guessed at - is_half_day alone still fully answers
    -- "was this a half day" (and so still drives the 0.5-day deduction and
    -- the attendance Half Day status) for those older rows; this column
    -- only adds the which-half detail for requests submitted going forward.
    half_day_period ENUM('First Half', 'Second Half') NULL,
    reason VARCHAR(255) NULL,
    status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Pending',
    -- Set when status becomes Rejected (by manager or admin/HR) and shown
    -- back to the employee in My Leave. Distinct from `reason` above,
    -- which is always the employee's own reason for requesting the leave.
    -- Cleared if a Rejected request is later reversed back to Approved.
    rejection_reason VARCHAR(255) NULL,
    reviewed_by_employee_id INT NULL,
    reviewed_by_admin_id INT NULL,
    reviewed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_leave_requests_employee FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE,

    CONSTRAINT fk_leave_requests_reviewer_employee FOREIGN KEY (reviewed_by_employee_id)
        REFERENCES employees(employee_id) ON DELETE SET NULL,

    CONSTRAINT fk_leave_requests_reviewer_admin FOREIGN KEY (reviewed_by_admin_id)
        REFERENCES admins(admin_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- attendance.leave_request_id references leave_requests, which is only
-- defined above this point, so its FK is added here. NULL means the row
-- was never leave-generated, or was leave-generated but has since been
-- manually edited by admin/HR via PUT /attendance/<id> (which always
-- clears this column) - either way, leave reversal must never touch it.
ALTER TABLE attendance
    ADD CONSTRAINT fk_attendance_leave_request FOREIGN KEY (leave_request_id)
        REFERENCES leave_requests(leave_request_id) ON DELETE SET NULL;

-- ------------------------------------------------------
-- employee_notifications
-- Generic in-app notification feed, shared by both employee self-service
-- recipients and admin recipients - recipient_employee_id/recipient_admin_id
-- are mutually exclusive per row (exactly one is set), enforced in
-- application code (create_notification() in notification_helper.py)
-- rather than a DB constraint, same preference already established
-- elsewhere in this schema (e.g. Roster's date-overlap checks, Asset's
-- single-open-assignment rule). Admin notifications are always a
-- broadcast (one row per admin, written by notify_all_admins()) - there
-- is no per-admin targeting/permission filtering at the data level.
-- type/related_entity_type are plain strings, not ENUMs, deliberately -
-- unlike attendance.status or leave_requests.status (closed, controlled
-- vocabularies), every module (Leave, Asset, Onboarding, Offboarding,
-- Training, Performance, Documents) introduces its own type strings here
-- without needing a schema change. related_entity_type/related_entity_id
-- are an optional generic pointer back to whatever triggered the
-- notification (e.g. "leave_request" / leave_request_id), same spirit
-- as audit_logs.entity/record_id.
-- ------------------------------------------------------
CREATE TABLE employee_notifications (
    notification_id INT AUTO_INCREMENT PRIMARY KEY,
    recipient_employee_id INT NULL,
    recipient_admin_id INT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(150) NOT NULL,
    message VARCHAR(500) NOT NULL,
    link VARCHAR(255) NULL,
    related_entity_type VARCHAR(50) NULL,
    related_entity_id INT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_employee_notifications_recipient FOREIGN KEY (recipient_employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE,

    CONSTRAINT fk_employee_notifications_recipient_admin FOREIGN KEY (recipient_admin_id)
        REFERENCES admins(admin_id) ON DELETE CASCADE,

    INDEX idx_employee_notifications_recipient_admin (recipient_admin_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- asset_types
-- Catalog of asset categories (Laptop, Monitor, Phone...), same shape as
-- shifts/grades/roles. type_code (e.g. "LAP") is admin-set once and used
-- to auto-generate asset_tag values below (LAP-001, LAP-002...) - it is
-- therefore unique and never blank.
-- ------------------------------------------------------
CREATE TABLE asset_types (
    asset_type_id INT AUTO_INCREMENT PRIMARY KEY,
    type_name VARCHAR(100) NOT NULL,
    type_code VARCHAR(10) NOT NULL UNIQUE,
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- assets
-- Individual physical inventory units. asset_tag is auto-generated from
-- the owning type's type_code (e.g. LAP-001) - never accepted from the
-- client, same convention as employee_code/department_code elsewhere.
-- current_employee_id is a denormalized "who has it right now" pointer
-- for fast lookups; asset_assignments below is the source of truth for
-- history. There is no stored quantity anywhere - available/assigned
-- counts per type are always a live COUNT(*) query against this table.
-- ------------------------------------------------------
CREATE TABLE assets (
    asset_id INT AUTO_INCREMENT PRIMARY KEY,
    asset_type_id INT NOT NULL,
    asset_tag VARCHAR(20) NOT NULL UNIQUE,
    serial_number VARCHAR(100) NULL,
    manufacturer VARCHAR(100) NULL,
    model VARCHAR(100) NULL,
    `condition` ENUM('New', 'Good', 'Fair', 'Poor') NULL,   -- reserved word in MySQL: must stay quoted
    status ENUM('Available', 'Assigned', 'Under Repair', 'Retired', 'Lost') NOT NULL DEFAULT 'Available',
    current_employee_id INT NULL,
    purchase_date DATE NULL,
    purchase_cost DECIMAL(10,2) NULL,
    vendor VARCHAR(150) NULL,
    warranty_expiry DATE NULL,
    notes VARCHAR(500) NULL,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_assets_type FOREIGN KEY (asset_type_id)
        REFERENCES asset_types(asset_type_id) ON DELETE RESTRICT,

    CONSTRAINT fk_assets_current_employee FOREIGN KEY (current_employee_id)
        REFERENCES employees(employee_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- asset_assignments
-- Full assignment history - never hard-deleted, mirrors leave_requests'
-- treatment of its own history. One open row (returned_date IS NULL)
-- per asset at a time, enforced at the application layer (an asset's
-- status must be 'Available' before a new assignment can be created for
-- it), not by a DB constraint - same preference already established for
-- Roster's date-overlap checks.
-- ------------------------------------------------------
CREATE TABLE asset_assignments (
    assignment_id INT AUTO_INCREMENT PRIMARY KEY,
    asset_id INT NOT NULL,
    employee_id INT NOT NULL,
    assigned_by_admin_id INT NULL,
    returned_by_admin_id INT NULL,
    assigned_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    returned_date DATETIME NULL,
    assignment_notes VARCHAR(500) NULL,
    return_condition ENUM('Good', 'Damaged', 'Missing Parts', 'Non-functional') NULL,
    return_notes VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_asset_assignments_asset FOREIGN KEY (asset_id)
        REFERENCES assets(asset_id) ON DELETE RESTRICT,

    CONSTRAINT fk_asset_assignments_employee FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE,

    CONSTRAINT fk_asset_assignments_assigned_by FOREIGN KEY (assigned_by_admin_id)
        REFERENCES admins(admin_id) ON DELETE SET NULL,

    CONSTRAINT fk_asset_assignments_returned_by FOREIGN KEY (returned_by_admin_id)
        REFERENCES admins(admin_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- onboarding_checklist_items / offboarding_checklist_items
-- Admin-configurable catalogs, same shape as asset_types. display_order
-- controls the order items are shown/snapshotted in; is_required marks
-- items that must be completed before offboarding can be finished (see
-- employee_offboarding_tasks) - onboarding has no equivalent completion
-- gate, is_required there is informational only.
-- ------------------------------------------------------
CREATE TABLE onboarding_checklist_items (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    item_code VARCHAR(10) NOT NULL UNIQUE,         -- auto-generated, e.g. ONB0001
    item_name VARCHAR(150) NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE offboarding_checklist_items (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    item_code VARCHAR(10) NOT NULL UNIQUE,         -- auto-generated, e.g. OFF0001
    item_name VARCHAR(150) NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- employee_onboarding_tasks / employee_offboarding_tasks
-- One row per checklist item copied for a specific employee when
-- "Start Onboarding"/"Start Offboarding" is run. item_name/is_required/
-- display_order are snapshotted at that moment (same reasoning as
-- attendance.shift_id snapshotting the roster's shift) so a later edit
-- to the catalog item never rewrites a checklist someone is already
-- partway through. item_id is kept too (ON DELETE RESTRICT) so the
-- catalog item can't be permanently deleted while task history exists,
-- matching every other master-data table in this system.
-- ------------------------------------------------------
CREATE TABLE employee_onboarding_tasks (
    task_id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    item_id INT NOT NULL,
    item_name VARCHAR(150) NOT NULL,
    is_required BOOLEAN NOT NULL,
    display_order INT NOT NULL,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_by_admin_id INT NULL,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_eot_employee FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE,

    CONSTRAINT fk_eot_item FOREIGN KEY (item_id)
        REFERENCES onboarding_checklist_items(item_id) ON DELETE RESTRICT,

    CONSTRAINT fk_eot_completed_by FOREIGN KEY (completed_by_admin_id)
        REFERENCES admins(admin_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE employee_offboarding_tasks (
    task_id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    item_id INT NOT NULL,
    item_name VARCHAR(150) NOT NULL,
    is_required BOOLEAN NOT NULL,
    display_order INT NOT NULL,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_by_admin_id INT NULL,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_ffot_employee FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE,

    CONSTRAINT fk_ffot_item FOREIGN KEY (item_id)
        REFERENCES offboarding_checklist_items(item_id) ON DELETE RESTRICT,

    CONSTRAINT fk_ffot_completed_by FOREIGN KEY (completed_by_admin_id)
        REFERENCES admins(admin_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- review_cycles
-- Admin-configurable catalog of performance review periods (e.g.
-- "Q1 2026", "Annual 2026"), same shape as other master tables.
-- ------------------------------------------------------
CREATE TABLE review_cycles (
    cycle_id INT AUTO_INCREMENT PRIMARY KEY,
    cycle_code VARCHAR(10) NOT NULL UNIQUE,        -- auto-generated, e.g. CYC0001
    cycle_name VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- performance_reviews
-- One review per employee per cycle (enforced below), created by either
-- an admin/HR user or the employee's reporting manager - same dual
-- reviewer pattern as leave_requests.reviewed_by_employee_id /
-- reviewed_by_admin_id, since only one of the two is ever set. Draft
-- reviews can be edited; once status = 'Submitted' the row is treated
-- as immutable at the application level.
-- ------------------------------------------------------
CREATE TABLE performance_reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    cycle_id INT NOT NULL,
    rating TINYINT NOT NULL,                       -- 1-5, validated in application code
    comments VARCHAR(500) NULL,
    status ENUM('Draft', 'Submitted') NOT NULL DEFAULT 'Draft',
    reviewer_employee_id INT NULL,
    reviewer_admin_id INT NULL,
    submitted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_performance_reviews_employee FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE,

    CONSTRAINT fk_performance_reviews_cycle FOREIGN KEY (cycle_id)
        REFERENCES review_cycles(cycle_id) ON DELETE RESTRICT,

    CONSTRAINT fk_performance_reviews_reviewer_employee FOREIGN KEY (reviewer_employee_id)
        REFERENCES employees(employee_id) ON DELETE SET NULL,

    CONSTRAINT fk_performance_reviews_reviewer_admin FOREIGN KEY (reviewer_admin_id)
        REFERENCES admins(admin_id) ON DELETE SET NULL,

    UNIQUE KEY uq_performance_reviews_employee_cycle (employee_id, cycle_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- training_programs
-- Admin-configurable catalog covering both Training and Certification
-- programs (program_type distinguishes them) rather than two near-
-- identical tables. validity_months only applies to Certification
-- programs - NULL means "does not expire". Training programs must
-- always have validity_months = NULL, enforced in application code.
-- ------------------------------------------------------
CREATE TABLE training_programs (
    program_id INT AUTO_INCREMENT PRIMARY KEY,
    program_code VARCHAR(10) NOT NULL UNIQUE,      -- auto-generated, e.g. TRN0001
    program_name VARCHAR(150) NOT NULL,
    program_type ENUM('Training', 'Certification') NOT NULL,
    validity_months INT NULL,                      -- Certification only; NULL = does not expire
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------
-- employee_training_records
-- One row per assignment. Unlike performance_reviews, an employee can
-- have more than one Completed record for the same program over time
-- (recurring training, re-certification), so there is no uniqueness
-- constraint here - "only one open Assigned record per employee/
-- program at a time" is enforced in application code instead, since
-- it is a conditional rule (only applies while status = 'Assigned')
-- that a plain UNIQUE KEY cannot express.
--
-- expiry_date is computed once at completion time from
-- completion_date + training_programs.validity_months and stored
-- permanently - a later change to the catalog's validity_months must
-- never alter an already-completed record's expiry_date.
--
-- document_id optionally links to an existing employee_documents row
-- (a certificate) - ON DELETE SET NULL so deleting a document never
-- blocks on this table, same reasoning as the reviewer FKs elsewhere.
-- ------------------------------------------------------
CREATE TABLE employee_training_records (
    record_id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    program_id INT NOT NULL,
    status ENUM('Assigned', 'Completed') NOT NULL DEFAULT 'Assigned',
    assigned_date DATE NOT NULL,
    due_date DATE NULL,
    completion_date DATE NULL,
    expiry_date DATE NULL,
    document_id INT NULL,
    -- Optional note the employee can add when marking their own record
    -- complete (Mark Complete in My Training). NULL for records completed
    -- by a manager/admin, whose flows don't collect one.
    completion_comment VARCHAR(500) NULL,
    assigned_by_admin_id INT NULL,
    assigned_by_employee_id INT NULL,
    completed_by_admin_id INT NULL,
    completed_by_employee_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_etr_employee FOREIGN KEY (employee_id)
        REFERENCES employees(employee_id) ON DELETE CASCADE,

    CONSTRAINT fk_etr_program FOREIGN KEY (program_id)
        REFERENCES training_programs(program_id) ON DELETE RESTRICT,

    CONSTRAINT fk_etr_document FOREIGN KEY (document_id)
        REFERENCES employee_documents(document_id) ON DELETE SET NULL,

    CONSTRAINT fk_etr_assigned_by_admin FOREIGN KEY (assigned_by_admin_id)
        REFERENCES admins(admin_id) ON DELETE SET NULL,

    CONSTRAINT fk_etr_assigned_by_employee FOREIGN KEY (assigned_by_employee_id)
        REFERENCES employees(employee_id) ON DELETE SET NULL,

    CONSTRAINT fk_etr_completed_by_admin FOREIGN KEY (completed_by_admin_id)
        REFERENCES admins(admin_id) ON DELETE SET NULL,

    CONSTRAINT fk_etr_completed_by_employee FOREIGN KEY (completed_by_employee_id)
        REFERENCES employees(employee_id) ON DELETE SET NULL
) ENGINE=InnoDB;