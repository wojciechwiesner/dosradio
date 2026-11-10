# PLAN v1.4 — Android w tle, głośność lektora, beat-sync miks streamu

**Status:** PROPOSAL (planner, zero implementacji)
**Data:** 2026-11-06
**Zakres:** trzy niezależne jednostki biznesowe (A/B/C), wspólny kręgosłup = serwerowy strumień ciągły.

---

## 1. Fakty z kodu (zweryfikowane, ścieżka:linia)

### Odtwarzanie archiwum (klient)
- `src/radio/chunkStreamer.ts:11` — `FADE_S = 0.08`. **Fade in/out nakładany na KAŻDY segment** (`schedule()` linie 114–117: ramp 0→1 na starcie, 1→0 na końcu). Linia 125: `nextStartTime = startAt + duration - FADE_S` → segmenty nachodzą o 80 ms. Wewnątrz jednego nagrania (plastry tego samego utworu) ten fade jest słyszalnym „oddechem" co 30 s — do usunięcia.
- `src/radio/chunkStreamer.ts:129–159` — `fetchChunk()` pobiera `/radio-api/station/{id}/next-chunk?live_prob=0.3&after=<seg>`, dekoduje `decodeAudioData`, czyta nagłówki `x-dosradio-segment/source/hours`. Każdy segment to osobny plik Ogg/Opus → ma własny encoder delay/pre-skip, stąd maskujący fade.
- `src/radio/publicRadioEngine.ts:159` — `ChunkStreamer` jest źródłem muzyki **tylko dla stacji preset** (`isPresetStation`, `stations.ts:190`). Mood/custom gra przez `LiveMusicHelper` (Lyria live).

### Miks głosu / muzyki (klient) — KLUCZOWE dla części B
- `src/radio/publicRadioEngine.ts:48` — `private readonly voiceGain = this.ctx.createGain();`
- `src/radio/publicRadioEngine.ts:89–91` — `musicBus → master`, `voiceGain → master`, `master → limiter`.
- `src/radio/publicRadioEngine.ts:86–87` — limiter `threshold = -2 dB`, `ratio = 12` (łapie tylko peaki).
- `src/radio/publicRadioEngine.ts:25` — `DUCK_LEVEL = 0.16` (muzyka ściszana do −16 dB na czas głosu, `duck()` linie 431–437, używany w `airHostClip` 421, `airBreak` 464, `playWelcomeIntro` 300).
- `src/radio/publicRadioEngine.ts:479–487` — `playVoice()` podpina źródło głosu do `voiceGain`.
- **BUG:** `voiceGain.gain` nie jest ustawiany NIGDZIE → zostaje domyślne **1.0**. Lektor gra na pełnej skali, muzyka pod nim na 0.16. Różnica toru: `20·log10(1.0/0.16) = +15.9 dB` lektor nad ściszoną muzyką; a TTS z Gemini jest zazwyczaj znormalizowany blisko full-scale, więc i względem NIEściszonej muzyki (program ~−16 LUFS z Opus 96 kbps) głos „wychodzi ponad muzykę". To jest przyczyna skargi.

### Tło / Android (klient)
- `src/audio/backgroundAudio.ts:23–29` — cichy 1 s WAV (data URI), `volume=0.01`, loop. `35–45` — MediaSession handlery play/pause/nexttrack. To NIE jest element grający słyszalne audio — realny dźwięk leci przez Web Audio (`ChunkStreamer → musicBus`). Po zamknięciu karty Chrome Android ubija AudioContext → cisza.
- `src/audio/iosAudioUnlock.ts:59–73` — już jest cichy `<audio>` + `navigator.audioSession.type='playback'` (iOS słyszy mimo wyciszenia sprzętowego). `92–98` — `getSharedAudioContext()` 48 kHz, `latencyHint:'playback'`.
- `src/ui/dosradio.ts:421–424` — `initBackgroundAudio(togglePlay, newsNow)`; `447/478` — `updateMetadata`.

### Archiwum (serwer)
- `server/app/archive.py:29–30` — `list_segments()` = `sorted(glob("seg-*.opus"))` po nazwie (timestamp ns).
- `server/app/archive.py:76–94` — `pick_next(live_probability, after)`: z `after` kontynuuje po kolei; bez/na końcu — 30% najnowszy „live", 70% losowy punkt. **Brak jakiejkolwiek metadanej granicy nagrania** — kolejne `seg-*` z różnych sesji Lyria są nieodróżnialne.
- `server/app/main.py:227–252` — endpoint `next-chunk`, regex `after` = `^seg-\d+\.opus$` (232), zwraca `audio/ogg; codecs=opus`.
- `server/app/main.py:306–356` — proxy WS Lyria (tylko stacje live/mood).

### Nagrywanie + „limit sesji ~10 min" (serwer)
- `server/app/recorder.py:124–135` — `record_loop`: wybiera stację z najmniejszą liczbą segmentów, nagrywa `record_session(..., num_segments=10)` (~5 min), potem rotacja; przy wyjątku backoff 10 s.
- `server/app/recorder.py:137–175` — `record_session`: jedna sesja WS Lyria = **jedno ciągłe nagranie** (`async with websockets.connect`), akumuluje `pcm_buffer`, tnie dokładnie `TARGET_CHUNK_BYTES` (30 s × 192000 B/s), każdy plaster koduje OSOBNO do Opus (`encode_pcm_to_opus`, 88–101) i `arch.add_segment(..., is_live=True)`.
- **Granica nagrania = koniec jednego `record_session`.** Sesja kończy się po 10 segmentach LUB gdy Google urwie strumień wcześniej (timeout 25 s / wyjątek → backoff). To jest „limit sesji ~10 min" z zadania (realnie u nas cap 10 segmentów = ~5 min, Google i tak potrafi urwać wcześniej). Po rotacji kolejne nagranie TEJ SAMEJ stacji to nowy kontekst Lyria → nowe tempo/faza.
- `server/app/recorder.py:27–85` — `STATION_SPECS` z docelowym `bpm` (dos-groove 122, raw-techno 134, liquid-dnb 174, **deep-ambient 60**, **stoa 66**, …). **Realny BPM nagrania nie jest mierzony** — brak analizy onset/tempo, brak sidecarów.
- **Pełny PCM sesji jest dostępny w pamięci w `record_session`** — idealne miejsce na analizę beatgridu przy zapisie (bez ponownego dekodowania).

### DSP
- `src/dsp/` — `audioDecisionEngine.ts` (arbitraż JEV dla Lyria live), `rtFeatures.ts`, `promptCanon.ts`, `jevOutcome.ts`. **Brak jakiejkolwiek analizy RMS/LUFS/loudness** gotowej do dopasowania głośności lektora. Loudness matching trzeba dodać (rekomendacja: po stronie serwera, nie w tym DSP).

---

## 2. Decyzja architektoniczna (kręgosłup A+C)

**Rekomendacja: serwerowy ciągły strumień Opus per stacja (model rozgłośni / Icecast-like), konsumowany przez realny `<audio>` na kliencie, wpięty w istniejący `musicBus` przez `createMediaElementSource`.**

Dlaczego jeden mechanizm rozwiązuje A i C naraz:
- **A (Android):** realny `<audio src=…/stream.ogg>` = realna sesja mediów → Chrome Android utrzymuje foreground service po zamknięciu karty; lock-screen z MediaSession. iOS: `<audio>` + `audioSession='playback'` już działa, nie psujemy.
- **C (beatmatch):** sklejanie i beatmatch robimy SERWEROWO, gdzie mamy pełny PCM, CPU i sidecar beatgridu. Wewnątrz nagrania = bezszwowa konkatenacja bez fade. Na granicy nagrań = miks ~60 s zsynchronizowany do beatu (albo tryb no-beat). Klient dostaje gotowy, ciągły dźwięk.
- Ducking pod głos, level meter i nakładka głosu **zostają bez zmian** — `<audio>` wchodzi przez `MediaElementAudioSourceNode → musicBus`, więc `duck()` i `analyser` działają jak dziś.

**Wariant rozgłośni (rekomendowany):** jeden mikser/enkoder na AKTYWNĄ stację, wszyscy słuchacze dołączają do bieżącej pozycji (broadcast). Skaluje się O(stacje), nie O(słuchacze). Koszt: tracimy per-słuchacz `live_prob`/własną pozycję — dla PUBLICZNEGO radia to zaleta, nie wada. **Akceptuję tę zmianę semantyki.**
**Wariant zapasowy (gdy trzeba zachować personalizację):** strumień per-słuchacz reużywający `pick_next` — zachowuje dzisiejsze zachowanie, ale koszt CPU dekod+miks rośnie liniowo ze słuchaczami. Trzymać jako fallback.

**Fallback kompatybilności:** gdy `<audio>`/stream padnie, klient wraca do `ChunkStreamer` (z poprawką fade z U-C4). Dzięki temu release jest odwracalny i nie łamie iOS/desktop.

---

## 3. Jednostki

### CZĘŚĆ B — głośność lektora (najszybsza, zrób pierwsze, niezależna)

#### U-B1 — twarda atenuacja toru głosu + płytsze ducking (klient)
- **Cel:** lektor nigdy nie wychodzi ponad poziom muzyki (programu), zachowana zrozumiałość.
- **Pliki:** `src/radio/publicRadioEngine.ts`.
- **Zmiany/sygnatury:**
  - Nowa stała (góra pliku): `const VOICE_GAIN = 0.35; // -9 dB tor lektora` oraz podnieść `DUCK_LEVEL` z `0.16` do `0.30` (−10.5 dB zamiast −16 dB — muzyka zostaje słyszalna pod głosem).
  - W konstruktorze (po utworzeniu węzłów, ~linia 95): `this.voiceGain.gain.value = VOICE_GAIN;`
- **Liczby / uzasadnienie (docelowy miks):**
  - Program muzyki ≈ −16 LUFS (Opus 96 kbps). Ducked bed = −16 − 10.5 = **−26.5 LUFS**.
  - TTS ≈ full-scale (−3…−6 LUFS). Po `VOICE_GAIN 0.35` (−9 dB): lektor ≈ **−24.4 LUFS**.
  - Efekt: lektor ~+2 dB nad ściszoną muzyką (słyszalny), ale **~8 dB PONIŻEJ nieściszonego programu** → „głos nie wychodzi ponad muzykę" spełnione.
- **Kryteria akceptacji:**
  - `voiceGain.gain.value === 0.35` w stanie ustalonym (test jednostkowy na engine / inspekcja w runtime).
  - Odsłuch: wejście prowadzącego i wiadomości wyraźnie cichsze niż dziś; bez clippingu (limiter nie wchodzi w redukcję > kilka dB).
  - Brak regresji ducking: muzyka słyszalna pod głosem (nie spada do ciszy).
- **Zależności:** brak. Można mergować osobno (patch < 10 linii).

#### U-B2 — serwerowa normalizacja loudness TTS (lepsza, opcjonalna nadbudowa)
- **Cel:** usunąć zmienność głośności między głosami/wiadomościami u źródła (deterministycznie), żeby `VOICE_GAIN` był trimem, nie łatą na skrajności.
- **Pliki:** `server/app/news.py` (`GeminiClient.speak` 169–186 / `pcm_to_wav` 118–125), `server/app/main.py` (`render_host_audio` 64–74, `intro_audio` 285–303), `server/app/host_clips.py`.
- **Sygnatura:** nowy helper w `news.py`:
  `def loudnorm_wav(wav_bytes: bytes, target_lufs: float = -20.0) -> bytes` — ffmpeg `loudnorm I=-20:TP=-2:LRA=11` (single-pass), wywoływany raz przy zapisie każdego pliku TTS (welcome/jingle/intro/story/chatter).
- **Liczby:** cel **I = −20 LUFS**, TP = −2 dBTP. Po tym klientowy `VOICE_GAIN` można podnieść do `0.6` (−4.4 dB), bo źródło jest już spójne.
- **Kryteria akceptacji:**
  - Każdy nowo renderowany plik TTS ma zmierzone integrated loudness w zakresie −20 ±1 LUFS (`ffmpeg … -af loudnorm=print_format=json` na próbce = dowód).
  - Istniejące pliki: jednorazowy skrypt renormalizacji lub naturalna wymiana przy regeneracji (welcome/jingle cache’owane „forever" — dodać wersjonowanie nazwy, np. `welcome-{sid}-ln20.wav`, żeby wymusić re-render).
- **Zależności:** niezależna od U-B1, ale logicznie po niej (najpierw szybka łata kliencka, potem źródło).

---

### CZĘŚĆ A — Android gra w tle po zamknięciu przeglądarki

#### U-A1 — serwerowy endpoint ciągłego strumienia (kręgosłup)
- **Cel:** jeden ciągły `audio/ogg; codecs=opus` per stacja, bez przerw, gotowy do odtwarzania w `<audio>`.
- **Pliki:** nowy `server/app/stream.py`; rejestracja w `server/app/main.py` (obok `next-chunk`).
- **Sygnatury:**
  - `class StationBroadcaster:` (jeden na stację, model rozgłośni)
    - `def __init__(self, arch: StationArchive, spec: dict) -> None`
    - `async def run(self) -> None` — pętla: czyta segmenty w kolejności nagrań (z manifestu U-C2), dekoduje do PCM, sklei bezszwowo wewnątrz nagrania, na granicy woła mikser (U-C3), re-enkoduje do ciągłego Ogg/Opus (ffmpeg pipe, jeden strumień = spójne strony Ogg), wrzuca do ring-buffera.
    - `async def subscribe(self) -> AsyncIterator[bytes]` — nowy słuchacz dostaje nagłówki Ogg (BOS) + bieżącą pozycję.
  - `class BroadcastRegistry:` `def stream(self, station_id) -> StationBroadcaster` (leniwy start/stop przy 0 słuchaczy).
  - Route w `main.py`:
    `@app.api_route("/radio-api/station/{station_id}/stream.ogg", methods=["GET","HEAD"])`
    `async def station_stream(request, station_id) -> StreamingResponse` — `require_access`, walidacja `station_id in STATION_SPECS`, `media_type="audio/ogg; codecs=opus"`, nagłówki `cache-control: no-store`, `access-control-expose-headers`.
- **Kryteria akceptacji:**
  - `curl -s -N .../station/dos-groove/stream.ogg | head -c 200000 | ffprobe -` → `codec=opus`, ciągły Ogg, brak końca (stream trwa).
  - Dwóch równoczesnych słuchaczy dostaje spójne strony Ogg od momentu dołączenia (brak uszkodzonego nagłówka).
  - `trial-ended` / 402 respektowane tak jak w `next-chunk` (zamknięcie strumienia).
- **Zależności:** potrzebuje manifestu nagrań (U-C2) do kolejności; na start może działać z samym `list_segments()` (sekwencyjnie) zanim U-C3 doda beatmatch.

#### U-A2 — realny `<audio>` na kliencie + wpięcie w musicBus (foreground Android)
- **Cel:** muzyka leci przez realny element mediów → Android trzyma po zamknięciu karty; lock-screen działa; iOS niezłamany.
- **Pliki:** nowy `src/audio/mediaStreamPlayer.ts`; `src/radio/publicRadioEngine.ts` (zamiana źródła dla preset); `src/audio/backgroundAudio.ts`; `src/ui/dosradio.ts`.
- **Sygnatury:**
  - `src/audio/mediaStreamPlayer.ts`:
    ```
    export class MediaStreamPlayer {
      constructor(ctx: AudioContext, destination: AudioNode, stationId: string, events: { onError:(e:string)=>void; onPlaying:()=>void });
      start(): Promise<boolean>;      // ustawia <audio>.src=/radio-api/station/{id}/stream.ogg, play(), createMediaElementSource→destination
      stop(): void;
      setStation(id: string): Promise<boolean>;
      get element(): HTMLAudioElement; // realny element dla MediaSession/Android
    }
    ```
    - `<audio>`: `playsinline`, `preload='none'`, `crossOrigin='anonymous'`. `createMediaElementSource(el)` raz (cache), reconnect `destination = musicBus`.
  - `publicRadioEngine.ts`: w `startMusic()` (157) i `setStation()` (202) dla `isPresetStation` użyć `MediaStreamPlayer` zamiast `ChunkStreamer`; `ChunkStreamer` zostaje jako fallback w `catch`. Dodać getter `get musicElement(): HTMLAudioElement | null`.
  - `backgroundAudio.ts`: rozszerzyć sygnaturę
    `initBackgroundAudio(onTogglePlay, onSkipNext?, getMediaElement?: () => HTMLAudioElement | null)`;
    MediaSession `setPositionState`/metadata spięte z realnym elementem; cichy WAV zostaje TYLKO jako iOS fallback (gdy brak realnego elementu).
  - `dosradio.ts:421` — przekazać `() => engine.musicElement`.
- **Kryteria akceptacji (twardy dowód runtime — Bit-fals):**
  - **Android Chrome:** play → zamknij kartę/przeglądarkę → muzyka gra dalej ≥ 60 s; powiadomienie mediów z play/pause/next na lock screen; klik działa. (dowód: nagranie ekranu / opis z urządzenia).
  - **iOS Safari:** brak regresji — gra w tle i przy wyciszeniu sprzętowym jak dziś.
  - Ducking pod głos i level meter nadal działają (głos nakłada się na strumień).
- **Zależności:** po U-A1. Równolegle do części B.

---

### CZĘŚĆ C — beat-sync miks całego streamu (najtrudniejsze)

#### U-C1 — pomiar beatgridu + ID nagrania przy zapisie (serwer)
- **Cel:** znać realny BPM, fazę beatu i przynależność segmentów do nagrania.
- **Pliki:** nowy `server/app/beatgrid.py`; `server/app/recorder.py` (`record_session`).
- **Sygnatury:**
  - `beatgrid.py`:
    ```
    @dataclass
    class BeatGrid:
      bpm_measured: float; beat_offset_s: float; beat_period_s: float; stable: bool; confidence: float
    def measure_beatgrid(pcm_s16le: bytes, rate: int, target_bpm: int) -> BeatGrid
    ```
    - Metoda: onset envelope + autokorelacja/tempogram (rekomendacja: `librosa.beat.beat_track` + `onset_strength`; alternatywa lekka: `aubio.tempo`). `stable = confidence > próg AND |bpm_measured/target_bpm - 1| < 0.06`. Analiza na downmixie mono, w wątku (`asyncio.to_thread`).
  - `recorder.py:137` `record_session`: akumulować pełny `session_pcm` (osobny `bytearray` równolegle do `pcm_buffer`), nadać `recording_id = f"rec-{session_start_ns}"`, przekazać do `add_segment`, a na końcu sesji: `grid = measure_beatgrid(session_pcm, 48000, spec["bpm"])` i zapis sidecara (U-C2).
- **Kryteria akceptacji:**
  - Po jednej sesji dla dos-groove istnieje sidecar z `bpm_measured` w okolicy 122 ±8, `stable=True`.
  - deep-ambient/stoa: `stable=False` lub pominięte (patrz U-C3 lista NO_BEAT).
  - Analiza nie blokuje pętli nagrywania (działa w `to_thread`, czas < 2 s na 5 min audio).
- **Zależności:** niezależna start; wymagana przez U-C2/U-C3. Dodać zależność `librosa` (lub `aubio`) do `server/requirements`.

#### U-C2 — manifest nagrań w archiwum (serwer)
- **Cel:** mapować segment→nagranie i udostępniać beatgrid + kolejność.
- **Pliki:** `server/app/archive.py`.
- **Sygnatury:**
  - sidecar: `self.dir / f"{recording_id}.json"` = `{"id","station","segments":[names...],"started_ns",**BeatGrid}`.
  - `def add_segment(self, opus_bytes, is_live=True, recording_id: str | None = None) -> Path` — dopisuje nazwę do manifestu `recording_id`.
  - `def list_recordings(self) -> list[Recording]` — nagrania w kolejności czasu (`Recording` = dataclass: id, segments, grid).
  - `def recording_of(self, segment_name: str) -> Recording | None`.
  - `enforce_cap()` (61–74): przy usuwaniu segmentów czyścić osierocone wpisy/manifesty.
- **Kryteria akceptacji:**
  - `list_recordings()` zwraca nagrania; suma ich `segments` == `list_segments()` (brak sierot).
  - `recording_of(seg)` poprawnie wskazuje nagranie dla każdego segmentu.
  - Wsteczna zgodność: segmenty bez manifestu (stare) traktowane jako jedno-segmentowe nagrania no-beat (nie wywalać).
- **Zależności:** po/z U-C1 (wspólny format BeatGrid).

#### U-C3 — mikser beatmatch na granicy nagrań (serwer, w strumieniu)
- **Cel:** wewnątrz nagrania bezszwowo; na granicy ~60 s miks zsynchronizowany do beatu albo tryb no-beat.
- **Pliki:** nowy `server/app/beatmatch.py`; użyty w `StationBroadcaster.run` (U-A1).
- **Sygnatury:**
  ```
  NO_BEAT_STATIONS = {"deep-ambient", "stoa"}
  BPM_TOLERANCE = 0.02         # > 2% różnicy => no-beat
  MAX_STRETCH = 0.04           # time-stretch tylko do ±4%
  MIX_SECONDS = 60.0
  @dataclass
  class TransitionPlan: mode: Literal["beatmatch","no-beat"]; stretch_ratio: float; align_offset_s: float; mix_seconds: float
  def plan_transition(station_id: str, tail: BeatGrid, head: BeatGrid) -> TransitionPlan
  def beatmatch_mix(tail_pcm, head_pcm, plan, rate=48000) -> bytes   # equal-power crossfade ~60s, siatka beatu wyrównana
  def no_beat_mix(tail_pcm, head_pcm, rate=48000) -> bytes          # krótszy crossfade ~6-8s + wyciszenie kicka wejścia
  ```
  - `plan_transition`: `mode="no-beat"` gdy `station_id in NO_BEAT_STATIONS` OR `not head.stable or not tail.stable` OR `|head.bpm/tail.bpm - 1| > BPM_TOLERANCE` (to pokrywa „urwanie na limicie sesji / rozjazd BPM"). Inaczej `mode="beatmatch"`: `stretch_ratio = clamp(tail.bpm/head.bpm, 1-MAX_STRETCH, 1+MAX_STRETCH)`, reszta rozjazdu absorbowana przez `align_offset_s` (wyrównanie `beat_offset`).
  - time-stretch: ffmpeg `atempo=<ratio>` (w granicach ±4%) lub `rubberband`.
  - no-beat: equal-power crossfade 6–8 s; na czas przejścia wyciszyć niskie pasmo wejścia (highpass/sidechain na sub) żeby kicki się nie rozjechały; dla ambientu to i tak brak beatu.
  - wewnątrz nagrania: konkatenacja PCM bez fade (bezszwowo, bo dekodujemy z jednego ciągłego PCM nagrania).
- **Kryteria akceptacji:**
  - Wewnątrz nagrania: brak słyszalnego „oddechu" co 30 s (dowód: analiza obwiedni RMS — brak periodycznych dipów 30 s; odsłuch).
  - Granica beatmatch (dos-groove↔dos-groove, stabilne): beaty zgrane w oknie miksu (korelacja onsetów tail/head w strefie przejścia > próg), stretch ≤ 4%.
  - Granica no-beat wymuszana gdy BPM rozjazd > 2% lub niestabilny grid; brak rytmicznego „ćwierkania" (odsłuch + log `mode`).
  - deep-ambient/stoa: ZAWSZE `mode="no-beat"`.
- **Zależności:** po U-C1, U-C2, U-A1.

#### U-C4 — poprawka fade w ChunkStreamer (fallback)
- **Cel:** żeby ścieżka zapasowa (gdy stream padnie) też nie fade’owała wewnątrz nagrania.
- **Pliki:** `src/radio/chunkStreamer.ts`.
- **Zmiany:** używać nagłówka `x-dosradio-recording` (dodać w `next-chunk`, main.py:242) by wiedzieć czy kolejny segment to to samo nagranie; jeśli TAK → bez fade (czysty gapless `nextStartTime = startAt + duration`), tylko ~5 ms equal-power do maskowania styku Opus; jeśli granica nagrania → krótki crossfade. Usunąć bezwarunkowy 80 ms fade z linii 114–117/125.
- **Kryteria akceptacji:** w trybie fallback brak periodycznego dipu 30 s; styki segmentów bez trzasków.
- **Zależności:** po U-C2 (nagłówek recording-id). Niski priorytet (tylko fallback).

---

## 4. Kolejność i równoległość

```
Faza 1 (równolegle, szybkie, niezależne):
  U-B1  (klient: VOICE_GAIN + DUCK_LEVEL)         ← zrób NAJPIERW, patch < 10 linii
  U-C1  (serwer: beatgrid + recording_id)         ← odblokowuje część C
  U-B2  (serwer: loudnorm TTS)                     ← po U-B1

Faza 2 (kręgosłup):
  U-A1  (serwer: /stream.ogg, najpierw sekwencyjnie bez beatmatch)   zależy: U-C1→U-C2
  U-C2  (serwer: manifest nagrań)                 zależy: U-C1

Faza 3:
  U-A2  (klient: <audio> + musicBus + Android)    zależy: U-A1
  U-C3  (serwer: beatmatch w strumieniu)          zależy: U-C1,U-C2,U-A1

Faza 4 (opcjonalnie):
  U-C4  (fallback ChunkStreamer fade)             zależy: U-C2
```

Ścieżka krytyczna: **U-C1 → U-C2 → U-A1 → {U-A2, U-C3}**. Część B (U-B1/U-B2) całkowicie równolegle — daje natychmiastową wartość bez czekania na kręgosłup.

---

## 5. Ryzyka i decyzje (rekomendacje)

| # | Ryzyko | Decyzja / rekomendacja |
|---|--------|------------------------|
| R1 | Rozgłośnia (shared) vs per-słuchacz — utrata `live_prob`/pozycji | **Rekomendacja: shared broadcast per stacja.** Dla publicznego radia to poprawny model i skaluje się O(stacje). Per-słuchacz zostaje jako udokumentowany fallback. |
| R2 | Koszt CPU: dekod Opus + time-stretch + re-enkod w czasie rzeczywistym | Shared = 1 pipeline/stację (≤14), nie na słuchacza. Beatmatch liczony raz na granicę (~co 5 min), buforowany z wyprzedzeniem; `atempo` tani. Akceptowalne na borg.tools. |
| R3 | `nagranie` = tylko ~5 min (num_segments=10) → granice co 5 min, dużo przejść | **Rekomendacja: podnieść `num_segments` do ~20 (≈10 min)** żeby granice i miksy były rzadsze i bliższe intencji „~10 min". Google i tak urywa wcześniej → wtedy no-beat (R4). |
| R4 | Nagranie urwane na limicie sesji → rozjazd beatu | Pokryte progiem w `plan_transition`: `not stable` lub BPM>2% ⇒ **no-beat** (wejście z wyciszonym kickiem). Dokładnie jak w wymaganiu. |
| R5 | Konkatenacja osobno kodowanych Opus NIE jest bit-perfect gapless (encoder delay/pre-skip) | Dlatego dekodujemy do PCM i re-enkodujemy JEDEN ciągły strumień serwerowo (U-A1) — to eliminuje styki. Fade w kliencie znika (U-C4 tylko dla fallbacku). |
| R6 | `createMediaElementSource` + CORS/`crossOrigin` może wyciszyć graf jeśli zła konfiguracja | `crossOrigin='anonymous'`, stream same-origin (`/radio-api/...`), `access-control-expose-headers`. Zweryfikować level meter != 0 po wpięciu. |
| R7 | Zależność `librosa` ciężka (numpy/scipy) na serwerze | Alternatywa `aubio` (lekka) jeśli obraz za duży; interfejs `measure_beatgrid` identyczny — decyzja przy implementacji wg rozmiaru obrazu Docker. |
| R8 | Cache „forever" welcome/jingle nie złapie loudnorm | Wersjonować nazwę pliku (`-ln20`) by wymusić re-render; stare pliki wygasną. |
| R9 | Regresja iOS przy zamianie ChunkStreamer→`<audio>` | `<audio>`+`audioSession='playback'` to ścieżka już sprawdzona w `iosAudioUnlock`. Twardy test na realnym iPhonie w DoD U-A2. |

---

## 6. Zadania robocze do delegacji (gotowe)

1. **[B/klient]** W `publicRadioEngine.ts` dodać `VOICE_GAIN=0.35`, ustawić `voiceGain.gain.value` w konstruktorze i podnieść `DUCK_LEVEL` do 0.30; zweryfikować odsłuchem i testem, że głos nie przebija muzyki.
2. **[B/serwer]** Dodać `loudnorm_wav(..., -20 LUFS)` i wpiąć w każdy render TTS (`speak`/welcome/jingle/intro/story), z wersjonowaniem nazw cache; dowód: `loudnorm print_format=json` ≈ −20 LUFS.
3. **[C/serwer]** Napisać `beatgrid.py` (`measure_beatgrid` via librosa/aubio) i wpiąć w `recorder.record_session` z `recording_id`; dodać zależność do requirements.
4. **[C/serwer]** Rozszerzyć `archive.py` o manifest nagrań (`list_recordings`, `recording_of`, sidecar JSON), z czyszczeniem sierot w `enforce_cap` i zgodnością wsteczną dla starych segmentów.
5. **[A/serwer]** Zbudować `stream.py` (`StationBroadcaster`/`BroadcastRegistry`) i route `/radio-api/station/{id}/stream.ogg` (StreamingResponse, ciągły Ogg/Opus), start od trybu sekwencyjnego bez beatmatch.
6. **[A/klient]** Napisać `mediaStreamPlayer.ts` (realny `<audio>`→`createMediaElementSource`→`musicBus`), podmienić źródło preset w `publicRadioEngine`, rozszerzyć `backgroundAudio` o realny element + MediaSession; dowód runtime: Android gra po zamknięciu karty, iOS bez regresji.
7. **[C/serwer]** Zaimplementować `beatmatch.py` (`plan_transition`+`beatmatch_mix`+`no_beat_mix`, progi: NO_BEAT_STATIONS, BPM 2%, stretch 4%, miks 60 s) i wpiąć w `StationBroadcaster` na granicach nagrań.

---

*Plan referencyjny. Status EXECUTABLE dopiero po macierzy wymaganie→kod→luka→pliki→test→dowód runtime przy wejściu w GSD execute.*
