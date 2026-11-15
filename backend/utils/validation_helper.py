"""
Small helpers for validating JSON request values whose type is not
guaranteed. Request bodies are untrusted: a field can arrive as a number,
list, object or null instead of the string/integer the endpoint expects,
and passing such a value straight to strptime() or to the database driver
raises an exception that would otherwise surface as an uncaught 500.
"""

from datetime import datetime


def is_valid_id(value):
    """
    A positive integer id. Accepts a JSON integer or a string of digits (the
    UI's <select> values arrive as strings); rejects booleans, floats,
    lists, objects and anything else.
    """
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return value > 0
    return isinstance(value, str) and value.isdigit() and int(value) > 0


def parse_date_str(value):
    """date for a 'YYYY-MM-DD' string naming a real calendar date, else None (never raises)."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_datetime_str(value):
    """datetime for a 'YYYY-MM-DD HH:MM:SS' string, else None (never raises)."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None