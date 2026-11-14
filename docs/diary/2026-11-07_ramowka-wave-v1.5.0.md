# VibingDiary — 2026-11-07 — Ramówka Wave (v1.5.0)

## Decisions
| Decyzja | Dlaczego | Alternatywa |
|---|---|---|
| 3 workery cmux (Haiku backend, Sonnet engine/UI, Sonnet pill) | rozłączne strefy plików | 1 duży worker — wolniej |
| Słowa kluczowe sortują feed RSS zamiast filtrować | feed bez trafień dawał 0 wiadomości (bug zgłoszony przez Wojciecha) | filtr z fallbackiem |
| "Moje źródła" jako zwykły temat w /radio-api/news | ten sam silnik przerw, brak osobnego playera | osobny przycisk "Posłuchaj" |
| yt-dlp z venv aplikacji | wersja z dystrybucji (2025.11) dostaje 403/SABR | systemowy pip na Pythonie 3.10 (yt-dlp wymaga 3.11+) |
| Częstotliwość 1-60 min + 45 s muzyki po przerwie | "co minutę" nie może być ciągłym gadaniem | sztywna lista wartości |

## Proofs
- pytest 82 passed (Python 3.14; prod 3.12), vitest 65 passed, tsc 0, build OK
- deploy 20261107-012133 i 20261107-013451 exit 0, health 200; backup DB/.env/kod/web: /home/vizi/backups/*20261107-0121*
- /radio-api/news: 30/30 wiadomości z nagłówkiem, treść 55-67 słów (było ~105)
- weather Wrocław 200 ("Teraz 1 stopień, częściowo pochmurno"), weather.wav 200 3.3 s
- intro flash/main/hourly 200, outro 200; aired anon 401; pill anon 402; cats=mine anon -> komunikat Plus
- pigułka Dr. K (2 h): 16 fragmentów, 20.1%, 34 części dekodowane bez błędów, 203 s, ~/Desktop/projects/files/dosradio/pigulka-dr-k.mp3
- suwak w przeglądarce: 1/3/22/60 -> "Co minutę"/"Co 3 minuty"/"Co 22 minuty"/"Co godzinę", zapis w prefs

## Tokeny (usageMetadata, zmierzone na prod)
- wydanie wiadomości (6 szt., google_search): in 1694, out 1558, thinking 7183, razem 10435
- TTS nagłówek: 226 tokenów audio = 9.2 s; TTS wiadomość 58 słów: 798 tokenów = 32 s
- wybór fragmentów pigułki (transkrypt 2 h): in 39695, out 925, thinking 6950, razem 47570

## Gotchas
- testowy runner musi zwracać stdout (kontrakt Runner -> str), inaczej json.loads(None)
- automatyczne napisy tłumaczone (pl z en) -> 429; brać *-orig
- Gemini przy długim transkrypcie gubi polskie znaki — wymóg wprost w prompcie
- thinking = ~70-80% tokenów wyjściowych wiadomości i pigułki
