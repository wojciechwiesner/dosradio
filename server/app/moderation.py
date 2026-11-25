"""Listener text moderation shared by comments, dedications and custom radio names.

Everything a listener types and the host could say on air goes through ``moderate``:
links, e-mails and phone numbers are stripped, control characters and emoji removed,
length capped, and a Polish + English abuse list rejects the text with a friendly
message. ``moderate_with_llm`` adds an optional second opinion from a cheap LLM
(cached by text hash, never required: on any LLM failure the word list decides).
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Awaitable, Callable

GenerateText = Callable[[str, str], Awaitable[str]]

REJECT_ABUSE = "Ten tekst nie przejdzie na antenę AmbiRadio. Spróbuj powiedzieć to samo bez wulgaryzmów."
REJECT_EMPTY = "Napisz coś, co prowadzący może przeczytać na antenie."
REJECT_SPAM = "To wygląda na reklamę lub spam. Napisz własnymi słowami, a prowadzący chętnie to przeczyta."
REJECT_LLM = "Prowadzący nie może tego przeczytać na antenie AmbiRadio. Spróbuj inaczej sformułować myśl."

URL_RE = re.compile(
    r"(?i)\b(?:https?://|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:pl|com|net|org|io|eu|info|biz|xyz|ru|de|uk|me|tv|app|dev|ly|gg)\b(?:/\S*)?"
)
EMAIL_RE = re.compile(r"(?i)\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")
PHONE_RE = re.compile(r"(?<!\w)\+?\d(?:[\s().-]*\d){7,}(?!\w)")
HANDLE_RE = re.compile(r"(?<!\w)@[A-Za-z0-9_.]{3,}")
CTRL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f<>{}\[\]\\`|]")
EMOJI_RE = re.compile(r"[\U0001F000-\U0001FAFF☀-➿⬀-⯿️​-‏⁠]")
REPEAT_RE = re.compile(r"(.)\1{3,}")

LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "i"})

# Stems that are abusive wherever they appear inside a word (after normalisation).
ABUSE_STEMS: tuple[str, ...] = (
    # Polish
    "kurw", "kurew", "chuj", "chuja", "huj", "pierdol", "pierdal", "jeban", "jebac", "jebie", "jebi", "jebn",
    "zajeb", "wyjeb", "pojeb", "przyjeb", "odjeb", "zjeb", "rozjeb", "spierd", "wypierd", "napierd",
    "pizd", "skurw", "skurczybyk", "kutas", "cwel", "pedzio", "ciota", "szmat", "dziwk", "zdzir",
    "cipa", "cipk", "fiut", "debil", "kretyn", "idiot", "dzban", "spaslak", "ciul", "frajer", "zydki", "czarnuch",
    "ciapat", "wypierdalaj",
    # English
    "fuck", "bullshit", "cunt", "bitch", "asshole", "arsehole", "motherf", "nigg", "faggot", "retard",
    "whore", "slut", "bastard", "dickhead", "rapist",
)
# Multi-word threats and self-harm baiting, matched on folded text with single spaces.
ABUSE_PHRASES: tuple[str, ...] = ("zabij sie", "zabijcie sie", "powies sie", "kill yourself", "go die", "zdechnij")
# Short words that are abusive only as whole words (avoid "sukienka", "dickens", "hujnia" is caught by stems).
ABUSE_WORDS: frozenset[str] = frozenset({
    "suka", "suki", "suko", "shit", "shitty", "chuj", "huj", "dick", "fag", "cock", "porn", "porno", "nazi", "hitler", "kys", "wtf", "stfu",
})
SPAM_WORDS: tuple[str, ...] = ("kasyno", "casino", "bitcoin", "krypto", "crypto", "zarabiaj", "promocja", "kup teraz", "onlyfans", "viagra")


@dataclass(frozen=True)
class ModerationResult:
    ok: bool
    text: str                       # cleaned text, safe to store and to hand to TTS when ok
    reason: str = ""                # machine code: empty|abuse|spam|llm
    message: str = ""               # friendly Polish message for the listener
    removed: tuple[str, ...] = field(default_factory=tuple)  # what was stripped: link|email|phone|handle


def _fold(text: str) -> str:
    """Lowercase, strip Polish diacritics and leetspeak, drop separators: 'K.u-r_w@' -> 'kurwa'."""
    lowered = text.lower().replace("ł", "l")
    decomposed = unicodedata.normalize("NFKD", lowered)
    ascii_only = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return ascii_only.translate(LEET)


def _squash(word: str) -> str:
    return re.sub(r"(.)\1+", r"\1", word)


def _words(folded: str) -> list[str]:
    """Split into words, undoing the usual evasions: 'ku.rwa' -> 'kurwa', 'k u r w a' -> 'kurwa'."""
    glued = re.sub(r"(?<=[a-z])[._*'\-]+(?=[a-z])", "", folded)
    words = re.findall(r"[a-z]+", glued)
    merged: list[str] = []
    run: list[str] = []
    for word in words + [""]:
        if len(word) == 1:
            run.append(word)
            continue
        if len(run) >= 3:
            merged.append("".join(run))
        else:
            merged.extend(run)
        run = []
        if word:
            merged.append(word)
    return merged


def contains_abuse(text: str) -> bool:
    folded = _fold(text)
    words = _words(folded)
    for word in words:
        squashed = _squash(word)  # catches "kuuurwa"
        if word in ABUSE_WORDS or squashed in ABUSE_WORDS:
            return True
        if any(stem in word or stem in squashed for stem in ABUSE_STEMS):
            return True
    spaced = " ".join(words)
    return any(phrase in spaced for phrase in ABUSE_PHRASES)


def _looks_like_spam(text: str) -> bool:
    folded = _fold(text)
    return any(word in folded for word in SPAM_WORDS)


def clean_text(raw: str, max_len: int) -> tuple[str, tuple[str, ...]]:
    """Strip contact data, markup and emoji; collapse whitespace; cap length on a word boundary."""
    removed: list[str] = []
    text = raw or ""
    for name, pattern in (("email", EMAIL_RE), ("link", URL_RE), ("phone", PHONE_RE), ("handle", HANDLE_RE)):
        if pattern.search(text):
            removed.append(name)
            text = pattern.sub(" ", text)
    text = EMOJI_RE.sub("", CTRL_RE.sub(" ", text))
    text = REPEAT_RE.sub(lambda m: m.group(1) * 3, text)
    text = re.sub(r"\s+", " ", text).strip(" -,;:")
    if len(text) > max_len:
        cut = text[:max_len]
        text = (cut.rsplit(" ", 1)[0] if " " in cut[max_len // 2:] else cut).rstrip(" ,;:-")
    return text, tuple(removed)


def moderate(raw: str, *, max_len: int = 280, allow_empty: bool = False) -> ModerationResult:
    text, removed = clean_text(raw, max_len)
    if not text:
        if allow_empty:
            return ModerationResult(True, "", removed=removed)
        reason = "spam" if removed else "empty"
        return ModerationResult(False, "", reason, REJECT_SPAM if removed else REJECT_EMPTY, removed)
    if contains_abuse(raw) or contains_abuse(text):
        return ModerationResult(False, "", "abuse", REJECT_ABUSE, removed)
    if _looks_like_spam(text):
        return ModerationResult(False, "", "spam", REJECT_SPAM, removed)
    return ModerationResult(True, text, removed=removed)


def moderate_many(fields: dict[str, str], *, max_len: int = 200) -> tuple[dict[str, str], ModerationResult | None]:
    """Moderate several fields at once; returns cleaned values or the first rejection."""
    out: dict[str, str] = {}
    for key, value in fields.items():
        result = moderate(value, max_len=max_len, allow_empty=True)
        if not result.ok:
            return out, result
        out[key] = result.text
    return out, None


LLM_PROMPT = (
    "Jesteś moderatorem polskiego radia internetowego AmbiRadio. Słuchacz przysłał tekst, który prowadzący może "
    "przeczytać na antenie. Odrzuć: wulgaryzmy, obelgi, mowę nienawiści, treści seksualne, groźby, dane osobowe, "
    "reklamę, politykę partyjną i agitację. Oceń też, na ile tekst jest ciekawy do przeczytania na antenie "
    "(pytanie, humor, osobista historia, coś nowego) w skali 0-10.\n"
    'Odpowiedz wyłącznie JSON: {{"ok": true|false, "score": 0-10}}.\nTekst: """{text}"""'
)


class LLMModerator:
    """Optional cheap-LLM second opinion with an in-memory cache keyed by text hash."""

    def __init__(self, generate: GenerateText | None, max_cache: int = 2000) -> None:
        self.generate = generate
        self.cache: dict[str, tuple[bool, float | None]] = {}
        self.max_cache = max_cache
        self.calls = 0

    @staticmethod
    def key(text: str) -> str:
        return hashlib.sha256(_fold(text).encode("utf-8")).hexdigest()[:24]

    async def review(self, text: str) -> tuple[bool, float | None]:
        """Returns (ok, llm_score 0-1 or None). Fails open to the word list when no LLM answers."""
        if self.generate is None or not text:
            return True, None
        k = self.key(text)
        if k in self.cache:
            return self.cache[k]
        try:
            self.calls += 1
            reply = await self.generate(LLM_PROMPT.format(text=text), "moderation")
            match = re.search(r"\{.*?\}", reply, re.DOTALL)
            data = json.loads(match.group(0)) if match else {}
            ok = bool(data.get("ok", True))
            score = data.get("score")
            verdict = (ok, max(0.0, min(1.0, float(score) / 10)) if isinstance(score, (int, float)) else None)
        except Exception:
            return True, None  # word list already passed; do not cache transient failures
        if len(self.cache) >= self.max_cache:
            self.cache.pop(next(iter(self.cache)))
        self.cache[k] = verdict
        return verdict


async def moderate_with_llm(raw: str, llm: LLMModerator | None, *, max_len: int = 280) -> tuple[ModerationResult, float | None]:
    result = moderate(raw, max_len=max_len)
    if not result.ok or llm is None:
        return result, None
    ok, score = await llm.review(result.text)
    if not ok:
        return ModerationResult(False, "", "llm", REJECT_LLM, result.removed), score
    return result, score
