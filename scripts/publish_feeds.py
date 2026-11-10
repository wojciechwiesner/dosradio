#!/usr/bin/env python3
"""Publish calendar and AP feeds for the DOS Radio personal digest.

Runs on the Mac mini, where Himalaya (Gmail IMAP) and ap_improve live. Writes
three RSS files under an unguessable token directory and rsyncs them to the
radio host. The radio reads them through its normal personal-RSS path.

  calendar.xml  today's events from Google's "Daily Agenda" mail
  ap.xml        ticket-queue signals from ap_improve /api/ops
  all.xml       both, for listeners who want a single link

The token lives in ~/.config/dosradio-feeds/token (chmod 600), never in the repo.
"""
from __future__ import annotations

import json
import secrets
import subprocess
import sys
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from app.agenda_feed import AgendaItem, ap_items, build_rss, parse_agenda  # noqa: E402

CONFIG_DIR = Path.home() / ".config" / "dosradio-feeds"
OUT_DIR = Path.home() / ".local" / "share" / "dosradio-feeds"
REMOTE = "borg-ts:/var/www/dosradio.theones.io/feeds"
PUBLIC_BASE = "https://dosradio.theones.io/feeds"
AP_OPS_URL = "http://127.0.0.1:8790/api/ops"
AGENDA_SENDER = "calendar-notification@google.com"


def load_token() -> str:
    path = CONFIG_DIR / "token"
    if not path.exists():
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_urlsafe(24))
        path.chmod(0o600)
    return path.read_text().strip()


def himalaya(*args: str) -> str:
    result = subprocess.run(["himalaya", *args], capture_output=True, text=True, timeout=90, check=True)
    return result.stdout


def todays_agenda(today: date) -> list[AgendaItem]:
    """Events from today's Daily Agenda mail; no mail from today means no events."""
    raw = himalaya("envelope", "list", "--folder", "INBOX", "--page-size", "5", "-o", "json",
                   "from", AGENDA_SENDER, "order", "by", "date", "desc")
    for envelope in json.loads(raw):
        if (envelope.get("date") or "")[:10] != today.isoformat():
            continue
        subject = envelope.get("subject") or ""
        if subject.startswith("You have no events"):
            return []
        if subject.startswith("Daily Agenda"):
            body = himalaya("message", "read", "--folder", "INBOX", "--no-headers", "--preview", str(envelope["id"]))
            return parse_agenda(body, today)
    return []


def current_ap_items() -> list[AgendaItem]:
    with urllib.request.urlopen(AP_OPS_URL, timeout=10) as response:
        return ap_items(json.load(response))


def safely(label: str, producer) -> list[AgendaItem]:
    """A dead source yields an empty topic and a log line, never a failed publish."""
    try:
        return producer()
    except Exception as err:  # noqa: BLE001 - isolation boundary, logged
        print(f"[feeds] {label} failed: {type(err).__name__}: {err}", file=sys.stderr)
        return []


def main() -> int:
    today = date.today()
    token = load_token()
    topics = {
        "calendar": safely("calendar", lambda: todays_agenda(today)),
        "ap": safely("ap", current_ap_items),
    }
    topics["all"] = topics["calendar"] + topics["ap"]

    target = OUT_DIR / token
    target.mkdir(parents=True, exist_ok=True)
    for topic, items in topics.items():
        url = f"{PUBLIC_BASE}/{token}/{topic}.xml"
        (target / f"{topic}.xml").write_text(build_rss(topic, items, today, url), encoding="utf-8")

    subprocess.run(["ssh", "-o", "ConnectTimeout=20", "borg-ts", f"mkdir -p /var/www/dosradio.theones.io/feeds/{token}"], check=True)
    subprocess.run(["rsync", "-az", "--delete", "-e", "ssh -o ConnectTimeout=20", f"{target}/", f"{REMOTE}/{token}/"], check=True)
    print(f"[feeds] published {today}: " + ", ".join(f"{t}={len(i)}" for t, i in topics.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
