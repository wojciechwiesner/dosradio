# VibingDiary: 2026-11-05 — DOS Radio v1.0.0 Architecture & Launch

## 1. Tabela decyzji i uzasadnień

| Obszar | Wybrane rozwiązanie | Alternatywy (odrzucone) | Uzasadnienie (Twarde dane) |
|---|---|---|---|
| **Skalowanie strumienia muzyki** | Bufor 100h (segmenty Ogg/Opus 30s, 96 kbps) + odtwarzanie w kolejności nagrania (`?after=seg-...`) | Bezpośrednie połączenie WebSocket Lyria RealTime 1:1 ze słuchaczem | Pomiar `lyria_probe.py` na Borgu wykazał twardy limit **9–11 równoległych sesji** na klucz Google (`1011 quota exceeded`). Archiwum 100h (~4.3 GB/stację) obsługuje tysiące słuchaczy przy 1 sesji nagrywającej w tle. |
| **Limit czasu sesji Lyrii (10 min)** | Strażnik ciszy (Watchdog) + dżingiel stacji + automatyczne wznowienie połączenia w tle | Zatrzymanie odtwarzacza z komunikatem „Kliknij Graj, aby wznowić” | 15-minutowy test wykazał, że Google **zawsze zamyka sesję po 600,9 s (10 min)**. Watchdog przechwytuje spadek sygnału i wznawia granie bez udziału użytkownika. |
| **Generowanie głosu (Gemini 3.8 Flash TTS)** | Przekazywanie wyłącznie czystego tekstu po polsku w polu `contents` | Instrukcja stylu po angielsku w `contents` lub pole `systemInstruction` | `gemini-3.8-flash-tts` zwraca HTTP 400 dla `systemInstruction`, a angielski prompt w `contents` czyta na głos słowo w słowo. Czysty tekst eliminuje wyciek promptu (potwierdzone transkrypcją). |
| **Odtwarzanie w tle na mobile (PWA)** | Pętla 1s niesłyszalnego pliku WAV w `<audio>` + `MediaSession API` | Samo `AudioContext` (Web Audio API) | iOS Safari i Android Chrome usypiają sam `AudioContext` ~30 s po zablokowaniu ekranu. Aktywny element `<audio>` utrzymuje sesję mediów i daje kontrolki na ekranie blokady. |

---

## 2. Twarde dowody weryfikacji (Runtime Proofs)

- **Produkcyjny URL:** `https://dosradio.theones.io` → `HTTP/2 200 OK`
- **API Healthcheck:** `https://dosradio.theones.io/radio-api/health` → `{"ok": true, "categories": ["ai", "beauty", "sport", "stoic", "funny"]}`
- **Diagnostyka E2E w Chrome (`scripts/diagnose.mjs`):**
  - `t=2s`: `status: "Gra DOS Groove"`, `playing: true`, `speaking: true`, `duck: 0.15` (wejście powitania Kuby w ~100 ms)
  - `t=4s..12s`: paski EQ animują się (`20.2% .. 29.4%`), powitanie gra nad wyciszoną muzyką
  - `t=14s..41s`: `speaking: false`, `duck: 1.0`, paski EQ osiągają `75%–100%`, kolejne segmenty pobierane sekwencyjnie (`?after=seg-...`)
- **Testy automatyczne:**
  - Backend: `pytest tests -q` → `7 passed in 0.99s`
  - Frontend: `npx tsc --noEmit` → `exit 0`, Vite build → `dist/index.html` + `sw.js` + `manifest.webmanifest`

---

## 3. Lessons Learned & Gotchas (Pułapki dla przyszłych agentów)

1. **Nigdy nie blokuj `start()` nieskończoną pętlą strumienia:** Pętla dociągająca kolejne segmenty (`feedLoop`) musi działać asynchronicznie w tle (`void this.feedLoop()`), po zaplanowaniu pierwszego segmentu. Czekanie na nią przez `await` blokuje przejście stanu UI i wycisza prowadzącego.
2. **Nginx regex vs API prefix:** Reguła `location ~* \.(wav|opus)$` ma w Nginxie wyższy priorytet niż zwykłe `location /radio-api/`. Zawsze używaj `location ^~ /radio-api/`, aby żądania o dynamiczne pliki audio trafiały do FastAPI, a nie szukały plików statycznych w `/var/www/`.
3. **Kolejność segmentów zamiast losowania:** Przy 30-sekundowych segmentach muzyki losowanie (`random.choice`) daje wrażenie zapętlonego utworu. Klient musi przekazywać ostatni segment (`?after=seg-...`), a serwer wydawać kolejny plik z nagrania.
4. **Ochrona `.venv` przy `rsync`:** Zawsze używaj `--exclude .venv` przy synchronizacji z macOS na Linuxa (Borg), aby nie nadpisać linuksowego interpretera binarkami z Maca.
