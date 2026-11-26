"""Renderer for the 1200x630 AmbiRadio share card (PNG)."""
from __future__ import annotations

import io
import re
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .config import BRAND_NAME, BRAND_TAGLINE_SHORT, public_domain

CARD_W, CARD_H = 1200, 630
MARGIN_X = 74
BG = (9, 9, 15)
ACCENT = (255, 107, 61)
WHITE = (255, 255, 255)
SOFT = (203, 213, 225)
MUTED = (148, 163, 184)
ORBITS = ((250, (56, 189, 248)), (375, (167, 139, 250)), (500, ACCENT))  # chill / groove / rave
CTA_TEXT = "Posłuchaj na żywo"
DEFAULT_TITLE = "Żywe radio AI i własne audycje"
DEFAULT_ABOUT = "Muzyka w trzech orbitach, prowadzący na żywo i audycje z dowolnej strony WWW."
TITLE_MAX_LINES = 3
ABOUT_MAX_CHARS = 120
ABOUT_WRAP = 62

FONT_BOLD = (
    "/usr/share/fonts/opentype/fira/FiraSans-SemiBold.otf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
)
FONT_REG = (
    "/usr/share/fonts/opentype/fira/FiraSans-Book.otf",
    "/usr/share/fonts/opentype/fira/FiraSans-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
)


def _font(candidates: tuple[str, ...], size: int):
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size=size)
            except Exception:
                continue
    return ImageFont.load_default()


def shorten(text: str, limit: int) -> str:
    """Collapse whitespace and cut at a word boundary with an ellipsis."""
    clean = re.sub(r"\s+", " ", text or "").strip()
    if len(clean) <= limit:
        return clean
    return clean[:limit].rsplit(" ", 1)[0].rstrip(" .,;:-") + "…"


def _draw_orbits(draw: ImageDraw.ImageDraw) -> None:
    for step in range(28):
        rad = 560 - step * 16
        shade = min(28, 9 + step // 2)
        draw.ellipse((CARD_W - 110 - rad, CARD_H + 60 - rad, CARD_W - 110 + rad, CARD_H + 60 + rad),
                     outline=(shade, shade, shade + 10), width=2)
    ox, oy = CARD_W + 20, CARD_H + 30
    for rad, colour in ORBITS:
        draw.arc((ox - rad, oy - int(rad * 0.92), ox + rad, oy + int(rad * 0.92)), start=175, end=272, fill=colour, width=4)


def _draw_header(draw: ImageDraw.ImageDraw, from_name: str) -> None:
    draw.ellipse((MARGIN_X, 84, MARGIN_X + 16, 100), fill=ACCENT)
    draw.text((MARGIN_X + 30, 70), BRAND_NAME, font=_font(FONT_BOLD, 40), fill=WHITE)
    draw.text((MARGIN_X + 30, 116), BRAND_TAGLINE_SHORT, font=_font(FONT_REG, 24), fill=MUTED)
    if from_name:
        draw.text((MARGIN_X, 168), f"Od: {shorten(from_name, 40)}", font=_font(FONT_BOLD, 24), fill=(255, 182, 153))


def _draw_copy(draw: ImageDraw.ImageDraw, title: str, about: str, top: int) -> None:
    title_clean = shorten(title or DEFAULT_TITLE, 120)
    size = 52 if len(title_clean) <= 46 else (44 if len(title_clean) <= 78 else 38)
    wrap = 31 if size >= 52 else (37 if size >= 44 else 43)
    font = _font(FONT_BOLD, size)
    y = top
    for line in textwrap.wrap(title_clean, width=wrap)[:TITLE_MAX_LINES]:
        draw.text((MARGIN_X, y), line, font=font, fill=WHITE)
        y += int(size * 1.24)
    body = shorten(about or DEFAULT_ABOUT, ABOUT_MAX_CHARS)
    y += 10
    for line in textwrap.wrap(body, width=ABOUT_WRAP)[:2]:
        draw.text((MARGIN_X, y), line, font=_font(FONT_REG, 26), fill=SOFT)
        y += 36


def _draw_footer(draw: ImageDraw.ImageDraw, station_name: str, domain: str) -> None:
    bar_y = CARD_H - 118
    meta = f"{shorten(station_name, 28)} · {domain}" if station_name else domain
    draw.text((MARGIN_X, bar_y + 16), meta, font=_font(FONT_BOLD, 26), fill=SOFT)
    draw.rounded_rectangle((786, bar_y, CARD_W - MARGIN_X, bar_y + 58), radius=16, fill=ACCENT)
    cta_font = _font(FONT_BOLD, 26)
    cta_w = draw.textlength(CTA_TEXT, font=cta_font)
    draw.text((786 + (CARD_W - MARGIN_X - 786 - cta_w) / 2, bar_y + 14), CTA_TEXT, font=cta_font, fill=(10, 10, 14))


def render_og_card_png(*, title: str, about: str, station_name: str, from_name: str = "",
                       brand_domain: str | None = None) -> bytes:
    """Render the share card: brand, tagline, short copy, domain and a single CTA."""
    img = Image.new("RGB", (CARD_W, CARD_H), BG)
    draw = ImageDraw.Draw(img)
    _draw_orbits(draw)
    draw.rounded_rectangle((36, 34, CARD_W - 36, CARD_H - 34), radius=28, outline=ACCENT, width=2)
    _draw_header(draw, from_name)
    _draw_copy(draw, title, about, top=214 if from_name else 178)
    _draw_footer(draw, station_name, brand_domain or public_domain())
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
