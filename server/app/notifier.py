"""Telegram alerts for new user registrations on DOS Radio, including server health metrics."""
from __future__ import annotations

import asyncio
import logging
import os
import psutil
import httpx

log = logging.getLogger("dosradio.telegram")

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "5070727280").strip()


def get_system_load() -> dict:
    try:
        mem = psutil.virtual_memory()
        cpu = psutil.cpu_percent(interval=None)
        return {
            "cpu_pct": cpu,
            "ram_used_gb": round(mem.used / (1024**3), 1),
            "ram_total_gb": round(mem.total / (1024**3), 1),
            "ram_pct": mem.percent,
        }
    except Exception:
        return {"cpu_pct": 0, "ram_used_gb": 0, "ram_total_gb": 0, "ram_pct": 0}


async def notify_new_user(email: str, total_users: int, archive_hours: float) -> None:
    token = TELEGRAM_BOT_TOKEN or os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = TELEGRAM_CHAT_ID or os.environ.get("TELEGRAM_CHAT_ID", "5070727280").strip()
    if not token or not chat_id:
        log.info("Telegram notification skipped (no token/chat_id configured)")
        return

    load = get_system_load()
    msg = (
        f"📻 *Nowy słuchacz w DOS Radio!*\n\n"
        f"👤 *Email:* `{email}`\n"
        f"👥 *Łącznie kont:* {total_users}\n"
        f"🎙️ *Archiwum muzyki:* ~{archive_hours:.1f}h nagrań\n"
        f"⚡ *Obciążenie serwera:* CPU: {load['cpu_pct']}%, RAM: {load['ram_used_gb']}G / {load['ram_total_gb']}G ({load['ram_pct']}%)\n\n"
        f"🔗 [Otwórz DOS Radio](https://dosradio.theones.io)"
    )

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={
                "chat_id": chat_id,
                "text": msg,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            })
            if resp.status_code != 200:
                log.warning("Telegram send failed: HTTP %s %s", resp.status_code, resp.text[:120])
    except Exception as err:
        log.warning("Telegram send error: %s", err)


def trigger_telegram_alert(email: str, total_users: int, archive_hours: float) -> None:
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(notify_new_user(email, total_users, archive_hours))
    except RuntimeError:
        # No running event loop (e.g. sync test client)
        pass
