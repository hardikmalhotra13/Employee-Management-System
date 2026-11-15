import os
import re
from dotenv import load_dotenv

load_dotenv()

# Database Configuration
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", 3306))
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "EMPLOYEE_MS")

# Optional TLS for the database connection (required by hosted databases such
# as Aiven). Path to the CA certificate file; leave empty for a local MySQL.
DB_SSL_CA = os.getenv("DB_SSL_CA", "")

# MySQL session time zone as a UTC offset, applied to every connection so SQL
# NOW()/CURDATE()/CURRENT_TIMESTAMP agree with the application's local time.
# Leave empty to use the database server's own time zone (local development).
# Pair this with the TZ environment variable (e.g. TZ=Asia/Kolkata) on the host.
DB_TIMEZONE_OFFSET = os.getenv("DB_TIMEZONE_OFFSET", "")
# MySQL accepts offsets from -13:59 to +14:00.
if DB_TIMEZONE_OFFSET and not re.fullmatch(r"(\+(0\d|1[0-3]):[0-5]\d|\+14:00|-(0\d|1[0-2]):[0-5]\d|-13:[0-5]\d)", DB_TIMEZONE_OFFSET):
    raise ValueError("DB_TIMEZONE_OFFSET must look like +05:30 or -08:00 (range -13:59 to +14:00)")

# Application Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
DEBUG = os.getenv("DEBUG", "False").lower() == "true"

# JWT Configuration
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-key")
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", 24))

# Separate secret for employee self-service tokens, so an employee token
# can never be decoded as an admin token (or vice versa) even if both
# happened to carry a similar payload shape.
EMPLOYEE_JWT_SECRET_KEY = os.getenv("EMPLOYEE_JWT_SECRET_KEY", "dev-employee-jwt-secret-key")

# Employee JWT secret is defined above with the rest of JWT config

# Google OIDC Configuration (Admin SSO - Authorization Code flow with PKCE)
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "")
GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration"

# MFA (TOTP) Configuration
# MFA_ENCRYPTION_KEY must be a urlsafe-base64-encoded 32-byte key (Fernet format).
# Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
MFA_ENCRYPTION_KEY = os.getenv("MFA_ENCRYPTION_KEY", "")
MFA_ISSUER_NAME = os.getenv("MFA_ISSUER_NAME", "Employee MS")

# Login Security Configuration
LOGIN_MAX_ATTEMPTS = int(os.getenv("LOGIN_MAX_ATTEMPTS", 5))
LOGIN_LOCKOUT_MINUTES = int(os.getenv("LOGIN_LOCKOUT_MINUTES", 15))

# Per-IP abuse protection for login and forgot-password requests. This is in
# addition to the per-account lockout above (which the public demo accounts are
# exempt from, so visitors cannot lock them for everyone).
IP_LOGIN_MAX_FAILURES = int(os.getenv("IP_LOGIN_MAX_FAILURES", 20))
IP_FORGOT_PASSWORD_MAX = int(os.getenv("IP_FORGOT_PASSWORD_MAX", 5))
IP_RATE_LIMIT_WINDOW_MINUTES = int(os.getenv("IP_RATE_LIMIT_WINDOW_MINUTES", 15))

# Number of reverse proxies in front of this app that each append the address
# they received the request from to X-Forwarded-For. The client address is then
# read that many entries from the RIGHT of the header (entries further left can
# be forged by the client and are never used). 0 = trust no forwarded headers
# and use the socket address - correct when the app is reached directly.
TRUSTED_PROXY_COUNT = int(os.getenv("TRUSTED_PROXY_COUNT", 0))

if not 0 <= TRUSTED_PROXY_COUNT <= 10:
    raise ValueError("TRUSTED_PROXY_COUNT must be between 0 and 10")
if min(IP_LOGIN_MAX_FAILURES, IP_FORGOT_PASSWORD_MAX, IP_RATE_LIMIT_WINDOW_MINUTES) < 1:
    raise ValueError("IP_LOGIN_MAX_FAILURES, IP_FORGOT_PASSWORD_MAX and IP_RATE_LIMIT_WINDOW_MINUTES must be at least 1")

# Password Policy Configuration
PASSWORD_MIN_LENGTH = int(os.getenv("PASSWORD_MIN_LENGTH", 8))

# Password Reset / Invite Token Configuration
INVITE_TOKEN_EXPIRY_HOURS = int(os.getenv("INVITE_TOKEN_EXPIRY_HOURS", 24))
RESET_TOKEN_EXPIRY_HOURS = int(os.getenv("RESET_TOKEN_EXPIRY_HOURS", 1))

# Email Configuration (Brevo transactional email HTTP API)
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "")
EMAIL_FROM_ADDRESS = os.getenv("EMAIL_FROM_ADDRESS", "")
EMAIL_FROM_NAME = os.getenv("EMAIL_FROM_NAME", "Employee Management System")

# Frontend Configuration
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173")

# CORS: comma-separated list of browser origins allowed to call the API.
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]

# Demo accounts: comma-separated emails of the public demo logins. These accounts
# are blocked from self-service changes (password, MFA, Google link, profile,
# uploads) and never receive real emails.
DEMO_ACCOUNT_EMAILS = {
    email.strip().lower()
    for email in os.getenv("DEMO_ACCOUNT_EMAILS", "").split(",")
    if email.strip()
}

# File Storage Configuration
# "local" keeps uploads on this machine's disk (local development).
# "s3" stores them in an S3-compatible bucket (production - e.g. Supabase Storage),
# because hosts like Render have an ephemeral filesystem.
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "")
S3_REGION = os.getenv("S3_REGION", "")
S3_BUCKET = os.getenv("S3_BUCKET", "")
S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID", "")
S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY", "")

# Employee Document Upload Configuration
UPLOAD_FOLDER = os.getenv(
    "UPLOAD_FOLDER",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
)
MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_DOCUMENT_EXTENSIONS = ("pdf", "jpg", "jpeg", "png")

# Employee Profile Photo Upload Configuration
MAX_PHOTO_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB
ALLOWED_PHOTO_EXTENSIONS = ("jpg", "jpeg", "png")


# ---------------------------------------------------------------------
# Production safety check
# ---------------------------------------------------------------------
# Render sets RENDER=true on every service. On Render the app refuses to start
# with development secrets or with incomplete/insecure settings, instead of
# running insecurely, silently losing data or sending broken emailed links.
# Local development (RENDER not set) is not affected.
if os.getenv("RENDER", "").lower() == "true":
    from datetime import datetime, timedelta
    from urllib.parse import urlparse

    _problems = []
    _local_names = ("localhost", "127.0.0.1", "0.0.0.0", "::1")

    def _origin_problem(value, name):
        """Returns a problem text unless value is a bare https origin like https://host."""
        parsed = urlparse(value or "")
        if parsed.scheme != "https" or not parsed.hostname:
            return f"{name} must be an https URL such as https://your-site.onrender.com"
        if parsed.hostname in _local_names:
            return f"{name} must not point at localhost"
        if parsed.path not in ("", ) or parsed.params or parsed.query or parsed.fragment:
            return f"{name} must be just the origin, with no trailing slash or path"
        return None

    # Secrets: real, long, and all different.
    _dev_defaults = {"dev-secret-key", "dev-jwt-secret-key", "dev-employee-jwt-secret-key", "change-me"}
    _secrets = (SECRET_KEY, JWT_SECRET_KEY, EMPLOYEE_JWT_SECRET_KEY)
    if any(secret in _dev_defaults or len(secret) < 32 for secret in _secrets):
        _problems.append("SECRET_KEY, JWT_SECRET_KEY and EMPLOYEE_JWT_SECRET_KEY must all be real random values of at least 32 characters")
    elif len(set(_secrets)) != 3:
        _problems.append("SECRET_KEY, JWT_SECRET_KEY and EMPLOYEE_JWT_SECRET_KEY must be three different values")

    if DEBUG:
        _problems.append("DEBUG must be False")

    # MFA key must be a valid Fernet key, not just non-empty.
    try:
        from cryptography.fernet import Fernet
        Fernet(MFA_ENCRYPTION_KEY.encode())
    except Exception:
        _problems.append("MFA_ENCRYPTION_KEY must be a valid Fernet key (see backend/.env.example)")

    # Database: a real host, a password, and verified TLS.
    if DB_HOST in _local_names:
        _problems.append("DB_HOST must be your hosted database, not localhost")
    if not DB_PASSWORD:
        _problems.append("DB_PASSWORD must be set")
    if not DB_SSL_CA or not os.path.isfile(DB_SSL_CA):
        _problems.append("DB_SSL_CA must be the path of the database CA certificate file")
    else:
        try:
            with open(DB_SSL_CA, "r", encoding="utf-8", errors="replace") as _ca_file:
                _ca_text = _ca_file.read()
        except OSError as _ca_error:
            # e.g. permission denied or an I/O error: report it with the other
            # configuration problems instead of crashing with a traceback.
            _problems.append(f"DB_SSL_CA could not be read ({_ca_error.strerror or _ca_error.__class__.__name__}); check the file and its permissions")
        else:
            if "-----BEGIN CERTIFICATE-----" not in _ca_text or "PRIVATE KEY" in _ca_text.upper():
                _problems.append("DB_SSL_CA must contain only public certificate blocks and no private key")

    # Time zone: both the database session and the app must use the same one.
    if not DB_TIMEZONE_OFFSET:
        _problems.append("DB_TIMEZONE_OFFSET must be set (for example +05:30), together with TZ")
    else:
        _sign = -1 if DB_TIMEZONE_OFFSET[0] == "-" else 1
        _hours, _minutes = DB_TIMEZONE_OFFSET[1:].split(":")
        _expected_offset = _sign * timedelta(hours=int(_hours), minutes=int(_minutes))
        if datetime.now().astimezone().utcoffset() != _expected_offset:
            _problems.append("the TZ environment variable must give the same UTC offset as DB_TIMEZONE_OFFSET (for example TZ=Asia/Kolkata with +05:30)")

    # File storage: S3 selected and fully configured.
    if STORAGE_BACKEND != "s3":
        _problems.append("STORAGE_BACKEND must be 's3' (Render's disk is wiped on every restart)")
    else:
        if not S3_ENDPOINT_URL.startswith("https://"):
            _problems.append("S3_ENDPOINT_URL must be an https URL")
        if not (S3_REGION and S3_BUCKET and S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY):
            _problems.append("S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must all be set")

    # Email.
    if not BREVO_API_KEY or not EMAIL_FROM_ADDRESS or "@" not in EMAIL_FROM_ADDRESS:
        _problems.append("BREVO_API_KEY and EMAIL_FROM_ADDRESS (a valid sender address) must be set")

    # Frontend URL (used in emailed links) and CORS origins.
    _frontend_problem = _origin_problem(FRONTEND_BASE_URL, "FRONTEND_BASE_URL")
    if _frontend_problem:
        _problems.append(_frontend_problem)
    if not os.getenv("CORS_ALLOWED_ORIGINS", "").strip():
        _problems.append("CORS_ALLOWED_ORIGINS must be set to the frontend origin")
    else:
        for _origin in CORS_ALLOWED_ORIGINS:
            _cors_problem = _origin_problem(_origin, f"CORS_ALLOWED_ORIGINS entry '{_origin}'")
            if _cors_problem:
                _problems.append(_cors_problem)
        if not _frontend_problem and FRONTEND_BASE_URL not in CORS_ALLOWED_ORIGINS:
            _problems.append("CORS_ALLOWED_ORIGINS must include FRONTEND_BASE_URL")

    # Per-IP rate limiting needs the real client address, not the proxy's.
    if TRUSTED_PROXY_COUNT < 1:
        _problems.append("TRUSTED_PROXY_COUNT must be set to the number of proxies in front of the app (see README), otherwise all visitors share one rate limit")

    if _problems:
        raise RuntimeError("Invalid production configuration: " + "; ".join(_problems))