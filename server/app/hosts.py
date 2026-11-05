"""Radio hosts: every station has its own named host whose voice and manner match the music.

The newsroom (one voice per news topic) is separate, so each topic is recorded once per hour
and the same file is replayed for every listener, whatever station they are on.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Host:
    name: str
    voice: str          # Gemini TTS prebuilt voice
    style: str          # English delivery hint, never part of the spoken text
    station_label: str  # how the host says the station name
    greeting: str       # spoken on Play, ~10-15 s
    jingle: str         # short ident played when the stream recovers


HOSTS: dict[str, Host] = {
    "dos-groove": Host(
        "Kuba", "Orus", "a calm, focused, quietly confident male host who respects the listener's concentration",
        "DOS Groove",
        "Cześć, tu Kuba. Ty robisz swoje, ja pilnuję rytmu. Spokojny groove, zero pośpiechu. Zaczynamy.",
        "DOS Groove. Kuba jest z tobą."),
    "lofi-nauka": Host(
        "Ola", "Achernar", "a soft, warm young female host speaking quietly, like in a cosy library",
        "Lo-fi Nauka",
        "Hej, tu Ola. Zrób sobie herbatę, usiądź wygodnie. Będzie cicho, ciepło i bez rozpraszania.",
        "Lo-fi Nauka. Ola, jestem obok."),
    "micro-house": Host(
        "Rafał", "Algieba", "a smooth, understated male host who loves subtle details",
        "Microhouse",
        "Dobry wieczór i dzień dobry, tu Rafał. Słuchaj detali, małych kliknięć i ciepłego basu. To się dzieje powoli.",
        "Microhouse. Rafał, gramy dalej."),
    "deep-ambient": Host(
        "Ida", "Vindemiatrix", "a very gentle, slow, breathy female host, almost a whisper, with long pauses",
        "Głęboki Ambient",
        "Tu Ida. Weź głęboki oddech. Nic nie musisz. Pozwól, żeby dźwięk rozlał się wokół ciebie.",
        "Głęboki Ambient. Oddychaj spokojnie."),
    "poranna-kawa": Host(
        "Zosia", "Zephyr", "a bright, sunny, cheerful female morning host with a smile in her voice",
        "Poranna Kawa",
        "Dzień dobry, tu Zosia! Kawa w dłoń, okno szeroko. Gramy jasno i z energią na dobry start.",
        "Poranna Kawa. Zosia mówi: dasz radę."),
    "liquid-dnb": Host(
        "Lena", "Aoede", "a breezy, flowing, positive female host, like a late night drive",
        "Liquid DnB",
        "Cześć, tu Lena. Płyniemy razem: połamane bity, ciepły bas i dużo przestrzeni. Zapnij pasy, jedziemy.",
        "Liquid DnB. Lena, płyniemy dalej."),
    "groove-funk": Host(
        "Tadek", "Puck", "an upbeat, playful, warm male host who grins while he talks",
        "Neo Funk",
        "Siema, tu Tadek! Bas buja, gitara skacze, a ty nie musisz siedzieć prosto. Kręcimy groove.",
        "Neo Funk. Tadek, bujamy się dalej."),
    "club-dance": Host(
        "Max", "Fenrir", "an energetic, excited male club host, enthusiastic but never shouting",
        "Klubowy Dance",
        "Hej, tu Max! Głośniej, wyżej, lżej. Parkiet jest tam, gdzie ty. Jedziemy z energią.",
        "Klubowy Dance. Max, nie zwalniamy."),
    "minimal-techno": Host(
        "Igor", "Iapetus", "a clear, sparse, hypnotic male host who uses few words",
        "Minimal Techno",
        "Tu Igor. Mniej słów, więcej pulsu. Zostań w rytmie.",
        "Minimal Techno. Igor. Rytm trwa."),
    "raw-techno": Host(
        "Wiktor", "Algenib", "a low, gravelly, dark male host with the calm of a warehouse at 4am",
        "Mocne Techno",
        "Tu Wiktor. Światła gasną, stopa rośnie. Ciężko, prosto, do przodu.",
        "Mocne Techno. Wiktor. Nie zatrzymujemy się."),
    "warm-jazz": Host(
        "Helena", "Sulafat", "a warm, elegant, unhurried female host from a late night jazz club",
        "Nocny Jazz",
        "Dobry wieczór, tu Helena. Przyciemnij światło, nalej sobie coś dobrego. Mamy całą noc.",
        "Nocny Jazz. Helena, zostańmy chwilę dłużej."),
    "trip-hop": Host(
        "Marta", "Despina", "a smooth, relaxed, slightly mysterious female host with a lazy tempo",
        "Trip-hop Wieczór",
        "Cześć, tu Marta. Zwolnij. Gęsty bas, winyl i deszcz za oknem. Nigdzie się nie spieszymy.",
        "Trip-hop Wieczór. Marta, powoli."),
    "nocny-dub": Host(
        "Szymon", "Enceladus", "a breathy, spacious, calm male host, like a night bus driver",
        "Nocny Dub",
        "Tu Szymon. Miasto śpi, a my jedziemy przez noc. Echo, przestrzeń i spokój.",
        "Nocny Dub. Szymon, jedziemy dalej."),
    "stoa": Host(
        "Marek", "Sadaltager", "a calm, wise, steady male host, short sentences, measured pauses, like a stoic teacher",
        "Stoa",
        "Witaj, tu Marek. Nie wszystko zależy od ciebie, ale twoja uwaga tak. Usiądź spokojnie. Zacznijmy.",
        "Stoa. Marek. Wróć do tego, co zależy od ciebie."),
}

NEWSROOM_VOICES: dict[str, tuple[str, str]] = {
    "ai": ("Kore", "a calm, confident, friendly Polish radio news reader"),
    "beauty": ("Leda", "a warm, stylish, upbeat Polish lifestyle news reader"),
    "sport": ("Alnilam", "an energetic, clear Polish sports news reader"),
    "funny": ("Puck", "a cheerful, playful Polish radio host who enjoys a funny story"),
    "stoic": ("Charon", "a slow, deep, thoughtful Polish narrator reading a short reflection"),
}

DEFAULT_HOST_STATION = "dos-groove"


def host_for(station_id: str | None) -> Host:
    return HOSTS.get(station_id or "", HOSTS[DEFAULT_HOST_STATION])


def intro_line(station_id: str) -> str:
    host = host_for(station_id)
    return f"Z tej strony {host.name}, {host.station_label}, DOS Radio."
