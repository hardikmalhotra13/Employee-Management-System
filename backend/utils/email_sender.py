import requests

from config import settings

BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email"
BREVO_TIMEOUT_SECONDS = 10


def send_email(to_email, subject, body):
    """
    Sends a plain-text email through the Brevo transactional email API (HTTPS).
    Returns True if Brevo accepted the message, False otherwise - callers decide
    what to do on failure, exactly as before.

    HTTPS is used instead of SMTP because the hosting platform blocks outbound
    SMTP ports.
    """
    # Demo accounts never receive real email (their addresses need not exist).
    if to_email and to_email.strip().lower() in settings.DEMO_ACCOUNT_EMAILS:
        return False

    if not settings.BREVO_API_KEY or not settings.EMAIL_FROM_ADDRESS:
        print("Failed to send email: BREVO_API_KEY or EMAIL_FROM_ADDRESS is not configured")
        return False

    payload = {
        "sender": {"name": settings.EMAIL_FROM_NAME, "email": settings.EMAIL_FROM_ADDRESS},
        "to": [{"email": to_email}],
        "subject": subject,
        "textContent": body,
    }

    try:
        response = requests.post(
            BREVO_SEND_URL,
            json=payload,
            headers={"api-key": settings.BREVO_API_KEY, "accept": "application/json"},
            timeout=BREVO_TIMEOUT_SECONDS,
        )
    except requests.RequestException as e:
        print(f"Failed to send email to {to_email}: {e}")
        return False

    if not response.ok:
        print(f"Failed to send email to {to_email}: Brevo returned {response.status_code} {response.text[:200]}")
        return False

    return True