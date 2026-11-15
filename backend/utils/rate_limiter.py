"""
Per-IP rate limiting for the unauthenticated endpoints that can be abused
without an account: login attempts and forgot-password requests.

This sits next to (not instead of) the per-account lockout in
login_attempts.py. It is an in-process sliding window, so like that lockout it
is per backend process and resets when the process restarts - which is why the
backend runs as a single Gunicorn worker.

Two ways to use it:
  check_and_record() - checks the limit and counts the request in ONE locked
      step, so simultaneous requests cannot all slip under the limit. Used for
      forgot-password, where every request counts.
  is_rate_limited() + record_event() - used for failed logins. A failure can only
      be counted once the credentials have been checked, so the check at the
      start and the count at the end are necessarily two steps. Requests that
      are already in flight when the limit is reached can still finish, so the
      limit can be exceeded by at most the number of simultaneous request
      threads minus one (Gunicorn runs with --threads 4), never unboundedly.

Timestamps are always taken while holding the lock, so the list for a client is
kept in order (oldest first), which the expiry and Retry-After logic rely on.

The client address is request.remote_addr. app.py rewrites it from
X-Forwarded-For only for the number of trusted proxies configured with
TRUSTED_PROXY_COUNT; otherwise it is the socket address. Forwarded headers are
never read here directly.
"""

import math
import threading
import time

from flask import request, jsonify

from config import settings

_events = {}                 # (bucket, ip) -> list of monotonic timestamps
_lock = threading.Lock()
_MAX_TRACKED_CLIENTS = 10000


def _window_seconds():
    return settings.IP_RATE_LIMIT_WINDOW_MINUTES * 60


def _client_ip():
    return request.remote_addr or "unknown"


def _recent_events_locked(key, now):
    """Timestamps for this key that are still inside the window (drops the rest)."""
    cutoff = now - _window_seconds()
    events = [t for t in _events.get(key, ()) if t > cutoff]
    if events:
        _events[key] = events
    else:
        _events.pop(key, None)
    return events


def _trim_locked(now):
    """Keeps memory bounded if many different addresses are seen."""
    if len(_events) <= _MAX_TRACKED_CLIENTS:
        return
    cutoff = now - _window_seconds()
    for key in [k for k, v in _events.items() if not v or v[-1] <= cutoff]:
        del _events[key]
    while len(_events) > _MAX_TRACKED_CLIENTS:
        del _events[next(iter(_events))]       # oldest first-seen client


def is_rate_limited(bucket, max_events):
    """Returns (limited, retry_after_seconds) for the calling client. Does not count anything."""
    key = (bucket, _client_ip())
    with _lock:
        now = time.monotonic()
        events = _recent_events_locked(key, now)
        if len(events) >= max_events:
            retry_after = math.ceil(events[0] + _window_seconds() - now)
            return True, max(retry_after, 1)
    return False, 0


def record_event(bucket):
    """Counts one event (a failed login) for the calling client."""
    key = (bucket, _client_ip())
    with _lock:
        now = time.monotonic()
        _recent_events_locked(key, now)
        _events.setdefault(key, []).append(now)
        _trim_locked(now)


def check_and_record(bucket, max_events):
    """
    Atomic check-and-count: if the calling client is already at the limit,
    returns (True, retry_after_seconds) and counts nothing; otherwise counts
    this request and returns (False, 0). Check and count happen under one lock,
    so concurrent requests cannot all pass the check before any is counted.
    """
    key = (bucket, _client_ip())
    with _lock:
        now = time.monotonic()
        events = _recent_events_locked(key, now)
        if len(events) >= max_events:
            retry_after = math.ceil(events[0] + _window_seconds() - now)
            return True, max(retry_after, 1)
        _events.setdefault(key, []).append(now)
        _trim_locked(now)
    return False, 0


def rate_limited_response(retry_after_seconds):
    response = jsonify({
        "success": False,
        "message": "Too many requests from your network. Please try again later."
    })
    response.status_code = 429
    response.headers["Retry-After"] = str(retry_after_seconds)
    return response