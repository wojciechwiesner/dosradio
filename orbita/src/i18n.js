/* UI strings, station copy and plural rules for PL / EN / RU */
export const LANGS = ['pl', 'en', 'ru'];
const LOCALE = { pl: 'pl-PL', en: 'en-GB', ru: 'ru-RU' };
let lang = 'pl';
export const getLang = () => lang;
export const locale = () => LOCALE[lang];
export function detectLang() {
  const h = (location.hash || '').replace('#', '');
  if (LANGS.includes(h)) return h;
  try { const s = localStorage.getItem('dosradio.orbita.lang'); if (LANGS.includes(s)) return s; } catch { /* blocked */ }
  const n = (navigator.language || 'pl').slice(0, 2);
  return LANGS.includes(n) ? n : 'en';
}
export function setLang(l) {
  lang = LANGS.includes(l) ? l : 'pl';
  document.documentElement.lang = lang;
  try { localStorage.setItem('dosradio.orbita.lang', lang); } catch { /* blocked */ }
}

/* Slavic plurals: one / few / many */
export function plural(n, [one, few, many]) {
  if (lang === 'en') return n === 1 ? one : few;
  const m10 = n % 10, m100 = n % 100;
  if (lang === 'ru') { if (m10 === 1 && m100 !== 11) return one; if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few; return many; }
  if (n === 1) return one; if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few; return many;
}
const MIN = { pl: ['minutę', 'minuty', 'minut'], en: ['minute', 'minutes', 'minutes'], ru: ['минуту', 'минуты', 'минут'] };
export function intervalText(n) {
  if (n === 60) return t('everyHour');
  if (n === 1) return t('everyMinute');
  return t('everyN', { n, unit: plural(n, MIN[lang]) });
}
export const fmtClock = d => d.toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit' });
export function fmtLeft(sec) {
  sec = Math.max(0, Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const S = {
pl: {
  brand: 'DOS RADIO', howto: 'Jak to działa', demo: 'Demo', live: 'Na żywo', holdSeek: 'Przytrzymaj = seek',
  enterMeta1: 'Pierwsze radio osobiste', enterTitle: 'Orbita', enterLead: 'Twoje radio w przestrzeni. Stroisz stacje jak na starym odbiorniku, księżyce wokół głośnika to tematy wiadomości, a gdy ktoś mówi, widzisz prowadzących.',
  enterFree: 'Pierwsza godzina za darmo, bez konta. W niej: wiadomości, stoicka pigułka i jeden twój podcast.',
  enterSound: 'Wejdź z dźwiękiem', enterMute: 'Bez dźwięku', enterDemo: 'Tryb demo: muzyka i głosy z przeglądarki', enterLive: 'Połączone z DOS Radio',
  trialLeft: 'Darmowa godzina', plusActive: 'Plus aktywny', freeEnded: 'Darmowa godzina minęła',
  onAir: 'Na antenie', offAir: 'Poza anteną', music: 'Muzyka', newsLive: 'Wiadomości na żywo', hostLive: 'Prowadzący na żywo', podcastLive: 'Podcast', pillLive: 'Pigułka', musicOnly: 'Tylko muzyka', jingle: 'DOS Radio',
  nextIn: 'Za {t}: {title}', nextSoon: 'Za chwilę: {title}', nextBreak: 'Następne wejście {time}', breakOff: 'wejścia wyłączone',
  schedule: 'Ramówka', schNews: 'Wiadomości', schHourly: 'Serwis godzinny i pogoda', schPill: 'Pigułka: {title}', schHost: 'Prowadzący między utworami', schEmpty: 'Włącz Graj, żeby zobaczyć ramówkę.',
  cat_fokus: 'Fokus', cat_chill: 'Chill', cat_energia: 'Energia', cat_noc: 'Noc',
  hostBy: 'Prowadzi', modeLbl: 'Tryb', musicOnlyLower: 'sama muzyka', play: 'Graj', pause: 'Pauza', newsNow: 'Wiadomości teraz', mixWith: 'Miks z', prev: 'Poprzednia stacja', next: 'Następna stacja',
  tabRadio: 'Radio', tabMine: 'Moje', tabPods: 'Podcasty', tabPlus: 'Plus',
  host: 'Prowadzący', withHost: 'Z prowadzącym', musicOnlyBtn: 'Sama muzyka',
  news: 'Wiadomości', orMoons: 'albo kliknij księżyce', dayTopic: 'Temat dnia: usłyszysz o nim najwięcej',
  everyHour: 'co godzinę', everyMinute: 'co minutę', everyN: 'co {n} {unit}', newsEvery: 'Wiadomości {x}. Księżyce krążą w tym rytmie.', pickTopic: 'Zostaw przynajmniej jeden temat wiadomości.',
  hourly: 'Pełne wiadomości co godzinę', city: 'Miasto do pogody', cityPh: 'np. Wrocław', useLoc: 'Użyj mojej lokalizacji', locAsk: 'Pytam o zgodę na lokalizację…', locNo: 'Brak zgody na lokalizację. Wpisz miasto.', locOk: 'Pogoda z twojej lokalizacji.', weatherFor: 'Pogoda dla: {c}', noCity: 'Bez miasta nie podamy pogody.',
  mix: 'Miks stacji', mixHint: 'Druga stacja przeplata się z główną', noMix: 'Bez miksu', mixShift: 'Shift + klik na satelicie też ustawia miks.', mixOff: 'Miks wyłączony', mixOn: 'Miks: {name}',
  mood: 'Nastrój', moodPh: 'np. deszczowy wieczór z herbatą i kodowaniem', moodGo: 'Dopasuj muzykę', moodWork: 'Komponuję muzykę pod nastrój…', moodPlaying: 'Gra nastrój: {name}', moodUnknown: 'Nie rozpoznałem nastroju. Spróbuj: fokus, deszcz, trening, noc.', sayMood: 'Powiedz nastrój', micNo: 'Mikrofon jest tu niedostępny. Wpisz nastrój.',
  moods: ['Głęboki fokus', 'Deszczowy wieczór', 'Poranny kick', 'Nocny chill'],
  mineTitle: 'Twoje źródła', mineLead: 'Radio czyta to, co ważne dla ciebie: twoje słowa kluczowe, kanały RSS i skrzynkę. Twoje wiadomości wchodzą na antenę przed resztą.',
  keywords: 'Słowa kluczowe (maks. 20, po przecinku)', feeds: 'Kanały RSS (maks. 10, jeden na linię)', saveSources: 'Zapisz źródła', sourcesSaved: 'Zapisano. Temat „Moje źródła” jest włączony, radio przeczyta je w najbliższym wejściu.',
  tooManyKw: 'Maksymalnie 20 słów kluczowych.', tooManyFeeds: 'Maksymalnie 10 kanałów RSS.', badFeed: 'Każdy kanał RSS musi zaczynać się od http:// albo https://.',
  digestHead: 'Najświeższe z twoich źródeł ({n})', digestEmpty: 'Brak własnych wiadomości. Dodaj słowa kluczowe, kanał RSS albo połącz Gmail.', digestPlay: 'Posłuchaj swoich wiadomości', yours: 'twoje',
  gmailTitle: 'Gmail', gmailLead: 'Rano prowadzący czyta ci 3 najważniejsze maile i mówi, co z nimi zrobić. Radio widzi tylko nadawcę, temat i początek treści. Nic nie wysyła.',
  gmailConnect: 'Połącz Gmail', gmailDemo: 'Wypróbuj na przykładowej skrzynce', gmailConnected: 'Połączone', gmailSample: 'Przykładowa skrzynka', gmailSoon: 'Połączenie z Gmail jest w przygotowaniu. Na razie posłuchaj przykładu.', gmailAdded: 'Dodano 3 maile do wiadomości. Prowadzący przeczyta je teraz.',
  plusLock: 'W Plus', unlock: 'Odblokuj w Plus',
  podTitle: 'Twój podcast', podLead: 'Dwoje prowadzących rozmawia o twoim temacie przez kilka minut, przeplatając rozmowę muzyką stacji.', podPh: 'Temat, np. jak stoicy radzą sobie ze stresem', podGo: 'Wygeneruj podcast', podFree: 'Pierwszy za darmo', podStop: 'Zatrzymaj', podWork: 'Generuję podcast: {topic}…', podWorkDay: 'Generuję dzisiejszy podcast…', podPlaying: 'Odtwarzam: {title} ({i}/{n})', podDone: '{title}: koniec. Radio gra dalej.', podUsed: 'Darmowy podcast już wykorzystany. W Plus generujesz je bez limitu.',
  podIdeas: ['Stoicy i stres w pracy', 'Co nowego w AI w tym tygodniu', 'Jak zacząć poranek bez telefonu'],
  pillTitle: 'Pigułka z YouTube', pillLead: 'Wybieramy najważniejsze 20% odcinka i puszczamy jako krótkie bloki, każdy z jednozdaniowym wstępem prowadzącej. Link do kanału oznacza jego najnowszy odcinek (do 3 godzin).',
  pillUrl: 'Link do odcinka albo kanału', pillGo: 'Zrób pigułkę', pillBadUrl: 'Wklej link do YouTube (zaczyna się od https://).', pillQueued: 'Pigułka czeka w kolejce…', pillWorking: 'Czytam napisy, wybieram najważniejsze fragmenty i wycinam dźwięk. To potrwa kilka minut.', pillReady: 'Gotowe: {title}. Wejdzie w najbliższej przerwie, po wiadomościach.', pillTooLong: 'Pigułka robi się zbyt długo. Spróbuj później.',
  myPills: 'Moje pigułki', inProgramme: 'W programie', fromNo: 'Od numeru', remove: 'Usuń z programu', addToProg: 'Dodaj do programu: {title}', addedToProg: 'W programie: {title}. Wejdzie w najbliższej przerwie.', alreadyIn: 'Ta pigułka jest już w programie.',
  showcase: 'Na start', showcaseHint: 'Stoicka pigułka jest już w programie twojej darmowej godziny.',
  stoicTitle: 'Myśl dnia', stoicListen: 'Posłuchaj', stoicAdd: 'Dodaj stoików do wiadomości', stoicAdded: 'Stoicka myśl jest w wiadomościach.',
  fhTitle: 'Twoja darmowa godzina', fhProgress: '{d} z {n}', fhDoneAll: 'Wszystko sprawdzone. Zostań na dłużej: 30 dni Plus za darmo po założeniu konta.',
  fhSteps: { news: 'Posłuchaj pierwszych wiadomości', orbit: 'Nastrój inną stację na orbicie', stoic: 'Posłuchaj myśli dnia', podcast: 'Wygeneruj swój podcast (1 za darmo)', source: 'Połącz Gmail albo dodaj własne źródło' },
  plansTitle: 'DOS Radio Plus', perMonth: '/ mies.', currency: 'zł',
  planPlus: ['Podcasty w duecie bez limitu', 'Własne tematy, RSS i Gmail', 'Pigułki z YouTube', 'Wszystkie stacje bez limitu czasu'],
  planAi: ['Wszystko, co w Plus', 'Wyższe limity generowania AI', 'Podcasty bez kolejki', 'Nowe funkcje jako pierwsza'],
  choosePlus: 'Wybieram Plus', chooseAi: 'Wybieram Plus+AI', openingPay: 'Otwieram płatności…', payOff: 'Płatności są w tej chwili wyłączone. Wróć wkrótce.', payLogin: 'Zaloguj się, żeby wykupić Plus.', payFail: 'Nie udało się otworzyć płatności. Spróbuj ponownie.', stripeNote: 'Płatności obsługuje Stripe. Subskrypcję anulujesz w każdej chwili.',
  recapTitle: 'Twoja godzina z DOS Radio', recapLead: 'Tyle radio zrobiło dla ciebie w godzinę. Załóż konto, a przez 30 dni Plus zrobi to codziennie.', recapNews: 'wiadomości', recapPods: 'podcasty', recapStoic: 'myśli stoików', recapStations: 'stacje',
  register: 'Załóż konto i odbierz 30 dni Plus', haveAccount: 'Mam konto — zaloguj się', login: 'Zaloguj się', logout: 'Wyloguj', noAccount: 'Nie mam konta — załóż je',
  emailLbl: 'E-mail', pwLbl: 'Hasło (min. 8 znaków)', pwShort: 'Hasło musi mieć co najmniej 8 znaków.', checkMail: 'Sprawdź skrzynkę {e} (też spam). Kliknij link w mailu, żeby aktywować konto.', loggedIn: 'Gotowe. Słuchasz bez limitu.', demoAuth: 'W demo konto się nie zakłada. Na dosradio.theones.io ten formularz działa naprawdę.', loggedOut: 'Wylogowano.',
  continueFree: 'Słuchaj dalej za darmo', later: 'Może później',
  nudge15: 'Zostało 15 minut darmowej godziny. Wygeneruj jeszcze swój podcast, jest za darmo.', nudge5: 'Zostało 5 minut. Załóż konto, żeby radio grało dalej, z 30 dniami Plus gratis.', afterPod: 'Chcesz taki podcast codziennie rano? To jest w Plus.',
  demoSkip: 'Demo: pokaż koniec godziny',
  palettePh: 'Szukaj stacji albo polecenia…', palFoot: '↑↓ wybór · Enter wykonaj · Esc zamknij', nothing: 'Nic nie pasuje',
  cmdTopicOn: 'Włącz temat: {t}', cmdTopicOff: 'Wyłącz temat: {t}', cmdRandom: 'Losowa stacja', cmdUndo: 'Cofnij ostatnią zmianę', cmdOpen: 'Otwórz klasyczne DOS Radio', cmdPodcast: 'Wygeneruj podcast', cmdLang: 'Język: {l}',
  undone: 'Cofnięto', nothingUndo: 'Nie ma czego cofnąć', undo: 'Cofnij', close: 'Zamknij',
  tuned: 'Nastrojono: {name}, {bpm} BPM',
  infoTitle: 'Jak to działa',
  info: [['Przeciągnij', 'Obraca tarczę. Stacja na wskazówce gra, między stacjami słychać szum.'], ['Kółko, ← →', 'Stacja po stacji, z wyczuwalnym zapadkiem.'], ['Przytrzymaj', 'Seek: tarcza przyspiesza, puść, żeby wylądować. Spacja działa tak samo.'], ['Księżyce', 'Tematy wiadomości. Klawisze 1–6 też je przełączają.'], ['Prowadzący', 'Gdy ktoś mówi, z kratki wyłaniają się sylwetki prowadzących, a na dole widać napisy.'], ['⌘K lub /', 'Paleta poleceń.'], ['⌘Z', 'Cofa ostatnią zmianę.']],
  infoNote: 'Ustawienia, kolejka pigułek i przeczytane wiadomości są wspólne z klasycznym DOS Radio. Efekt kratki i płynu to własna implementacja technik z eksperymentu AstroDither Roberta Borghesiego.',
  st_loading: 'Łączę z muzyką…', st_playing: 'Gra {name}', st_reconnect: 'Łączę ponownie z muzyką…', st_newsFail: 'Nie udało się załadować nagrań serwisu.', st_filler: 'To wszystkie nowe wiadomości na teraz. Zaraz coś od prowadzącego.', st_stream: 'Strumień nie ruszył. Spróbuj ponownie.',
  liveCaption: 'napisy', demoLive: 'W demo to nie działa. Na dosradio.theones.io działa po zalogowaniu.', plusOnly: 'Ta funkcja jest w Plus.', showcasePlay: 'Posłuchaj', mineOn: 'Temat „Moje źródła” włączony.',
  tts_intro: 'Jest {time}. DOS Radio, wiadomości.', tts_hourly: 'Jest {time}. Pełny serwis DOS Radio.', tts_weather: 'Pogoda: dziś pochmurno, około dwunastu stopni, wieczorem przejaśnienia.', tts_teaser: 'Za chwilę: {h}.',
  tts_welcome: 'Cześć, tu {host}. Witaj w DOS Radio, twoim radiu osobistym. Za chwilę pierwsze wiadomości, a potem stoicka pigułka.',
  tts_jingle: 'DOS Radio. Gra to, co chcesz usłyszeć.', tts_5min: 'Zostało pięć minut darmowej godziny. Załóż konto, a zostanę z tobą na dłużej.',
  tts_chatter: ['Jeśli dopiero zaczynasz dzień, to dobry moment na szklankę wody.', 'Ten numer mógłby grać do końca świata. Ja bym się nie obraził.', 'Mała rada od prowadzącego: jedno zadanie naraz. Reszta poczeka.'],
},
en: {
  brand: 'DOS RADIO', howto: 'How it works', demo: 'Demo', live: 'Live', holdSeek: 'Hold = seek',
  enterMeta1: 'The first personal radio', enterTitle: 'Orbit', enterLead: 'Your radio in space. Tune stations like on an old receiver, the moons around the speaker are your news topics, and when someone talks, you see the hosts.',
  enterFree: 'Your first hour is free, no account needed. It includes news, a stoic pill and one podcast of your own.',
  enterSound: 'Enter with sound', enterMute: 'Without sound', enterDemo: 'Demo mode: music and voices from your browser', enterLive: 'Connected to DOS Radio',
  trialLeft: 'Free hour', plusActive: 'Plus active', freeEnded: 'Your free hour is over',
  onAir: 'On air', offAir: 'Off air', music: 'Music', newsLive: 'News live', hostLive: 'Host live', podcastLive: 'Podcast', pillLive: 'Pill', musicOnly: 'Music only', jingle: 'DOS Radio',
  nextIn: 'In {t}: {title}', nextSoon: 'Coming up: {title}', nextBreak: 'Next break {time}', breakOff: 'breaks off',
  schedule: 'Schedule', schNews: 'News', schHourly: 'Hourly bulletin and weather', schPill: 'Pill: {title}', schHost: 'Host between tracks', schEmpty: 'Press Play to see the schedule.',
  cat_fokus: 'Focus', cat_chill: 'Chill', cat_energia: 'Energy', cat_noc: 'Night',
  hostBy: 'Host', modeLbl: 'Mode', musicOnlyLower: 'music only', play: 'Play', pause: 'Pause', newsNow: 'News now', mixWith: 'Mixed with', prev: 'Previous station', next: 'Next station',
  tabRadio: 'Radio', tabMine: 'Mine', tabPods: 'Podcasts', tabPlus: 'Plus',
  host: 'Host', withHost: 'With a host', musicOnlyBtn: 'Music only',
  news: 'News', orMoons: 'or click the moons', dayTopic: 'Topic of the day: you will hear the most about it',
  everyHour: 'every hour', everyMinute: 'every minute', everyN: 'every {n} {unit}', newsEvery: 'News {x}. The moons orbit at this pace.', pickTopic: 'Keep at least one news topic.',
  hourly: 'Full bulletin every hour', city: 'City for weather', cityPh: 'e.g. London', useLoc: 'Use my location', locAsk: 'Asking for location access…', locNo: 'No location access. Type a city.', locOk: 'Weather for your location.', weatherFor: 'Weather for: {c}', noCity: 'No city, no weather.',
  mix: 'Station mix', mixHint: 'A second station weaves into the main one', noMix: 'No mix', mixShift: 'Shift + click a satellite also sets the mix.', mixOff: 'Mix off', mixOn: 'Mix: {name}',
  mood: 'Mood', moodPh: 'e.g. rainy evening, tea and coding', moodGo: 'Match the music', moodWork: 'Composing music for your mood…', moodPlaying: 'Playing your mood: {name}', moodUnknown: 'I could not read that mood. Try: focus, rain, workout, night.', sayMood: 'Say your mood', micNo: 'The microphone is not available here. Type your mood.',
  moods: ['Deep focus', 'Rainy evening', 'Morning kick', 'Night chill'],
  mineTitle: 'Your sources', mineLead: 'The radio reads what matters to you: your keywords, RSS feeds and inbox. Your items go on air before everything else.',
  keywords: 'Keywords (max 20, comma separated)', feeds: 'RSS feeds (max 10, one per line)', saveSources: 'Save sources', sourcesSaved: 'Saved. The “My sources” topic is on, the radio will read them in the next break.',
  tooManyKw: 'Up to 20 keywords.', tooManyFeeds: 'Up to 10 RSS feeds.', badFeed: 'Each RSS feed must start with http:// or https://.',
  digestHead: 'Latest from your sources ({n})', digestEmpty: 'No personal news yet. Add keywords, an RSS feed or connect Gmail.', digestPlay: 'Listen to your news', yours: 'yours',
  gmailTitle: 'Gmail', gmailLead: 'In the morning the host reads your 3 most important emails and tells you what to do with them. The radio only sees the sender, subject and first lines. It never sends anything.',
  gmailConnect: 'Connect Gmail', gmailDemo: 'Try it on a sample inbox', gmailConnected: 'Connected', gmailSample: 'Sample inbox', gmailSoon: 'The Gmail connection is on its way. For now, listen to the sample.', gmailAdded: 'Added 3 emails to your news. The host will read them now.',
  plusLock: 'In Plus', unlock: 'Unlock with Plus',
  podTitle: 'Your podcast', podLead: 'Two hosts talk about your topic for a few minutes, with the station’s music in between.', podPh: 'Topic, e.g. how the Stoics handled stress', podGo: 'Generate podcast', podFree: 'First one free', podStop: 'Stop', podWork: 'Generating podcast: {topic}…', podWorkDay: 'Generating today’s podcast…', podPlaying: 'Playing: {title} ({i}/{n})', podDone: '{title}: finished. The radio plays on.', podUsed: 'Your free podcast is used. With Plus you generate as many as you like.',
  podIdeas: ['The Stoics and stress at work', 'What’s new in AI this week', 'Starting the morning without your phone'],
  pillTitle: 'YouTube pill', pillLead: 'We pick the most important 20% of an episode and play it in short blocks, each with a one-line intro from the host. A channel link means its latest episode (up to 3 hours).',
  pillUrl: 'Episode or channel link', pillGo: 'Make a pill', pillBadUrl: 'Paste a YouTube link (starting with https://).', pillQueued: 'Your pill is in the queue…', pillWorking: 'Reading captions, picking the key parts and cutting audio. This takes a few minutes.', pillReady: 'Ready: {title}. It airs in the next break, after the news.', pillTooLong: 'This pill is taking too long. Try again later.',
  myPills: 'My pills', inProgramme: 'In the programme', fromNo: 'From part', remove: 'Remove from programme', addToProg: 'Add to programme: {title}', addedToProg: 'In the programme: {title}. It airs in the next break.', alreadyIn: 'This pill is already in the programme.',
  showcase: 'To start', showcaseHint: 'A stoic pill is already in your free hour’s programme.',
  stoicTitle: 'Thought of the day', stoicListen: 'Listen', stoicAdd: 'Add the Stoics to your news', stoicAdded: 'Stoic thought is in your news.',
  fhTitle: 'Your free hour', fhProgress: '{d} of {n}', fhDoneAll: 'You’ve tried it all. Stay longer: 30 days of Plus free when you create an account.',
  fhSteps: { news: 'Hear your first news', orbit: 'Tune another station on the orbit', stoic: 'Listen to the thought of the day', podcast: 'Generate your podcast (1 free)', source: 'Connect Gmail or add your own source' },
  plansTitle: 'DOS Radio Plus', perMonth: '/ month', currency: 'PLN',
  planPlus: ['Unlimited duo podcasts', 'Your own topics, RSS and Gmail', 'YouTube pills', 'All stations, no time limit'],
  planAi: ['Everything in Plus', 'Higher AI generation limits', 'Podcasts without the queue', 'New features first'],
  choosePlus: 'Choose Plus', chooseAi: 'Choose Plus+AI', openingPay: 'Opening checkout…', payOff: 'Payments are switched off right now. Check back soon.', payLogin: 'Log in to buy Plus.', payFail: 'Could not open checkout. Try again.', stripeNote: 'Payments are handled by Stripe. Cancel any time.',
  recapTitle: 'Your hour with DOS Radio', recapLead: 'This is what the radio did for you in one hour. Create an account and Plus does it every day for 30 days, free.', recapNews: 'news items', recapPods: 'podcasts', recapStoic: 'stoic thoughts', recapStations: 'stations',
  register: 'Create account, get 30 days of Plus', haveAccount: 'I have an account — log in', login: 'Log in', logout: 'Log out', noAccount: 'No account yet — create one',
  emailLbl: 'Email', pwLbl: 'Password (min. 8 characters)', pwShort: 'The password needs at least 8 characters.', checkMail: 'Check {e} (and spam). Click the link in the email to activate your account.', loggedIn: 'Done. You’re listening without limits.', demoAuth: 'The demo does not create accounts. On dosradio.theones.io this form works for real.', loggedOut: 'Logged out.',
  continueFree: 'Keep listening for free', later: 'Maybe later',
  nudge15: '15 minutes of your free hour left. Generate your podcast, it’s free.', nudge5: '5 minutes left. Create an account to keep the radio playing, with 30 days of Plus free.', afterPod: 'Want a podcast like this every morning? That’s Plus.',
  demoSkip: 'Demo: show the end of the hour',
  palettePh: 'Search stations or commands…', palFoot: '↑↓ select · Enter run · Esc close', nothing: 'No matches',
  cmdTopicOn: 'Turn on topic: {t}', cmdTopicOff: 'Turn off topic: {t}', cmdRandom: 'Random station', cmdUndo: 'Undo last change', cmdOpen: 'Open classic DOS Radio', cmdPodcast: 'Generate podcast', cmdLang: 'Language: {l}',
  undone: 'Undone', nothingUndo: 'Nothing to undo', undo: 'Undo', close: 'Close',
  tuned: 'Tuned: {name}, {bpm} BPM',
  infoTitle: 'How it works',
  info: [['Drag', 'Turns the dial. The station under the needle plays; between stations you hear static.'], ['Wheel, ← →', 'Station by station, with a detent click.'], ['Hold', 'Seek: the dial speeds up, let go to land. Space works too.'], ['Moons', 'News topics. Keys 1–6 toggle them too.'], ['Hosts', 'When someone talks, the hosts’ silhouettes rise from the grid and captions appear below.'], ['⌘K or /', 'Command palette.'], ['⌘Z', 'Undo the last change.']],
  infoNote: 'Settings, the pill queue and aired news are shared with classic DOS Radio. The grid and fluid effects are an original implementation of techniques seen in Robert Borghesi’s AstroDither experiment.',
  st_loading: 'Connecting to music…', st_playing: 'Playing {name}', st_reconnect: 'Reconnecting to music…', st_newsFail: 'Could not load the news recordings.', st_filler: 'That’s all the new news for now. The host has something for you.', st_stream: 'The stream did not start. Try again.',
  liveCaption: 'captions', demoLive: 'This does not work in the demo. On dosradio.theones.io it works once you log in.', plusOnly: 'This is a Plus feature.', showcasePlay: 'Listen', mineOn: '“My sources” topic is on.',
  tts_intro: 'It’s {time}. DOS Radio news.', tts_hourly: 'It’s {time}. The full DOS Radio bulletin.', tts_weather: 'Weather: cloudy today, around twelve degrees, clearing in the evening.', tts_teaser: 'Coming up: {h}.',
  tts_welcome: 'Hi, this is {host}. Welcome to DOS Radio, your personal radio. The first news is coming up, then a stoic pill.',
  tts_jingle: 'DOS Radio. Playing what you want to hear.', tts_5min: 'Five minutes of your free hour left. Create an account and I’ll stay with you longer.',
  tts_chatter: ['If your day is just starting, this is a good moment for a glass of water.', 'This track could play until the end of the world. I wouldn’t mind.', 'A small tip from your host: one task at a time. The rest can wait.'],
},
ru: {
  brand: 'DOS RADIO', howto: 'Как это работает', demo: 'Демо', live: 'В эфире', holdSeek: 'Удерживай = поиск',
  enterMeta1: 'Первое личное радио', enterTitle: 'Орбита', enterLead: 'Твоё радио в пространстве. Настраивай станции, как на старом приёмнике. Луны вокруг динамика — темы новостей, а когда кто-то говорит, ты видишь ведущих.',
  enterFree: 'Первый час бесплатно и без аккаунта. В нём новости, стоическая пилюля и один твой подкаст.',
  enterSound: 'Войти со звуком', enterMute: 'Без звука', enterDemo: 'Демо-режим: музыка и голоса из браузера', enterLive: 'Подключено к DOS Radio',
  trialLeft: 'Бесплатный час', plusActive: 'Plus активен', freeEnded: 'Бесплатный час закончился',
  onAir: 'В эфире', offAir: 'Не в эфире', music: 'Музыка', newsLive: 'Новости в эфире', hostLive: 'Ведущий в эфире', podcastLive: 'Подкаст', pillLive: 'Пилюля', musicOnly: 'Только музыка', jingle: 'DOS Radio',
  nextIn: 'Через {t}: {title}', nextSoon: 'Сейчас будет: {title}', nextBreak: 'Следующий выход {time}', breakOff: 'выходы выключены',
  schedule: 'Программа', schNews: 'Новости', schHourly: 'Часовой выпуск и погода', schPill: 'Пилюля: {title}', schHost: 'Ведущий между треками', schEmpty: 'Нажми «Играть», чтобы увидеть программу.',
  cat_fokus: 'Фокус', cat_chill: 'Чилл', cat_energia: 'Энергия', cat_noc: 'Ночь',
  hostBy: 'Ведёт', modeLbl: 'Режим', musicOnlyLower: 'только музыка', play: 'Играть', pause: 'Пауза', newsNow: 'Новости сейчас', mixWith: 'Микс с', prev: 'Предыдущая станция', next: 'Следующая станция',
  tabRadio: 'Радио', tabMine: 'Моё', tabPods: 'Подкасты', tabPlus: 'Plus',
  host: 'Ведущий', withHost: 'С ведущим', musicOnlyBtn: 'Только музыка',
  news: 'Новости', orMoons: 'или нажми на луны', dayTopic: 'Тема дня: о ней будет больше всего',
  everyHour: 'каждый час', everyMinute: 'каждую минуту', everyN: 'каждые {n} {unit}', newsEvery: 'Новости {x}. Луны кружат в этом ритме.', pickTopic: 'Оставь хотя бы одну тему новостей.',
  hourly: 'Полный выпуск каждый час', city: 'Город для погоды', cityPh: 'например, Москва', useLoc: 'Моё местоположение', locAsk: 'Запрашиваю доступ к местоположению…', locNo: 'Нет доступа к местоположению. Введи город.', locOk: 'Погода для твоего местоположения.', weatherFor: 'Погода: {c}', noCity: 'Без города погоды не будет.',
  mix: 'Микс станций', mixHint: 'Вторая станция вплетается в основную', noMix: 'Без микса', mixShift: 'Shift + клик по спутнику тоже задаёт микс.', mixOff: 'Микс выключен', mixOn: 'Микс: {name}',
  mood: 'Настроение', moodPh: 'например, дождливый вечер, чай и код', moodGo: 'Подобрать музыку', moodWork: 'Сочиняю музыку под настроение…', moodPlaying: 'Играет настроение: {name}', moodUnknown: 'Не понял настроение. Попробуй: фокус, дождь, тренировка, ночь.', sayMood: 'Скажи настроение', micNo: 'Микрофон здесь недоступен. Напиши настроение.',
  moods: ['Глубокий фокус', 'Дождливый вечер', 'Утренний заряд', 'Ночной чилл'],
  mineTitle: 'Твои источники', mineLead: 'Радио читает то, что важно тебе: ключевые слова, RSS-ленты и почту. Твои новости выходят в эфир раньше остальных.',
  keywords: 'Ключевые слова (до 20, через запятую)', feeds: 'RSS-ленты (до 10, по одной в строке)', saveSources: 'Сохранить источники', sourcesSaved: 'Сохранено. Тема «Мои источники» включена, радио прочитает их в ближайшем выходе.',
  tooManyKw: 'Не больше 20 ключевых слов.', tooManyFeeds: 'Не больше 10 RSS-лент.', badFeed: 'Каждая RSS-лента должна начинаться с http:// или https://.',
  digestHead: 'Свежее из твоих источников ({n})', digestEmpty: 'Своих новостей пока нет. Добавь ключевые слова, RSS или подключи Gmail.', digestPlay: 'Слушать свои новости', yours: 'твоё',
  gmailTitle: 'Gmail', gmailLead: 'Утром ведущий читает три самых важных письма и говорит, что с ними сделать. Радио видит только отправителя, тему и начало письма. Ничего не отправляет.',
  gmailConnect: 'Подключить Gmail', gmailDemo: 'Попробовать на примере ящика', gmailConnected: 'Подключено', gmailSample: 'Пример ящика', gmailSoon: 'Подключение Gmail готовится. Пока послушай пример.', gmailAdded: 'Три письма добавлены в новости. Ведущий прочитает их сейчас.',
  plusLock: 'В Plus', unlock: 'Открыть в Plus',
  podTitle: 'Твой подкаст', podLead: 'Двое ведущих несколько минут обсуждают твою тему, а между репликами звучит музыка станции.', podPh: 'Тема, например: как стоики справлялись со стрессом', podGo: 'Создать подкаст', podFree: 'Первый бесплатно', podStop: 'Стоп', podWork: 'Создаю подкаст: {topic}…', podWorkDay: 'Создаю подкаст дня…', podPlaying: 'Играет: {title} ({i}/{n})', podDone: '{title}: конец. Радио играет дальше.', podUsed: 'Бесплатный подкаст уже использован. В Plus их можно создавать без ограничений.',
  podIdeas: ['Стоики и стресс на работе', 'Что нового в ИИ на этой неделе', 'Как начать утро без телефона'],
  pillTitle: 'Пилюля с YouTube', pillLead: 'Выбираем самые важные 20% выпуска и ставим их короткими блоками, каждый с вступлением ведущей в одну фразу. Ссылка на канал означает его последний выпуск (до 3 часов).',
  pillUrl: 'Ссылка на выпуск или канал', pillGo: 'Сделать пилюлю', pillBadUrl: 'Вставь ссылку на YouTube (начинается с https://).', pillQueued: 'Пилюля ждёт в очереди…', pillWorking: 'Читаю субтитры, выбираю главное и вырезаю звук. Это займёт несколько минут.', pillReady: 'Готово: {title}. Выйдет в ближайший перерыв, после новостей.', pillTooLong: 'Пилюля делается слишком долго. Попробуй позже.',
  myPills: 'Мои пилюли', inProgramme: 'В программе', fromNo: 'С части', remove: 'Убрать из программы', addToProg: 'Добавить в программу: {title}', addedToProg: 'В программе: {title}. Выйдет в ближайший перерыв.', alreadyIn: 'Эта пилюля уже в программе.',
  showcase: 'Для начала', showcaseHint: 'Стоическая пилюля уже в программе твоего бесплатного часа.',
  stoicTitle: 'Мысль дня', stoicListen: 'Слушать', stoicAdd: 'Добавить стоиков в новости', stoicAdded: 'Стоическая мысль добавлена в новости.',
  fhTitle: 'Твой бесплатный час', fhProgress: '{d} из {n}', fhDoneAll: 'Ты всё попробовал. Оставайся: 30 дней Plus бесплатно после регистрации.',
  fhSteps: { news: 'Послушай первые новости', orbit: 'Настрой другую станцию на орбите', stoic: 'Послушай мысль дня', podcast: 'Создай свой подкаст (1 бесплатно)', source: 'Подключи Gmail или добавь свой источник' },
  plansTitle: 'DOS Radio Plus', perMonth: '/ мес.', currency: 'зл',
  planPlus: ['Подкасты в дуэте без ограничений', 'Свои темы, RSS и Gmail', 'Пилюли с YouTube', 'Все станции без лимита времени'],
  planAi: ['Всё из Plus', 'Больше генераций ИИ', 'Подкасты без очереди', 'Новые функции первыми'],
  choosePlus: 'Выбрать Plus', chooseAi: 'Выбрать Plus+AI', openingPay: 'Открываю оплату…', payOff: 'Оплата сейчас недоступна. Загляни чуть позже.', payLogin: 'Войди, чтобы купить Plus.', payFail: 'Не удалось открыть оплату. Попробуй ещё раз.', stripeNote: 'Платежи обрабатывает Stripe. Подписку можно отменить в любой момент.',
  recapTitle: 'Твой час с DOS Radio', recapLead: 'Вот что радио сделало для тебя за час. Создай аккаунт, и 30 дней Plus будет делать это каждый день бесплатно.', recapNews: 'новостей', recapPods: 'подкасты', recapStoic: 'мыслей стоиков', recapStations: 'станции',
  register: 'Создать аккаунт и получить 30 дней Plus', haveAccount: 'Уже есть аккаунт — войти', login: 'Войти', logout: 'Выйти', noAccount: 'Нет аккаунта — создать',
  emailLbl: 'E-mail', pwLbl: 'Пароль (минимум 8 символов)', pwShort: 'Пароль должен быть не короче 8 символов.', checkMail: 'Проверь почту {e} (и спам). Нажми на ссылку в письме, чтобы активировать аккаунт.', loggedIn: 'Готово. Слушаешь без ограничений.', demoAuth: 'В демо аккаунт не создаётся. На dosradio.theones.io эта форма работает по-настоящему.', loggedOut: 'Ты вышел из аккаунта.',
  continueFree: 'Слушать дальше бесплатно', later: 'Может, позже',
  nudge15: 'Осталось 15 минут бесплатного часа. Создай свой подкаст, это бесплатно.', nudge5: 'Осталось 5 минут. Создай аккаунт, чтобы радио играло дальше, и получи 30 дней Plus бесплатно.', afterPod: 'Хочешь такой подкаст каждое утро? Это есть в Plus.',
  demoSkip: 'Демо: показать конец часа',
  palettePh: 'Найти станцию или команду…', palFoot: '↑↓ выбор · Enter выполнить · Esc закрыть', nothing: 'Ничего не найдено',
  cmdTopicOn: 'Включить тему: {t}', cmdTopicOff: 'Выключить тему: {t}', cmdRandom: 'Случайная станция', cmdUndo: 'Отменить последнее изменение', cmdOpen: 'Открыть классическое DOS Radio', cmdPodcast: 'Создать подкаст', cmdLang: 'Язык: {l}',
  undone: 'Отменено', nothingUndo: 'Нечего отменять', undo: 'Отменить', close: 'Закрыть',
  tuned: 'Настроено: {name}, {bpm} BPM',
  infoTitle: 'Как это работает',
  info: [['Тяни', 'Вращает шкалу. Играет станция под стрелкой, между станциями слышен шум.'], ['Колесо, ← →', 'Станция за станцией, с ощутимым щелчком.'], ['Удерживай', 'Поиск: шкала ускоряется, отпусти, чтобы остановиться. Пробел работает так же.'], ['Луны', 'Темы новостей. Клавиши 1–6 тоже их переключают.'], ['Ведущие', 'Когда кто-то говорит, из сетки появляются силуэты ведущих, а внизу — субтитры.'], ['⌘K или /', 'Палитра команд.'], ['⌘Z', 'Отменить последнее изменение.']],
  infoNote: 'Настройки, очередь пилюль и прочитанные новости общие с классическим DOS Radio. Эффекты сетки и жидкости — собственная реализация приёмов из эксперимента AstroDither Роберта Боргезе.',
  st_loading: 'Подключаю музыку…', st_playing: 'Играет {name}', st_reconnect: 'Переподключаю музыку…', st_newsFail: 'Не удалось загрузить записи новостей.', st_filler: 'Это все свежие новости на сейчас. Сейчас ведущий что-нибудь расскажет.', st_stream: 'Поток не запустился. Попробуй ещё раз.',
  liveCaption: 'субтитры', demoLive: 'В демо это не работает. На dosradio.theones.io работает после входа.', plusOnly: 'Эта функция есть в Plus.', showcasePlay: 'Слушать', mineOn: 'Тема «Мои источники» включена.',
  tts_intro: 'Сейчас {time}. Новости DOS Radio.', tts_hourly: 'Сейчас {time}. Полный выпуск DOS Radio.', tts_weather: 'Погода: сегодня облачно, около двенадцати градусов, к вечеру прояснения.', tts_teaser: 'Сейчас будет: {h}.',
  tts_welcome: 'Привет, это {host}. Добро пожаловать в DOS Radio, твоё личное радио. Сейчас первые новости, а потом стоическая пилюля.',
  tts_jingle: 'DOS Radio. Играет то, что ты хочешь услышать.', tts_5min: 'Осталось пять минут бесплатного часа. Создай аккаунт, и я останусь с тобой подольше.',
  tts_chatter: ['Если твой день только начинается, самое время выпить стакан воды.', 'Этот трек мог бы играть до конца света. Я бы не возражал.', 'Маленький совет от ведущего: одна задача за раз. Остальное подождёт.'],
},
};

export function t(key, vars) {
  let s = S[lang][key] ?? S.pl[key] ?? key;
  if (typeof s === 'string' && vars) s = s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return s;
}

/* Station copy */
const ST = {
  pl: {
    'dos-groove': ['DOS Groove', 'Minimal deep tech do pracy'], 'lofi-nauka': ['Lo-fi Nauka', 'Ciepłe bity z winyla i miękkie pianino'], 'micro-house': ['Microhouse', 'Organiczny rumuński minimal i detal'], 'deep-tech': ['Deep Tech', 'Głęboki, równy tech bez ozdobników'], 'dub-techno': ['Dub Techno', 'Akordy, które wracają echem'],
    'deep-house': ['Deep House', 'Ciepły bas i miękkie akordy'], 'organic-house': ['Organic House', 'Drewno, oddech i ciepły perkusjon'], 'deep-ambient': ['Głęboki Ambient', 'Bez perkusji, medytacyjna przestrzeń'], stoa: ['Stoa', 'Wiolonczela, fortepian i spokój stoików'],
    'detroit-techno': ['Detroit Techno', 'Strunowe akordy i maszynowy puls'], 'tech-house': ['Tech House', 'Równy parkiet, najszerzej trafia'], 'melodic-house': ['Melodic House', 'Długa melodia nad głębokim basem'], 'progressive-house': ['Progressive House', 'Buduje się powoli i niesie'], 'drum-and-bass': ['Drum and Bass', 'Szybki łamany bit i głęboki bas'], trance: ['Trance', 'Jasna melodia i równy galop'], 'afro-house': ['Afro House', 'Perkusja, ciepło i taneczny oddech'], 'poranna-kawa': ['Poranna Kawa', 'Słoneczny, ciepły deep house'], 'liquid-dnb': ['Liquid DnB', 'Płynne, ciepłe połamane bity i głęboki bas'], 'groove-funk': ['Neo Funk', 'Bujający bas, vintage gitara i groove'], 'club-dance': ['Klubowy Dance', 'Sprężysty tech-house i parkietowa energia'], 'minimal-techno': ['Minimal Techno', 'Hipnotyczny, precyzyjny klubowy puls'], 'raw-techno': ['Mocne Techno', 'Ciężki industrialny warehouse groove'],
    'warm-jazz': ['Nocny Jazz', 'Miotełki, ciepły kontrabas i Rhodes'], 'trip-hop': ['Trip-hop Wieczór', 'Leniwy winylowy dół w stylu Bristolu'], 'nocny-dub': ['Nocny Dub', 'Przestrzenne akordy i głęboki oddech'],
  },
  en: {
    'dos-groove': ['DOS Groove', 'Minimal deep tech for work'], 'lofi-nauka': ['Lo-fi Study', 'Warm vinyl beats and soft piano'], 'micro-house': ['Microhouse', 'Organic Romanian minimal and detail'], 'deep-tech': ['Deep Tech', 'Deep, steady tech with no frills'], 'dub-techno': ['Dub Techno', 'Chords that come back as echoes'],
    'deep-house': ['Deep House', 'Warm bass and soft chords'], 'organic-house': ['Organic House', 'Wood, breath and warm percussion'], 'deep-ambient': ['Deep Ambient', 'No drums, meditative space'], stoa: ['Stoa', 'Cello, piano and Stoic calm'],
    'detroit-techno': ['Detroit Techno', 'String chords and a machine pulse'], 'tech-house': ['Tech House', 'A steady floor that suits everyone'], 'melodic-house': ['Melodic House', 'A long melody over deep bass'], 'progressive-house': ['Progressive House', 'Builds slowly and carries you'], 'drum-and-bass': ['Drum and Bass', 'Fast broken beat and deep bass'], trance: ['Trance', 'Bright melody and a steady gallop'], 'afro-house': ['Afro House', 'Percussion, warmth and a dancing breath'], 'poranna-kawa': ['Morning Coffee', 'Sunny, warm deep house'], 'liquid-dnb': ['Liquid DnB', 'Fluid, warm broken beats and deep bass'], 'groove-funk': ['Neo Funk', 'Rolling bass, vintage guitar and groove'], 'club-dance': ['Club Dance', 'Bouncy tech house and floor energy'], 'minimal-techno': ['Minimal Techno', 'A hypnotic, precise club pulse'], 'raw-techno': ['Hard Techno', 'Heavy industrial warehouse groove'],
    'warm-jazz': ['Night Jazz', 'Brushes, warm double bass and Rhodes'], 'trip-hop': ['Trip-hop Evening', 'Lazy vinyl low end, Bristol style'], 'nocny-dub': ['Night Dub', 'Spacious chords and deep breath'],
  },
  ru: {
    'dos-groove': ['DOS Groove', 'Минимал и дип-тек для работы'], 'lofi-nauka': ['Лоу-фай для учёбы', 'Тёплые биты с винила и мягкое пианино'], 'micro-house': ['Микрохаус', 'Органичный румынский минимал и детали'], 'deep-tech': ['Дип-тек', 'Глубокий ровный тек без украшений'], 'dub-techno': ['Даб-техно', 'Аккорды, что возвращаются эхом'],
    'deep-house': ['Дип-хаус', 'Тёплый бас и мягкие аккорды'], 'organic-house': ['Органик-хаус', 'Дерево, дыхание и тёплая перкуссия'], 'deep-ambient': ['Глубокий эмбиент', 'Без ударных, медитативное пространство'], stoa: ['Стоя', 'Виолончель, фортепиано и спокойствие стоиков'],
    'detroit-techno': ['Детройт-техно', 'Струнные аккорды и машинный пульс'], 'tech-house': ['Тек-хаус', 'Ровный танцпол, подходит всем'], 'melodic-house': ['Мелодик-хаус', 'Длинная мелодия над глубоким басом'], 'progressive-house': ['Прогрессив-хаус', 'Нарастает медленно и несёт'], 'drum-and-bass': ['Драм-н-бейс', 'Быстрый ломаный бит и глубокий бас'], trance: ['Транс', 'Светлая мелодия и ровный галоп'], 'afro-house': ['Афро-хаус', 'Перкуссия, тепло и танцевальное дыхание'], 'poranna-kawa': ['Утренний кофе', 'Солнечный тёплый дип-хаус'], 'liquid-dnb': ['Ликвид-DnB', 'Плавные тёплые ломаные биты и глубокий бас'], 'groove-funk': ['Нео-фанк', 'Качающий бас, винтажная гитара и грув'], 'club-dance': ['Клубный дэнс', 'Упругий тек-хаус и энергия танцпола'], 'minimal-techno': ['Минимал-техно', 'Гипнотичный точный клубный пульс'], 'raw-techno': ['Жёсткое техно', 'Тяжёлый индустриальный грув'],
    'warm-jazz': ['Ночной джаз', 'Щётки, тёплый контрабас и Rhodes'], 'trip-hop': ['Трип-хоп вечер', 'Ленивый виниловый низ в духе Бристоля'], 'nocny-dub': ['Ночной даб', 'Просторные аккорды и глубокое дыхание'],
  },
};
export const stationName = s => (s.custom ? s.name : ST[lang][s.id]?.[0] ?? s.name);
export const stationTag = s => (s.custom ? s.tagline || '' : ST[lang][s.id]?.[1] ?? '');
const TOP = {
  pl: { ai: 'AI', beauty: 'Beauty i moda', sport: 'Sport', funny: 'Głupie', stoic: 'Stoicka myśl', mine: 'Moje źródła', personal: 'Twoje', weather: 'Pogoda' },
  en: { ai: 'AI', beauty: 'Beauty & fashion', sport: 'Sport', funny: 'Silly', stoic: 'Stoic thought', mine: 'My sources', personal: 'Yours', weather: 'Weather' },
  ru: { ai: 'ИИ', beauty: 'Красота и мода', sport: 'Спорт', funny: 'Смешное', stoic: 'Стоическая мысль', mine: 'Мои источники', personal: 'Твоё', weather: 'Погода' },
};
export const topicLabel = id => TOP[lang][id] ?? id;
export const LANG_NAMES = { pl: 'Polski', en: 'English', ru: 'Русский' };
