"""
Standard JSON response helpers used across all route modules.

Every API response follows one of two shapes:
  Success: { "success": true, "message": "...", "data": {...} }
  Error:   { "success": false, "message": "...", "errors": {...} }

"""

from flask import jsonify


def success_response(message="", data=None, status_code=200):
    """Generic success response. Used for GET, PUT, and DELETE operations."""
    response = {"success": True, "message": message}
    if data is not None:
        response["data"] = data
    return jsonify(response), status_code


def created_response(message="Resource created successfully", data=None):
    """Shortcut for successful POST/create operations (HTTP 201)."""
    return success_response(message, data, status_code=201)


def error_response(message="Something went wrong", errors=None, status_code=400):
    """Generic error response. status_code should be set based on the situation."""
    response = {"success": False, "message": message}
    if errors:
        response["errors"] = errors
    return jsonify(response), status_code


def validation_error_response(errors, message="Validation failed"):
    """Used when request data fails field-level validation (HTTP 400)."""
    return error_response(message, errors=errors, status_code=400)


def not_found_response(message="Resource not found"):
    """Used when a requested record does not exist (HTTP 404)."""
    return error_response(message, status_code=404)


def unauthorized_response(message="Invalid email or password"):
    """Used for failed authentication or missing/invalid JWT (HTTP 401)."""
    return error_response(message, status_code=401)