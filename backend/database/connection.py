import pymysql
from config import settings


def get_db_connection():
    connect_args = {
        "host": settings.DB_HOST,
        "port": settings.DB_PORT,
        "user": settings.DB_USER,
        "password": settings.DB_PASSWORD,
        "database": settings.DB_NAME,
        "cursorclass": pymysql.cursors.DictCursor,
    }

    # Hosted databases (e.g. Aiven) require TLS; verify the server against the
    # provider's CA certificate. Not set for a local MySQL.
    if settings.DB_SSL_CA:
        connect_args["ssl_ca"] = settings.DB_SSL_CA
        connect_args["ssl_verify_cert"] = True

    # Make SQL NOW()/CURDATE()/CURRENT_TIMESTAMP use the application's time zone
    # (the value is validated in settings.py as a +HH:MM offset).
    if settings.DB_TIMEZONE_OFFSET:
        connect_args["init_command"] = f"SET time_zone = '{settings.DB_TIMEZONE_OFFSET}'"

    try:
        connection = pymysql.connect(**connect_args)
        return connection
    except pymysql.MySQLError as e:
        print(f"Database connection failed: {e}")
        return None