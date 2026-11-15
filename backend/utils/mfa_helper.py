import secrets
import threading
import time

import jwt
import pyotp
from cryptography.fernet import Fernet, InvalidToken

from config import settings
from utils.token_helper import hash_token

# Recovery codes: 8 characters, uppercase alphanumeric, excluding visually
# ambiguous characters (0/O, 1/I) - 4 codes issued per (re-)enrollment.
RECOVERY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
RECOVERY_CODE_LENGTH = 8
RECOVERY_CODE_COUNT = 4

# In-memory record of mfa_pending token jti's that have already been
# successfully used, so the same token can't be replayed to obtain a
# second session. Simple in-process dict keyed by jti -> expiry (Unix
# timestamp, taken from the token's own "exp"), pruned lazily on access -
# same lightweight, no-new-table approach as login_attempts.py. Guarded
# by a lock so the check-and-mark is one atomic operation: without it,
# two concurrent requests holding the same valid pending_token + code
# could both pass a separate "already used?" check before either marked
# it used, and both would succeed.
_used_pending_jtis = {}
_pending_jti_lock = threading.Lock()


def _prune_used_jtis_locked():
    now = time.time()
    expired = [jti for jti, exp in _used_pending_jtis.items() if exp < now]
    for jti in expired:
        del _used_pending_jtis[jti]


def is_pending_token_used(jti):
    with _pending_jti_lock:
        _prune_used_jtis_locked()
        return jti in _used_pending_jtis


def consume_pending_token_jti(jti, exp_timestamp):
    with _pending_jti_lock:
        _prune_used_jtis_locked()
        if jti in _used_pending_jtis:
            return False
        _used_pending_jtis[jti] = exp_timestamp
        return True


# Which claim names the account an interim token belongs to.
_INTERIM_SUBJECT_CLAIM = {
    "mfa_setup": "admin_id",
    "mfa_pending": "admin_id",
    "mfa_recovery_grant": "admin_id",
    "employee_mfa_pending": "employee_id",
}

# Interim tokens that may only be used once. They must carry a jti, otherwise
# the replay protection above (is_pending_token_used / consume_pending_token_jti)
# would silently be skipped. mfa_setup is not single-use (it carries the
# not-yet-saved secret) and has never had a jti.
_INTERIM_TYPES_REQUIRING_JTI = {"mfa_pending", "mfa_recovery_grant", "employee_mfa_pending"}


def decode_interim_token(token, expected_type, secret_key=None):
    """
    Returns the payload of a valid interim token, or None. Besides the
    signature and type, the token must have an expiry, an integer account id,
    and (for single-use types) a non-empty jti - tokens missing those are
    rejected instead of being accepted without expiry or replay protection.
    """
    # Admin interim tokens are signed with JWT_SECRET_KEY (the default);
    # employee ones pass EMPLOYEE_JWT_SECRET_KEY so the two never mix.
    try:
        payload = jwt.decode(
            token, secret_key or settings.JWT_SECRET_KEY,
            algorithms=["HS256"], options={"require": ["exp"]}
        )
    except jwt.PyJWTError:
        return None

    if payload.get("type") != expected_type:
        return None

    subject_claim = _INTERIM_SUBJECT_CLAIM.get(expected_type)
    if subject_claim:
        subject = payload.get(subject_claim)
        if not isinstance(subject, int) or isinstance(subject, bool) or subject < 1:
            return None

    if expected_type in _INTERIM_TYPES_REQUIRING_JTI:
        jti = payload.get("jti")
        if not isinstance(jti, str) or not jti:
            return None

    return payload


def requires_mfa(admin_role_id, mfa_enabled):
    # MFA is user-controlled: it is only required at login for an account
    # that has itself turned it on. No role forces enrollment any more.
    return bool(mfa_enabled)


def _get_fernet():
    if not settings.MFA_ENCRYPTION_KEY:
        raise RuntimeError("MFA_ENCRYPTION_KEY is not configured")
    return Fernet(settings.MFA_ENCRYPTION_KEY.encode())


def generate_totp_secret():
    """A fresh base32 secret for a new enrollment. Not persisted until
    the admin proves they can generate a valid code from it."""
    return pyotp.random_base32()


def get_totp_uri(secret, email):
    """otpauth:// URI the frontend renders as a QR code for the
    authenticator app. No image library needed server-side."""
    return pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name=settings.MFA_ISSUER_NAME)


def verify_totp_code(secret, code):
    """Accepts the current code plus one step before/after to tolerate
    minor clock drift (pyotp's default valid_window=1)."""
    if not secret or not code:
        return False
    return pyotp.totp.TOTP(secret).verify(code, valid_window=1)


def encrypt_mfa_secret(secret):
    return _get_fernet().encrypt(secret.encode()).decode()


def decrypt_mfa_secret(encrypted_secret):
    try:
        return _get_fernet().decrypt(encrypted_secret.encode()).decode()
    except InvalidToken:
        return None


def generate_recovery_codes():
    return [
        "".join(secrets.choice(RECOVERY_CODE_ALPHABET) for _ in range(RECOVERY_CODE_LENGTH))
        for _ in range(RECOVERY_CODE_COUNT)
    ]


def hash_recovery_code(code):
    return hash_token(code.strip().upper())


def replace_recovery_codes(cursor, admin_id):
    codes = generate_recovery_codes()

    cursor.execute("DELETE FROM admin_mfa_recovery_codes WHERE admin_id = %s", (admin_id,))
    for code in codes:
        cursor.execute(
            "INSERT INTO admin_mfa_recovery_codes (admin_id, code_hash) VALUES (%s, %s)",
            (admin_id, hash_recovery_code(code))
        )

    return codes


def consume_recovery_code(cursor, admin_id, code):
    cursor.execute(
        "UPDATE admin_mfa_recovery_codes SET is_used = TRUE, used_at = NOW() "
        "WHERE admin_id = %s AND code_hash = %s AND is_used = FALSE",
        (admin_id, hash_recovery_code(code))
    )
    return cursor.rowcount == 1


def has_recovery_codes(cursor, admin_id):
    cursor.execute("SELECT COUNT(*) AS cnt FROM admin_mfa_recovery_codes WHERE admin_id = %s", (admin_id,))
    return cursor.fetchone()["cnt"] > 0


def recovery_code_is_valid(cursor, admin_id, code):
    cursor.execute(
        "SELECT id FROM admin_mfa_recovery_codes WHERE admin_id = %s AND code_hash = %s AND is_used = FALSE",
        (admin_id, hash_recovery_code(code))
    )
    return cursor.fetchone() is not None


# ---------------------------------------------------------------------
# Employee portal - same mechanism, separate recovery-code table
# ---------------------------------------------------------------------

def replace_employee_recovery_codes(cursor, employee_id):
    codes = generate_recovery_codes()

    cursor.execute("DELETE FROM employee_mfa_recovery_codes WHERE employee_id = %s", (employee_id,))
    for code in codes:
        cursor.execute(
            "INSERT INTO employee_mfa_recovery_codes (employee_id, code_hash) VALUES (%s, %s)",
            (employee_id, hash_recovery_code(code))
        )

    return codes


def consume_employee_recovery_code(cursor, employee_id, code):
    cursor.execute(
        "UPDATE employee_mfa_recovery_codes SET is_used = TRUE, used_at = NOW() "
        "WHERE employee_id = %s AND code_hash = %s AND is_used = FALSE",
        (employee_id, hash_recovery_code(code))
    )
    return cursor.rowcount == 1


def has_employee_recovery_codes(cursor, employee_id):
    cursor.execute("SELECT COUNT(*) AS cnt FROM employee_mfa_recovery_codes WHERE employee_id = %s", (employee_id,))
    return cursor.fetchone()["cnt"] > 0