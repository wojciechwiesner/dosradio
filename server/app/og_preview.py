"""Dynamic OpenGraph / Social Miniature (1200x630 PNG) & SSR Meta Tags for shared links."""
from __future__ import annotations

import html
import io
import os
import re
import textwrap
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, Response
from PIL import Image, ImageDraw, ImageFont

from .comments import CommentService
from .config import BRAND_NAME, BRAND_TAGLINE, public_base_url, public_domain
from .custom_radios import CustomRadioService
from .db import Database
from .dedications import DedicationStore
from .podcast import PodcastService
from .social import SocialService

FONT_CANDIDATES_BOLD = (
    "/usr/share/fonts/opentype/fira/FiraSans-SemiBold.otf",
    "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
)
FONT_CANDIDATES_REG = (
    "/usr/share/fonts/opentype/fira/FiraSans-Book.otf",
    "/usr/share/fonts/opentype/fira/FiraSans-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
)


def _load_font(candidates: tuple[str, ...], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in candidates:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size=size)
            except Exception:
                continue
    return ImageFont.load_default()


def render_og_card_png(
    *,
    title: str,
    about: str,
    station_name: str,
    from_name: str = "",
    brand_domain: str = "ambiradio.com",
) -> bytes:
    """Render a crisp 1200x630 Dark Obsidian + 3-Orbit Vinyl social share card PNG."""
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), (9, 9, 15))
    draw = ImageDraw.Draw(img)

    # Subtle dark atmospheric gradient & 3 concentric quarter-circle orbital arcs on right
    for step in range(28):
        rad = 560 - step * 16
        c_val = min(28, 9 + step // 2)
        draw.ellipse((w - 110 - rad, h + 60 - rad, w - 110 + rad, h + 60 + rad), outline=(c_val, c_val, c_val + 10), width=2)

    orbit_specs = [
        (250, (56, 189, 248)),   # Ring I - Chill cyan
        (375, (167, 139, 250)),  # Ring II - Groove violet
        (500, (255, 107, 61)),   # Ring III - Rave orange
    ]
    ox, oy = w + 20, h + 30
    for rad, col in orbit_specs:
        bbox = (ox - rad, oy - int(rad * 0.92), ox + rad, oy + int(rad * 0.92))
        draw.arc(bbox, start=175, end=272, fill=col, width=4)

    # Outer editorial frame
    draw.rounded_rectangle((36, 34, w - 36, h - 34), radius=28, outline=(255, 107, 61), width=2)

    f_kicker = _load_font(FONT_CANDIDATES_BOLD, 22)
    title_clean = (title or "Audycja specjalna na żywo").strip()
    title_size = 52 if len(title_clean) <= 46 else (44 if len(title_clean) <= 78 else 38)
    f_title = _load_font(FONT_CANDIDATES_BOLD, title_size)
    f_body = _load_font(FONT_CANDIDATES_REG, 26)
    f_meta = _load_font(FONT_CANDIDATES_BOLD, 24)

    # Top pill badge: AUDYCJA W RADIU AMBIRADIO.COM
    badge_txt = f"AUDYCJA W RADIU {brand_domain.upper()}" + (f"  ·  OD: {from_name.upper()}" if from_name else "")
    draw.rounded_rectangle((74, 72, min(w - 80, 120 + len(badge_txt) * 14), 120), radius=24, fill=(38, 20, 18), outline=(255, 107, 61), width=2)
    draw.ellipse((94, 89, 108, 103), fill=(255, 107, 61))
    draw.text((120, 82), badge_txt, font=f_kicker, fill=(255, 182, 153))

    # Main Audition Title (wrapped cleanly up to 3 lines)
    wrap_chars = 31 if title_size >= 52 else (37 if title_size >= 44 else 43)
    lines = textwrap.wrap(f"„{title_clean}”", width=wrap_chars)[:3]
    y = 154
    for ln in lines:
        draw.text((74, y), ln, font=f_title, fill=(255, 255, 255))
        y += int(title_size * 1.24)

    # About / Story summary (up to 2 lines)
    about_clean = re.sub(r"\s+", " ", (about or "Posłuchaj wieloczęściowej audycji z prowadzącymi na żywo.")).strip()
    if about_clean:
        y += 14
        about_lines = textwrap.wrap(f"Opowiada o: {about_clean}", width=58)[:2]
        for idx, al in enumerate(about_lines):
            if idx == 1 and len(about_clean) > 115 and not al.endswith("..."):
                al = al.rstrip(" .,") + "..."
            draw.text((74, y), al, font=f_body, fill=(203, 213, 225))
            y += 36

    # Bottom bar: Station Music + CTA pill
    bar_y = h - 118
    draw.rounded_rectangle((74, bar_y, 760, bar_y + 58), radius=16, fill=(22, 22, 36), outline=(167, 139, 250), width=2)
    st_txt = f"PRZY MUZYCE: {(station_name or 'DOS Groove').upper()}"
    draw.text((96, bar_y + 15), st_txt[:42], font=f_meta, fill=(221, 214, 254))

    draw.rounded_rectangle((786, bar_y, w - 74, bar_y + 58), radius=16, fill=(255, 107, 61))
    draw.text((818, bar_y + 15), "WŁĄCZ AUDYCJĘ NA ŻYWO", font=f_meta, fill=(10, 10, 14))

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def build_og_router(
    *,
    db: Database,
    podcasts: PodcastService,
    custom_radios: CustomRadioService,
    station_lookup: Callable[[str], dict[str, Any] | None],
    html_candidates: list[Path],
) -> APIRouter:
    router = APIRouter(tags=["og"])
    social = SocialService(db)
    ded_store = DedicationStore(db.path)
    comments = CommentService(db)

    def _brand() -> str:
        return os.getenv("RADIO_BRAND_DOMAIN", "").strip() or public_domain()

    def _resolve_meta(params: dict[str, str]) -> dict[str, str]:
        brand = _brand()
        title = "Żywe radio AI i własne audycje"
        about = "Trzy orbity muzyki pod kciukiem, prowadzący na żywo, wrzutki głosowe i audycje ze stron WWW."
        st_id = params.get("station") or "dos-groove"
        from_name = ""

        tok = params.get("p") or params.get("w") or ""
        if tok:
            drop = social.get_drop(tok)
            if drop:
                st_id = str(drop.get("station_id") or st_id)
                from_name = str(drop.get("from_name") or "")
                title = str(drop.get("site_title") or "")
                about = str(drop.get("message") or drop.get("pill_text") or drop.get("comment") or about)
                pid = str(drop.get("podcast_id") or "")
                if pid:
                    mf = podcasts.load_manifest(pid)
                    if mf:
                        title = str(mf.get("title") or title or mf.get("topic") or title)
                        about = str(mf.get("summary") or about)
                if not title:
                    title = f"Pozdrowienie dla: {drop.get('to_name')}" if drop.get("kind") == "greeting" else "Audycja specjalna"
        elif params.get("r"):
            rad = custom_radios.get(params["r"])
            if rad:
                st_id = str(rad.get("base_station_id") or st_id)
                from_name = str(rad.get("creator_name") or "")
                title = str(rad.get("name") or title)
                about = str(rad.get("description") or "Autorska stacja radiowa na żywo i pigułki wiedzy.")
        elif params.get("k"):
            cmt = comments.get(params["k"]) if params["k"].isalnum() else None
            if cmt:
                st_id = str(cmt.get("station_id") or st_id)
                from_name = str(cmt.get("nick") or "")
                host_name = str(cmt.get("host_name") or "prowadzący")
                title = f"Komentarz na antenie AmbiRadio: odpowiada {host_name}" if cmt.get("on_air") else "Komentarz dla prowadzącego AmbiRadio"
                about = str(cmt.get("text") or about)
        elif params.get("d"):
            ded = ded_store.get(params["d"])
            if ded:
                st_id = str(ded.get("station_id") or st_id)
                from_name = str(ded.get("from_name") or "")
                to_n = str(ded.get("to_name") or "")
                title = f"Dedykacja na antenie{f' dla {to_n}' if to_n else ''}"
                about = str(ded.get("message") or ded.get("script") or about)
        elif params.get("station"):
            st_obj = station_lookup(params["station"])
            if st_obj:
                title = f"Stacja {st_obj.get('name', params['station'])}"
                about = f"Wspólny odsłuch stacji {st_obj.get('name', '')} na żywo z prowadzącym."

        st_info = station_lookup(st_id) or {"name": st_id or "DOS Groove"}
        st_name = str(st_info.get("name") or "DOS Groove")
        full_og_title = f"{title} — audycja w radiu {BRAND_NAME}"
        full_og_desc = f"Zapraszamy do wysłuchania audycji pt. „{title}”, która opowiada o: {about[:160]} — przy muzyce {st_name}."
        return {
            "brand": brand,
            "title": title,
            "about": about[:220],
            "station_name": st_name,
            "from_name": from_name,
            "og_title": full_og_title,
            "og_desc": full_og_desc,
        }

    @router.get("/radio-api/og/card.png")
    async def og_card_image(request: Request) -> Response:
        q = {k: v for k, v in request.query_params.items() if k in ("p", "w", "r", "d", "k", "station")}
        meta = _resolve_meta(q)
        png = render_og_card_png(
            title=meta["title"],
            about=meta["about"],
            station_name=meta["station_name"],
            from_name=meta["from_name"],
            brand_domain=meta["brand"],
        )
        return Response(content=png, media_type="image/png", headers={"Cache-Control": "public, max-age=120"})

    @router.get("/radio-api/og/share-html", response_class=HTMLResponse)
    async def og_share_html(request: Request) -> HTMLResponse:
        q = {k: v for k, v in request.query_params.items() if k in ("p", "w", "r", "d", "k", "station", "view")}
        meta = _resolve_meta(q)
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "https"
        host = request.headers.get("host") or request.url.netloc
        # Serve both ambiradio.com and the legacy dosradio.theones.io from their own host.
        origin = f"{proto}://{host}" if host else public_base_url()
        qs = urlencode({k: v for k, v in q.items() if k in ("p", "w", "r", "d", "k", "station")})
        img_url = f"{origin}/radio-api/og/card.png" + (f"?{qs}" if qs else "")
        page_url = f"{origin}/" + (f"?{urlencode(q)}" if q else "")

        raw_html = ""
        for cand in html_candidates:
            if cand.exists():
                raw_html = cand.read_text(encoding="utf-8")
                break
        if not raw_html:
            raw_html = "<!doctype html><html lang='pl'><head><title>Radio</title></head><body></body></html>"

        e_title = html.escape(meta["og_title"] if q else BRAND_TAGLINE, quote=True)
        e_desc = html.escape(meta["og_desc"], quote=True)
        e_img = html.escape(img_url, quote=True)
        e_url = html.escape(page_url, quote=True)

        # Strip static title + og:* tags and inject dynamic OpenGraph + Twitter Card tags
        cleaned = re.sub(r"<title>.*?</title>", "", raw_html, count=1, flags=re.DOTALL)
        # Canonical follows the configured public URL, so it never points at a domain that does not serve yet.
        canonical = html.escape(public_base_url().rstrip("/") + "/", quote=True)
        cleaned = re.sub(r'<link\s+rel="canonical"\s+href="[^"]*"\s*/?>',
                         f'<link rel="canonical" href="{canonical}" />', cleaned, count=1)
        cleaned = re.sub(r'<meta\s+property="og:[^"]+"\s+content="[^"]*"\s*/?>\s*', "", cleaned)
        cleaned = re.sub(r'<meta\s+name="(?:description|twitter:[^"]+)"\s+content="[^"]*"\s*/?>\s*', "", cleaned)

        injected = (
            f"<title>{e_title}</title>\n"
            f'  <meta name="description" content="{e_desc}" />\n'
            f'  <meta property="og:type" content="website" />\n'
            f'  <meta property="og:site_name" content="{html.escape(BRAND_TAGLINE, quote=True)}" />\n'
            f'  <meta property="og:url" content="{e_url}" />\n'
            f'  <meta property="og:title" content="{e_title}" />\n'
            f'  <meta property="og:description" content="{e_desc}" />\n'
            f'  <meta property="og:image" content="{e_img}" />\n'
            f'  <meta property="og:image:width" content="1200" />\n'
            f'  <meta property="og:image:height" content="630" />\n'
            f'  <meta name="twitter:card" content="summary_large_image" />\n'
            f'  <meta name="twitter:title" content="{e_title}" />\n'
            f'  <meta name="twitter:description" content="{e_desc}" />\n'
            f'  <meta name="twitter:image" content="{e_img}" />'
        )
        out_html = cleaned.replace("<head>", f"<head>\n  {injected}", 1)
        return HTMLResponse(content=out_html, headers={"Cache-Control": "no-cache"})

    return router
