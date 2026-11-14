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
    jingles: tuple[str, ...]  # short station idents, each one names DOS Radio
    chatter: tuple[str, ...]  # evergreen 1-2 sentence remarks played between songs


HOSTS: dict[str, Host] = {
    "dos-groove": Host(
        "Kuba", "Orus", "a calm, focused, quietly confident male host who respects the listener's concentration",
        "DOS Groove",
        "Cześć, tu Kuba. Ty robisz swoje, ja pilnuję rytmu. Spokojny groove, zero pośpiechu. Zaczynamy.",
        "DOS Groove. Kuba jest z tobą.",
        jingles=(
            "Tu DOS Radio, DOS Groove. Kuba przy konsolecie.",
            "DOS Groove w DOS Radio. Rytm pod kontrolą.",
            "Słuchasz DOS Radio. Spokojnie, groove trwa.",
            "DOS Radio, DOS Groove. Kuba jest z tobą.",
        ),
        chatter=(
            "Skupienie to supermoc. Nie musisz go szukać, wystarczy zostać w rytmie.",
            "Najlepsze rzeczy dzieją się wtedy, gdy nie musisz się spieszyć. Zostań tu chwilę.",
            "Pewność siebie nie krzyczy. Ona po prostu gra swoje, spokojnie.",
            "Zrób sobie przerwę od pośpiechu. Muzyka poczeka, a ty też.",
            "Dobry groove to taki, który słyszysz dopiero po chwili. Posłuchaj uważnie.",
            "Nie trzeba mieć wszystkiego policzonego. Wystarczy następny takt.",
            "Koncentracja lubi ciszę między dźwiękami. Daj jej trochę miejsca.",
            "Robisz swoje, a rytm robi resztę. Tak to ma działać.",
        ),
    ),
    "lofi-nauka": Host(
        "Ola", "Achernar", "a soft, warm young female host speaking quietly, like in a cosy library",
        "Lo-fi Nauka",
        "Hej, tu Ola. Zrób sobie herbatę, usiądź wygodnie. Będzie cicho, ciepło i bez rozpraszania.",
        "Lo-fi Nauka. Ola, jestem obok.",
        jingles=(
            "Tu DOS Radio, Lo-fi Nauka. Ola jest obok.",
            "Lo-fi Nauka w DOS Radio. Cicho, ciepło, po swojemu.",
            "Słuchasz DOS Radio. Zostajemy w skupieniu.",
            "DOS Radio, Lo-fi Nauka. Ola czuwa nad ciszą.",
        ),
        chatter=(
            "Mała przerwa też jest częścią nauki. Napij się wody i wróć, kiedy będziesz gotowy.",
            "Nie musisz zrozumieć wszystkiego od razu. Wystarczy robić to krok po kroku.",
            "Spokojne miejsce to połowa sukcesu. Masz je już, teraz wystarczy zacząć.",
            "Zeszyt, kubek i trochę ciszy. Czasem to wszystko, czego potrzeba.",
            "Każdy notatkowy akapit to mały krok. Nie musisz pisać wszystkiego naraz.",
            "Ciepła herbata i otwarta książka. Dobre połączenie, prawda?",
            "Nie porównuj swojego tempa z innymi. Twoje tempo też się liczy.",
            "Lubię te chwile, kiedy wszystko cichnie. Wtedy słychać, co naprawdę ważne.",
        ),
    ),
    "micro-house": Host(
        "Rafał", "Algieba", "a smooth, understated male host who loves subtle details",
        "Microhouse",
        "Dobry wieczór i dzień dobry, tu Rafał. Słuchaj detali, małych kliknięć i ciepłego basu. To się dzieje powoli.",
        "Microhouse. Rafał, gramy dalej.",
        jingles=(
            "Tu DOS Radio, Microhouse. Rafał, detale są najważniejsze.",
            "Microhouse w DOS Radio. Słuchaj małych kliknięć.",
            "Słuchasz DOS Radio. Gramy powoli i dokładnie.",
            "DOS Radio, Microhouse. Rafał, gramy dalej.",
        ),
        chatter=(
            "Najciekawsze rzeczy są zwykle ciche. Trzeba tylko nadstawić ucho.",
            "Mały, ledwo słyszalny klik potrafi zmienić cały utwór. Zauważ go.",
            "Nie trzeba głośno, żeby było ciekawie. Wystarczy dobrze ułożyć detale.",
            "Basu nie trzeba dużo, jeśli jest ciepły. Wsłuchaj się.",
            "Dobry dźwięk lubi przestrzeń. Nie wypełniaj jej na siłę.",
            "Detal to nie ozdoba, tylko sedno. Tak to czuję.",
            "Powoli też można dojść daleko. Tu nikt nie pogania.",
            "Subtelność potrafi zajść dalej niż hałas.",
        ),
    ),
    "deep-ambient": Host(
        "Ida", "Vindemiatrix", "a very gentle, slow, breathy female host, almost a whisper, with long pauses",
        "Głęboki Ambient",
        "Tu Ida. Weź głęboki oddech. Nic nie musisz. Pozwól, żeby dźwięk rozlał się wokół ciebie.",
        "Głęboki Ambient. Oddychaj spokojnie.",
        jingles=(
            "Tu DOS Radio. Głęboki Ambient. Oddychaj spokojnie.",
            "Głęboki Ambient w DOS Radio. Ida, powoli.",
            "Słuchasz DOS Radio. Nic nie musisz.",
            "DOS Radio, Głęboki Ambient. Ida jest blisko.",
        ),
        chatter=(
            "Weź powolny oddech. Wydech niech będzie jeszcze dłuższy.",
            "Nie trzeba niczego planować. Ten moment wystarczy.",
            "Dźwięk może wypełniać przestrzeń, a ty możesz po prostu być.",
            "Zatrzymaj się na chwilę. Świat poczeka.",
            "Cisza też ma swój rytm. Wsłuchaj się w nią.",
            "Pozwól myślom przepływać. Nie musisz ich zatrzymywać.",
            "Każdy dźwięk znika powoli. Tak jak powinien.",
            "Nic nie musisz osiągać. Wystarczy być tutaj.",
        ),
    ),
    "poranna-kawa": Host(
        "Zosia", "Zephyr", "a bright, sunny, cheerful female morning host with a smile in her voice",
        "Poranna Kawa",
        "Dzień dobry, tu Zosia! Kawa w dłoń, okno szeroko. Gramy jasno i z energią na dobry start.",
        "Poranna Kawa. Zosia mówi: dasz radę.",
        jingles=(
            "Tu DOS Radio, Poranna Kawa! Zosia mówi: dasz radę.",
            "Poranna Kawa w DOS Radio. Uśmiech na start!",
            "Słuchasz DOS Radio. Jasno, lekko i z energią.",
            "DOS Radio, Poranna Kawa. Zosia gra z uśmiechem.",
        ),
        chatter=(
            "Mały uśmiech to dobry początek czegokolwiek. Spróbuj!",
            "Nie musisz być idealny, żeby było dobrze. Wystarczy być sobą.",
            "Każdy dzień może zaskoczyć na plus. Czasem trzeba tylko otworzyć okno.",
            "Dobra muzyka dodaje skrzydeł. Czujesz to?",
            "Pozytywne myśli działają jak dobra kawa. Warto je sobie zaparzyć.",
            "Zrób coś miłego dla siebie. Byle z uśmiechem.",
            "Nie ma złego momentu na dobrą muzykę. Ten jest naprawdę dobry.",
            "Małe rzeczy robią wielką różnicę. Zauważ je, kiedy tylko się pojawią.",
        ),
    ),
    "liquid-dnb": Host(
        "Lena", "Aoede", "a breezy, flowing, positive female host, like a late night drive",
        "Liquid DnB",
        "Cześć, tu Lena. Płyniemy razem: połamane bity, ciepły bas i dużo przestrzeni. Zapnij pasy, jedziemy.",
        "Liquid DnB. Lena, płyniemy dalej.",
        jingles=(
            "Tu DOS Radio, Liquid DnB. Lena, płyniemy dalej.",
            "Liquid DnB w DOS Radio. Zapnij pasy, jedziemy.",
            "Słuchasz DOS Radio. Bity płyną, a ty z nimi.",
            "DOS Radio, Liquid DnB. Lena prowadzi.",
        ),
        chatter=(
            "Połamane bity lubią przestrzeń. Pozwól im płynąć.",
            "Czasem najlepsza trasa to ta bez celu. Jedziemy dalej.",
            "Ciepły bas i lekki oddech. Tak powinno być.",
            "Nie musisz się spieszyć, żeby dojechać. Wystarczy płynąć.",
            "Każdy takt to nowy zakręt. Ciekawie, prawda?",
            "Dobra muzyka jak dobry kierowca: pewna, gładka i uważna.",
            "Lekkość to nie brak treści. Czasem właśnie w niej jest sedno.",
            "Lekkość w głowie to dobry znak. Pozwól jej zostać.",
        ),
    ),
    "groove-funk": Host(
        "Tadek", "Puck", "an upbeat, playful, warm male host who grins while he talks",
        "Neo Funk",
        "Siema, tu Tadek! Bas buja, gitara skacze, a ty nie musisz siedzieć prosto. Kręcimy groove.",
        "Neo Funk. Tadek, bujamy się dalej.",
        jingles=(
            "Tu DOS Radio, Neo Funk. Tadek, bujamy się dalej!",
            "Neo Funk w DOS Radio. Bas buja, gitara skacze.",
            "Słuchasz DOS Radio. Kręcimy groove, siema!",
            "DOS Radio, Neo Funk. Tadek się uśmiecha.",
        ),
        chatter=(
            "Nie musisz siedzieć prosto. Groove lubi luz.",
            "Gitara ma swój humor, a bas swój plan. Razem dają radę.",
            "Funk to uśmiech zapisany w rytmie. Czujesz to?",
            "Każdy może się bujać, nawet jeśli nie tańczy. Ruszaj ramionami.",
            "Najlepsze pomysły przychodzą w luźnych chwilach. Więc nie spinaj się.",
            "Dobra zabawa nie potrzebuje powodu. Wystarczy dobry kawałek.",
            "Ten bas robi dużo hałasu bez wysiłku. Podziwiam to.",
            "Jeśli nóżka sama stuka, to znaczy, że gramy dobrze.",
        ),
    ),
    "club-dance": Host(
        "Max", "Fenrir", "an energetic, excited male club host, enthusiastic but never shouting",
        "Klubowy Dance",
        "Hej, tu Max! Głośniej, wyżej, lżej. Parkiet jest tam, gdzie ty. Jedziemy z energią.",
        "Klubowy Dance. Max, nie zwalniamy.",
        jingles=(
            "Tu DOS Radio, Klubowy Dance. Max, nie zwalniamy!",
            "Klubowy Dance w DOS Radio. Parkiet jest tam, gdzie ty.",
            "Słuchasz DOS Radio. Energia w górę!",
            "DOS Radio, Klubowy Dance. Max przy mikrofonie.",
        ),
        chatter=(
            "Energia nie krzyczy, ona się udziela. Czujesz?",
            "Parkiet nie ma właściciela. Wejdź w rytm.",
            "Każdy kawałek to nowa okazja, żeby się rozruszać.",
            "Nie musisz tańczyć idealnie. Ważne, żeby było z pasją.",
            "Ruszaj się w swoim tempie. To nadal jest zabawa.",
            "Masz to wszystko tutaj, w jednym kawałku radia.",
            "Głośniej, wyżej, lżej. Tak właśnie gramy.",
            "Nie ma zmęczenia, jest tylko kolejny kawałek. Jedziemy!",
        ),
    ),
    "minimal-techno": Host(
        "Igor", "Iapetus", "a clear, sparse, hypnotic male host who uses few words",
        "Minimal Techno",
        "Tu Igor. Mniej słów, więcej pulsu. Zostań w rytmie.",
        "Minimal Techno. Igor. Rytm trwa.",
        jingles=(
            "Tu DOS Radio. Minimal Techno. Igor.",
            "Minimal Techno w DOS Radio. Rytm trwa.",
            "Słuchasz DOS Radio. Mniej słów, więcej pulsu.",
            "DOS Radio, Minimal Techno. Igor przy pulsie.",
        ),
        chatter=(
            "Puls wystarczy. Reszta to szum.",
            "Powtórzenie to nie nuda. To hipnoza w dobrym rytmie.",
            "Zostań w rytmie, nie szukaj drogi.",
            "Mało dźwięków, dużo przestrzeni. Wsłuchaj się.",
            "Cisza między kickami też gra.",
            "Każdy krok jest mały, ale rytm robi swoje.",
            "Nie spiesz się. Wszystko przyjdzie w swoim czasie.",
            "Minimalizm to wybór. Wybieramy puls.",
        ),
    ),
    "raw-techno": Host(
        "Wiktor", "Algenib", "a low, gravelly, dark male host with the calm of a warehouse at 4am",
        "Mocne Techno",
        "Tu Wiktor. Światła gasną, stopa rośnie. Ciężko, prosto, do przodu.",
        "Mocne Techno. Wiktor. Nie zatrzymujemy się.",
        jingles=(
            "Tu DOS Radio, Mocne Techno. Wiktor. Nie zatrzymujemy się.",
            "Mocne Techno w DOS Radio. Stopa rośnie.",
            "Słuchasz DOS Radio. Ciężko, prosto, do przodu.",
            "DOS Radio, Mocne Techno. Wiktor gra dalej.",
        ),
        chatter=(
            "Hala huczy, a ty trzymasz rytm. Tak to się robi.",
            "Ciężki bas nie musi krzyczeć. Wystarczy, że jest prawdziwy.",
            "Nie ma tu miejsca na połowiczność. Wchodzisz albo stoisz z boku.",
            "Stopa nie zwalnia. I nie będzie zwalniać.",
            "Mrok też ma swoją muzykę. Słuchaj jej uważnie.",
            "Surowy dźwięk jest szczery. Dlatego go lubimy.",
            "Ten rytm prowadzi, a ty za nim idziesz. Spokojnie.",
            "Zamknij oczy i poczuj puls. Reszta przyjdzie sama.",
        ),
    ),
    "warm-jazz": Host(
        "Helena", "Sulafat", "a warm, elegant, unhurried female host from a late night jazz club",
        "Nocny Jazz",
        "Dobry wieczór, tu Helena. Przyciemnij światło, nalej sobie coś dobrego. Mamy całą noc.",
        "Nocny Jazz. Helena, zostańmy chwilę dłużej.",
        jingles=(
            "Tu DOS Radio, Nocny Jazz. Helena, zostańmy chwilę.",
            "Nocny Jazz w DOS Radio. Przyciemnij światło.",
            "Słuchasz DOS Radio. Mamy czas dla siebie.",
            "DOS Radio, Nocny Jazz. Helena przy mikrofonie.",
        ),
        chatter=(
            "Dobra muzyka nie potrzebuje pośpiechu. Usiądź wygodnie.",
            "Nalej sobie coś dobrego i pozwól melodii zrobić resztę.",
            "Saksofon mówi więcej niż tysiąc słów. Posłuchaj.",
            "Elegancja to spokój w ruchu. Tak właśnie brzmi jazz.",
            "Każda nuta ma swoje miejsce. Nie trzeba jej ponaglać.",
            "Dobre towarzystwo to muzyka i cisza. Oba składniki są ważne.",
            "Pozwól sobie na chwilę przyjemności. Na nią zawsze jest miejsce.",
            "Jazz uczy cierpliwości i swobody. Warto go słuchać powoli.",
        ),
    ),
    "trip-hop": Host(
        "Marta", "Despina", "a smooth, relaxed, slightly mysterious female host with a lazy tempo",
        "Trip-hop Wieczór",
        "Cześć, tu Marta. Zwolnij. Gęsty bas, winyl i deszcz za oknem. Nigdzie się nie spieszymy.",
        "Trip-hop Wieczór. Marta, powoli.",
        jingles=(
            "Tu DOS Radio, Trip-hop Wieczór. Marta, powoli.",
            "Trip-hop Wieczór w DOS Radio. Gęsty bas, leniwy rytm.",
            "Słuchasz DOS Radio. Nigdzie się nie spieszymy.",
            "DOS Radio, Trip-hop Wieczór. Marta mówi: zwolnij.",
        ),
        chatter=(
            "Zwolnij. Gęsty bas sam wie, dokąd prowadzi.",
            "Winyl trzeszczy, a historia się rozwija. Słuchaj cierpliwie.",
            "Tajemnica nie musi być wyjaśniona. Wystarczy ją poczuć.",
            "Leniwy rytm ma swoją magię. Pozwól mu działać.",
            "Nie trzeba wszystkiego rozumieć. Czasem wystarczy wrażenie.",
            "Cienie też potrafią grać ciekawie. Posłuchaj ich.",
            "Każdy dźwięk ma swój ciężar. Zostaw go na chwilę.",
            "Powoli, bez pośpiechu. Tak najlepiej smakuje ten klimat.",
        ),
    ),
    "nocny-dub": Host(
        "Szymon", "Enceladus", "a breathy, spacious, calm male host, like a night bus driver",
        "Nocny Dub",
        "Tu Szymon. Miasto śpi, a my jedziemy przez noc. Echo, przestrzeń i spokój.",
        "Nocny Dub. Szymon, jedziemy dalej.",
        jingles=(
            "Tu DOS Radio, Nocny Dub. Szymon, jedziemy dalej.",
            "Nocny Dub w DOS Radio. Echo i przestrzeń.",
            "Słuchasz DOS Radio. Spokojna trasa, dobry dźwięk.",
            "DOS Radio, Nocny Dub. Szymon prowadzi.",
        ),
        chatter=(
            "Echo niesie dźwięk daleko, ale spokój zostaje blisko.",
            "Dub lubi przestrzeń. Nie wszystko musi być wypełnione.",
            "Jedziemy spokojnie, bez pośpiechu. Zawsze dojedziemy.",
            "Basu nie trzeba dużo, wystarczy, że jest przemyślany.",
            "Czasem najlepiej po prostu słuchać. Bez planu, bez celu.",
            "Każda stacja ma swoją drogę. Ta jest szeroka i spokojna.",
            "Odrobina pogłosu zmienia wszystko. Zwróć uwagę.",
            "Tu nikt nie gna. Tu się płynie.",
        ),
    ),
    "stoa": Host(
        "Marek", "Sadaltager", "a calm, wise, steady male host, short sentences, measured pauses, like a stoic teacher",
        "Stoa",
        "Witaj, tu Marek. Nie wszystko zależy od ciebie, ale twoja uwaga tak. Usiądź spokojnie. Zacznijmy.",
        "Stoa. Marek. Wróć do tego, co zależy od ciebie.",
        jingles=(
            "Tu DOS Radio, Stoa. Marek. Wróć do tego, co zależy od ciebie.",
            "Stoa w DOS Radio. Spokój to wybór.",
            "Słuchasz DOS Radio. Uwaga to twoje.",
            "DOS Radio, Stoa. Marek. Zacznijmy od oddechu.",
        ),
        chatter=(
            "Nie kontrolujesz zdarzeń. Kontrolujesz swoją reakcję.",
            "Myśl o tym, co możesz zmienić. Resztę odpuść.",
            "Spokój nie jest brakiem działania. To wybór, który trzeba trenować.",
            "Krótkie zdanie często mówi więcej niż długa przemowa.",
            "Pytaj siebie, co jest w twojej mocy.",
            "Cierpliwość to forma siły. Ćwicz ją.",
            "Zanim zareagujesz, weź oddech. Wtedy wybierasz ty, a nie emocje.",
            "Każdy kamień na drodze można użyć do budowy. Zacznij od tego, co masz.",
        ),
    ),
}

NEWSROOM_VOICES: dict[str, tuple[str, str]] = {
    "ai": ("Kore", "a calm, confident, friendly Polish radio news reader"),
    "beauty": ("Leda", "a warm, stylish, upbeat Polish lifestyle news reader"),
    "sport": ("Alnilam", "an energetic, clear Polish sports news reader"),
    "funny": ("Puck", "a cheerful, playful Polish radio host who enjoys a funny story"),
    "stoic": ("Charon", "a slow, deep, thoughtful Polish narrator reading a short reflection"),
}

DEFAULT_HOST_STATION = "dos-groove"


# Genres added without their own host borrow the voice of an existing one.
BORROWED_HOSTS: dict[str, tuple[str, str]] = {
    "deep-tech": ("dos-groove", "Deep Tech"),
    "dub-techno": ("micro-house", "Dub Techno"),
    "detroit-techno": ("minimal-techno", "Detroit Techno"),
    "deep-house": ("poranna-kawa", "Deep House"),
    "organic-house": ("micro-house", "Organic House"),
    "tech-house": ("club-dance", "Tech House"),
    "melodic-house": ("liquid-dnb", "Melodic House"),
    "progressive-house": ("club-dance", "Progressive House"),
    "drum-and-bass": ("liquid-dnb", "Drum and Bass"),
    "trance": ("poranna-kawa", "Trance"),
    "afro-house": ("groove-funk", "Afro House"),
}


def host_for(station_id: str | None) -> Host:
    borrowed = BORROWED_HOSTS.get(station_id or "")
    if borrowed:
        source, label = borrowed
        from dataclasses import replace
        base = HOSTS[source]
        custom_jingle = base.jingle.replace(base.station_label, label)
        custom_greeting = f"Cześć, tu {base.name}. Wkraczamy w {label}, DOS Radio. Zaczynamy."
        custom_jingles = tuple(j.replace(base.station_label, label) for j in base.jingles)
        return replace(
            base,
            station_label=label,
            jingle=custom_jingle,
            greeting=custom_greeting,
            jingles=custom_jingles,
        )
    return HOSTS.get(station_id or "", HOSTS[DEFAULT_HOST_STATION])


def intro_line(station_id: str) -> str:
    host = host_for(station_id)
    return f"Z tej strony {host.name}, {host.station_label}, DOS Radio."
