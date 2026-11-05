# DOS Radio 📻

> **Prywatna stacja radiowa ze sztuczną inteligencją.** Muzyka generowana w locie przez Google Lyria RealTime, 14 stacji z dedykowanymi prowadzącymi, AI Mood Composer, cogodzinne wydania wiadomości i pełne PWA z odtwarzaniem w tle na telefonie.

🌐 **Live:** [https://dosradio.theones.io](https://dosradio.theones.io)

---

## Czym jest DOS Radio?

DOS Radio to eksperyment z formatem radiowym przyszłości stworzony dla osób pracujących głęboko (np. programistów, osób z ADHD), które potrzebują ciągłego, nieinwazyjnego tła muzycznego i spokojnych, krótkich wejść głosowych bez dotykania telefonu czy przełączania zakładek.

Muzyka nie pochodzi z żadnej bazy gotowych plików ani serwisów streamingowych — powstaje na żywo z wag promptów i parametrów DSP modelu **Google Lyria RealTime**.

---

## Kluczowe możliwości

- **14 stacji z charakterem i prowadzącymi**:
  - *DOS Groove* (Kuba) — minimal deep tech do pracy (122 BPM)
  - *Lo-fi Nauka* (Ola) — ciepłe bity z winyla i miękkie pianino (82 BPM)
  - *Microhouse* (Rafał) — organiczny rumuński minimal i detal (124 BPM)
  - *Głęboki Ambient* (Ida) — bez perkusji, medytacyjna przestrzeń (60 BPM)
  - *Stoa* (Marek) — wiolonczela, fortepian i spokój stoików (66 BPM)
  - *Poranna Kawa* (Zosia) — słoneczny, ciepły deep house (120 BPM)
  - *Liquid DnB* (Lena) — płynne połamane bity i głęboki bas (174 BPM)
  - *Neo Funk* (Tadek) — bujający bas i vintage gitara (112 BPM)
  - *Klubowy Dance* (Max) — sprężysty tech-house (128 BPM)
  - *Minimal Techno* (Igor) — hipnotyczny, precyzyjny puls (126 BPM)
  - *Mocne Techno* (Wiktor) — ciężki industrialny warehouse groove (134 BPM)
  - *Nocny Jazz* (Helena) — miotełki, kontrabas i Rhodes (86 BPM)
  - *Trip-hop Wieczór* (Marta) — leniwy winylowy dół (92 BPM)
  - *Nocny Dub* (Szymon) — przestrzenne akordy i głęboki oddech (84 BPM)

- **AI Mood Composer („Twój nastrój”)**:
  Opisz swój stan słowami (np. *„deszczowy wieczór z herbatą i kodowaniem”*). Gemini 3.8 Flash przekształca opis w precyzyjne parametry muzyczne w ułamku sekundy, a radio natychmiast płynnie morphuje dźwięk.

- **Tryb „Tylko muzyka” (No-Host)**:
  Jeden klik wyłącza wszystkie wejścia lektorskie i wiadomości, zostawiając 100% czystego, nieprzerwanego flow state.

- **PWA i granie w tle na telefonie**:
  - Obsługa instalacji jako aplikacja na ekranie głównym iOS i Androida.
  - Sterowanie z poziomu ekranu blokady / Dynamic Island (**MediaSession API**).
  - Wyciszona pętla keep-alive gwarantująca, że system mobilny nie ubije AudioContextu po zablokowaniu ekranu.

- **Zero Dead Air & Strażnik ciszy**:
  Połączenia Lyria RealTime mają twardy limit 10 minut od Google. Watchdog w ułamku sekundy wyłapuje spadek poziomu audio, odpala miękki dżingiel stacji i wznawia strumień bez ani jednej sekundy ciszy dla słuchacza.

- **Skala: Bufor 100h i miks 70/30**:
  Serwer w tle nagrywa stacje do segmentów Ogg/Opus 96 kbps z automatyczną rotacją FIFO najstarszych plików. Słuchacze otrzymują miks 70% rotowanego archiwum + 30% świeżego live pool, co pozwala obsłużyć tysiące użytkowników przy stałym, minimalnym koszcie API.

- **Powiadomienia i analityka na Telegramie**:
  Automatyczny raport na Telegram po każdej rejestracji (email, stan kont, liczba nagranych godzin w archiwum, zużycie CPU i RAM serwera).

---

## Architektura techniczna

```
┌─────────────────────────────────────────────────────────────┐
│                 Przeglądarka / PWA                          │
│  [ Web Audio Context ] <──> [ MediaSession Lock Screen ]    │
│            │                                                │
│     ChunkStreamer (Opus 70/30) / Lyria WS Proxy             │
│            │ (ducking)                                      │
│     VoiceGainNode (Wiadomości / Host Greetings / Jingles)   │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTPS / WSS
┌─────────────────────────────▼───────────────────────────────┐
│                    Nginx (Reverse Proxy)                    │
│     dosradio.theones.io  (Cloudflare Tunnel + SSL)          │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                   FastAPI Backend (:3015)                   │
│  ├── /radio-api/station/{id}/next-chunk (70/30 hybrid)      │
│  ├── /radio-api/mood (Gemini Flash Mood Composer)           │
│  ├── /radio-api/news (Hourly Grounded News Editions)        │
│  ├── /radio-api/{welcome,jingle}/{id}.wav (Host Assets)     │
│  ├── /radio-ws/lyria/ (WebSocket Key Injector Proxy)        │
│  └── StationRecorder Worker (Lyria -> Opus 100h FIFO)       │
└─────────────────────────────────────────────────────────────┘
```

---

## Szybki start (lokalnie)

### Wymagania
- Node.js 20+
- Python 3.11+
- ffmpeg (z koderem `libopus`)
- Klucz Google Gemini API (`GEMINI_API_KEY`)

### Uruchomienie backendu
```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export GEMINI_API_KEY="twój-klucz"
export DOSRADIO_SECRET="dowolny-sekret-min-32-znaki-losowe"
export DOSRADIO_DATA_DIR="./data"

uvicorn app.main:app --port 3015 --reload
```

### Uruchomienie frontendu
```bash
npm install
npm run dev
```

Strona otwiera się pod `http://localhost:5202`.

---

## Testy

```bash
# Testy Pythona (backend, auth, 100h rotacja archiwum)
cd server && pytest tests -q

# Weryfikacja TypeScript i build frontendu
npm run build
```

---

## Licencja & Prawa autorskie

Cała muzyka w DOS Radio jest generowana w czasie rzeczywistym przez model sztucznej inteligencji i nie pochodzi z nagrań artystów, płyt ani serwisów streamingowych. Nie odtwarzamy cudzych utworów. Sygnał audio zawiera niesłyszalny cyfrowy znak wodny SynthID oznaczający treść wygenerowaną przez AI.

Kod: MIT License.

Developed by Wojciech Wiesner <wojciech@theones.io>
-= join.theones.io =- be The One Who Is Many -
