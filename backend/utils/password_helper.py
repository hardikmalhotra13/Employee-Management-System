"""
Shared password strength rule used by set-password and change-password,
so the rule is defined once instead of duplicated across routes.
"""

import re

from config import settings

SPECIAL_CHAR_PATTERN = re.compile(r"[^A-Za-z0-9]")


def validate_password_strength(password):
    """Returns an error message if the password is too weak, else None."""
    if not password or len(password) < settings.PASSWORD_MIN_LENGTH:
        return f"Password must be at least {settings.PASSWORD_MIN_LENGTH} characters long"

    if not re.search(r"[A-Za-z]", password):
        return "Password must contain at least one letter"

    if not re.search(r"[0-9]", password):
        return "Password must contain at least one number"

    if not SPECIAL_CHAR_PATTERN.search(password):
        return "Password must contain at least one special character"

    return None