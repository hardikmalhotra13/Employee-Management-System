from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

from config import settings
from database.connection import get_db_connection
from utils.response_helpers import error_response
from utils.storage_helper import StorageError

from routes.auth_routes import auth_bp
from routes.department_routes import department_bp
from routes.role_routes import role_bp
from routes.grade_routes import grade_bp
from routes.shift_routes import shift_bp
from routes.employee_routes import employee_bp
from routes.dashboard_routes import dashboard_bp
from routes.settings_routes import settings_bp
from routes.document_routes import document_bp
from routes.rbac_routes import rbac_bp
from routes.employee_auth_routes import employee_auth_bp
from routes.manager_routes import manager_bp
from routes.roster_routes import roster_bp
from routes.attendance_routes import attendance_bp
from routes.leave_routes import leave_bp
from routes.employee_notification_routes import employee_notification_bp
from routes.admin_notification_routes import admin_notification_bp
from routes.asset_routes import asset_bp
from routes.onboarding_routes import onboarding_bp
from routes.offboarding_routes import offboarding_bp
from routes.performance_routes import performance_bp
from routes.training_routes import training_bp
from routes.employee_dashboard_routes import employee_dashboard_bp
from routes.holiday_routes import holiday_bp

app = Flask(__name__)
app.config["SECRET_KEY"] = settings.SECRET_KEY

# Only the configured frontend origin(s) may call the API from a browser.
CORS(app, origins=settings.CORS_ALLOWED_ORIGINS)

# Client address for per-IP rate limiting. Behind a reverse proxy the socket
# address is the proxy's, so request.remote_addr is read from X-Forwarded-For -
# but only counting TRUSTED_PROXY_COUNT entries from the right, which are the
# ones our own proxies added. Anything further left can be forged by the client
# and is ignored. Other forwarded headers (proto, host, prefix) are not trusted.
# With TRUSTED_PROXY_COUNT=0 nothing is trusted and the socket address is used.
if settings.TRUSTED_PROXY_COUNT:
    app.wsgi_app = ProxyFix(
        app.wsgi_app,
        x_for=settings.TRUSTED_PROXY_COUNT,
        x_proto=0, x_host=0, x_port=0, x_prefix=0,
    )

app.register_blueprint(auth_bp, url_prefix="/api/v1")
app.register_blueprint(department_bp, url_prefix="/api/v1")
app.register_blueprint(role_bp, url_prefix="/api/v1")
app.register_blueprint(grade_bp, url_prefix="/api/v1")
app.register_blueprint(shift_bp, url_prefix="/api/v1")
app.register_blueprint(employee_bp, url_prefix="/api/v1")
app.register_blueprint(dashboard_bp, url_prefix="/api/v1")
app.register_blueprint(settings_bp, url_prefix="/api/v1")
app.register_blueprint(document_bp, url_prefix="/api/v1")
app.register_blueprint(rbac_bp, url_prefix="/api/v1")
app.register_blueprint(employee_auth_bp, url_prefix="/api/v1")
app.register_blueprint(manager_bp, url_prefix="/api/v1")
app.register_blueprint(roster_bp, url_prefix="/api/v1")
app.register_blueprint(attendance_bp, url_prefix="/api/v1")
app.register_blueprint(leave_bp, url_prefix="/api/v1")
app.register_blueprint(employee_notification_bp, url_prefix="/api/v1")
app.register_blueprint(admin_notification_bp, url_prefix="/api/v1")
app.register_blueprint(asset_bp, url_prefix="/api/v1")
app.register_blueprint(onboarding_bp, url_prefix="/api/v1")
app.register_blueprint(offboarding_bp, url_prefix="/api/v1")
app.register_blueprint(performance_bp, url_prefix="/api/v1")
app.register_blueprint(training_bp, url_prefix="/api/v1")
app.register_blueprint(employee_dashboard_bp, url_prefix="/api/v1")
app.register_blueprint(holiday_bp, url_prefix="/api/v1")


@app.errorhandler(StorageError)
def handle_storage_error(error):
    # The file bucket could not be reached (not configured, paused, network error...).
    print(f"File storage error: {error}")
    return error_response("File storage is temporarily unavailable, please try again later", status_code=503)


@app.route("/")
def index():
    return jsonify({"message": "Employee Management System Backend is Running"})


@app.route("/health")
def health():
    connection = get_db_connection()
    if connection:
        connection.close()
        return jsonify({"status": "success", "message": "Database connection is healthy"})
    return jsonify({"status": "error", "message": "Database connection failed"}), 500


if __name__ == "__main__":
    app.run(debug=settings.DEBUG)