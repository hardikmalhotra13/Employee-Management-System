# Employee Management System (EMS)

A full-stack web application for managing an organisation's workforce: employee records, shifts and rosters, attendance, leave, office holidays, assets, onboarding and offboarding, performance reviews, training, notifications and role-based administration.

The system has two separate web portals served by one React application and one Flask API:

- **Admin Panel** for HR and administrators, with role-based permissions.
- **Employee Portal** for every employee, which also gives employees who manage others a **My Team** section.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Features](#2-features)
3. [System Architecture](#3-system-architecture)
4. [Prerequisites and Installation](#4-prerequisites-and-installation)
5. [Database Setup](#5-database-setup)
6. [Environment Configuration](#6-environment-configuration)
7. [Running the Project](#7-running-the-project)
8. [Login and Access](#8-login-and-access)
9. [Usage Guide](#9-usage-guide)
10. [API Documentation](#10-api-documentation)
11. [Testing and Troubleshooting](#11-testing-and-troubleshooting)
12. [Repository Structure](#12-repository-structure)
13. [Security and Limitations](#13-security-and-limitations)
14. [Deploying as a Free Demo](#14-deploying-as-a-free-demo)

---

## 1. Project Overview

### Purpose

EMS centralises the day-to-day HR workflow of an organisation in one application. HR staff maintain employee records and master data, publish rosters and holidays, review attendance and leave, track assets, run onboarding and offboarding checklists, record performance reviews and assign training. Employees use a self-service portal for their own attendance, leave, documents and profile, and managers handle approvals for their direct reports from the same portal.

### Technology stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, React Router 6, Vite 5, Axios, `lucide-react` (icons), `qrcode` (authenticator-app QR codes), plain CSS files per component |
| Backend | Python, Flask 3.1, PyMySQL (hand-written SQL, no ORM), PyJWT, Werkzeug (password hashing), Flask-Cors, python-dotenv, Gunicorn (production server) |
| Security libraries | `pyotp` (one-time codes), `cryptography` (Fernet encryption of authenticator secrets), Authlib (Google sign-in) |
| Database | MySQL, InnoDB tables |
| File storage and email | Local disk or any S3-compatible bucket (`boto3`); Brevo transactional email API |
| Authentication | JSON Web Tokens (HS256), separate token realms for admins and employees |

Exact backend versions are pinned in [`backend/requirements.txt`](backend/requirements.txt); frontend versions are in [`frontend/package.json`](frontend/package.json).

---

## 2. Features

### 2.1 Admin Panel

The sidebar lists these modules. What each admin can actually do depends on the permissions of their role (see [Login and Access](#8-login-and-access)).

| Module | What it provides |
|--------|------------------|
| **Dashboard** | Summary cards, charts, upcoming events and a leave summary |
| **Employees** | Create, edit, search and filter employees; view a full profile (personal and employment details, direct reports, documents, onboarding, offboarding, performance reviews, training records); archive, restore or permanently delete; export to CSV; send a set-password invitation; reset an employee's two-step verification |
| **Departments, Roles, Grades** | Master data. *Roles* are job designations, not access roles. Archive, restore and permanent delete are supported |
| **Shifts** | Shift definitions (code, name, start and end time) with archive, restore and permanent delete |
| **Roster** | Assign a shift to an employee for a date, edit or remove an entry, or bulk-assign a shift to one employee or a whole department over a date range |
| **Attendance** | View attendance with filters; record an Absent or Half Day entry; correct an existing record (a reason is required and the change is audited) |
| **Holidays** | Add, edit and delete office holidays for specific dates and mark a Saturday or Sunday as a working day. Weekends are holidays by default |
| **Leave** | View all leave requests; approve or reject them, including reversing an earlier decision; set the annual quota for each leave type |
| **Asset Types, Assets** | Maintain asset categories and assets; assign, return and bulk-assign assets; view an asset's assignment history |
| **Onboarding, Offboarding** | Maintain the checklist templates. Each employee's own checklist is started, ticked off and completed from the employee profile |
| **Review Cycles** | Define performance review cycles. Individual reviews are created and submitted from the employee profile |
| **Training Programs** | Maintain training programs and assign them to employees, or to all employees at once |
| **Settings** | Own profile and password, two-step verification, Google account linking, administrator accounts, roles and permissions, and the activity log. Sections appear only when the role has the matching permission |
| **Notifications** | Bell icon with an unread count and a notifications page |

### 2.2 Employee Portal

| Page | What it provides |
|------|------------------|
| **Dashboard** | Today's attendance with Check In and Check Out, leave balance, today's schedule, training, assets, latest performance review, recent notifications and quick actions |
| **My Profile** | Own details and profile photo |
| **My Attendance** | Check in and check out, a summary, and a history for the current and previous calendar month that includes weekends and holidays |
| **My Leave** | Apply for leave, view the balance and history, cancel a pending request |
| **Holidays** | A month calendar and a list of the year's office holidays and working-weekend days |
| **My Performance** | Own performance reviews |
| **My Training** | Assigned training, certificate upload and marking training complete |
| **My Assets** | Assets currently assigned |
| **My Documents** | Upload, view and download own documents |
| **Settings** | Two-step verification with recovery codes, Google account linking, change password |
| **Notifications** | Bell icon and a notifications page |

### 2.3 Manager features (My Team)

There is no separate manager login. Any employee who has direct reports sees an extra **My Team** section in the Employee Portal:

| Page | What it provides |
|------|------------------|
| **My Team** | The team list and each member's profile |
| **Team Attendance** | Team attendance, a summary and an exceptions view |
| **Team Leave** | Approve or reject team members' leave requests |
| **Team Performance** | Create, edit, submit and delete performance reviews for team members |
| **Team Training** | Assign training to team members and mark it complete |

### 2.4 Cross-cutting capabilities

- **Role-based access control.** 74 permissions across 18 modules, assigned to admin roles. Three built-in roles are provided and custom roles can be created.
- **Two-step verification (TOTP) with recovery codes**, for admins and employees. It is optional and switched on per account.
- **Google sign-in, link-based.** A user links a Google account from Settings and can then sign in with it. Accounts are never linked automatically by email address.
- **Audit logging.** Administrative actions are recorded and shown in Settings, Activity Log.
- **In-app notifications** for leave activity, onboarding and offboarding, training, asset assignment and return, document uploads, submitted performance reviews, and holiday changes. Leave events also send email when email (Brevo) is configured.
- **Archive and restore.** Master data, employees, assets and similar records are archived first and can be restored; permanent delete is a separate action.
- **File uploads.** Documents accept PDF, JPG, JPEG or PNG up to 10 MB; profile photos accept JPG, JPEG or PNG up to 2 MB. Files are stored on local disk by default, or in a private S3-compatible bucket in production (`STORAGE_BACKEND`).

### 2.5 Key business rules

These are implemented in the backend and apply across the modules.

- **Working days.** Saturday and Sunday are non-working by default. An admin can add a *Holiday* (a weekday on which the office is closed) or a *Working Day* (a Saturday or Sunday on which the office is open). One entry is allowed per date, and past dates can be edited. Employees are notified when one is declared, updated or cancelled.
- **Attendance.** An employee checks in and out themselves, including on a holiday. A check-in within 15 minutes of the shift start is *Present* and a later one is *Late*. An *Absent* record is created automatically when a scheduled shift (a roster entry, or today's default shift) passes its halfway point without a check-in; this never happens on weekends or holidays. *Half Day* comes from an admin entry or from a half-day leave. Employee and manager views show the current and previous calendar month.
- **Leave.** Leave types are Casual Leave (CL) and Earned Leave (EL), each with one annual quota that admins can change. Half-day requests are supported. Weekends and holidays are not counted as leave days. The remaining balance is always calculated from the requests, so cancelling or reversing a request corrects it automatically. Admins cannot create or edit a leave request on an employee's behalf; they approve, reject or reverse it. Approving a leave never overwrites attendance that a person recorded by hand.
- **Roster.** One shift per employee per date. Bulk assignment skips dates that already have an entry and skips weekends and holidays. Archived or Inactive employees, and archived or Inactive shifts, cannot be assigned. Existing entries are never removed when an employee or shift later becomes Inactive.
- **Offboarding.** Completing an employee's offboarding marks the employee Inactive and archived.
- **Employee access.** Archived and Inactive employees cannot log in.

---

## 3. System Architecture

```
 Browser: React single-page app (Vite dev server, port 5173)
   |  Two Axios clients: admin (token) and employee (employee_token)
   |  JSON over HTTP, base URL http://127.0.0.1:5000/api/v1
   v
 Flask application (backend/app.py), 24 blueprints under /api/v1
   routes/   one blueprint per module
   utils/    authentication and permission decorators, audit log, notifications,
             working-day rules, validation, e-mail, MFA, Google sign-in
   |  PyMySQL: hand-written SQL, one connection per request
   v
 MySQL database EMPLOYEE_MS (32 tables)

 Uploaded files (documents, photos, certificates) are stored on disk under backend/uploads/
```

### Frontend

- `src/App.jsx` mounts two route trees: `AppRoutes` for the Admin Panel and `EmployeeRoutes` for the Employee Portal. The browser root `/` redirects to the admin login.
- Two React contexts, `AuthContext` and `EmployeeAuthContext`, hold the signed-in admin or employee. Tokens are kept in the browser's `localStorage` (`token` and `employee_token`).
- `src/services/api/` contains one API module per area. Admin calls go through `apiClient.js` and employee calls through `employeeApiClient.js`; each attaches its own token as `Authorization: Bearer <token>`.
- `src/features/` holds one folder per module with its pages and components; `src/components/` holds shared UI such as the data table, modal, form input and notification bell.
- Admin pages hide or show action buttons using the permission list returned at login.

### Backend

- `backend/app.py` creates the Flask app, enables CORS, registers the blueprints under `/api/v1` and exposes `GET /health`.
- All data access is hand-written SQL through PyMySQL (`backend/database/connection.py`), with values passed as query parameters.
- Authentication helpers in `backend/utils/auth_helper.py` provide three decorators: `require_auth` (any signed-in admin), `require_permission("module.action")` (admin with that permission) and `require_employee_auth` (any active employee). JSON responses use the shape `{ "success": ..., "message": ..., "data" | "errors": ... }`; the exceptions are `GET /health`, file downloads and the CSV export.
- Settings are read from environment variables in `backend/config/settings.py`.

### Database

32 tables in these groups:

| Group | Tables |
|-------|--------|
| Access control | `admin_roles`, `admin_permissions`, `admin_role_permissions`, `admins`, `admin_mfa_recovery_codes`, `password_tokens`, `audit_logs` |
| Organisation | `departments`, `roles`, `grades`, `shifts`, `employees`, `employee_mfa_recovery_codes`, `employee_password_tokens`, `employee_documents` |
| Time and leave | `shift_rosters`, `office_holidays`, `attendance`, `leave_quotas`, `leave_requests` |
| Notifications | `employee_notifications` |
| Assets | `asset_types`, `assets`, `asset_assignments` |
| Onboarding and offboarding | `onboarding_checklist_items`, `offboarding_checklist_items`, `employee_onboarding_tasks`, `employee_offboarding_tasks` |
| Performance and training | `review_cycles`, `performance_reviews`, `training_programs`, `employee_training_records` |

### Authentication and authorisation

1. **Two separate realms.** Admin tokens are signed with `JWT_SECRET_KEY` and employee tokens with `EMPLOYEE_JWT_SECRET_KEY`, so a token from one realm is rejected by the other. Tokens expire after `JWT_EXPIRATION_HOURS`.
2. **Passwords** are stored as Werkzeug hashes. New passwords must be at least `PASSWORD_MIN_LENGTH` characters and contain a letter, a digit and a special character.
3. **Account activation.** New admin and employee accounts have no password. A time-limited, single-purpose link is emailed to the user so that they can set one. Password resets use the same mechanism. Only hashes of these link tokens are stored.
4. **Brute-force protection.** After `LOGIN_MAX_ATTEMPTS` failed logins an email address is locked out for `LOGIN_LOCKOUT_MINUTES`.
5. **Two-step verification.** If an account has it switched on, login returns a short-lived pending token and then requires a code from an authenticator app (or a recovery code). The shared secrets are stored encrypted with `MFA_ENCRYPTION_KEY`.
6. **Google sign-in.** Authorization Code flow with PKCE. Only Google accounts already linked to an EMS account can sign in.
7. **Authorisation.** Every admin API route is protected by a named permission, for example `employees.update`. Three built-in roles are seeded and further roles can be defined in Settings. Employee-side routes check that the employee is still active on every request.

---

## 4. Prerequisites and Installation

### 4.1 Prerequisites

| Software | Version | Notes |
|----------|---------|-------|
| Git | any recent version | To clone the repository |
| Python | 3.9 or newer | Required by the pinned Flask 3.1 |
| Node.js and npm | Node 18 or newer | Required by Vite 5 |
| MySQL Server | 8.0 recommended | The repository does not pin a MySQL version |
| MySQL client | `mysql` command line or MySQL Workbench | To run the SQL files |

A Brevo account (free) is needed only if you want invitation, password-reset and leave emails. A Google Cloud OAuth client is needed only for Google sign-in. Both are optional for a first run, but see the note on invitations in [Login and Access](#8-login-and-access).

### 4.2 Setup at a glance

1. Clone the repository.
2. Create the Python virtual environment and install the backend dependencies.
3. Create and seed the MySQL database ([Database Setup](#5-database-setup)).
4. Create `backend/.env` ([Environment Configuration](#6-environment-configuration)).
5. Install the frontend dependencies.
6. Start the backend, then the frontend ([Running the Project](#7-running-the-project)).
7. Create the Super Admin account ([Database Setup](#5-database-setup), Step 4) and sign in ([Login and Access](#8-login-and-access)).

### 4.3 Clone the repository

```bash
git clone <repository-url>
cd <repository-folder>
```

Replace `<repository-url>` with the address of this repository and `<repository-folder>` with the folder Git creates.

### 4.4 Backend: virtual environment and dependencies

```bash
cd backend
python -m venv venv
```

Activate the environment:

| System | Command |
|--------|---------|
| Windows, PowerShell | `.\venv\Scripts\Activate.ps1` |
| Windows, Command Prompt | `venv\Scripts\activate.bat` |
| macOS or Linux | `source venv/bin/activate` |

On Windows, use `py -m venv venv` if `python` is not recognised. If PowerShell refuses to run the activation script, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once and try again.

Then install the dependencies:

```bash
pip install -r requirements.txt
```

### 4.5 Frontend: dependencies

In a second terminal, from the repository root:

```bash
cd frontend
npm install
```

---

## 5. Database Setup

All SQL files are in the [`database/`](database/) folder. The files are written for a database named `EMPLOYEE_MS`: `schema.sql` creates it with `CREATE DATABASE IF NOT EXISTS EMPLOYEE_MS`, and each file begins with `USE EMPLOYEE_MS;`. If you want a different name, change those lines in `schema.sql` and `seed_data.sql`, and set `DB_NAME` to match.

| File | Purpose | When to run |
|------|---------|-------------|
| `schema.sql` | Creates the database and all tables | Fresh installation, once |
| `seed_data.sql` | Inserts the reference data the application needs: admin roles, the permission catalogue and role assignments, sample departments, job roles, grades and shifts, checklist items, review cycles, training programs and leave quotas. It contains **no accounts, email addresses or passwords** | Fresh installation, once, after `schema.sql` |
| `backend/scripts/provision_accounts.py` | Creates the Super Admin, and optionally the public Demo Admin and Demo Employee, from environment variables | Fresh installation, once, after `seed_data.sql` |

### 5.1 Fresh installation

**Step 1.** Make sure MySQL is running and you can sign in as a user allowed to create databases.

**Step 2.** From the repository root, run the schema and then the seed data, **in this order**. The seed data depends on the tables created by the schema.

| Shell | Commands |
|-------|----------|
| macOS, Linux, Windows Command Prompt | `mysql -u root -p < database/schema.sql` then `mysql -u root -p < database/seed_data.sql` |
| Windows PowerShell (no `<` operator) | `Get-Content database\schema.sql \| mysql -u root -p` then `Get-Content database\seed_data.sql \| mysql -u root -p` |
| Any system, inside the `mysql` client | `SOURCE database/schema.sql;` then `SOURCE database/seed_data.sql;` |
| MySQL Workbench | File, Open SQL Script, choose `schema.sql`, run it; then the same for `seed_data.sql` |

Replace `root` with your MySQL user if it differs; you will be prompted for the password.

**Step 3.** Check the result:

```sql
USE EMPLOYEE_MS;
SHOW TABLES;                                -- 32 tables
SELECT COUNT(*) FROM admin_permissions;     -- 74
SELECT role_name FROM admin_roles;          -- Super Admin, HR Admin, Read-only
```

**Step 4.** Create the Super Admin. `seed_data.sql` deliberately creates no accounts, so nobody can sign in yet. Add these lines to `backend/.env` (it is git-ignored) with your own values:

```ini
SUPER_ADMIN_EMAIL=you@example.com
SUPER_ADMIN_PASSWORD=choose-a-strong-password-1!
SUPER_ADMIN_NAME=Your Name
```

Then, from the `backend` folder with the virtual environment active, run:

```bash
python scripts/provision_accounts.py
```

The script checks the password against the same rules as the application (at least `PASSWORD_MIN_LENGTH` characters with a letter, a number and a special character) and stores only a hash. **It never modifies an existing account by default:** if the email already exists the account is left untouched and reported as `skipped`, so running it again is safe. To deliberately reset the password of the Super Admin it manages, add `--reset-super-admin`; even then only the password changes, and only if that account really is a Super Admin (an admin with another role is refused, never promoted). It also refuses an email that already belongs to an employee, because admin and employee emails must be different. The Super Admin is created on its own: it needs none of the demo variables. **Remove the password lines from `.env` afterwards.** The public demo accounts are created with the same script; see section 8.2.

Run each file only once. The files contain no `DROP` statements: running `schema.sql` again fails with "table already exists", and running `seed_data.sql` again fails on duplicate keys. To start over, delete the database and repeat Steps 2 and 4:

```sql
DROP DATABASE EMPLOYEE_MS;   -- permanently deletes all data
```

---

## 6. Environment Configuration

Configuration is read from environment variables. The repository contains two example files with placeholders only. Copy each to a file named `.env` in the same folder and edit it:

| System | Backend | Frontend |
|--------|---------|----------|
| macOS or Linux | `cp backend/.env.example backend/.env` | `cp frontend/.env.example frontend/.env` |
| Windows | `copy backend\.env.example backend\.env` | `copy frontend\.env.example frontend\.env` |

`.env` files are listed in `.gitignore` and must never be committed.

### 6.1 Backend variables (`backend/.env`)

| Variable | Default if unset | Purpose |
|----------|------------------|---------|
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` | `root` | MySQL user |
| `DB_PASSWORD` | empty | MySQL password |
| `DB_NAME` | `EMPLOYEE_MS` | Database name |
| `DB_SSL_CA` | empty | Path to the database provider's CA certificate file (for example `certs/aiven-ca.pem`). It is a public certificate and must never contain a private key. Set it for hosted databases that require TLS (for example Aiven); leave empty for a local MySQL |
| `DB_TIMEZONE_OFFSET` | empty | MySQL session time zone as a UTC offset such as `+05:30`, so SQL `NOW()` and `CURDATE()` match the application's local time. Pair it with the `TZ` environment variable (for example `TZ=Asia/Kolkata`) on the host. Leave empty locally |
| `SECRET_KEY` | built-in development value | Flask secret key |
| `DEBUG` | `False` | `true` turns on Flask debug mode and auto-reload |
| `JWT_SECRET_KEY` | built-in development value | Signs admin tokens |
| `JWT_EXPIRATION_HOURS` | `24` | Token lifetime for admins and employees |
| `EMPLOYEE_JWT_SECRET_KEY` | built-in development value | Signs employee tokens. Must differ from `JWT_SECRET_KEY` |
| `GOOGLE_CLIENT_ID` | empty | Google sign-in client ID |
| `GOOGLE_CLIENT_SECRET` | empty | Google sign-in client secret |
| `GOOGLE_REDIRECT_URI` | empty | Must match the redirect URI registered with Google |
| `MFA_ENCRYPTION_KEY` | empty | Fernet key used to encrypt authenticator secrets. **Required before anyone turns on two-step verification** |
| `MFA_ISSUER_NAME` | `Employee MS` | Name shown in authenticator apps |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failed logins before lockout |
| `LOGIN_LOCKOUT_MINUTES` | `15` | Lockout length |
| `IP_LOGIN_MAX_FAILURES` | `20` | Failed logins allowed per client address within the window; further login requests get HTTP 429. Applies to the Admin and Employee portals and to the public demo accounts |
| `IP_FORGOT_PASSWORD_MAX` | `5` | Forgot-password requests allowed per client address within the window; further requests get HTTP 429 |
| `IP_RATE_LIMIT_WINDOW_MINUTES` | `15` | Length of the per-address window |
| `TRUSTED_PROXY_COUNT` | `0` | Number of reverse proxies in front of the backend that append to `X-Forwarded-For`. The client address is read that many entries from the **right** of the header; anything further left can be forged and is ignored. `0` trusts no forwarded header and uses the socket address (local development). It must be set on a host such as Render, where the socket address is the host's proxy (see section 14.5) |
| `PASSWORD_MIN_LENGTH` | `8` | Minimum password length |
| `INVITE_TOKEN_EXPIRY_HOURS` | `24` | Lifetime of set-password invitation links |
| `RESET_TOKEN_EXPIRY_HOURS` | `1` | Lifetime of password-reset links |
| `BREVO_API_KEY` | empty | Brevo API key used to send invitation, reset and leave emails over HTTPS |
| `EMAIL_FROM_ADDRESS` | empty | Sender address. Must be a sender you verified in Brevo |
| `EMAIL_FROM_NAME` | `Employee Management System` | Sender name shown to recipients |
| `FRONTEND_BASE_URL` | `http://localhost:5173` | Used to build the links inside emails |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated browser origins allowed to call the API |
| `DEMO_ACCOUNT_EMAILS` | empty | Comma-separated emails of the public demo accounts. They cannot change passwords, two-step verification, the Google link, their profile or upload files, never receive real email, and are exempt from the per-account login lockout (the per-address limits above still apply). `provision_accounts.py` refuses to create a demo account whose email is not listed here |
| `STORAGE_BACKEND` | `local` | `local` stores uploads on disk; `s3` uses an S3-compatible bucket (required in production) |
| `UPLOAD_FOLDER` | `backend/uploads` | Where uploaded files are stored when `STORAGE_BACKEND=local` |
| `S3_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET` | empty | S3-compatible bucket (for example Supabase Storage's S3 endpoint) used when `STORAGE_BACKEND=s3` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | empty | Server-side access keys for that bucket |

If `SECRET_KEY`, `JWT_SECRET_KEY` or `EMPLOYEE_JWT_SECRET_KEY` are left unset, the backend silently falls back to fixed development values that are visible in the source code. Always set your own long, random values (on Render the backend refuses to start with the development values, or without `MFA_ENCRYPTION_KEY`):

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Generate the key for two-step verification with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Keep the generated `MFA_ENCRYPTION_KEY` safe. If it is lost or changed, authenticator secrets that were already stored can no longer be decrypted.

**`backend/.env.example`** (placeholders only):

```ini
# Copy this file to `.env` in the backend/ folder and fill in real values.
# Never commit the actual .env file.
#
# Local development: only the DB_* values are needed; every other line can stay
# as it is.
#
# Production (Render sets RENDER=true automatically): the backend REFUSES TO START
# unless all of these hold:
#   - SECRET_KEY, JWT_SECRET_KEY, EMPLOYEE_JWT_SECRET_KEY: three different random
#     values of at least 32 characters (not the "change-me" placeholders); DEBUG=False
#   - MFA_ENCRYPTION_KEY: a valid Fernet key
#   - DB_HOST is a hosted database (not localhost), DB_PASSWORD is set, DB_SSL_CA is
#     the CA certificate file (public certificate only, no private key)
#   - DB_TIMEZONE_OFFSET is set and the TZ environment variable gives the same
#     offset (TZ=Asia/Kolkata with +05:30)
#   - STORAGE_BACKEND=s3 with S3_ENDPOINT_URL (https), S3_REGION, S3_BUCKET,
#     S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY
#   - BREVO_API_KEY and EMAIL_FROM_ADDRESS
#   - FRONTEND_BASE_URL and every CORS_ALLOWED_ORIGINS entry: https origins with no
#     trailing slash and no localhost; CORS_ALLOWED_ORIGINS includes FRONTEND_BASE_URL
#   - TRUSTED_PROXY_COUNT is 1 or more

# --- Database ---
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=EMPLOYEE_MS
# Hosted databases (e.g. Aiven) require TLS: path to the provider's CA certificate
# file, for example certs/aiven-ca.pem. It is a PUBLIC certificate (it may be
# committed) - it must never contain a private key. Leave empty for a local MySQL.
DB_SSL_CA=
# MySQL session time zone as a UTC offset so SQL NOW()/CURDATE() match the app's
# local time. Leave empty locally; use +05:30 for India. Also set TZ=Asia/Kolkata
# on the server (see README deployment section).
DB_TIMEZONE_OFFSET=

# --- Application ---
# Used by Flask's app.config["SECRET_KEY"]
SECRET_KEY=change-me
DEBUG=False

# --- Admin JWT ---
JWT_SECRET_KEY=change-me
JWT_EXPIRATION_HOURS=24

# --- Employee (self-service) JWT ---
# Must be different from JWT_SECRET_KEY so an employee token can never be
# decoded as an admin token, or vice versa.
EMPLOYEE_JWT_SECRET_KEY=change-me

# --- Google OIDC (Admin SSO - Authorization Code flow with PKCE) ---
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/google/callback

# --- MFA (TOTP) ---
# Must be a urlsafe-base64-encoded 32-byte key (Fernet format). Generate with:
# python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
MFA_ENCRYPTION_KEY=
MFA_ISSUER_NAME=Employee MS

# --- Login security ---
# Per-account lockout. The public demo accounts (DEMO_ACCOUNT_EMAILS) are exempt, so
# visitors cannot lock them for everyone.
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15

# --- Per-IP abuse protection (login and forgot-password) ---
# Failed logins allowed per client address, and forgot-password requests allowed per
# client address, within the window below. Further requests get HTTP 429.
IP_LOGIN_MAX_FAILURES=20
IP_FORGOT_PASSWORD_MAX=5
IP_RATE_LIMIT_WINDOW_MINUTES=15
# Number of reverse proxies in front of the backend that append to X-Forwarded-For.
# The client address is taken that many entries from the RIGHT of the header (entries
# further left can be forged by the client and are never used). 0 = trust nothing and
# use the socket address (running locally / reached directly). On a host such as
# Render the socket address is the host's proxy, so this MUST be set there, otherwise
# every visitor shares one limit. See README section 14.5 for how to confirm the value.
TRUSTED_PROXY_COUNT=0

# --- Password policy ---
PASSWORD_MIN_LENGTH=8

# --- Password reset / invite tokens ---
INVITE_TOKEN_EXPIRY_HOURS=24
RESET_TOKEN_EXPIRY_HOURS=1

# --- Email (Brevo transactional email API - invite, reset and notification emails) ---
# API key from Brevo (SMTP & API > API Keys). EMAIL_FROM_ADDRESS must be a sender
# address you have verified in Brevo.
BREVO_API_KEY=
EMAIL_FROM_ADDRESS=
EMAIL_FROM_NAME=Employee Management System

# --- Frontend ---
# Used to build links inside emails (invite/reset links)
FRONTEND_BASE_URL=http://localhost:5173
# Comma-separated browser origins allowed to call the API (CORS)
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# --- Public demo accounts ---
# Comma-separated emails of the public Demo Admin / Demo Employee logins. These
# accounts cannot change passwords, MFA, Google link, profile or uploads, and never
# receive real emails. Leave empty if you do not run public demo accounts.
DEMO_ACCOUNT_EMAILS=

# --- File storage ---
# "local" (default) keeps uploads on disk; "s3" uses an S3-compatible bucket
# (required in production - e.g. Render's disk is wiped on every restart).
STORAGE_BACKEND=local
# Optional - local backend only. Defaults to a local "uploads" folder next to backend/
UPLOAD_FOLDER=
# S3 backend only (Supabase Storage > Settings > S3 connection):
#   S3_ENDPOINT_URL=https://<project_ref>.storage.supabase.co/storage/v1/s3
S3_ENDPOINT_URL=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
```

### 6.2 Frontend variables (`frontend/.env`)

Locally the application runs without this file. For a deployed site `VITE_API_BASE_URL` is required, and the `VITE_GOOGLE_*` variables are needed for Google sign-in. Vite reads these at build time, so rebuild or redeploy after changing them.

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | Backend address including `/api/v1`, for example `https://your-api.onrender.com/api/v1`. If unset, the frontend uses `http://127.0.0.1:5000/api/v1` (local development) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID. Must match the backend `GOOGLE_CLIENT_ID` |
| `VITE_GOOGLE_REDIRECT_URI` | Must match the backend `GOOGLE_REDIRECT_URI` and the URI registered with Google |

**`frontend/.env.example`** (placeholders only):

```ini
# Copy this file to `.env` in the frontend/ folder and fill in real values.
# Never commit the actual .env file. Vite only exposes variables prefixed
# with VITE_ to client-side code.
#
# PUBLIC VALUES ONLY: everything in this file is compiled into the JavaScript that
# every visitor downloads. Never put a secret here (no passwords, API keys, client
# secrets or tokens) - those belong in the backend environment.

# Base URL of the backend API, including /api/v1. Leave empty for local
# development (falls back to http://127.0.0.1:5000/api/v1). For a deployed site,
# set it to the backend's public URL, e.g. https://your-api.onrender.com/api/v1.
# Vite reads it at build time, so rebuild/redeploy after changing it.
VITE_API_BASE_URL=

# Google OAuth client ID used for Admin "Continue with Google" sign-in.
# Must match the OAuth client configured in Google Cloud Console and the
# backend's GOOGLE_CLIENT_ID.
VITE_GOOGLE_CLIENT_ID=

# Must match the backend's GOOGLE_REDIRECT_URI and the redirect URI
# registered on the Google OAuth client.
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/auth/google/callback
```

The API clients in `frontend/src/services/api/apiClient.js` and `employeeApiClient.js` read `VITE_API_BASE_URL`, and fall back to `http://127.0.0.1:5000/api/v1` when it is not set.

---

## 7. Running the Project

Start the backend first, then the frontend. Both must keep running.

### 7.1 Backend

```bash
cd backend
# activate the virtual environment first (see section 4.4)
python app.py
```

The server listens on Flask's defaults, `http://127.0.0.1:5000`. Setting `DEBUG=true` in `backend/.env` enables auto-reload during development.

Check that it can reach the database:

```bash
curl http://127.0.0.1:5000/health
```

A healthy backend answers with a JSON body whose `status` is `success` and whose message is "Database connection is healthy". If the database cannot be reached, the message is "Database connection failed" instead.

### 7.2 Frontend

```bash
cd frontend
npm run dev
```

Vite serves the application, by default at **http://localhost:5173**. No port is configured in `vite.config.js`, and if 5173 is busy Vite chooses the next free port. Google sign-in and email links expect port 5173.

To check that a production build compiles, or to serve one locally:

```bash
npm run build      # writes the build to frontend/dist/
npm run preview
```

### 7.3 Addresses

| What | URL |
|------|-----|
| Application root (redirects to the admin login) | http://localhost:5173/ |
| Admin Panel login | http://localhost:5173/login |
| Employee Portal login | http://localhost:5173/employee/login |
| Backend API base | http://127.0.0.1:5000/api/v1 |
| Backend health check | http://127.0.0.1:5000/health |

---

## 8. Login and Access

### 8.1 Entry points

| Portal | URL | Credentials |
|--------|-----|-------------|
| Admin Panel | `/login` | Admin email and password |
| Employee Portal | `/employee/login` | Employee email and password |

Both pages also offer "forgot password" (`/forgot-password` and `/employee/forgot-password`) and, for accounts that have linked one, Google sign-in.

### 8.2 Initial access

**No account, email address or password is stored in the repository.** `database/seed_data.sql` creates reference data only. You create the Super Admin yourself with `backend/scripts/provision_accounts.py` (section 5.1, Step 4) and sign in at `/login` with those credentials. After your first sign-in, change the password in Settings.

**Public demo accounts.** For a public demo, the same script can also create two restricted accounts. Set `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` for a Demo Admin (the built-in Read-only role: view and export only), and `DEMO_EMPLOYEE_EMAIL` and `DEMO_EMPLOYEE_PASSWORD` for a Demo Employee (Morning shift, no manager). Both emails must also be listed in `DEMO_ACCOUNT_EMAILS` (in `backend/.env` when you run the script, and on the backend host); the script refuses to create a demo account that would not be restricted, refuses to reuse the Super Admin's email or the other demo account's email, and refuses an email that already belongs to a real admin or employee. Those accounts cannot change passwords, two-step verification, the Google link, their profile or photo, cannot upload files, never receive real email, and are exempt from the per-account login lockout so visitors cannot lock the shared logins for everyone; wrong passwords are still limited per client address. To rotate their passwords, run the script again with `--reset-demo-accounts` (only the password changes, and only for accounts that really are the demo accounts: the Demo Admin by name and role, the Demo Employee by name and its reserved demo phone number). The Super Admin credentials are never shared.

| Demo account | Sign in at | Email | Password |
|--------------|-----------|-------|----------|
| Demo Admin (Read-only) | `/login` | `demo.admin@gmail.com` | `admin@ems2026` |
| Demo Employee | `/employee/login` | `demo.employee@gmail.com` | `employee@ems2026` |

> These credentials are public on purpose, and the accounts are restricted as described above. They work only after the accounts have been created with `backend/scripts/provision_accounts.py` using these same values (see section 5.1).

If a login is locked after repeated failures, wait for `LOGIN_LOCKOUT_MINUTES` or restart the backend; see [Security and Limitations](#13-security-and-limitations).

### 8.3 Creating more accounts

- **Another administrator.** Settings, Users (needs the `users.create` permission, which only Super Admin has by default). The person receives an email with a link to set their password.
- **An employee.** Employees, add a new employee. Creating the record does **not** send anything; use the *Invite* action on the employee list to email the set-password link. The link lasts `INVITE_TOKEN_EXPIRY_HOURS` (24 by default).

Both flows depend on working email settings (`BREVO_API_KEY` and `EMAIL_FROM_ADDRESS`). Without them the email cannot be sent, and the link exists only inside that email, so a new account cannot be activated. Until email is configured, only accounts created with the provisioning script can sign in.

### 8.4 Roles and permissions

| Role | Access |
|------|--------|
| **Super Admin** | Every permission |
| **HR Admin** | Every permission except user management (`users.*`), the activity log and role management (`rbac.manage`) |
| **Read-only** | View and export permissions only |
| *Custom roles* | Created in Settings with any combination of the 74 permissions (needs `rbac.manage`) |

The three built-in roles cannot be renamed or deleted. Permissions are named `module.action`, for example `leave.approve` or `holidays.create`. The backend enforces them on every admin API route. The Admin Panel sidebar lists every module for every admin, and a role that lacks a permission is refused by the API when it tries the action.

Managers need no extra role. Any employee with direct reports automatically sees the **My Team** section.

### 8.5 Two-step verification and Google sign-in

- **Two-step verification is optional** and is switched on per account. Admins use Settings, Security; employees use Settings, Security (two-step verification). Both can scan a QR code with an authenticator app and receive recovery codes. The backend must have `MFA_ENCRYPTION_KEY` set first, otherwise enabling it fails with "MFA_ENCRYPTION_KEY is not configured".
- **Google sign-in** needs the Google variables in both `.env` files. Sign in normally first, link the Google account from Settings, then use "Continue with Google" afterwards. An unlinked Google account is refused, and EMS never links accounts automatically by email address. Administrators with `employees.mfa_reset` or `users.mfa_reset` can reset another user's two-step verification.

---

## 9. Usage Guide

### 9.1 Admin Panel: suggested first-time order

1. **Sign in** at http://localhost:5173/login (see section 8.2).
2. **Set up master data** from the sidebar: *Departments*, *Roles* (job designations), *Grades* and *Shifts*. The seed already provides a few of each.
3. **Add employees.** *Employees*, add a new employee and choose department, role, grade, shift and reporting manager. Then use *Invite* on the employee list so the employee can set a password.
4. **Publish rosters.** *Roster* lets you assign a shift to one employee for one date, or bulk-assign one employee or a whole department over a date range. Bulk assignment skips weekends and holidays and dates that are already scheduled.
5. **Declare holidays.** *Holidays*, **Add Date**. Choose *Holiday* for a weekday on which the office is closed, or *Working Day* for a Saturday or Sunday on which it is open. Use the row's three-dot menu to edit or delete an entry. Every eligible employee is notified of each change.
6. **Review attendance.** *Attendance* shows records by date and employee. You can record an Absent or Half Day entry and correct an existing record; a reason is mandatory and is audited.
7. **Handle leave.** *Leave* lists requests; approve or reject them, and reverse a decision if needed. The same page holds the annual CL and EL quotas.
8. **Assets.** Create *Asset Types* and *Assets*, then assign, return or bulk-assign them. Each asset keeps its assignment history.
9. **Onboarding and offboarding.** Maintain the checklist templates under *Onboarding* and *Offboarding*. Open an employee's profile to start their checklist, tick tasks and complete it. Completing offboarding marks the employee Inactive and archived.
10. **Performance and training.** Create cycles under *Review Cycles*, then create and submit each review from the employee profile. Under *Training Programs*, create programs and assign them to everyone, or assign them individually from the employee profile.
11. **Settings.** Manage your profile, password, two-step verification, Google link, administrator accounts, roles and permissions, and read the activity log.
12. **Archived items.** Deleting removes a record from normal lists without destroying it. An archived record can be restored, or permanently deleted as a separate action.

### 9.2 Employee Portal

1. Sign in at http://localhost:5173/employee/login. First-time users open the link in their invitation email to set a password.
2. The **Dashboard** shows today's schedule and attendance. Use **Check In** and **Check Out**. On a holiday or weekend the dashboard shows a day-off status, and you can still check in if you are working.
3. **My Attendance** shows the summary and the history. Weekends and holidays appear as their own rows, alongside any absences, late arrivals, half days and leave.
4. **My Leave**: choose a leave type (CL or EL), the dates, full or half day, and a reason, then submit. You can cancel a request while it is pending. The balance excludes weekends and holidays.
5. **Holidays** shows a month calendar and the year's list.
6. **My Documents**, **My Training** and **My Profile** let you upload documents, upload training certificates and mark training complete, and update your details and photo.
7. **Settings**, Security: turn on two-step verification, link Google, or change your password.
8. The bell icon opens your notifications.

### 9.3 Managers (My Team)

An employee with direct reports sees the **My Team** section in the sidebar. From there you can view the team, review team attendance and exceptions, approve or reject **Team Leave**, create and submit reviews under **Team Performance**, and assign training under **Team Training**.

---

## 10. API Documentation

The backend exposes 222 route handlers under **`/api/v1`**, plus an unprefixed `GET /health`. The tables below summarise them by area. The full list is in the files under [`backend/routes/`](backend/routes/).

**Conventions**

- Send `Authorization: Bearer <token>`. Admin routes need an admin token and `/employee/...` and `/manager/...` routes need an employee token; the two are not interchangeable.
- Successful JSON responses are `{ "success": true, "message": "...", "data": ... }` and errors are `{ "success": false, "message": "...", "errors": { ... } }`. `GET /health`, file downloads and the CSV export are the exceptions.
- Lists accept `page` and `pageSize`.
- A guard of `perm` means the admin must hold that permission. `admin` means any signed-in admin and `employee` means any active employee.

### 10.1 Authentication and accounts

| Route | Purpose | Guard |
|-------|---------|-------|
| `POST /login` | Admin login; may return a pending token when two-step verification is on | public |
| `POST /mfa/verify`, `POST /mfa/verify-recovery`, `POST /mfa/setup/verify` | Complete an admin login with an authenticator or recovery code | public |
| `POST /auth/google/callback` | Admin Google sign-in (linked accounts only) | public |
| `POST /forgot-password`, `GET /validate-token`, `POST /set-password` | Admin password reset and account activation | public |
| `POST /employee/login`, `/employee/mfa/verify`, `/employee/mfa/verify-recovery`, `/employee/google/callback` | Employee login flow | public |
| `POST /employee/forgot-password`, `GET /employee/validate-token`, `POST /employee/set-password` | Employee password reset and activation | public |
| `POST /employees/<id>/invite` | Email a set-password invitation | `employees.update` |
| `GET, PUT /employee/me`; `GET, POST, DELETE /employee/me/photo` | Own profile and photo | employee |
| `GET /employee/settings/security`, `POST /employee/settings/mfa/setup/start`, `POST /employee/settings/mfa/setup/confirm`, `POST /employee/settings/mfa/disable`, `POST /employee/settings/google/link`, `PUT /employee/settings/change-password` | Employee security settings | employee |

### 10.2 Admin settings, users and permissions

| Route | Purpose | Guard |
|-------|---------|-------|
| `PUT /settings/profile`, `PUT /settings/change-password`, `GET /settings/security` | Own profile and password | admin |
| `POST /settings/mfa/setup/start`, `POST /settings/mfa/setup/confirm`, `POST /settings/mfa/disable`, `POST /settings/mfa/recovery-codes/setup`, `POST /settings/mfa/reenroll/start`, `POST /settings/mfa/reenroll/confirm`, `POST /settings/google/link` | Own two-step verification and Google link | admin |
| `GET, POST /settings/users`, `PUT, DELETE /settings/users/<id>`, `PUT /settings/users/<id>/mfa/reset` | Administrator accounts | `users.*` |
| `GET /settings/activity-log` | Audit log | `activity_log.view` |
| `GET /admin-roles` | List admin roles | `users.view` |
| `GET /permissions`, `POST /admin-roles`, `GET, PUT, DELETE /admin-roles/<id>` | Permission catalogue and role management | `rbac.manage` |
| `GET /dashboard/summary`, `/dashboard/charts`, `/dashboard/upcoming-events` | Dashboard data | admin |
| `GET /dashboard/leave-summary` | Leave summary | `leave.view` |

### 10.3 Organisation data

Departments, Roles, Grades, Shifts and Asset Types share one pattern. For `/departments`, `/roles`, `/grades`, `/shifts` and `/asset-types`:

| Route | Purpose | Permission |
|-------|---------|------------|
| `GET /<resource>` and `GET /<resource>/<id>` | List and detail | `<module>.view` |
| `POST /<resource>` | Create | `<module>.create` |
| `PUT /<resource>/<id>` | Update | `<module>.update` |
| `DELETE /<resource>/<id>` | Archive | `<module>.archive` |
| `PUT /<resource>/<id>/restore` | Restore | `<module>.restore` |
| `DELETE /<resource>/<id>/permanent` | Delete permanently | `<module>.delete` |

The module is `departments`, `roles`, `grades`, `shifts` or `asset` (asset types).

| Route | Purpose | Guard |
|-------|---------|-------|
| `GET, POST /employees`; `GET, PUT /employees/<id>` | List, create, read and update employees | `employees.view` / `create` / `update` |
| `GET /employees/export` | CSV export (`employees.csv`) | `employees.export` |
| `GET /employees/<id>/direct-reports`, `GET /employees/<id>/manager-chain` | Reporting lines | `employees.view` |
| `DELETE /employees/<id>`; `PUT /employees/<id>/restore`; `DELETE /employees/<id>/permanent` | Archive, restore, delete permanently | `employees.archive` / `restore` / `delete` |
| `PUT /employees/<id>/mfa/reset` | Reset an employee's two-step verification | `employees.mfa_reset` |
| `GET, POST /employees/<id>/documents`; `GET /documents/<id>/download`; `DELETE /documents/<id>` | Employee documents | `documents.view` / `upload` / `delete` |

### 10.4 Rosters, attendance and holidays

| Route | Purpose | Guard |
|-------|---------|-------|
| `GET, POST /roster`; `PUT, DELETE /roster/<id>`; `POST /roster/bulk` | Roster entries and bulk assignment | `roster.view` / `create` / `update` / `delete` |
| `GET /attendance`; `POST /attendance`; `PUT /attendance/<id>` | List, record and correct attendance | `attendance.view` / `create` / `update` |
| `GET, POST /holidays`; `PUT, DELETE /holidays/<id>` | Office holidays and working-day overrides | `holidays.view` / `create` / `update` / `delete` |
| `GET /calendar/days` | Weekend, holiday and working-day information for a date range | admin |
| `GET /employee/holidays` | Holiday calendar for the employee portal | employee |
| `POST /employee/attendance/check-in`, `POST /employee/attendance/check-out`; `GET /employee/attendance`, `GET /employee/attendance/today`, `GET /employee/attendance/summary` | Own attendance | employee |
| `GET /employee/roster/today` | Own schedule for today | employee |
| `GET /manager/team/attendance`, `GET /manager/team/attendance/summary`, `GET /manager/team/attendance/exceptions` | Team attendance | employee (managers) |

### 10.5 Leave

| Route | Purpose | Guard |
|-------|---------|-------|
| `GET /leave`; `PUT /leave/<id>/approve`, `PUT /leave/<id>/reject` | List requests; approve, reject or reverse a decision | `leave.view` / `leave.approve` |
| `GET, PUT /leave/quotas` | Annual CL and EL quotas | `leave.view` / `leave.update` |
| `POST /leave`, `PUT /leave/<id>` | Disabled by design: admins cannot create or edit a leave request for an employee (returns 403) | `leave.create` / `leave.update` |
| `POST, GET /employee/leave`; `GET /employee/leave/balance`; `PUT /employee/leave/<id>/cancel` | Apply, list, balance and cancel | employee |
| `GET /manager/team/leave`; `PUT /manager/team/leave/<id>/approve`, `PUT /manager/team/leave/<id>/reject` | Team approvals | employee (managers) |

### 10.6 Assets, onboarding, offboarding

| Route | Purpose | Guard |
|-------|---------|-------|
| `GET, POST /assets`; `GET, PUT /assets/<id>`; `GET /assets/<id>/history` | Assets and their history | `asset.view` / `create` / `update` |
| `DELETE /assets/<id>`; `PUT /assets/<id>/restore`; `DELETE /assets/<id>/permanent` | Archive, restore, delete permanently | `asset.archive` / `restore` / `delete` |
| `POST /assets/<id>/assign`, `POST /assets/<id>/return`; `POST /assets/bulk-assign` | Assign and return | `asset.assign` / `asset.return` |
| `GET /employee/assets` | Own assets | employee |
| `/onboarding-items` and `/offboarding-items` (list, create, update, archive, restore, delete permanently) | Checklist templates | `onboarding.*` / `offboarding.*` |
| `GET /employees/<id>/onboarding`; `POST /employees/<id>/onboarding/start`; `PUT /employees/<id>/onboarding/tasks/<task_id>`; `PUT /employees/<id>/onboarding/complete` | An employee's onboarding | `onboarding.view` / `manage` |
| The same four routes under `/employees/<id>/offboarding` | An employee's offboarding; completing it deactivates and archives the employee | `offboarding.view` / `manage` / `complete` |

### 10.7 Performance and training

| Route | Purpose | Guard |
|-------|---------|-------|
| `/review-cycles` (list, create, update, archive, restore, delete permanently) | Review cycles | `performance.view` / `manage` |
| `GET, POST /employees/<id>/performance-reviews`; `PUT /performance-reviews/<id>`, `PUT /performance-reviews/<id>/submit` | Reviews | `performance.view` / `manage` |
| `GET /manager/review-cycles`; `GET /manager/team/performance-reviews`; `POST /manager/team/employees/<id>/performance-reviews`; `PUT /manager/team/performance-reviews/<id>`, `PUT /manager/team/performance-reviews/<id>/submit`; `DELETE /manager/team/performance-reviews/<id>` | Reviews written by managers | employee (managers) |
| `GET /employee/performance-reviews` | Own reviews | employee |
| `/training-programs` (list, create, update, archive, restore, delete permanently); `POST /training-programs/<id>/assign-all` | Training programs | `training.view` / `manage` |
| `GET, POST /employees/<id>/training-records`; `PUT /training-records/<id>/complete` | Individual training records | `training.view` / `manage` |
| `GET /manager/training-programs`; `GET /manager/team/training-records`; `POST /manager/team/employees/<id>/training-records`; `PUT /manager/team/training-records/<id>/complete` | Team training | employee (managers) |
| `GET /employee/training-records`; `POST /employee/training-records/<id>/certificate`, `POST /employee/training-records/<id>/complete` | Own training | employee |

### 10.8 Employee portal, manager and notifications

| Route | Purpose | Guard |
|-------|---------|-------|
| `GET /employee/dashboard` | Employee dashboard data | employee |
| `GET, POST /employee/documents`; `GET /employee/documents/<id>/download` | Own documents | employee |
| `GET /manager/team`, `/manager/team/<id>`, `/manager/team/shifts`; `GET /manager/team/documents/<id>/download` | Team members | employee (managers) |
| `GET /employee/notifications`, `GET /employee/notifications/unread-count`; `PUT /employee/notifications/<id>/read`, `PUT /employee/notifications/mark-all-read` | Employee notifications | employee |
| `GET /admin/notifications`, `GET /admin/notifications/unread-count`; `PUT /admin/notifications/<id>/read`, `PUT /admin/notifications/mark-all-read` | Admin notifications | admin |

---

## 11. Testing and Troubleshooting

### 11.1 Checking your installation

The repository contains no automated tests. To check that an installation works:

- `GET /health` confirms the backend can reach the database.
- `npm run build` in `frontend/` confirms the frontend compiles.

### 11.2 Common problems

| Symptom | Likely cause and fix |
|---------|----------------------|
| `Database connection failed` in the backend console, or `/health` returns 500 | MySQL is not running, or `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` or `DB_NAME` in `backend/.env` is wrong, or the database has not been created. Run the steps in section 5 |
| `Access denied for user` | Wrong `DB_USER` or `DB_PASSWORD` in `backend/.env` |
| `Unknown database 'EMPLOYEE_MS'` | `schema.sql` has not been run, or `DB_NAME` does not match the database you created |
| `Table ... already exists` or `Duplicate entry` when running the SQL | The file was already run. Run each file once; to start over, drop the database (section 5.1) |
| PowerShell reports that `<` is reserved | PowerShell has no `<` redirection. Use `Get-Content file.sql \| mysql -u root -p`, or Workbench (section 5.1) |
| `mysql` is not recognised | Add the MySQL `bin` folder to your `PATH`, or use MySQL Workbench |
| `ModuleNotFoundError` when starting the backend | The virtual environment is not active, or `pip install -r requirements.txt` was not run inside it |
| The login page shows a network error or nothing loads | The backend is not running on `127.0.0.1:5000`, or `VITE_API_BASE_URL` points somewhere else (section 6.2). On a deployed site the free backend may be waking up and the first request can take about a minute |
| Port 5173 is in use and Vite starts on another port | Free port 5173. Google sign-in and email links assume 5173 |
| `Account not yet activated. Please check your email to set your password.` | The admin account has no password yet. Follow section 8.2 or 8.3 |
| Invitation or reset emails never arrive | `BREVO_API_KEY` or `EMAIL_FROM_ADDRESS` is missing, or the sender address is not verified in Brevo. The backend console prints `Failed to send email to ...` with the reason. Also check the Brevo logs and your spam folder: mail sent from a free-mail address such as Gmail often lands in spam |
| `Too many failed login attempts` | Wait `LOGIN_LOCKOUT_MINUTES`, or restart the backend; the counter is kept in memory |
| `Too many requests from your network` (HTTP 429) | The per-address limit for failed logins or forgot-password requests was reached. Wait for the time in the `Retry-After` header (up to `IP_RATE_LIMIT_WINDOW_MINUTES`). If every visitor is limited at once on a deployed site, `TRUSTED_PROXY_COUNT` is too small (section 14.5) |
| The backend exits with `Invalid production configuration` | On Render the backend refuses to start with missing or insecure settings. The message lists every problem; fix them using the list at the top of `backend/.env.example` |
| Turning on two-step verification fails with `MFA_ENCRYPTION_KEY is not configured` | Set a Fernet key in `backend/.env` (section 6.1) and restart the backend |
| Google sign-in says the account is not linked | Sign in with a password first and link Google in Settings. EMS never links accounts automatically |
| Cannot sign in after setting up the database | The seed creates no accounts. Run `python scripts/provision_accounts.py` (section 5.1, Step 4) |
| A new employee cannot sign in | Creating the employee does not send an invitation. Use *Invite* on the employee list, or see section 8.2 |

---

## 12. Repository Structure

```
.
├── README.md
├── .gitignore
├── backend/
│   ├── app.py                          Flask app, blueprint registration, /health
│   ├── requirements.txt                pinned Python dependencies
│   ├── .env.example                    backend configuration template
│   ├── config/settings.py              reads every environment variable
│   ├── database/connection.py          MySQL connection helper (TLS and time zone options)
│   ├── scripts/provision_accounts.py   creates the Super Admin and public demo accounts (create-only; explicit --reset options)
│   ├── routes/                         one file per module (24 files), described in section 10
│   ├── utils/
│   │   ├── auth_helper.py              require_auth, require_permission, require_employee_auth
│   │   ├── token_helper.py             invitation and reset tokens
│   │   ├── mfa_helper.py               two-step verification
│   │   ├── google_oauth_helper.py      Google sign-in
│   │   ├── password_helper.py          password policy
│   │   ├── login_attempts.py           lockout tracking
│   │   ├── audit_helper.py             activity log writer
│   │   ├── notification_helper.py      in-app notifications
│   │   ├── calendar_helper.py          working-day and holiday rules
│   │   ├── attendance_audit_helper.py  tells automatic attendance rows from manual ones
│   │   ├── validation_helper.py        request value validation
│   │   ├── response_helpers.py         response format
│   │   ├── storage_helper.py           file storage (local disk or S3-compatible bucket; keys validated)
│   │   ├── rate_limiter.py             per-address limits for login and forgot-password
│   │   ├── code_helper.py              sequential record codes (EMP0001 ...) with retry on collision
│   │   └── email_sender.py             email through the Brevo HTTPS API
│   └── uploads/                        uploaded files (created at runtime, not committed)
├── database/
│   ├── schema.sql                      database and tables
│   └── seed_data.sql                   reference data only (no accounts or passwords)
└── frontend/
    ├── package.json                    scripts: dev, build, preview
    ├── vite.config.js
    ├── .env.example                    frontend configuration template
    ├── index.html
    └── src/
        ├── main.jsx, App.jsx           entry point and the two route trees
        ├── routes/                     route definitions and route guards
        ├── context/                    admin and employee authentication state
        ├── hooks/                      authentication hooks (useAuth, useEmployeeAuth)
        ├── services/api/               one API module per area
        ├── utils/                      permission check, validators, notification events, Google OAuth helper
        ├── components/common/          shared UI components
        ├── components/layout/          sidebars, top bars and page layouts
        └── features/                   one folder per module (pages and components)
```

---

## 13. Security and Limitations

### 13.1 Security measures in place

- Passwords are stored as salted hashes. Password hashes and authenticator secrets are not included in the employee and administrator account data that the API returns.
- Admin and employee tokens use different secrets and expire.
- Invitation and reset tokens are stored only as hashes and expire. The password-reset response does not reveal whether an email address exists.
- Repeated failed logins lock an email address for a period.
- Authenticator secrets are stored encrypted.
- Database queries pass values as parameters (`%s` placeholders) instead of building SQL from request data.
- Admin API routes are permission-checked on the server, not only in the interface.
- Uploads are restricted by file extension and size. Employees who are archived or Inactive are refused at login and on every request.
- Administrative actions are written to an audit log.
- `.env` files are excluded from version control.
- Uploaded files are kept in a private bucket in production and are served only through permission-checked API routes.
- Public demo accounts (`DEMO_ACCOUNT_EMAILS`) are blocked from password, two-step verification, Google-link, profile and upload changes, and never receive real email.

### 13.2 Configuration warnings

- Set your own `SECRET_KEY`, `JWT_SECRET_KEY` and `EMPLOYEE_JWT_SECRET_KEY`. The fallback values are public.
- Keep `DEBUG` set to `False` outside local development.
- Never commit a `.env` file or share real keys, passwords or tokens.
- `seed_data.sql` contains no accounts or secrets. Create accounts with `backend/scripts/provision_accounts.py` and keep their passwords out of version control (remove them from `.env` after use).

### 13.3 Limitations

- **Deployment.** Gunicorn is the production server (section 14); there is no Dockerfile. HTTPS is provided by the hosting platform.
- **CORS** only allows the origins listed in `CORS_ALLOWED_ORIGINS` (by default the local Vite dev server).
- **Tokens are kept in `localStorage`**, which is readable by any script running on the page.
- **The frontend API address** is set at build time with `VITE_API_BASE_URL` (default for local development: `http://127.0.0.1:5000/api/v1`).
- **Login lockout and per-address limits are in memory.** They are per backend process and reset when the backend restarts, so the backend must run as a single process (one Gunicorn worker). The per-account lockout does not apply to the public demo accounts; the per-address limits (`IP_LOGIN_MAX_FAILURES`, `IP_FORGOT_PASSWORD_MAX`) apply to everyone, and the client address is read from `X-Forwarded-For` only for the `TRUSTED_PROXY_COUNT` proxies you configure.
- **Two-step verification is not forced for any role.** It applies only to accounts that switch it on.
- **The admin sidebar is not filtered by permission.** Every admin sees every module, and the server refuses actions their role lacks.
- **Accounts need email.** Activating new accounts and resetting passwords depend on Brevo being configured.
- **Automatic absences skip weekends and holidays.** An employee who is rostered for a holiday or weekend but does not check in is not marked Absent automatically.
- **History window.** Employee and manager attendance views show the current and previous calendar month. Older records are kept in the database.
- **Leave types.** Only Casual Leave and Earned Leave exist, with one global annual quota each.
- **Uploaded files** live on local disk in `backend/uploads/` by default, or in the configured bucket with `STORAGE_BACKEND=s3`. The application does not back them up.
- **Database changes are plain SQL files.** There is no migration framework, so an existing database has to be upgraded by hand.
- **Testing.** The repository contains no automated tests.

---

## 14. Deploying as a Free Demo

This section describes the setup used for a free portfolio demo: the frontend and the Flask backend on Render, MySQL on Aiven, uploaded files in a private Supabase Storage bucket, and email through Brevo. It needs no custom domain and no payment card. Free tiers have limits; read [14.8](#148-what-to-expect-on-free-tiers) first.

### 14.1 What runs where

| Part | Service | Notes |
|------|---------|-------|
| Frontend | Render Static Site | One build serves both portals: `/login` (admin) and `/employee/login` |
| Backend | Render Web Service, Free plan | Gunicorn, with `backend` as the root directory |
| Database | Aiven for MySQL, Free plan | Requires TLS |
| Uploaded files | Supabase Storage, private bucket | Used through its S3-compatible API (`STORAGE_BACKEND=s3`). Render's disk is wiped on every restart |
| Email | Brevo transactional email API | Sent over HTTPS, because Render blocks outbound SMTP ports |

### 14.2 Database (Aiven)

1. Create an Aiven account and a MySQL service on the **Free** plan (not a trial plan).
2. Note the host, port, user and password, and download the service's CA certificate from the Aiven console. Save it as `backend/certs/aiven-ca.pem` and set `DB_SSL_CA=certs/aiven-ca.pem`. A CA certificate is public, so it can be committed, **but check the file first**: it must contain only `-----BEGIN CERTIFICATE-----` blocks and no private key. For example, `grep -c "PRIVATE KEY" backend/certs/aiven-ca.pem` must print `0` (the backend also refuses to start on Render if the file contains a private key or no certificate).
3. Decide the database name, then load the SQL files with TLS, in this order: `database/schema.sql`, then `database/seed_data.sql` (for example `mysql --ssl-ca=backend/certs/aiven-ca.pem -h HOST -P PORT -u avnadmin -p < database/schema.sql`). Both files are written for a database called `EMPLOYEE_MS`: `schema.sql` begins with `CREATE DATABASE IF NOT EXISTS EMPLOYEE_MS;` and `USE EMPLOYEE_MS;`, and `seed_data.sql` begins with `USE EMPLOYEE_MS;`. **Option A - keep `EMPLOYEE_MS`** (works if your Aiven user may create databases): run the files unchanged and set `DB_NAME=EMPLOYEE_MS`. **Option B - use the database Aiven created for you** (usually `defaultdb`): in your local copy of **both** files, delete the `CREATE DATABASE` line in `schema.sql` and change `USE EMPLOYEE_MS;` to `USE defaultdb;` in `schema.sql` and in `seed_data.sql`, and set `DB_NAME=defaultdb`. If you only change `DB_NAME`, the `USE` line still sends the tables to `EMPLOYEE_MS` (or fails), and the backend then looks in the wrong database.
4. Create the accounts: put the Aiven `DB_*` values, `DB_SSL_CA`, the `SUPER_ADMIN_*` and `DEMO_*` variables and `DEMO_ACCOUNT_EMAILS` (section 8.2) in `backend/.env`, run `python scripts/provision_accounts.py` from `backend/`, then remove the passwords from `.env`. Each account is created independently, and an account that already exists is left untouched unless you add `--reset-super-admin` or `--reset-demo-accounts`.

### 14.3 File storage (Supabase)

1. Create a Supabase project, then a Storage bucket (for example `ems-uploads`) that is **private**.
2. In the project's Storage settings, create S3 access keys and note the S3 endpoint (`https://<project_ref>.storage.supabase.co/storage/v1/s3`) and region.
3. Set `STORAGE_BACKEND=s3`, `S3_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` on the backend. Files are never served straight from the bucket; the API checks permissions and streams them.

### 14.4 Email (Brevo)

1. Create a Brevo account and verify a sender address; use it as `EMAIL_FROM_ADDRESS`.
2. Create an API key and use it as `BREVO_API_KEY`.
3. Mail sent from a free-mail address (for example Gmail) cannot be authenticated by Brevo and often lands in spam. Test delivery with your own inboxes.

### 14.5 Backend (Render Web Service)

| Setting | Value |
|---------|-------|
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn app:app --workers 1 --threads 4 --timeout 120` |
| Health Check Path | `/health` |
| Instance type | Free |

Use **one** worker: the login lockout counters, the per-address rate limits and the one-time two-step-verification tokens are kept in process memory.

Environment variables: `PYTHON_VERSION=3.13.7`, `TZ=Asia/Kolkata`, `DB_TIMEZONE_OFFSET=+05:30`, the `DB_*` values and `DB_SSL_CA`, three different random values of at least 32 characters for `SECRET_KEY`, `JWT_SECRET_KEY` and `EMPLOYEE_JWT_SECRET_KEY`, `DEBUG=False`, `MFA_ENCRYPTION_KEY`, the Google variables, `FRONTEND_BASE_URL` (the static site's `https://` URL with no trailing slash), `CORS_ALLOWED_ORIGINS` (the same URL), `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, the storage variables from 14.3 (including `S3_REGION`), `TRUSTED_PROXY_COUNT`, and `DEMO_ACCOUNT_EMAILS`. Render sets `RENDER=true` automatically, and the backend then refuses to start, listing every problem, unless all of these are valid: the secrets, `DEBUG`, a valid Fernet `MFA_ENCRYPTION_KEY`, a non-local `DB_HOST` with a password and a certificate-only `DB_SSL_CA`, `DB_TIMEZONE_OFFSET` together with a matching `TZ`, complete S3 settings, Brevo settings, an `https` `FRONTEND_BASE_URL` and `CORS_ALLOWED_ORIGINS` (no wildcard, no localhost, including the frontend URL), and `TRUSTED_PROXY_COUNT` of 1 or more.

**Client address and `TRUSTED_PROXY_COUNT`.** Render puts one or more proxies in front of the backend, so the backend's socket address belongs to Render, not to the visitor. `TRUSTED_PROXY_COUNT` is the number of proxies that append to `X-Forwarded-For`. The backend then takes the visitor's address that many entries from the **right** of that header and never uses entries further left, because a visitor can forge those. If the header has fewer entries than the count, the backend falls back to the socket address.

**There is no number to copy.** The value depends on the proxies Render places in front of your service, other projects report their own observations, and the chain can change. Establish it for your own service with Steps A to C, and repeat them after any Render infrastructure change or if every visitor suddenly gets HTTP 429.

**Step A - read the real header.** Temporarily add request-header logging to the start command, so each request prints the `X-Forwarded-For` value Render passes to the backend: append `--access-logfile - --access-logformat '%({x-forwarded-for}i)s'` and redeploy (Gunicorn prints any request header with `%({header-name}i)s`). Look up your own public IP address (search for "what is my IP"), open the site from that device, and read the log line. Count the entries **from the right**, up to and including your own public IP: that count is the number of proxies. Everything to the left of your IP is untrusted. Do this from at least two different networks (for example home broadband and mobile data). If the counts differ, use the **smaller** one: a value that is too small only makes some visitors share a limit, while a value that is too large lets visitors forge their address. Remove the logging options afterwards, because the logs contain visitors' addresses.

**Step B - set the value.** Set `TRUSTED_PROXY_COUNT` to the number from Step A and redeploy.

**Step C - test the behaviour.** Use an email address that does not exist, never a real account: real accounts also have the per-account lockout (a different message) and could be locked out. Replace `<backend>` with your backend address:

```bash
curl -i -X POST https://<backend>/api/v1/login -H "Content-Type: application/json" -d '{"email":"nobody-limit-test@example.invalid","password":"Wrong1!x"}'
```

1. **The limit works.** Send `IP_LOGIN_MAX_FAILURES` failed logins (default 20) from your own connection. The next request must return HTTP 429 with a `Retry-After` header.
2. **Visitors are not lumped together (value too small).** While that limit is still active (default window 15 minutes), send the same request from a different network, for example your phone on mobile data. It must return a normal 401. A 429 means the value is too small and all visitors share one limit. A single pass does not prove the value is right when it is only one too small, because the shared address may differ by location; Step A is the authoritative check.
3. **Forged addresses cannot dodge the limit (value too large).** Within the same window, from your own limited connection, send the same request with a forged header added: `-H "X-Forwarded-For: 203.0.113.10"`. The **first** forged request must already return 429. Repeat with other forged values (`203.0.113.11`, `203.0.113.12`) and with several forged entries (`-H "X-Forwarded-For: 203.0.113.20, 203.0.113.21"`). Every one must return 429. A 401 means the forged entry was used as the visitor's address: the value is too large, so lower it and start again at Step A. This is the dangerous direction. With a value that is too large, honest visitors fall back to the shared proxy address, but anyone who adds their own `X-Forwarded-For` entries can choose their own address and avoid the limit.

### 14.6 Frontend (Render Static Site)

| Setting | Value |
|---------|-------|
| Root Directory | `frontend` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |
| Rewrite rule | Source `/*`, destination `/index.html`, action Rewrite |

The rewrite rule is needed because the app uses client-side routing and emailed links such as `/employee/set-password?token=...` are opened directly. Set `NODE_VERSION` to 18 or newer (for example 20), `VITE_API_BASE_URL=https://<your-backend>.onrender.com/api/v1`, and, for Google sign-in, `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_REDIRECT_URI=https://<your-site>.onrender.com/auth/google/callback`.

The two services need each other's URLs: create both first, then set the URL-dependent variables (`FRONTEND_BASE_URL`, `CORS_ALLOWED_ORIGINS`, `VITE_API_BASE_URL`) and redeploy.

### 14.7 Google sign-in and two-step verification

- In Google Cloud, create a Web OAuth client and register `https://<your-site>.onrender.com/auth/google/callback` (and the localhost address for development) as a redirect URI. The app requests only `openid email profile`. Use the same URI in `GOOGLE_REDIRECT_URI` and `VITE_GOOGLE_REDIRECT_URI`.
- Google sign-in works only for accounts that have linked a Google account in Settings, so it is meant for the Super Admin, not for public visitors.
- Set `MFA_ENCRYPTION_KEY` and keep a backup of it. Enable two-step verification for the Super Admin after the first sign-in and store the recovery codes. The public demo accounts keep it off.

### 14.8 What to expect on free tiers

- The free Render backend sleeps after about 15 minutes without traffic; the first request afterwards can take about a minute.
- Aiven's free MySQL can be powered off after a period of inactivity; restart it from the Aiven console.
- Supabase free projects are paused after a week of inactivity; uploaded files are unavailable until the project is restored.
- Brevo's free plan has a daily sending limit, and mail from a free-mail sender may land in spam.
- The login lockout counter resets whenever the backend restarts or wakes up.
- Keep real personal data out of a public demo: the Demo Admin can view every employee record in the database.

### 14.9 Checking the deployment

1. `https://<backend>/health` reports a healthy database.
2. The Super Admin, Demo Admin and Demo Employee can each sign in; the demo accounts get "disabled for the public demo account" on password, profile and upload actions.
3. Per-address limits: follow Steps A to C in section 14.5, and confirm that repeated wrong passwords on a demo account never show the account-lockout message.
4. Upload a document and a profile photo, redeploy the backend, and download them again.
5. Compare a check-in time and an activity-log time with the clock in India Standard Time.
6. Send an invitation and a password reset to your own inboxes (also check the spam folder).
7. Link Google and enable two-step verification for the Super Admin, then sign in with each.
8. Create and edit an asset, to confirm the Assets module works on your MySQL version.