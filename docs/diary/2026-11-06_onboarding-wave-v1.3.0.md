# VibingDiary — 2026-11-06 — Onboarding Wave (v1.3.0)

## Decisions
| Decyzja | Dlaczego | Alternatywa |
|---|---|---|
| 2 workery (Sonnet frontend, Haiku backend) | swap 98%, rozłączne strefy plików | 3+ workery — ryzyko thrashingu |
| Haiku na backend | zadanie mechaniczne z dokładnym kontraktem API | Sonnet — drożej, bez zysku |
| Klipy TTS leniwie + cache | ~0.20 USD za cały pakiet, zero kosztu przy braku słuchaczy | prewarm 168 plików na starcie |
| Welcome Plus tylko gdy plan='free' | nie skracamy płatnych / bezterminowych | nadpisywanie plus_until |
| Pierwsze wiadomości 5 min od Graj | słuchacz najpierw muzyka, potem treść | siatka zegarowa |

## Proofs
- pytest 43 passed, vitest 19 passed, tsc 0, build OK (master d053651)
- deploy exit 0; prod .env DOSRADIO_TRIAL_SECONDS 600 -> 3600 (backup /home/vizi/backups/dosradio-env-20261106)
- DB backup /home/vizi/backups/dosradio-20261106-pre-v130.db; 4 verified free -> plus 30 d
- nowe IP: /me trial_remaining=3600 -> po starcie 3599
- /radio-api/host-clips/dos-groove 200; jingle/0.wav 200 audio/wav 175 kB (3.7 s TTS); index 99 -> 404
- przeglądarka: #onboardModal otwarty na Graj, wybory zapisane w prefs, zrzut ~/Desktop/projects/files/dosradio/onboarding-v1.3.0.png

## Gotchas
- prod .env nadpisywał domyślny trial (600) — zmiana defaultu w kodzie nie wystarczy
- trial jest per IP + cookie: testy z tego samego IP pokazują 0:00, to nie bug
- main.py był poza strefą W2 -> tekst "10 minut" w 402 poprawiony przez orkiestratora
