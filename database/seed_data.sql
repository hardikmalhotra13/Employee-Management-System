-- Employee Management System (EMS) - Version 1.0
--
-- This file contains reference / master data only: admin roles and permissions,
-- departments, job roles, grades, shifts, checklists and leave settings.
-- It contains NO accounts, email addresses, passwords or personal data, so it
-- can be run as it is. Create the Super Admin (and the optional public demo
-- accounts) afterwards with backend/scripts/provision_accounts.py - see
-- "Database Setup" in the README.

USE employee_ms;

-- ------------------------------------------------------
-- Admin roles (system roles - fixed for now, more can be added later
-- through the RBAC management UI without a schema change)
-- ------------------------------------------------------
INSERT INTO admin_roles (admin_role_id, role_name, is_system) VALUES
    (1, 'Super Admin', TRUE),
    (2, 'HR Admin', TRUE),
    (3, 'Read-only', TRUE);

-- ------------------------------------------------------
-- Permission catalog
-- ------------------------------------------------------
INSERT INTO admin_permissions (permission_key, module, description) VALUES
    ('departments.view', 'departments', 'View departments'),
    ('departments.create', 'departments', 'Create departments'),
    ('departments.update', 'departments', 'Edit departments'),
    ('departments.archive', 'departments', 'Archive departments'),
    ('departments.restore', 'departments', 'Restore archived departments'),
    ('departments.delete', 'departments', 'Permanently delete archived departments'),

    ('roles.view', 'roles', 'View employee job roles'),
    ('roles.create', 'roles', 'Create employee job roles'),
    ('roles.update', 'roles', 'Edit employee job roles'),
    ('roles.archive', 'roles', 'Archive employee job roles'),
    ('roles.restore', 'roles', 'Restore archived employee job roles'),
    ('roles.delete', 'roles', 'Permanently delete archived employee job roles'),

    ('grades.view', 'grades', 'View grades'),
    ('grades.create', 'grades', 'Create grades'),
    ('grades.update', 'grades', 'Edit grades'),
    ('grades.archive', 'grades', 'Archive grades'),
    ('grades.restore', 'grades', 'Restore archived grades'),
    ('grades.delete', 'grades', 'Permanently delete archived grades'),

    ('shifts.view', 'shifts', 'View shifts'),
    ('shifts.create', 'shifts', 'Create shifts'),
    ('shifts.update', 'shifts', 'Edit shifts'),
    ('shifts.archive', 'shifts', 'Archive shifts'),
    ('shifts.restore', 'shifts', 'Restore archived shifts'),
    ('shifts.delete', 'shifts', 'Permanently delete archived shifts'),

    ('roster.view', 'roster', 'View the shift roster'),
    ('roster.create', 'roster', 'Assign employees to shifts on the roster'),
    ('roster.update', 'roster', 'Edit roster shift assignments'),
    ('roster.delete', 'roster', 'Remove roster shift assignments'),

    ('attendance.view', 'attendance', 'View attendance records'),
    ('attendance.create', 'attendance', 'Manually create attendance records'),
    ('attendance.update', 'attendance', 'Edit attendance records'),

    ('holidays.view', 'holidays', 'View office holidays and working-day overrides'),
    ('holidays.create', 'holidays', 'Add office holidays and working-day overrides'),
    ('holidays.update', 'holidays', 'Edit office holidays and working-day overrides'),
    ('holidays.delete', 'holidays', 'Delete office holidays and working-day overrides'),

    ('leave.view', 'leave', 'View leave requests and quotas'),
    ('leave.create', 'leave', 'Create leave requests on behalf of an employee'),
    ('leave.update', 'leave', 'Edit leave quotas and override leave requests'),
    ('leave.approve', 'leave', 'Approve or reject leave requests'),

    ('asset.view', 'asset', 'View asset types, inventory, and assignment history'),
    ('asset.create', 'asset', 'Create asset types and inventory items'),
    ('asset.update', 'asset', 'Edit asset types and inventory items'),
    ('asset.archive', 'asset', 'Archive asset types and inventory items'),
    ('asset.restore', 'asset', 'Restore archived asset types and inventory items'),
    ('asset.delete', 'asset', 'Permanently delete archived asset types and inventory items'),
    ('asset.assign', 'asset', 'Assign assets to employees'),
    ('asset.return', 'asset', 'Process asset returns'),

    ('employees.view', 'employees', 'View employees'),
    ('employees.create', 'employees', 'Create employees'),
    ('employees.update', 'employees', 'Edit employees'),
    ('employees.archive', 'employees', 'Archive employees'),
    ('employees.mfa_reset', 'employees', 'Reset an employee''s 2-Step Verification, so they can log in and set it up again'),
    ('employees.restore', 'employees', 'Restore archived employees'),
    ('employees.delete', 'employees', 'Permanently delete archived employees'),
    ('employees.export', 'employees', 'Export employee records to CSV'),

    ('documents.view', 'documents', 'View and download employee documents'),
    ('documents.upload', 'documents', 'Upload employee documents'),
    ('documents.delete', 'documents', 'Delete employee documents'),

    ('users.view', 'users', 'View admin user accounts'),
    ('users.create', 'users', 'Invite new admin user accounts'),
    ('users.update', 'users', 'Edit admin user accounts'),
    ('users.delete', 'users', 'Delete admin user accounts'),
    ('users.mfa_reset', 'users', 'Reset another admin''s MFA enrollment, forcing re-enrollment'),

    ('activity_log.view', 'activity_log', 'View the activity log'),

    ('rbac.manage', 'rbac', 'Manage admin roles and their permissions'),

    ('onboarding.view', 'onboarding', 'View onboarding checklist items and employee onboarding progress'),
    ('onboarding.manage', 'onboarding', 'Manage onboarding checklist items, start onboarding, and complete tasks'),

    ('offboarding.view', 'offboarding', 'View offboarding checklist items and employee offboarding progress'),
    ('offboarding.manage', 'offboarding', 'Manage offboarding checklist items, start offboarding, and complete tasks'),
    ('offboarding.complete', 'offboarding', 'Complete offboarding and archive the employee'),

    ('performance.view', 'performance', 'View review cycles and employee performance reviews'),
    ('performance.manage', 'performance', 'Manage review cycles and create/update/submit performance reviews'),

    ('training.view', 'training', 'View training/certification programs and employee training records'),
    ('training.manage', 'training', 'Manage training/certification programs and assign/complete employee training records');

-- ------------------------------------------------------
-- Role -> permission assignments
-- Chosen so the 3 existing roles keep exactly the same effective
-- access they had before this change.
-- ------------------------------------------------------

-- Super Admin: everything
INSERT INTO admin_role_permissions (admin_role_id, permission_id)
SELECT 1, permission_id FROM admin_permissions;

-- HR Admin: everything except user management, activity log, and RBAC management
INSERT INTO admin_role_permissions (admin_role_id, permission_id)
SELECT 2, permission_id FROM admin_permissions
WHERE permission_key NOT IN (
    'users.view', 'users.create', 'users.update', 'users.delete', 'users.mfa_reset',
    'activity_log.view', 'rbac.manage'
);

-- Read-only: view (and export) access only, no mutations
INSERT INTO admin_role_permissions (admin_role_id, permission_id)
SELECT 3, permission_id FROM admin_permissions
WHERE permission_key IN (
    'departments.view', 'roles.view', 'grades.view', 'shifts.view',
    'employees.view', 'employees.export', 'documents.view', 'roster.view',
    'attendance.view', 'holidays.view', 'leave.view', 'asset.view', 'onboarding.view', 'offboarding.view', 'performance.view',
    'training.view'
);

-- ------------------------------------------------------
-- Departments
-- ------------------------------------------------------
INSERT INTO departments (department_code, department_name, status) VALUES
('DEP0001', 'Human Resources', 'Active'),
('DEP0002', 'Information Technology', 'Active'),
('DEP0003', 'Finance', 'Active'),
('DEP0004', 'Sales', 'Active'),
('DEP0005', 'Operations', 'Active');

-- ------------------------------------------------------
-- Employee Job Roles (designations)
-- ------------------------------------------------------
INSERT INTO roles (role_code, role_name, status) VALUES
('ROL0001', 'Software Developer', 'Active'),
('ROL0002', 'HR Executive', 'Active'),
('ROL0003', 'Accountant', 'Active'),
('ROL0004', 'Sales Executive', 'Active'),
('ROL0005', 'Project Manager', 'Active');

-- ------------------------------------------------------
-- Grades 
-- ------------------------------------------------------
INSERT INTO grades (grade_code, grade_name, status) VALUES
('GRD0001', 'A', 'Active'),
('GRD0002', 'B', 'Active'),
('GRD0003', 'C', 'Active'),
('GRD0004', 'D', 'Active');

-- ------------------------------------------------------
-- Shifts
-- ------------------------------------------------------
INSERT INTO shifts (shift_code, shift_name, start_time, end_time, status) VALUES
('SHF0001', 'Morning', '09:00:00', '17:00:00', 'Active'),
('SHF0002', 'Evening', '18:00:00', '02:00:00', 'Active');

-- ------------------------------------------------------
-- Onboarding / Offboarding checklist items
-- ------------------------------------------------------
INSERT INTO onboarding_checklist_items (item_code, item_name, is_required, display_order, status) VALUES
('ONB0001', 'Collect ID proof documents', TRUE, 1, 'Active'),
('ONB0002', 'Send employee portal invite', TRUE, 2, 'Active'),
('ONB0003', 'Assign laptop and equipment', TRUE, 3, 'Active'),
('ONB0004', 'Complete orientation session', TRUE, 4, 'Active'),
('ONB0005', 'Introduce to reporting manager and team', FALSE, 5, 'Active');

INSERT INTO offboarding_checklist_items (item_code, item_name, is_required, display_order, status) VALUES
('OFF0001', 'Return assigned assets', TRUE, 1, 'Active'),
('OFF0002', 'Revoke system and portal access', TRUE, 2, 'Active'),
('OFF0003', 'Complete knowledge transfer', TRUE, 3, 'Active'),
('OFF0004', 'Conduct exit interview', FALSE, 4, 'Active'),
('OFF0005', 'Process final settlement', TRUE, 5, 'Active');

-- ------------------------------------------------------
-- Review Cycles
-- ------------------------------------------------------
INSERT INTO review_cycles (cycle_code, cycle_name, start_date, end_date, status) VALUES
('CYC0001', 'Q1 2026', '2026-01-01', '2026-03-31', 'Active'),
('CYC0002', 'Q2 2026', '2026-04-01', '2026-06-30', 'Active'),
('CYC0003', 'Annual 2026', '2026-01-01', '2026-12-31', 'Active');

-- ------------------------------------------------------
-- Training Programs
-- ------------------------------------------------------
INSERT INTO training_programs (program_code, program_name, program_type, validity_months, status) VALUES
('TRN0001', 'Workplace Safety Training', 'Training', NULL, 'Active'),
('TRN0002', 'Code of Conduct Training', 'Training', NULL, 'Active'),
('TRN0003', 'First Aid Certification', 'Certification', 24, 'Active'),
('TRN0004', 'Information Security Certification', 'Certification', 12, 'Active');

-- ------------------------------------------------------
-- Leave Quotas
-- Starting global annual quotas; editable by admin/HR afterwards.
-- ------------------------------------------------------
INSERT INTO leave_quotas (leave_type, annual_quota) VALUES
('CL', 10),
('EL', 15);