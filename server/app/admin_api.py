"""Protected Admin API router for AmbiRadio: overview, tracks, mixer preview, tokens, users, catalog, ramówka, leads."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import io
import json
import logging
import os
import re
import secrets
import shutil
import subprocess
import time
import wave
from pathlib import Path
from typing import Any, Callable

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .archive import ArchiveRegistry, TARGET_SEGMENT_SECONDS
from .auth import SESSION_COOKIE, AccessService, client_ip, token_hash, verify_password
from .auto_ramowka import RamowkaService
from .catalog import CatalogService, validate_slug
from .db import Database, SECONDS_PER_DAY
from . import mixer
from .telemetry import TelemetryService

log = logging.getLogger("dosradio.admin")

SEGMENT_FILENAME_RE = re.compile(r"^seg-(\d+)\.opus$")
SESSION_GAP_S = 45.0
ADMIN_TOKEN_DERIVATION_LABEL = b"dosradio-admin-token-v1"

DEFAULT_MIXER_CONFIG: dict[str, Any] = {
    "crossfade_beats": 32,
    "fallback_fade_seconds": 12.0,
    "bass_swap_position": 0.5,
    "equal_power_highs": True,
    "tempo_lock": True,
    "intra_declick_ms": 15.0,
    "technique": "auto",
}


def _admin_emails() -> set[str]:
    raw = os.environ.get("DOSRADIO_ADMIN_EMAILS", "wojciech@theones.io")
    emails = {item.strip().lower() for item in raw.split(",") if item.strip()}
    return emails or {"wojciech@theones.io"}


def _derive_admin_token(app_secret: str) -> str:
    """Derive the fallback admin token from the app secret so no secret material is ever exposed."""
    return hmac.new(app_secret.encode("utf-8"), ADMIN_TOKEN_DERIVATION_LABEL, hashlib.sha256).hexdigest()


def _expected_admin_token(access: AccessService | None = None) -> str:
    env_tok = os.environ.get("DOSRADIO_ADMIN_TOKEN", "").strip()
    if env_tok:
        return env_tok
    env_secret = os.environ.get("DOSRADIO_SECRET", "").strip()
    if env_secret:
        return _derive_admin_token(env_secret)
    if access is not None and getattr(access, "secret", ""):
        return _derive_admin_token(str(access.secret))
    return ""


def _decode_segment_sync(path: Path) -> np.ndarray:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-f",
        "s16le",
        "-ar",
        str(mixer.RATE),
        "-ac",
        str(mixer.CHANNELS),
        "pipe:1",
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"ffmpeg decode failed for {path.name}: {proc.stderr.decode()[:200]}")
    return mixer.pcm_to_float(proc.stdout)


def _pcm_float_to_wav_bytes(audio: np.ndarray, rate: int = mixer.RATE) -> bytes:
    pcm_bytes = mixer.float_to_pcm(audio)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(mixer.CHANNELS)
        wav_file.setsampwidth(2)
        wav_file.setframerate(rate)
        wav_file.writeframes(pcm_bytes)
    return buf.getvalue()


def _envelope_60_points(audio: np.ndarray) -> list[float]:
    if len(audio) == 0:
        return [-60.0] * 60
    mono = audio.mean(axis=1)
    indices = np.array_split(np.arange(len(mono)), 60)
    points: list[float] = []
    for idx in indices:
        if len(idx) == 0:
            points.append(-60.0)
            continue
        chunk = mono[idx]
        rms = float(np.sqrt(np.mean(chunk * chunk)))
        db = float(20.0 * np.log10(max(rms, 1e-5)))
        points.append(round(max(-60.0, db), 2))
    return points


def run_builtin_mixer_preview(
    path_a: Path,
    path_b: Path,
    crossfade_beats: int = 32,
    fallback_fade_seconds: float = 12.0,
    bass_swap_position: float = 0.5,
    equal_power_highs: bool = True,
    tempo_lock: bool = True,
    context_seconds: float = 16.0,
    technique: str = "auto",
    station_a: str | None = None,
    station_b: str | None = None,
) -> dict[str, Any]:
    if shutil.which("ffmpeg") is None:
        raise HTTPException(503, "ffmpeg niedostępny na serwerze")
    tail = _decode_segment_sync(path_a)
    head = _decode_segment_sync(path_b)

    tail_onsets = mixer._onsets_of(tail, from_end=True)
    head_onsets = mixer._onsets_of(head, from_end=False)
    tail_period = mixer.steady_period(tail_onsets)
    head_period = mixer.steady_period(head_onsets)
    cfg = mixer.MixerConfig(
        crossfade_beats=max(2, min(64, int(crossfade_beats))),
        fallback_fade_seconds=max(0.2, min(22.0, float(fallback_fade_seconds))),
        bass_swap_position=max(0.0, min(1.0, float(bass_swap_position))),
        equal_power_highs=bool(equal_power_highs),
        tempo_lock=bool(tempo_lock),
        technique=technique,
    )
    joined, rep = mixer.mix_with_report(tail, head, cfg, station_a=station_a, station_b=station_b)
    rep_dict = rep.to_dict()

    lost_frames = max(0, len(tail) + len(head) - len(joined))
    overlap_seconds = rep_dict["overlap_seconds"]

    seam_frame = max(0, len(tail) - lost_frames // 2)
    ctx_frames = int(max(1.0, min(20.0, float(context_seconds))) * mixer.RATE)
    half_overlap = lost_frames // 2
    start_frame = max(0, seam_frame - ctx_frames - half_overlap)
    end_frame = min(len(joined), seam_frame + ctx_frames + half_overlap)
    snippet = joined[start_frame:end_frame]
    if len(snippet) == 0:
        snippet = joined

    peak = float(np.max(np.abs(snippet))) if len(snippet) > 0 else 1e-6
    peak_db = round(float(20.0 * np.log10(max(peak, 1e-6))), 2)

    mono_snippet = snippet.mean(axis=1) if len(snippet) > 0 else np.zeros(1, dtype=np.float32)
    low_mono = mixer._low_pass(mono_snippet)
    mid_mono = mono_snippet - low_mono
    sub_rms = float(np.sqrt(np.mean(low_mono * low_mono)))
    mid_rms = float(np.sqrt(np.mean(mid_mono * mid_mono)))
    sub_rms_db = round(float(20.0 * np.log10(max(sub_rms, 1e-6))), 2)
    mid_rms_db = round(float(20.0 * np.log10(max(mid_rms, 1e-6))), 2)

    envelope_db = _envelope_60_points(snippet)
    wav_bytes = _pcm_float_to_wav_bytes(snippet)
    dur_s = round(len(snippet) / mixer.RATE, 2)

    return {
        "ok": True,
        "report": rep_dict,
        "mode": rep_dict["mode"],
        "segment_a": path_a.name,
        "segment_b": path_b.name,
        "tail_bpm": rep_dict["tail_bpm"],
        "head_bpm": rep_dict["head_bpm"],
        "overlap_seconds": overlap_seconds,
        "beats_mixed": rep_dict["beats_mixed"],
        "bass_swap_seconds": rep_dict["bass_swap_seconds"],
        "snippet_seconds": dur_s,
        "duration_seconds": dur_s,
        "peak_db": peak_db,
        "peak_dbfs": peak_db,
        "sub_rms_db": sub_rms_db,
        "mid_rms_db": mid_rms_db,
        "envelope_db": envelope_db,
        "params": {
            "crossfade_beats": crossfade_beats,
            "fallback_fade_seconds": fallback_fade_seconds,
            "bass_swap_position": bass_swap_position,
            "equal_power_highs": equal_power_highs,
            "tempo_lock": tempo_lock,
        },
        "audio_wav_base64": base64.b64encode(wav_bytes).decode("ascii"),
    }


class AdminLoginRequest(BaseModel):
    email: str | None = None
    password: str | None = None
    token: str | None = None


class MixerConfigPayload(BaseModel):
    crossfade_beats: int = Field(default=32, ge=2, le=64)
    fallback_fade_seconds: float = Field(default=12.0, ge=0.1, le=22.0)
    bass_swap_position: float = Field(default=0.5, ge=0.0, le=1.0)
    equal_power_highs: bool = True
    tempo_lock: bool = True
    intra_declick_ms: float = Field(default=15.0, ge=0.0, le=250.0)
    technique: str = Field(default="auto", max_length=24)


class MixerPreviewRequest(BaseModel):
    station_a: str
    segment_a: str | None = None
    station_b: str | None = None
    segment_b: str | None = None
    crossfade_beats: int = Field(default=32, ge=2, le=64)
    fallback_fade_seconds: float = Field(default=12.0, ge=0.1, le=22.0)
    bass_swap_position: float = Field(default=0.5, ge=0.0, le=1.0)
    equal_power_highs: bool = True
    tempo_lock: bool = True
    context_seconds: float = Field(default=16.0, ge=1.0, le=28.0)
    technique: str = Field(default="auto", max_length=24)


class UserPatchRequest(BaseModel):
    plan: str | None = None
    plus_days: int | None = None
    email_verified: bool | None = None


class GroupCreateRequest(BaseModel):
    id: str
    name: str
    tagline: str = ""
    color: str = "#8f6bff"
    sort_order: int = 0
    enabled: bool = True


class GroupPatchRequest(BaseModel):
    name: str | None = None
    tagline: str | None = None
    color: str | None = None
    sort_order: int | None = None
    enabled: bool | None = None


class StationCreateRequest(BaseModel):
    id: str
    group_id: str
    name: str
    tagline: str = ""
    prompt: str
    bpm: int = 120
    density: float = 0.45
    brightness: float = 0.45
    category: str = "fokus"
    host: str = "Kuba"
    sort_order: int = 0
    enabled: bool = True


class StationPatchRequest(BaseModel):
    group_id: str | None = None
    name: str | None = None
    tagline: str | None = None
    prompt: str | None = None
    bpm: int | None = None
    density: float | None = None
    brightness: float | None = None
    category: str | None = None
    host: str | None = None
    sort_order: int | None = None
    enabled: bool | None = None


class RamowkaHourRequest(BaseModel):
    station_id: str
    slot_label: str = ""


class SpotCreateRequest(BaseModel):
    id: str
    kind: str = "ad"
    title: str
    script: str
    voice: str = "Orus"
    cta_label: str = ""
    cta_url: str = ""
    enabled: bool = True
    sort_order: int = 0


class SpotPatchRequest(BaseModel):
    kind: str | None = None
    title: str | None = None
    script: str | None = None
    voice: str | None = None
    cta_label: str | None = None
    cta_url: str | None = None
    enabled: bool | None = None
    sort_order: int | None = None


class LeadPatchRequest(BaseModel):
    status: str


def build_admin_router(
    db: Database,
    access: AccessService,
    archives: ArchiveRegistry,
    catalog: CatalogService,
    telemetry: TelemetryService,
    ramowka_service: RamowkaService,
    recorder: Any = None,
    mixer_preview_fn: Callable[..., Any] | None = None,
    mixer_config_holder: dict[str, Any] | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/radio-api/admin")
    data_dir = db.path.parent
    mixer_config_path = data_dir / "mixer_config.json"

    def _load_mixer_config() -> dict[str, Any]:
        cfg = dict(DEFAULT_MIXER_CONFIG)
        if mixer_config_holder is not None:
            cfg.update(mixer_config_holder)
        if mixer_config_path.exists():
            try:
                stored = json.loads(mixer_config_path.read_text())
                if isinstance(stored, dict):
                    cfg.update(stored)
            except Exception as err:
                log.warning("Could not read mixer_config.json: %s", err)
        if mixer_config_holder is not None:
            mixer_config_holder.update(cfg)
        return cfg

    def _save_mixer_config(new_cfg: dict[str, Any]) -> dict[str, Any]:
        cfg = _load_mixer_config()
        cfg.update(new_cfg)
        if mixer_config_holder is not None:
            mixer_config_holder.update(cfg)
        mixer.set_default_mixer_config(mixer.MixerConfig(
            crossfade_beats=max(2, min(64, int(cfg.get("crossfade_beats", 32)))),
            fallback_fade_seconds=max(0.2, min(22.0, float(cfg.get("fallback_fade_seconds", 12.0)))),
            bass_swap_position=max(0.0, min(1.0, float(cfg.get("bass_swap_position", 0.5)))),
            equal_power_highs=bool(cfg.get("equal_power_highs", True)),
            tempo_lock=bool(cfg.get("tempo_lock", True)),
            intra_declick_ms=max(0.0, min(250.0, float(cfg.get("intra_declick_ms", 15.0)))),
            technique=str(cfg.get("technique", "auto")),
        ))
        try:
            tmp = mixer_config_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False))
            tmp.replace(mixer_config_path)
        except Exception as err:
            log.warning("Could not save mixer_config.json: %s", err)
        return cfg

    def require_admin(request: Request) -> dict[str, Any]:
        admin_emails = _admin_emails()
        expected_tok = _expected_admin_token(access)

        header_tok = (request.headers.get("x-admin-token") or "").strip()
        if not header_tok:
            auth_header = (request.headers.get("authorization") or "").strip()
            if auth_header.lower().startswith("bearer "):
                header_tok = auth_header[7:].strip()

        if header_tok:
            if expected_tok and hmac.compare_digest(header_tok, expected_tok):
                return {"admin": True, "email": sorted(admin_emails)[0], "via": "token"}
            raise HTTPException(403, "Brak uprawnień administratora")

        ip = client_ip(
            {k.lower(): v for k, v in request.headers.items()},
            request.client.host if request.client else None,
        )
        resolved = access.resolve(request.cookies, ip)
        if resolved.registered and resolved.email:
            email_low = resolved.email.strip().lower()
            user = db.find_user_by_email(email_low)
            if user is not None and email_low in admin_emails:
                return {"admin": True, "email": email_low, "via": "session"}
            raise HTTPException(403, "Brak uprawnień administratora")

        raise HTTPException(401, "Wymagane uwierzytelnienie administratora")

    @router.post("/login")
    def admin_login(body: AdminLoginRequest, response: Response) -> dict[str, Any]:
        admin_emails = _admin_emails()
        expected_tok = _expected_admin_token(access)

        if body.token:
            candidate = body.token.strip()
            if expected_tok and hmac.compare_digest(candidate, expected_tok):
                return {"ok": True, "admin": True, "email": sorted(admin_emails)[0], "token": expected_tok}
            raise HTTPException(403, "Brak uprawnień administratora")

        if body.email and body.password:
            clean_email = body.email.strip().lower()
            if clean_email not in admin_emails:
                raise HTTPException(403, "Brak uprawnień administratora")
            user = db.find_user_by_email(clean_email)
            if not user or not user["email_verified"] or not verify_password(body.password, user["password_hash"]):
                raise HTTPException(403, "Brak uprawnień administratora")
            sess_tok = secrets.token_urlsafe(32)
            db.create_session(token_hash(sess_tok), int(user["id"]))
            response.set_cookie(
                SESSION_COOKIE,
                sess_tok,
                max_age=180 * 24 * 3600,
                httponly=True,
                secure=True,
                samesite="lax",
                path="/",
            )
            return {"ok": True, "admin": True, "email": clean_email}

        raise HTTPException(403, "Brak uprawnień administratora")

    def _collect_all_station_ids() -> list[str]:
        ids = {s["id"] for s in catalog.list_stations(include_disabled=True)}
        ids.update(archives.archives.keys())
        if archives.root.exists():
            for child in archives.root.iterdir():
                if child.is_dir() and SLUG_RE_SAFE.match(child.name):
                    ids.add(child.name)
        return sorted(ids)

    @router.get("/overview")
    def admin_overview(_: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
        now = time.time()
        with db.connect() as conn:
            total_users = int(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0])
            verified_users = int(conn.execute("SELECT COUNT(*) FROM users WHERE email_verified = 1").fetchone()[0])
            plus_users = int(
                conn.execute(
                    "SELECT COUNT(*) FROM users WHERE plan = 'plus' AND (plus_until IS NULL OR plus_until > ?)",
                    (now,),
                ).fetchone()[0]
            )
            trial_cutoff = now - getattr(access, "trial_seconds", 3600)
            active_trials = int(
                conn.execute("SELECT COUNT(*) FROM trials WHERE started_at >= ?", (trial_cutoff,)).fetchone()[0]
            )
            leads_count = int(conn.execute("SELECT COUNT(*) FROM zrobimy_leads").fetchone()[0])
            new_leads_count = int(
                conn.execute("SELECT COUNT(*) FROM zrobimy_leads WHERE status = 'new'").fetchone()[0]
            )

        total_segments = 0
        total_bytes = 0
        per_station: dict[str, dict[str, Any]] = {}
        for sid in _collect_all_station_ids():
            arch = archives.get(sid)
            segs = arch.list_segments()
            seg_count = len(segs)
            station_bytes = sum(p.stat().st_size for p in segs if p.exists())
            hours = round((seg_count * TARGET_SEGMENT_SECONDS) / 3600.0, 2)
            total_segments += seg_count
            total_bytes += station_bytes
            per_station[sid] = {
                "segments": seg_count,
                "hours": hours,
                "disk_mb": round(station_bytes / (1024 * 1024), 2),
            }

        total_hours = round((total_segments * TARGET_SEGMENT_SECONDS) / 3600.0, 2)
        total_disk_mb = round(total_bytes / (1024 * 1024), 2)

        return {
            "ok": True,
            "users": {
                "registered": total_users,
                "verified": verified_users,
                "active_plus": plus_users,
                "active_trials": active_trials,
            },
            "registered_users": total_users,
            "verified_users": verified_users,
            "active_plus_users": plus_users,
            "active_trials": active_trials,
            "listeners": telemetry.active_listeners(),
            "tokens": telemetry.token_summary(days=30),
            "archive": {
                "total_segments": total_segments,
                "total_hours": total_hours,
                "total_disk_mb": total_disk_mb,
                "current_station": getattr(recorder, "current_station", None) if recorder is not None else None,
                "per_station": per_station,
            },
            "leads_count": leads_count,
            "new_leads_count": new_leads_count,
        }

    @router.get("/tracks")
    def admin_list_tracks(
        station_id: str | None = Query(default=None),
        limit: int = Query(default=100, ge=1, le=1000),
        offset: int = Query(default=0, ge=0),
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        if station_id is not None:
            sid = validate_slug(station_id)
            station_ids = [sid]
        else:
            station_ids = _collect_all_station_ids()

        all_tracks: list[dict[str, Any]] = []
        for sid in station_ids:
            arch = archives.get(sid)
            segs = arch.list_segments()
            prev_ts: float | None = None
            for path in segs:
                m = SEGMENT_FILENAME_RE.match(path.name)
                if not m:
                    continue
                stamp_ns = int(m.group(1))
                rec_at = round(stamp_ns / 1_000_000_000.0, 3)
                is_start = prev_ts is None or (rec_at - prev_ts) > SESSION_GAP_S
                prev_ts = rec_at
                try:
                    sz = path.stat().st_size
                except OSError:
                    continue
                all_tracks.append(
                    {
                        "station_id": sid,
                        "filename": path.name,
                        "size_bytes": sz,
                        "recorded_at": rec_at,
                        "duration_s": TARGET_SEGMENT_SECONDS,
                        "is_session_start": is_start,
                        "audio_url": f"/radio-api/admin/tracks/{sid}/{path.name}/audio",
                    }
                )

        all_tracks.sort(key=lambda item: (item["recorded_at"], item["filename"]), reverse=True)
        total = len(all_tracks)
        sliced = all_tracks[offset : offset + limit]
        return {
            "total": total,
            "offset": offset,
            "limit": limit,
            "tracks": sliced,
        }

    def _resolve_track_path(station_id: str, filename: str) -> Path:
        try:
            sid = validate_slug(station_id)
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        if not SEGMENT_FILENAME_RE.match(filename):
            raise HTTPException(400, "Nieprawidłowa nazwa pliku segmentu")
        arch = archives.get(sid)
        base_dir = arch.dir.resolve()
        candidate = (arch.dir / filename).resolve()
        if candidate.parent != base_dir or not candidate.exists():
            raise HTTPException(404, "Nie znaleziono nagrania")
        return candidate

    @router.get("/tracks/{station_id}/{filename}/audio")
    def admin_track_audio(
        station_id: str,
        filename: str,
        _: dict[str, Any] = Depends(require_admin),
    ) -> FileResponse:
        path = _resolve_track_path(station_id, filename)
        return FileResponse(path, media_type="audio/ogg")

    @router.delete("/tracks/{station_id}/{filename}")
    def admin_delete_track(
        station_id: str,
        filename: str,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        path = _resolve_track_path(station_id, filename)
        m = SEGMENT_FILENAME_RE.match(filename)
        path.unlink(missing_ok=True)
        if m:
            stamp = m.group(1)
            live_copy = archives.get(station_id).live_dir / f"live-{stamp}.opus"
            live_copy.unlink(missing_ok=True)
        return {"ok": True, "station_id": station_id, "deleted": filename}

    @router.get("/mixer/config")
    def admin_get_mixer_config(_: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
        return _load_mixer_config()

    @router.put("/mixer/config")
    def admin_put_mixer_config(
        body: MixerConfigPayload,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        updated = _save_mixer_config(body.model_dump())
        return {"ok": True, "config": updated, **updated}

    @router.post("/mixer/preview")
    async def admin_mixer_preview(
        body: MixerPreviewRequest,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        sid_a = validate_slug(body.station_a)
        sid_b = validate_slug(body.station_b or body.station_a)

        segs_a = archives.get(sid_a).list_segments()
        segs_b = archives.get(sid_b).list_segments()
        if not segs_a:
            raise HTTPException(404, f"Brak segmentów w archiwum stacji {sid_a}")
        if not segs_b:
            raise HTTPException(404, f"Brak segmentów w archiwum stacji {sid_b}")

        if body.segment_a:
            path_a = _resolve_track_path(sid_a, body.segment_a)
        else:
            path_a = segs_a[-2] if (sid_a == sid_b and len(segs_a) >= 2) else segs_a[-1]

        if body.segment_b:
            path_b = _resolve_track_path(sid_b, body.segment_b)
        else:
            if sid_a == sid_b:
                path_b = segs_b[-1]
            else:
                path_b = segs_b[1] if len(segs_b) >= 2 else segs_b[0]

        if mixer_preview_fn is not None:
            res = mixer_preview_fn(
                path_a=path_a,
                path_b=path_b,
                crossfade_beats=body.crossfade_beats,
                fallback_fade_seconds=body.fallback_fade_seconds,
                bass_swap_position=body.bass_swap_position,
                equal_power_highs=body.equal_power_highs,
                tempo_lock=body.tempo_lock,
                context_seconds=body.context_seconds,
            )
            if asyncio.iscoroutine(res):
                return await res
            return res

        return await asyncio.to_thread(
            run_builtin_mixer_preview,
            path_a=path_a,
            path_b=path_b,
            crossfade_beats=body.crossfade_beats,
            fallback_fade_seconds=body.fallback_fade_seconds,
            bass_swap_position=body.bass_swap_position,
            equal_power_highs=body.equal_power_highs,
            tempo_lock=body.tempo_lock,
            context_seconds=body.context_seconds,
            technique=body.technique,
            station_a=sid_a,
            station_b=sid_b,
        )

    @router.get("/tokens")
    def admin_get_tokens(
        days: int = Query(default=30, ge=1, le=365),
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        return telemetry.token_summary(days=days)

    @router.get("/users")
    def admin_list_users(_: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
        active = telemetry.active_listeners()
        online_emails = {
            (item["email"] or "").lower()
            for item in active["listeners"]
            if item.get("email")
        }
        online_ids = {
            int(item["user_id"])
            for item in active["listeners"]
            if item.get("user_id") is not None
        }
        with db.connect() as conn:
            rows = conn.execute(
                "SELECT u.id, u.email, u.created_at, u.email_verified, u.plan, u.plus_until, "
                "COUNT(s.token_hash) AS session_count "
                "FROM users u LEFT JOIN sessions s ON s.user_id = u.id "
                "GROUP BY u.id ORDER BY u.created_at DESC, u.id DESC"
            ).fetchall()

        users = [
            {
                "id": int(r["id"]),
                "email": r["email"],
                "created_at": float(r["created_at"]),
                "email_verified": bool(r["email_verified"]),
                "plan": r["plan"],
                "plus_until": float(r["plus_until"]) if r["plus_until"] is not None else None,
                "session_count": int(r["session_count"]),
                "is_online": int(r["id"]) in online_ids or (r["email"] or "").lower() in online_emails,
            }
            for r in rows
        ]
        return {"users": users, "total": len(users)}

    @router.patch("/users/{user_id}")
    def admin_patch_user(
        user_id: int,
        body: UserPatchRequest,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        with db.connect() as conn:
            existing = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if existing is None:
                raise HTTPException(404, "Nie znaleziono użytkownika")

            new_plan = body.plan if body.plan is not None else existing["plan"]
            new_plus_until = existing["plus_until"]
            if body.plus_days is not None:
                if body.plus_days > 0:
                    new_plus_until = time.time() + int(body.plus_days) * SECONDS_PER_DAY
                    if body.plan is None:
                        new_plan = "plus"
                else:
                    new_plus_until = None
                    if body.plan is None:
                        new_plan = "free"

            new_verified = (
                1 if body.email_verified else 0
            ) if body.email_verified is not None else int(existing["email_verified"])

            conn.execute(
                "UPDATE users SET plan = ?, plus_until = ?, email_verified = ? WHERE id = ?",
                (new_plan, new_plus_until, new_verified, user_id),
            )
            updated = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

        assert updated is not None
        return {
            "ok": True,
            "user": {
                "id": int(updated["id"]),
                "email": updated["email"],
                "created_at": float(updated["created_at"]),
                "email_verified": bool(updated["email_verified"]),
                "plan": updated["plan"],
                "plus_until": float(updated["plus_until"]) if updated["plus_until"] is not None else None,
            },
        }

    @router.get("/catalog")
    def admin_get_catalog(_: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
        return {
            "groups": catalog.list_groups(include_disabled=True),
            "stations": catalog.list_stations(include_disabled=True),
        }

    @router.post("/catalog/groups")
    def admin_create_group(
        body: GroupCreateRequest,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        try:
            grp = catalog.upsert_group(body.model_dump())
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        return {"ok": True, "group": grp}

    @router.patch("/catalog/groups/{group_id}")
    def admin_patch_group(
        group_id: str,
        body: GroupPatchRequest,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        changes = {k: v for k, v in body.model_dump().items() if v is not None}
        try:
            grp = catalog.update_group(group_id, changes)
        except KeyError as err:
            raise HTTPException(404, str(err)) from err
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        return {"ok": True, "group": grp}

    @router.post("/catalog/stations")
    def admin_create_station(
        body: StationCreateRequest,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        try:
            st = catalog.upsert_station(body.model_dump())
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        return {"ok": True, "station": st}

    @router.patch("/catalog/stations/{station_id}")
    def admin_patch_station(
        station_id: str,
        body: StationPatchRequest,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        changes = {k: v for k, v in body.model_dump().items() if v is not None}
        try:
            st = catalog.update_station(station_id, changes)
        except KeyError as err:
            raise HTTPException(404, str(err)) from err
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        return {"ok": True, "station": st}

    @router.delete("/catalog/stations/{station_id}")
    def admin_delete_station(
        station_id: str,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        try:
            res = catalog.delete_station(station_id)
        except KeyError as err:
            raise HTTPException(404, str(err)) from err
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        return {"ok": True, **res}

    @router.get("/ramowka")
    def admin_get_ramowka(_: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
        sched = ramowka_service.hourly_schedule()
        return {
            "hours": sched,
            "hourly_schedule": sched,
            "spots": ramowka_service.list_spots(include_disabled=True),
            "state": ramowka_service.state(),
        }

    @router.put("/ramowka/hours/{hour}")
    def admin_put_ramowka_hour(
        hour: int,
        body: RamowkaHourRequest,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        try:
            slot = ramowka_service.set_hour_slot(hour, body.station_id, body.slot_label)
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        return {"ok": True, "slot": slot}

    @router.post("/ramowka/spots")
    def admin_create_spot(
        body: SpotCreateRequest,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        try:
            spot = ramowka_service.upsert_spot(body.model_dump())
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        return {"ok": True, "spot": spot}

    @router.patch("/ramowka/spots/{spot_id}")
    def admin_patch_spot(
        spot_id: str,
        body: SpotPatchRequest,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        changes = {k: v for k, v in body.model_dump().items() if v is not None}
        try:
            spot = ramowka_service.update_spot(spot_id, changes)
        except KeyError as err:
            raise HTTPException(404, str(err)) from err
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        return {"ok": True, "spot": spot}

    @router.get("/leads")
    def admin_list_leads(
        limit: int = Query(default=200, ge=1, le=1000),
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        leads = telemetry.list_leads(limit=limit)
        return {"leads": leads, "total": len(leads)}

    @router.patch("/leads/{lead_id}")
    def admin_patch_lead(
        lead_id: int,
        body: LeadPatchRequest,
        _: dict[str, Any] = Depends(require_admin),
    ) -> dict[str, Any]:
        try:
            updated = telemetry.update_lead_status(lead_id, body.status)
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        if updated is None:
            raise HTTPException(404, "Nie znaleziono zgłoszenia")
        return {"ok": True, "lead": updated}

    return router


SLUG_RE_SAFE = re.compile(r"^[a-z0-9-]{2,48}$")
