# VibingDiary — 2026-11-07 — Clean Sound + Pill-in-Programme (v1.6.0)

## Decisions
| Decyzja | Dlaczego | Alternatywa |
|---|---|---|
| Wycie leczone na 3 poziomach: filtr w przeglądarce, notch przy zapisie, czyszczenie archiwum | stacje grają nagrane archiwum, nie żywą Lyrię | tylko restart Lyrii (nie dotyka streamu) |
| Sesje Lyrii 60 s zamiast 5 min | pierwsze 30 s sesji ma tonu 5x mniej | dłuższe sesje = mniej połączeń, ale więcej wycia |
| Czyszczenie archiwum na Mac mini | borg load 20-23/8 rdzeni: ~1 plik/min; Mac: ~100 plików/min | czekać dni / skasować archiwum (nieodwracalne) |
| Pigułka jako jednostki w przerwach | play nie może zatrzymywać radia | osobny player (stary) |

## Proofs
- skan przed: dos-groove 51%, minimal-techno 41% segmentów ze stałym tonem
- archiwum: 1711 segmentów przepisanych (14 stacji), oryginały w <station>/originals/ na borgu, 0 plików tymczasowych, health 200
- przed -> po na tych samych plikach: minimal-techno 23% -> 4%, nocny-dub 67% -> 19%, trip-hop 83% -> 50%
- md5: oryginał na borgu == oryginał z Maca, plik live == wersja wyczyszczona
- przeglądarka (konto Wojciecha, sesja próbna usunięta): play pigułki -> radio gra dalej, "W programie: ... (0/32)", usuń + dodaj działa
- testy: 106 pytest (15/15 bez flaków), 86 vitest, tsc 0, build OK

## Gotchas
- `pkill -f <wzorzec>` przez ssh zabija własne połączenie, gdy wzorzec jest w komendzie -> exit 255; zabijaj po PID
- heredoc w ssh z zagnieżdżonymi cudzysłowami potrafi się nie zapisać; wysyłaj skrypty przez scp
- trip-hop / warm-jazz / nocny-dub: część "tonów" to trzymane nuty muzyczne, nie wycie; detektor ich nie odróżnia
- float: 1.0 + 0.05 - 1.0 > 0.05 — porównania zakresów z tolerancją
