"""Prompt for a podcast about a business website: hosts stick to what the page really says."""
from __future__ import annotations

PAGE_EXCERPT_CHARS = 6000

FACTUAL_RULES = (
    "Zasady (bezwzględne): prezentujcie usługi tej firmy i to, co klient zyskuje dzięki nim, "
    "opierając się WYŁĄCZNIE na faktach z treści strony poniżej. "
    "Nie porównujcie usług do zabiegów medycznych ani leków, nie obiecujcie efektów zdrowotnych. "
    "Nie twierdźcie nic o dostępności terminów, cenach ani rezultatach, jeśli strona tego nie podaje. "
    "Opinie klientów możecie cytować tylko w brzmieniu, w jakim są na stronie. "
    "Czego nie ma na stronie, tego nie dodawajcie ani nie zgadujcie."
)


def build_url_podcast_prompt(site: dict, intro_note: str = "") -> str:
    return (
        f"Omówcie stronę internetową '{site['title']}' ({site['domain']}). "
        f"{FACTUAL_RULES}\n"
        f"Opis: {site['description']}. Treść ze strony: {site['text'][:PAGE_EXCERPT_CHARS]}\n{intro_note}"
    )
