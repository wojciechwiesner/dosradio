# AmbiRadio — plan rebrandingu i wzrostu (v1, 2026-11-25)

Marka: **AmbiRadio — Ambitnie dla Ciebie** · domena: **ambiradio.com**
Repo: `~/Projects/active/dosradio` · main = `a4886ae` (PR #2 zmergowany)

## 0. Zrobione dziś
- [x] Merge `feat/kasprzak-receiver` -> `main` (PR #2, merge commit a4886ae, 24 commity).
- [x] Front: 136/136 testów, build OK (po `npm install` — brakowało `three`).
- [!] Backend: 226/227 — `test_stream_chain` czerwony od `c531082` (beat-grid lock). Bisect potwierdzony, fix w W2.

## 1. Korzyści i funkcje unikalne (pozycjonowanie)
Jedno zdanie: **Radio, które jest tylko Twoje — prowadzący z charakterem mówią o tym, co Cię obchodzi, między muzyką, która nigdy się nie powtarza.**

| # | Korzyść (dla słuchacza) | Funkcja unikalna | Hak viralowy |
|---|---|---|---|
| 1 | Prowadzący, których chce się słuchać | Hości z duszą: stała osobowość, poglądy, running jokes, pamięć słuchaczy | Klipy „prowadzący przeczytał mój komentarz" |
| 2 | Słuchacz współtworzy audycję | Komentarze/pytania -> moderacja -> najciekawsze idą na antenę z imieniem | Link „usłysz siebie w radiu" do udostępnienia |
| 3 | Twoje newsy, nie cudze | Ramówka z wybranych tematów + własny link do podcastu/strony | „Moje radio o …" — karta OG z tytułem |
| 4 | Muzyka bez reklam i powtórek | Generatywny mix DJ z beatmatchingiem (25 stacji -> po cięciu tylko jakościowe) | — |
| 5 | Pozdrowienie jako prezent | „Udostępnij z pozdrowieniem": głos prowadzącego czyta dedykację | Odbiorca słyszy swoje imię -> wchodzi -> rejestruje się |
| 6 | Zero konfiguracji | Autostart po kliknięciu: prowadzący mówi od razu, muzyka po kilku sekundach | — |
| 7 | Dwa światy | Classic (surowy, funkcjonalny) i Orbita (immersyjny 2.5D) — split screen na wejściu | Orbita = materiał na nagrania ekranu |

## 2. Pricing (USD, miesięcznie)
| Plan | Cena | Zawartość |
|---|---|---|
| Free | 0 | Radio + stacje, prowadzący, komentarze (limit/dzień). **Pierwsze 6 h = pełne Plus (full experience)** |
| Plus | **$2.99/mc** | Własna ramówka newsów, 1 podcast/dzień z linku, pozdrowienia bez limitu, bez rejestracji przy każdym urządzeniu |
| Plus AI | **$6.99/mc** | Własny prowadzący (osobowość/głos), podcasty bez limitu, priorytet komentarzy na antenie, eksport klipów |
Roczne: 10 mc w cenie 12 ($29.90 / $69.90). Zmiana kodu: `server/app/billing.py:29-30` (amount_pln -> amount_usd, currency usd), `src/ui/billing.ts:151`. Nowe Price ID w Stripe tworzy Wojciech (żadnych kluczy w repo).

## 3. Lejek: 6 h full experience -> rejestracja
1. Wejście -> **split screen Classic | Orbita** (1 klik, zapamiętywane).
2. Klik = autostart: głos prowadzącego od razu + komunikat „Muzyka ruszy za kilka sekund — generuję początkowe nuty, ale prowadzący może już mówić".
3. **Kreator startowy (3 kroki, pomijalny):** tematy newsów (chipy) -> podcast (link lub gotowe przykłady: Tech/AI, Biznes, Sport, Kultura, Nauka) -> prowadzący (2–3 osobowości).
4. Trial 6 h (`DOSRADIO_TRIAL_SECONDS=21600`) z licznikiem nienachalnym.
5. Rejestracja 1-klik (magic link / Google) w momentach szczytu: po pierwszym pozdrowieniu, po komentarzu przeczytanym na antenie, na 30 min przed końcem triala.

## 4. Do usunięcia / zabezpieczenia
- Stacje o słabej jakości: lista z audytu (W-audit) — kryteria: <96 kbps MP3 / <64 kbps AAC, martwe, mono, geo-block.
- Funkcje ryzykowne: lista z audytu; zasada — TTS dowolnego tekstu usera tylko po moderacji + limit; brak copyright music; koszty LLM/TTS limitowane per user.

## 5. Strumienie pracy (równolegle)
| ID | Zakres | Typ | Zależność |
|---|---|---|---|
| W1 | Bugi: statystyki online + pozdrowienie (generowanie/odtwarzanie) | kod | diagnoza (w toku) |
| W2 | Fix regresji mixera c531082 + autostart z komunikatem | kod | diagnoza (w toku) |
| W3 | Rebrand AmbiRadio: wszystkie teksty, meta/OG, manifest, title, ambiradio.com, CORS/nginx | kod | — |
| W4 | Classic redesign: surowy minimalizm, ultrafunkcjonalny | design+kod | W3 |
| W5 | Orbita SOTA upgrade | design+kod | W3 |
| W6 | Split screen wyboru wersji + kreator startowy + trial 6 h | kod | W3 |
| W7 | Hości z duszą + komentarze słuchaczy na antenie (moderacja LLM + kolejka) | backend+kod | W2 |
| W8 | Pricing USD + strona Plus | kod | Stripe Price ID od Wojciecha |
| W9 | Cięcie stacji i ryzykownych funkcji | kod | audyt (w toku) |
| C1 | Spoty reklamowe (skrypty 15/30/60 s) + nagranie głosami prowadzących | treść+audio | W7 (głosy) |
| C2 | Prezentacja YouTube ~10 min: scenariusz, tekst lektora, lista ujęć | treść | — |

Zasady: kod w widocznych sesjach (code-dispatch), max 2 na Macu, ciężkie na Omarchy; >3 sesje kodujące tylko po potwierdzeniu Wojciecha. Każdy strumień = osobny branch + PR, bramka: `npm run test` + `npm run build` + pytest (py3.12) + dowód w przeglądarce.

## 6. Deploy
Prod: `deploy.sh` -> borg (pm2 `dosradio-api`). Nowa domena ambiradio.com wymaga: DNS (Cloudflare) + vhost nginx + cert — decyzja Wojciecha, bez auto-deployu.
