"""The share card is AmbiRadio-branded, 1200x630, and takes its domain from public_domain()."""
from __future__ import annotations

import io

from PIL import Image

from app import og_card
from app.og_card import render_og_card_png, shorten


def test_card_is_1200_by_630_png():
    png = render_og_card_png(title="Dedykacja", about="Krótki opis", station_name="Ambi Groove")
    img = Image.open(io.BytesIO(png))
    assert img.size == (1200, 630) and img.format == "PNG"


def test_card_domain_comes_from_public_domain(monkeypatch):
    seen: list[str] = []
    real = og_card._draw_footer
    monkeypatch.setattr(og_card, "_draw_footer", lambda d, st, dom: (seen.append(dom), real(d, st, dom))[1])
    monkeypatch.setenv("DOSRADIO_PUBLIC_BASE_URL", "https://example.test")
    render_og_card_png(title="x", about="y", station_name="z")
    assert seen == ["example.test"]


def test_shorten_cuts_on_word_boundary():
    assert shorten("ala ma kota i psa", 10) == "ala ma…"
    assert shorten("  krótki   tekst ", 50) == "krótki tekst"
