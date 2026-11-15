import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from config import settings

EXPIRY_HOURS = {
    "invite": settings.INVITE_TOKEN_EXPIRY_HOURS,
    "reset": settings.RESET_TOKEN_EXPIRY_HOURS,
}


def generate_token():
    return secrets.token_urlsafe(32)


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def get_expiry(token_type):
    hours = EXPIRY_HOURS[token_type]
    return datetime.now(timezone.utc) + timedelta(hours=hours)