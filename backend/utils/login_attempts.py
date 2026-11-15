"""
Basic in-memory login attempt tracker used to lock out an account after
repeated failed login attempts for a short cooldown.

This is intentionally simple: an in-process dict keyed by email, holding
the failed attempt count and the lockout expiry (if any). It resets on
every successful login and does not persist across app restarts, which
is fine for this single-process Flask app.
"""

from datetime import datetime, timedelta, timezone
import math

from config import settings

_attempts = {}


def _normalize(email):
    return email.strip().lower()


def _is_demo_account(key):
    """
    The public demo accounts share one published password, so anyone could lock
    them out for everybody with a few wrong attempts. They are exempt from the
    account-level lockout; abuse is limited per client address instead (see
    rate_limiter.py). Other keys (real accounts, MFA keys) are never exempt.
    """
    return key in settings.DEMO_ACCOUNT_EMAILS


def is_locked_out(email):
    """Returns (locked_out, minutes_remaining)."""
    if _is_demo_account(_normalize(email)):
        return False, 0

    record = _attempts.get(_normalize(email))
    if not record or not record.get("locked_until"):
        return False, 0

    now = datetime.now(timezone.utc)
    if now >= record["locked_until"]:
        return False, 0

    minutes_remaining = math.ceil((record["locked_until"] - now).total_seconds() / 60)
    return True, minutes_remaining


def record_failed_attempt(email):
    key = _normalize(email)
    if _is_demo_account(key):
        return

    record = _attempts.setdefault(key, {"count": 0, "locked_until": None})
    record["count"] += 1

    if record["count"] >= settings.LOGIN_MAX_ATTEMPTS:
        record["locked_until"] = datetime.now(timezone.utc) + timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)


def reset_attempts(email):
    _attempts.pop(_normalize(email), None)