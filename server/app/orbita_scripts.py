from __future__ import annotations

LANGS = {"pl", "en", "ru"}

NUDGE_5MIN: dict[str, str] = {
    "pl": "Zostało pięć minut pełnego dostępu. Załóż konto, a zostanę z tobą na dłużej.",
    "en": "Five minutes of full access left. Create an account and I’ll stay with you longer.",
    "ru": "Осталось пять минут полного доступа. Создай аккаунт, и я останусь с тобой подольше.",
}

PODCAST_TITLES: dict[str, str] = {
    "pl": "Twoja muzyka. Twoje tematy. Twoje życie.",
    "en": "Your music. Your topics. Your life.",
    "ru": "Твоя музыка. Твои темы. Твоя жизнь.",
}

STOIC_TITLES: dict[str, str] = {
    "pl": "Pigułka stoicka · Marek Aureliusz",
    "en": "Stoic pill · Marcus Aurelius",
    "ru": "Стоическая пилюля · Марк Аврелий",
}


def norm_lang(lang: str | None) -> str:
    return lang if lang in LANGS else "pl"


def intro_lines(host_name: str, lang: str) -> list[str]:
    code = norm_lang(lang)
    if code == "en":
        return [
            f"Hi, I'm {host_name}. This is AmbiRadio: the music is composed live, separately for each station.",
            "Drag the dial to change station. The moons around the speaker are news topics, pick the ones you want.",
            "Type any topic and we will record a podcast about it. Your own sources and mail go on air before the rest of the world.",
            "The first hour is free, and after that all you need to do is register. This is truly your radio — your music, your rules, your style.",
        ]
    if code == "ru":
        return [
            f"Привет, это {host_name}. Это AmbiRadio: музыка рождается вживую, отдельно для каждой станции.",
            "Потяни шкалу, чтобы сменить станцию. Луны вокруг динамика это темы новостей, выбери нужные.",
            "Напиши любую тему, и мы запишем о ней подкаст. Твои источники и письма выходят в эфир раньше остального мира.",
            "Первый час бесплатно, а потом достаточно просто зарегистрироваться. Это по-настоящему твоё радио — твоя музыка, твои правила, твой стиль.",
        ]
    return [
        f"Cześć, tu {host_name}. To AmbiRadio: muzyka powstaje na żywo, osobno dla każdej stacji.",
        "Przeciągnij tarczę, żeby zmienić stację. Księżyce wokół głośnika to tematy wiadomości, wybierz te, które chcesz.",
        "Wpisz dowolny temat, a nagramy o nim podcast. Twoje źródła i maile idą na antenę przed resztą świata.",
        "Pierwsza godzina jest za darmo, a później wystarczy, że się zarejestrujesz. To jest prawdziwe twoje radio — twoja muzyka, twoje zasady, twój styl.",
    ]


def podcast_script(a: str, b: str, lang: str) -> list[tuple[str, ...]]:
    code = norm_lang(lang)
    if code == "en":
        return [
            ("A", f"Welcome to AmbiRadio. I'm {a}, and {b} is in the studio with me. Three minutes about why this radio isn't playlists."),
            ("B", "Because a playlist ends, repeats, and sooner or later pulls your hand back to the screen. Here the music is composed live. Every bar for the first time, matched to the station you picked."),
            ("A", "Drag the dial: twenty-five stations, from deep ambient at sixty beats, through lo-fi for study and stoic minimalism, up to Berlin techno at a hundred thirty-eight."),
            ("B", "Every station has its own host and its own voice. If you only want the music, one button turns the hosts off completely."),
            ("music",),
            ("A", "Around the speaker orbit the moons: news topics. Click a moon to turn a topic on or off. AI, science, Polish, world, sport, stoic quotes, lighter stories."),
            ("B", "And the moon called Mine. Connect Gmail, paste RSS feeds, add keywords. Before the radio reads the world, it checks what matters to you."),
            ("A", "Your parcel, an invoice, a note from a client, a new release of a library you actually use. Not read word for word: one calm sentence, no spam, no newsletters."),
            ("music",),
            ("B", "The second thing: podcasts on demand. Type any topic, even a very narrow one: heat-pump sizing for an older house, Stoics on anger, new batteries in aviation."),
            ("A", "Two minutes later the two of us enter the airwaves with a conversation on that exact subject, woven into the music you are already listening to. One podcast in this free hour is on us."),
            ("B", "And the third: knowledge pills. Paste a YouTube lecture or an article you never have time for. The radio distils the core ideas and plays them between tracks."),
            ("A", "An hour of commute, cooking or walking, and you're caught up, without staring at a phone."),
            ("B", "Try everything now: drag the dial, switch a moon, order your free podcast in the panel on the right. Stay with us."),
        ]
    if code == "ru":
        return [
            ("A", f"Добро пожаловать на AmbiRadio. Я {a}, со мной в студии {b}. Три минуты о том, почему это радио не плейлисты."),
            ("B", "Плейлист кончается, повторяется и тянет руку обратно к экрану. Здесь музыка рождается вживую, каждый такт впервые, под выбранную станцию."),
            ("A", "Потяни шкалу: двадцать пять станций, от глубокого эмбиента до берлинского техно. У каждой свой ведущий, а одной кнопкой можно оставить только музыку."),
            ("music",),
            ("B", "Вокруг динамика вращаются луны тем. Включай нужные, а в луне Моё подключи почту, RSS и ключевые слова: твои дела прозвучат раньше мировых лент."),
            ("A", "Второе: подкаст на любую тему по запросу. Один подкаст в этот бесплатный час уже ждёт тебя в панели справа."),
            ("B", "И третье: пилюли знаний из длинных видео на YouTube и статей, между треками, пока заняты руки."),
            ("A", "Попробуй прямо сейчас: покрути шкалу, переключи луну, закажи свой бесплатный подкаст. Оставайся с нами."),
        ]
    return [
        ("A", f"Witaj w AmbiRadio. Tu {a}, a ze mną w studiu {b}. Przez trzy minuty pokażemy ci, dlaczego to radio nie gra z playlisty."),
        ("B", "Bo playlista się kończy, powtarza i prędzej czy później odrywa ręce do ekranu. Tutaj muzyka powstaje na żywo, w tej chwili, dopasowana do stacji, którą wybierzesz."),
        ("A", "Przeciągnij tarczę: dwadzieścia pięć stacji, od głębokiego ambientu sześćdziesiąt uderzeń na minutę, przez lo-fi do nauki i stoicki minimalizm, aż po berlińskie techno sto trzydzieści osiem."),
        ("B", "Każda stacja ma własnego prowadzącego i własny charakter. A jeśli chcesz samej muzyki, jednym przyciskiem wyłączasz głos całkowicie."),
        ("music",),
        ("A", "Wokół głośnika krążą księżyce: to tematy wiadomości. Klikasz księżyc i włączasz albo wyłączasz temat. Sztuczna inteligencja, nauka, Polska, świat, sport, stoickie cytaty, lżejsze historie."),
        ("B", "I księżyc Moje. Możesz podpiąć Gmaila, wkleić własne kanały RSS i słowa kluczowe. Zanim radio przeczyta świat, sprawdzi, co wydarzyło się u ciebie."),
        ("A", "Przesyłka, faktura, wiadomość od klienta, nowa wersja biblioteki, której używasz. Nie czytamy maili słowo w słowo: robimy jedno spokojne zdanie, bez spamu i bez newsletterów."),
        ("music",),
        ("B", "Druga rzecz: podcast na żądanie. Wpisujesz dowolny temat, choćby bardzo wąski: dobór pompy ciepła do starego domu, stoicy o gniewie, nowe baterie w lotnictwie."),
        ("A", "Dwie minuty później wchodzimy na antenę we dwoje z rozmową dokładnie o tym, wplecioną w muzykę, której właśnie słuchasz. Jeden taki podcast w tej godzinie masz od nas za darmo."),
        ("B", "I trzecia rzecz: pigułki wiedzy. Wklejasz link do długiego wykładu na YouTubie albo artykułu, na który nigdy nie ma czasu. Radio wyciąga sedno i podaje je między utworami."),
        ("A", "Godzina jazdy, gotowania albo spaceru, i jesteś na bieżąco, bez patrzenia w telefon."),
        ("B", "Wypróbuj wszystko teraz: przesuń tarczę, przełącz księżyc, zamów swój darmowy podcast w panelu po prawej. Zostań z nami."),
    ]


def stoic_script(lang: str) -> list[tuple[str, ...]]:
    code = norm_lang(lang)
    if code == "en":
        return [
            ("A", "A short stoic pill, the way knowledge pills sound on air."),
            ("B", "Marcus Aurelius wrote to himself at dawn: when you wake reluctant, tell yourself you are rising to do the work of a human being."),
            ("A", "Not to scroll, not to react to every ping. Pick one thing that depends on you before noon, and let the rest be background noise."),
            ("B", "Back to the music."),
        ]
    if code == "ru":
        return [
            ("A", "Короткая стоическая пилюля: так в эфире звучат пилюли знаний."),
            ("B", "Марк Аврелий писал себе утром: когда трудно вставать, скажи себе, что встаёшь ради дела человека."),
            ("A", "Выбери одно дело до полудня, которое зависит от тебя, а остальной шум оставь за окном."),
            ("B", "Возвращаемся к музыке."),
        ]
    return [
        ("A", "Krótka pigułka stoicka: tak na antenie brzmią pigułki wiedzy."),
        ("B", "Marek Aureliusz pisał do siebie rano: kiedy trudno ci wstać, powiedz sobie, że wstajesz do pracy człowieka."),
        ("A", "Nie do przewijania cudzych opinii i nie do gaszenia każdego powiadomienia. Wybierz przed południem jedną rzecz, która zależy wyłącznie od ciebie."),
        ("B", "Wracamy do muzyki."),
    ]
