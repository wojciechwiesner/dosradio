"""FastAPI endpoints for Friends, Invite-with-Greeting, Drops & URL-Podcast Links."""
from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any, Callable

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .auth import AccessService
from .custom_radios import resolve_actor_key
from .db import Database
from .dedications import DedicationStore, build_dedication_script
from .hosts import host_for
from .podcast import PodcastService
from .podcast_quota import PodcastQuota
from .social import SocialService, build_share_links
from .spots import SpotService
from .url_extractor import extract_webpage_content
from .url_podcast_prompt import build_url_podcast_prompt

log = logging.getLogger("dosradio.social")


class PresenceBody(BaseModel):
    station_id: str = Field(default="dos-groove", max_length=64)
    display_name: str = Field(default="", max_length=60)
    email: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=32)


class AddFriendBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    email: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=32)
    channel: str = Field(default="whatsapp", max_length=20)
    with_greeting: bool = True
    greeting_message: str = Field(default="", max_length=320)
    station_id: str = Field(default="dos-groove", max_length=64)
    from_name: str = Field(default="", max_length=60)


class CreateDropBody(BaseModel):
    to_friend_id: str = Field(default="", max_length=40)
    to_name: str = Field(default="Znajomy", max_length=60)
    from_name: str = Field(default="", max_length=60)
    kind: str = Field(default="greeting", max_length=20)
    station_id: str = Field(default="dos-groove", max_length=64)
    message: str = Field(default="", max_length=500)
    source_url: str = Field(default="", max_length=500)
    topic: str = Field(default="", max_length=400)
    comment: str = Field(default="", max_length=400)


class ClaimDropBody(BaseModel):
    display_name: str = Field(default="", max_length=60)


class UrlPodcastLinkBody(BaseModel):
    url: str = Field(min_length=3, max_length=500)
    comment: str = Field(default="", max_length=400)
    recipient_name: str = Field(default="", max_length=60)
    from_name: str = Field(default="", max_length=60)
    station_id: str = Field(default="dos-groove", max_length=64)


def build_social_router(
    db: Database,
    access: AccessService,
    podcasts: PodcastService,
    station_lookup: Callable[[str], dict[str, Any] | None],
    quota: PodcastQuota | None = None,
) -> APIRouter:
    quota = quota or PodcastQuota(db)
    router = APIRouter(prefix="/radio-api/social", tags=["social"])
    social = SocialService(db)
    ded_store = DedicationStore(db.path)
    spots_svc = SpotService(podcasts.client, db.path.parent / "spots")
    bg_tasks: set[asyncio.Task[Any]] = set()

    def _caller_name(request: Request, explicit: str = "") -> str:
        if explicit.strip():
            return explicit.strip()[:60]
        hdr = (request.headers.get("x-display-name") or "").strip()
        if hdr:
            return hdr[:60]
        cur = access.resolve(request.cookies, request.client.host if request.client else "0.0.0.0")
        if cur.email:
            return cur.email.split("@")[0][:40]
        return "Znajomy"

    def _make_dedication(station_id: str, to_name: str, from_name: str, msg: str, actor_key: str) -> dict[str, Any]:
        st = station_lookup(station_id) or {"id": "dos-groove", "name": "Ambi Groove"}
        sid = str(st["id"])
        sname = str(st.get("name") or sid)
        host = host_for(sid)
        script = build_dedication_script(
            host_name=host.name, station_name=sname,
            to_name=to_name or "Ciebie", from_name=from_name,
            message=msg, lang="pl",
        )
        ip_hash = hashlib.sha256(actor_key.encode()).hexdigest()[:16]
        return ded_store.create(
            station_id=sid, station_name=sname, host_name=host.name,
            to_name=to_name or "Ciebie", from_name=from_name,
            message=msg, lang="pl", script=script, ip_hash=ip_hash,
        )

    def _enrich_drop(drop: dict[str, Any]) -> dict[str, Any]:
        out = dict(drop)
        st_info = station_lookup(str(out.get("station_id") or "dos-groove")) or {"id": "dos-groove", "name": "Ambi Groove"}
        st_name = str(st_info.get("name") or out.get("station_id") or "Ambi Groove")
        st_genre = str(st_info.get("genre") or st_info.get("subtitle") or st_info.get("vibe") or "klubowa elektronika i groove")
        if out.get("dedication_token"):
            ded = ded_store.get(out["dedication_token"])
            if ded:
                out["dedication"] = ded
                out["audio_url"] = ded["audio_url"]
        pid = out.get("podcast_id") or ""
        pod_title = str(out.get("site_title") or "")
        pod_summary = str(out.get("message") or out.get("pill_text") or out.get("comment") or "")
        if pid:
            mf = podcasts.load_manifest(pid)
            if mf:
                tok = out["token"]
                pod_title = str(mf.get("title") or pod_title or mf.get("topic") or "Audycja specjalna")
                pod_summary = str(mf.get("summary") or pod_summary or mf.get("topic") or "")[:260]
                parts = []
                for p in mf.get("parts", []):
                    if p.get("kind") not in ("voice", "bumper", None):
                        continue
                    fname = str(p.get("file") or str(p.get("url", "")).rsplit("/", 1)[-1])
                    if fname:
                        parts.append({
                            "kind": p.get("kind", "voice"),
                            "section": p.get("section", "part_1"),
                            "speaker": p.get("speaker"),
                            "text": p.get("text", ""),
                            "file": fname,
                            "url": f"/radio-api/social/drops/{tok}/parts/{fname}",
                        })
                out["podcast"] = {
                    "id": pid,
                    "status": "ready",
                    "title": pod_title,
                    "summary": pod_summary,
                    "topic": mf.get("topic", ""),
                    "hosts": mf.get("hosts", []),
                    "parts": parts,
                }
            else:
                out["podcast"] = {"id": pid, "status": out.get("podcast_status") or "generating", "parts": []}
        elif out.get("podcast_status"):
            out["podcast"] = {
                "id": "",
                "status": out["podcast_status"],
                "error": out.get("podcast_error", ""),
                "parts": [],
            }
        inv_title = pod_title or (f"Pozdrowienie dla: {out.get('to_name')}" if out.get("kind") == "greeting" else "Audycja specjalna AmbiRadio")
        inv_about = pod_summary or "wyjątkowe wejście prowadzących przygotowane specjalnie dla Ciebie"
        out["invite"] = {
            "title": inv_title[:140],
            "about": inv_about[:260],
            "station_id": str(st_info.get("id") or out.get("station_id") or "dos-groove"),
            "station_name": st_name,
            "station_genre": st_genre,
            "from_name": str(out.get("from_name") or ""),
            "to_name": str(out.get("to_name") or ""),
            "comment": str(out.get("comment") or ""),
        }
        return out

    async def _generate_drop_podcast_bg(token: str, topic_prompt: str, reservation: int | None = 0) -> None:
        try:
            manifest = await podcasts.episode(topic_prompt, headlines=[])
            social.update_drop_podcast(token, podcast_id=manifest["id"], status="ready")
        except Exception as exc:
            quota.release(reservation)  # a failed run does not use up the day
            log.warning("Background drop podcast %s failed: %s", token, exc)
            social.update_drop_podcast(token, status="failed", error=str(exc))

    def _spawn(coro: Any) -> None:
        task = asyncio.create_task(coro)
        bg_tasks.add(task)
        task.add_done_callback(bg_tasks.discard)

    @router.post("/presence")
    async def post_presence(body: PresenceBody, request: Request) -> dict[str, Any]:
        actor = resolve_actor_key(request, access, db)
        name = _caller_name(request, body.display_name)
        social.upsert_identity(actor, display_name=name, email=body.email, phone=body.phone)
        friends_online, incoming = social.heartbeat(actor, body.station_id, name)
        return {
            "ok": True,
            "me_key": actor,
            "friends_online": friends_online,
            "incoming_live_drops": [_enrich_drop(d) for d in incoming],
        }

    @router.get("/friends")
    async def get_friends(request: Request) -> dict[str, Any]:
        actor = resolve_actor_key(request, access, db)
        return {"friends": social.list_friends(actor)}

    @router.post("/friends")
    async def post_friend(body: AddFriendBody, request: Request) -> dict[str, Any]:
        actor = resolve_actor_key(request, access, db)
        sender = _caller_name(request, body.from_name)
        social.upsert_identity(actor, display_name=sender)
        friend = social.add_friend(actor, body.name, email=body.email, phone=body.phone, channel=body.channel)
        if not body.with_greeting:
            return {"friend": friend}
        msg = body.greeting_message.strip() or f"Wskakuj na wspólny odsłuch w AmbiRadio!"
        ded = _make_dedication(body.station_id, body.name, sender, msg, actor)
        drop = social.create_drop(
            prefix="w", from_key=actor, from_name=sender,
            to_friend_id=friend["id"], to_key=friend.get("friend_key", ""),
            to_name=body.name.strip(), kind="greeting", station_id=ded["station_id"],
            message=msg, dedication_token=ded["id"],
        )
        invite_txt = f"Cześć {body.name.strip()}! {sender} zaprasza Cię do AmbiRadio i zostawił pozdrowienie u prowadzącego:"
        links = build_share_links("w", drop["token"], invite_txt, email=friend.get("email", ""), phone=friend.get("phone", ""))
        return {"friend": friend, "drop_token": drop["token"], "drop": _enrich_drop(drop), **links}

    @router.post("/drops")
    async def post_drop(body: CreateDropBody, request: Request, background_tasks: BackgroundTasks) -> dict[str, Any]:
        actor = resolve_actor_key(request, access, db)
        sender = _caller_name(request, body.from_name)
        to_key = ""
        to_name = body.to_name.strip() or "Znajomy"
        email_t, phone_t = "", ""
        if body.to_friend_id:
            fr = next((f for f in social.list_friends(actor) if f["id"] == body.to_friend_id), None)
            if fr:
                to_key = fr.get("friend_key", "")
                to_name = fr["name"]
                email_t, phone_t = fr.get("email", ""), fr.get("phone", "")

        kind = body.kind if body.kind in ("greeting", "pill", "podcast") else "greeting"
        ded_tok, pill_txt, site_title, pod_status = "", "", "", ""

        if kind == "greeting":
            ded = _make_dedication(body.station_id, to_name, sender, body.message or "Dobrego odsłuchu!", actor)
            ded_tok = ded["id"]
        elif kind == "pill":
            summary = body.message.strip() or body.topic.strip()
            if body.source_url.strip():
                try:
                    site = extract_webpage_content(body.source_url.strip())
                    site_title = site["title"]
                    summary = f"{site['title']}: {(site['description'] or site['text'])[:220]}"
                except ValueError as err:
                    raise HTTPException(422, str(err)) from err
                except Exception:
                    summary = summary or body.source_url.strip()
            pill_txt = summary[:280]
            ded = _make_dedication(body.station_id, to_name, sender, f"Wrzutka pigułki: {pill_txt}", actor)
            ded_tok = ded["id"]
        else:  # podcast
            pod_status = "generating"

        drop = social.create_drop(
            prefix="w", from_key=actor, from_name=sender,
            to_friend_id=body.to_friend_id, to_key=to_key, to_name=to_name,
            kind=kind, station_id=body.station_id, message=body.message,
            source_url=body.source_url, site_title=site_title, comment=body.comment,
            dedication_token=ded_tok, pill_text=pill_txt, podcast_status=pod_status,
        )
        if kind == "podcast":
            topic_prompt = body.topic.strip() or body.message.strip() or "Najciekawsze trendy dnia"
            if body.source_url.strip():
                try:
                    site = extract_webpage_content(body.source_url.strip())
                    topic_prompt = f"Strona: {site['title']}. {site['description']} {site['text'][:1600]}"
                except ValueError as err:
                    raise HTTPException(422, str(err)) from err
                except Exception:
                    pass
            topic_prompt += f"\nPozdrów słuchacza {to_name} od {sender}. {body.comment}".strip()
            background_tasks.add_task(_generate_drop_podcast_bg, drop["token"], topic_prompt)

        links = build_share_links("w", drop["token"], f"{sender} wrzuca Ci materiał na antenę AmbiRadio:", email=email_t, phone=phone_t)
        return {"token": drop["token"], "drop": _enrich_drop(drop), **links}

    @router.post("/url-podcast-link")
    async def create_url_podcast_link(body: UrlPodcastLinkBody, request: Request, background_tasks: BackgroundTasks) -> Any:
        actor = resolve_actor_key(request, access, db)
        sender = _caller_name(request, body.from_name)
        try:
            site = extract_webpage_content(body.url)
        except ValueError as err:
            raise HTTPException(422, str(err)) from err
        except Exception as err:
            raise HTTPException(502, f"Nie udało się odczytać strony WWW: {err}") from err

        recip = body.recipient_name.strip()
        intro_note = f"Odbiorca audycji: {recip}. " if recip else ""
        if body.comment.strip():
            intro_note += f"Komentarz od {sender} do przytoczenia na wejściu: {body.comment.strip()}."
        topic_prompt = build_url_podcast_prompt(site, intro_note)
        reservation = 0  # replaying an existing episode is free
        if not quota.is_replay(podcasts, topic_prompt):
            reservation = quota.reserve(actor)
            if reservation is None:
                return quota.limit_response()
        site_about = (site["description"] or site["text"][:220]).strip()[:260]
        drop = social.create_drop(
            prefix="p", from_key=actor, from_name=sender,
            to_name=recip or site["domain"], kind="podcast", station_id=body.station_id,
            message=site_about,
            source_url=site["url"], site_title=site["title"], comment=body.comment.strip(),
            podcast_status="generating",
        )
        background_tasks.add_task(_generate_drop_podcast_bg, drop["token"], topic_prompt, reservation)
        st_meta = station_lookup(body.station_id) or {"name": body.station_id}
        st_label = str(st_meta.get("name") or body.station_id)
        inv = (
            f"Zapraszam do wysłuchania audycji w radiu pt. „{site['title']}”, "
            f"która opowiada o: {site_about[:120]} — przy muzyce {st_label}:"
        )
        links = build_share_links("p", drop["token"], inv)
        enriched = _enrich_drop(drop)
        return {
            "token": drop["token"],
            "site_title": site["title"],
            "station_id": body.station_id,
            "drop": enriched,
            "invite": enriched["invite"],
            **links,
        }

    @router.get("/spot")
    async def get_promo_spot(request: Request, station: str = "dos-groove") -> dict[str, Any]:
        ip = request.client.host if request.client else "0.0.0.0"
        cur = access.resolve(request.cookies, ip)
        return spots_svc.pick_for_access(cur, station_id=station)

    @router.get("/spots")
    async def list_promo_spots() -> dict[str, Any]:
        return {"spots": spots_svc.list_all()}

    @router.get("/spot/{spot_id}.wav")
    async def get_promo_spot_audio(spot_id: str, station: str = "dos-groove") -> FileResponse:
        safe_id = "".join(c for c in spot_id if c.isalnum() or c == "_")
        try:
            wav_path = await spots_svc.render_wav(safe_id, station_id=station)
        except KeyError as err:
            raise HTTPException(404, "Nieznany spot") from err
        return FileResponse(wav_path, media_type="audio/wav")

    @router.get("/url-podcast-link/{token}")
    async def get_url_podcast_link(token: str) -> dict[str, Any]:
        drop = social.get_drop(token)
        if not drop:
            raise HTTPException(404, "Nie znaleziono tej audycji")
        return {"drop": _enrich_drop(drop)}

    @router.get("/drops/{token}")
    async def get_drop(token: str) -> dict[str, Any]:
        drop = social.get_drop(token)
        if not drop:
            raise HTTPException(404, "Nie znaleziono wrzutki")
        return {"drop": _enrich_drop(drop)}

    @router.post("/drops/{token}/claim")
    async def claim_drop(token: str, body: ClaimDropBody, request: Request) -> dict[str, Any]:
        actor = resolve_actor_key(request, access, db)
        cname = _caller_name(request, body.display_name)
        social.upsert_identity(actor, display_name=cname)
        claimed = social.claim_drop(token, actor, cname)
        if not claimed:
            raise HTTPException(404, "Nie znaleziono wrzutki")
        return {"drop": _enrich_drop(claimed), "auto_paired": claimed.get("auto_paired", False)}

    @router.get("/drops/{token}/parts/{file_name}")
    async def get_drop_podcast_part(token: str, file_name: str) -> FileResponse:
        drop = social.get_drop(token)
        if not drop or not drop.get("podcast_id"):
            raise HTTPException(404, "Brak nagrania dla tej wrzutki")
        try:
            path = podcasts.part_path(drop["podcast_id"], file_name)
        except FileNotFoundError as exc:
            raise HTTPException(404, "Nie znaleziono fragmentu audio") from exc
        media = "audio/wav" if file_name.endswith(".wav") else "audio/ogg; codecs=opus"
        return FileResponse(path, media_type=media, headers={"cache-control": "public, max-age=86400"})

    return router
