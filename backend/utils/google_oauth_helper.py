

import requests
from authlib.integrations.requests_client import OAuth2Session
from authlib.jose import jwt as jose_jwt
from authlib.jose.errors import JoseError

from config import settings

_cache = {}


def _get_discovery():
    if "discovery" not in _cache:
        response = requests.get(settings.GOOGLE_DISCOVERY_URL, timeout=10)
        response.raise_for_status()
        _cache["discovery"] = response.json()
    return _cache["discovery"]


def _get_jwks(force_refresh=False):
    if force_refresh or "jwks" not in _cache:
        discovery = _get_discovery()
        response = requests.get(discovery["jwks_uri"], timeout=10)
        response.raise_for_status()
        _cache["jwks"] = response.json()
    return _cache["jwks"]


def exchange_code_for_claims(code, code_verifier, expected_nonce):
    """Exchanges an authorization code (+ PKCE verifier) for tokens and
    returns the verified ID token claims dict, or None if the code is
    invalid, the ID token fails verification, or its nonce claim does
    not match expected_nonce (the value the frontend generated before
    redirecting to Google - this binds the returned token to this
    specific auth request and prevents replay of a previously issued ID
    token). Callers must treat None as "not a valid Google identity"
    and must never log the code, verifier, or raw token contents."""
    try:
        discovery = _get_discovery()
    except requests.RequestException:
        return None

    session = OAuth2Session(
        settings.GOOGLE_CLIENT_ID,
        settings.GOOGLE_CLIENT_SECRET,
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )

    try:
        token = session.fetch_token(
            discovery["token_endpoint"],
            code=code,
            code_verifier=code_verifier,
            grant_type="authorization_code",
        )
    except Exception:
        return None

    id_token = token.get("id_token")
    if not id_token:
        return None

    claims_options = {
        "iss": {"values": ["https://accounts.google.com", "accounts.google.com"]},
        "aud": {"values": [settings.GOOGLE_CLIENT_ID]},
    }

    claims = None
    for force_refresh in (False, True):
        try:
            jwks = _get_jwks(force_refresh=force_refresh)
            claims = jose_jwt.decode(id_token, jwks, claims_options=claims_options)
            claims.validate()
            break
        except JoseError:
            claims = None
            continue
        except requests.RequestException:
            return None

    if claims is None:
        return None

    if not claims.get("email_verified"):
        return None
    if not claims.get("sub") or not claims.get("email"):
        return None
    if not expected_nonce or claims.get("nonce") != expected_nonce:
        return None

    return claims