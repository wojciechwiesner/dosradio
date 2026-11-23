from app.url_podcast_prompt import PAGE_EXCERPT_CHARS, build_url_podcast_prompt

SITE = {"title": "Salon", "domain": "salon.example", "description": "Opis", "text": "x" * 9000}


def test_prompt_has_factual_rules_and_long_excerpt():
    prompt = build_url_podcast_prompt(SITE, "Odbiorca: Ola.")
    assert PAGE_EXCERPT_CHARS == 6000
    assert "x" * 6000 in prompt and "x" * 6001 not in prompt
    for rule in ("WYŁĄCZNIE na faktach", "Nie porównujcie usług do zabiegów medycznych",
                 "dostępności terminów, cenach ani rezultatach", "tylko w brzmieniu"):
        assert rule in prompt
    assert "Odbiorca: Ola." in prompt
