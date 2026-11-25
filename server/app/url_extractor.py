"""SSRF-guarded webpage extractor for Website-to-Podcast and Creator Pills."""
from __future__ import annotations

from html.parser import HTMLParser
import ipaddress
import re
import socket
from urllib.parse import urlparse
import urllib.request

from .config import public_base_url

MAX_BYTES = 524_288
MAX_TEXT_CHARS = 4500
USER_AGENT = f"AmbiRadioBot/1.0 (+{public_base_url()})"


def _validate_public_url(url: str) -> str:
    cleaned = (url or "").strip()
    if not cleaned:
        raise ValueError("URL jest pusty")
    if not cleaned.startswith(("http://", "https://")):
        cleaned = "https://" + cleaned
    parsed = urlparse(cleaned)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Nieprawidłowy adres URL")
    host = parsed.hostname.lower()
    if host in ("localhost", "0.0.0.0") or host.endswith(".local") or host.endswith(".internal"):
        raise ValueError("Adres lokalny jest niedozwolony")
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise ValueError(f"Nie można rozwiązać domeny {host}") from exc
    for info in infos:
        ip_str = info[4][0]
        ip_obj = ipaddress.ip_address(ip_str)
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        ):
            raise ValueError("Adres prywatny lub wewnętrzny jest zablokowany")
    return cleaned


class _ReadableExtractor(HTMLParser):
    SKIP_TAGS = {"script", "style", "noscript", "svg", "iframe", "nav", "footer"}

    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self._in_title = False
        self.title_parts: list[str] = []
        self.meta_desc = ""
        self.og_title = ""
        self.chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        if t in self.SKIP_TAGS:
            self._skip_depth += 1
            return
        if t == "title":
            self._in_title = True
            return
        if t == "meta":
            ad = {(k or "").lower(): (v or "") for k, v in attrs}
            name = ad.get("name", "").lower()
            prop = ad.get("property", "").lower()
            content = ad.get("content", "").strip()
            if content:
                if name == "description" and not self.meta_desc:
                    self.meta_desc = content
                elif prop == "og:description" and not self.meta_desc:
                    self.meta_desc = content
                elif prop == "og:title" and not self.og_title:
                    self.og_title = content

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in self.SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
        elif t == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        txt = re.sub(r"\s+", " ", data).strip()
        if not txt:
            return
        if self._in_title:
            self.title_parts.append(txt)
        elif len(txt) >= 3:
            self.chunks.append(txt)


def _fetch_html_raw(url: str, timeout: float = 10.0) -> str:
    validated = _validate_public_url(url)
    req = urllib.request.Request(
        validated,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        final_url = resp.geturl()
        if final_url and final_url != validated:
            _validate_public_url(final_url)
        raw = resp.read(MAX_BYTES)
        charset = resp.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def extract_webpage_content(url: str, timeout: float = 10.0) -> dict[str, str]:
    """Fetch a public webpage safely and return clean title, description, and body text."""
    norm_url = url.strip() if url.strip().startswith(("http://", "https://")) else f"https://{url.strip()}"
    html = _fetch_html_raw(norm_url, timeout=timeout)
    parser = _ReadableExtractor()
    parser.feed(html)
    parsed_host = urlparse(norm_url).hostname or norm_url
    title = (" ".join(parser.title_parts).strip() or parser.og_title or parsed_host)[:180]
    desc = parser.meta_desc[:360]
    body = re.sub(r"\s+", " ", " ".join(parser.chunks)).strip()[:MAX_TEXT_CHARS]
    if not body and desc:
        body = desc
    return {
        "url": norm_url,
        "domain": parsed_host,
        "title": title,
        "description": desc,
        "text": body,
    }
