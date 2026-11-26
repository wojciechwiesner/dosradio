"""Dynamic OpenGraph / Social Miniature (1200x630 PNG) & SSR Meta Tags for shared links."""
from __future__ import annotations

import html
import os
import re
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, Response

from .comments import CommentService
from .config import BRAND_NAME, BRAND_TAGLINE, public_base_url, public_domain
from .og_card import DEFAULT_ABOUT, DEFAULT_TITLE, render_og_card_png, shorten
from .custom_radios import CustomRadioService
from .db import Database
from .dedications import DedicationStore
from .podcast import PodcastService
from .social import SocialService

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
        title = DEFAULT_TITLE
        about = DEFAULT_ABOUT
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

        st_info = station_lookup(st_id) or {"name": st_id or "Ambi Groove"}
        st_name = str(st_info.get("name") or "Ambi Groove")
        full_og_title = f"{title} — audycja w radiu {BRAND_NAME}"
        full_og_desc = f"{title}. {shorten(about, 150)} Posłuchaj na żywo w {BRAND_NAME}, przy muzyce {st_name}."
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
