"""Verification e-mails for new DOS Radio accounts, sent over SMTP."""
from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage

log = logging.getLogger("dosradio.mailer")

VERIFY_TTL_SECONDS = 24 * 3600
SITE_URL = os.environ.get("DOSRADIO_SITE_URL", "https://dosradio.theones.io")

SUBJECT = "Potwierdź swój adres e-mail — DOS Radio"


def build_verification_email(to_email: str, token: str) -> EmailMessage:
    link = f"{SITE_URL}/?verify={token}"
    message = EmailMessage()
    message["Subject"] = SUBJECT
    message["From"] = os.environ.get("DOSRADIO_SMTP_FROM", "DOS Radio <noreply@theones.io>")
    message["To"] = to_email
    message.set_content(
        "Cześć!\n"
        "\n"
        "Ktoś (mam nadzieję, że Ty) właśnie założył konto w DOS Radio na ten adres e-mail.\n"
        "Kliknij poniższy link, aby potwierdzić konto i słuchać bez limitu:\n"
        "\n"
        f"{link}\n"
        "\n"
        "Link jest ważny 24 godziny. Jeśli to nie Ty, po prostu zignoruj tę wiadomość.\n"
        "\n"
        "— DOS Radio · https://dosradio.theones.io\n"
    )
    return message


def send_verification_email(to_email: str, token: str) -> None:
    """Send the confirmation link; raises RuntimeError when SMTP is not configured or fails."""
    host = os.environ.get("DOSRADIO_SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("DOSRADIO_SMTP_PORT", "587"))
    user = os.environ.get("DOSRADIO_SMTP_USER", "")
    password = os.environ.get("DOSRADIO_SMTP_PASS", "")
    if not user or not password:
        raise RuntimeError("SMTP not configured (DOSRADIO_SMTP_USER / DOSRADIO_SMTP_PASS missing)")

    message = build_verification_email(to_email, token)
    with smtplib.SMTP(host, port, timeout=15) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(message)
    log.info("Verification e-mail sent to %s", to_email)
