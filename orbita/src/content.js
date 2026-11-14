/* Scripts read on air (intro, default podcast, stoic pill) + sample content for demo mode.
   Demo samples are evergreen and labelled as samples; nothing here pretends to be real news. */
import { getLang } from './i18n.js';

const L = obj => obj[getLang()] || obj.pl;

/* ---------- Opening: the host explains the radio (always first) ---------- */
export const introScript = (host) => L({
  pl: [
    `Cześć, tu ${host}. To DOS Radio: muzyka powstaje na żywo, osobno dla każdej z dwudziestu pięciu stacji.`,
    'Przeciągnij tarczę, żeby zmienić stację. Księżyce wokół głośnika to tematy wiadomości, wybierz te, które chcesz.',
    'Wpisz dowolny temat, a nagramy o nim podcast. Twoje źródła i maile idą na antenę przed resztą świata.',
    'Pierwsza godzina jest za darmo. Zostań.',
  ],
  en: [
    `Hi, I'm ${host}. This is DOS Radio: the music is composed live, separately for each of twenty-five stations.`,
    'Drag the dial to change station. The moons around the speaker are news topics, pick the ones you want.',
    'Type any topic and we will record a podcast about it. Your own sources and mail go on air before the rest of the world.',
    'The first hour is free. Stay.',
  ],
  ru: [
    `Привет, это ${host}. Это DOS Radio: музыка рождается вживую, отдельно для каждой из двадцати пяти станций.`,
    'Потяни шкалу, чтобы сменить станцию. Луны вокруг динамика это темы новостей, выбери нужные.',
    'Напиши любую тему, и мы запишем о ней подкаст. Твои источники и письма выходят в эфир раньше остального мира.',
    'Первый час бесплатно. Оставайся.',
  ],
});

/* ---------- Default podcast: "Your music. Your topics. Your life." (duet A/B) ---------- */
export const defaultPodcastTitle = () => L({ pl: 'Twoja muzyka. Twoje tematy. Twoje życie.', en: 'Your music. Your topics. Your life.', ru: 'Твоя музыка. Твои темы. Твоя жизнь.' });
export const defaultPodcast = (a, b) => L({
  pl: [
    ['A', `Dzień dobry, tu ${a}.`], ['B', `A ja jestem ${b}. To nasz pierwszy wspólny odcinek i od razu o rzeczy najważniejszej: dlaczego to radio jest twoje.`],
    ['A', 'Zacznijmy od muzyki. Zwykłe radio gra to, co lubi średni słuchacz. Tutaj muzyka powstaje na żywo, pod stację, którą wybierasz, a nawet pod nastrój, który opiszesz jednym zdaniem.'],
    ['B', 'Wpisujesz na przykład: deszczowy wieczór, herbata i kodowanie. I za chwilę gra dokładnie to. Nie playlista z tysiąca piosenek, tylko muzyka zrobiona w tej sekundzie.'],
    ['music'],
    ['A', 'Druga rzecz to tematy. Wybierasz, o czym chcesz słyszeć: sztuczna inteligencja, sport, moda, stoicy, coś śmiesznego na rozluźnienie.'],
    ['B', 'I sam decydujesz, jak często. Raz na minutę, jeśli lubisz być na bieżąco, albo raz na godzinę, jeśli pracujesz w skupieniu.'],
    ['A', 'Najciekawsze są jednak twoje własne źródła. Słowa kluczowe, kanały RSS, a od niedawna także skrzynka mailowa. Rano słyszysz trzy najważniejsze maile i co z nimi zrobić.'],
    ['B', 'Czyli zamiast otwierać pocztę o siódmej rano, słuchasz jej przy kawie. Brzmi jak drobiazg, a oszczędza głowę na cały dzień.'],
    ['music'],
    ['A', 'Trzecia rzecz to twoje życie. Radio ma pamiętać, co już słyszałeś, żeby się nie powtarzać, i podsuwać to, co ma sens o tej porze dnia.'],
    ['B', 'Do tego podcasty takie jak ten. Podajesz dowolny temat, a my we dwoje rozmawiamy o nim kilka minut. Długi wywiad z YouTube zamieniamy w pigułkę z samym konkretem.'],
    ['A', 'I codziennie odrobina stoików. Krótka myśl, która pomaga oddzielić to, na co masz wpływ, od reszty.'],
    ['B', 'Masz teraz godzinę, żeby to wszystko sprawdzić. Wygeneruj swój pierwszy podcast, jest za darmo. Pokręć tarczą. Kliknij księżyc z tematem.'],
    ['A', 'Twoja muzyka. Twoje tematy. Twoje życie. To było DOS Radio.'], ['B', 'Do usłyszenia.'],
  ],
  en: [
    ['A', `Good morning, I'm ${a}.`], ['B', `And I'm ${b}. This is our first episode together, and we start with the most important thing: why this radio is yours.`],
    ['A', 'Let us start with music. Regular radio plays what the average listener likes. Here the music is made live, for the station you choose, or even for a mood you describe in one sentence.'],
    ['B', 'You type, say, rainy evening, tea and coding. And a moment later that is exactly what plays. Not a playlist of a thousand songs, but music made this very second.'],
    ['music'],
    ['A', 'The second thing is topics. You choose what you want to hear about: artificial intelligence, sport, fashion, the Stoics, something silly to relax.'],
    ['B', 'And you decide how often. Every minute if you like to keep up, or once an hour if you are deep in focus.'],
    ['A', 'The most interesting part is your own sources. Keywords, RSS feeds, and now your inbox too. In the morning you hear your three most important emails and what to do with them.'],
    ['B', 'So instead of opening email at seven in the morning, you listen to it over coffee. Sounds small, but it saves your head for the whole day.'],
    ['music'],
    ['A', 'The third thing is your life. The radio remembers what you have already heard, so it does not repeat itself, and suggests what makes sense at this time of day.'],
    ['B', 'Plus podcasts like this one. Give us any topic and the two of us talk about it for a few minutes. A long YouTube interview becomes a pill with just the essentials.'],
    ['A', 'And a little Stoicism every day. A short thought that helps you separate what you control from everything else.'],
    ['B', 'You now have an hour to try it all. Generate your first podcast, it is free. Turn the dial. Click a topic moon.'],
    ['A', 'Your music. Your topics. Your life. This was DOS Radio.'], ['B', 'Talk soon.'],
  ],
  ru: [
    ['A', `Доброе утро, это ${a}.`], ['B', `А я ${b}. Это наш первый общий выпуск, и начнём с главного: почему это радио твоё.`],
    ['A', 'Начнём с музыки. Обычное радио играет то, что нравится среднему слушателю. Здесь музыка рождается вживую, под станцию, которую ты выбрал, и даже под настроение, которое ты опишешь одной фразой.'],
    ['B', 'Пишешь, например: дождливый вечер, чай и код. И через мгновение играет именно это. Не плейлист из тысячи песен, а музыка, созданная в эту секунду.'],
    ['music'],
    ['A', 'Второе — темы. Ты выбираешь, о чём слушать: искусственный интеллект, спорт, мода, стоики, что-нибудь смешное для разрядки.'],
    ['B', 'И сам решаешь, как часто. Раз в минуту, если любишь быть в курсе, или раз в час, если работаешь в полной концентрации.'],
    ['A', 'Но самое интересное — твои собственные источники. Ключевые слова, RSS-ленты, а теперь и почта. Утром ты слышишь три самых важных письма и что с ними сделать.'],
    ['B', 'То есть вместо того, чтобы открывать почту в семь утра, ты слушаешь её за кофе. Мелочь, а голова свободна на весь день.'],
    ['music'],
    ['A', 'Третье — твоя жизнь. Радио помнит, что ты уже слышал, чтобы не повторяться, и предлагает то, что уместно в это время дня.'],
    ['B', 'Плюс подкасты вроде этого. Назови любую тему, и мы вдвоём поговорим о ней несколько минут. Длинное интервью с YouTube превращаем в пилюлю с одной сутью.'],
    ['A', 'И каждый день немного стоицизма. Короткая мысль, которая помогает отделить то, что в твоей власти, от всего остального.'],
    ['B', 'У тебя есть час, чтобы всё это попробовать. Создай свой первый подкаст, это бесплатно. Покрути шкалу. Нажми на луну с темой.'],
    ['A', 'Твоя музыка. Твои темы. Твоя жизнь. Это было DOS Radio.'], ['B', 'До встречи.'],
  ],
});

/* ---------- Showcase stoic pill (paraphrased public-domain ideas) ---------- */
export const stoicPillTitle = () => L({ pl: 'Stoicka pigułka: Seneka o czasie', en: 'Stoic pill: Seneca on time', ru: 'Стоическая пилюля: Сенека о времени' });
export const stoicPill = (a, b) => L({
  pl: [
    ['A', 'Stoicka pigułka. Dziś Seneka i jego list O krótkości życia.'],
    ['B', 'Seneka mówi coś przewrotnego: życie nie jest krótkie. To my robimy je krótkim, rozdając czas każdemu, kto o niego poprosi.'],
    ['A', 'Pilnujemy pieniędzy, a czasem szastamy. Choć to jedyna rzecz, której nie da się odkupić.'],
    ['music'],
    ['B', 'Epiktet dodaje drugą połowę: niektóre rzeczy zależą od nas, inne nie. Zależą od nas nasze oceny, decyzje i działania. Reszta nie.'],
    ['A', 'A Marek Aureliusz radził, żeby rano powiedzieć sobie wprost: spotkam dziś ludzi trudnych. I mimo to zrobię swoją robotę dobrze.'],
    ['B', 'Ćwiczenie na dziś: zapisz jedną rzecz, na którą masz wpływ, i zrób ją przed południem. Resztą zajmie się świat.'],
  ],
  en: [
    ['A', 'Stoic pill. Today: Seneca and his letter On the Shortness of Life.'],
    ['B', 'Seneca says something surprising: life is not short. We make it short by handing our time to anyone who asks for it.'],
    ['A', 'We guard our money, yet waste our time. And time is the one thing we can never buy back.'],
    ['music'],
    ['B', 'Epictetus adds the other half: some things are up to us, some are not. Our judgements, choices and actions are up to us. The rest is not.'],
    ['A', 'And Marcus Aurelius advised telling yourself each morning: today I will meet difficult people. And I will still do my work well.'],
    ['B', 'Exercise for today: write down one thing you control and do it before noon. The world will take care of the rest.'],
  ],
  ru: [
    ['A', 'Стоическая пилюля. Сегодня Сенека и его письмо «О скоротечности жизни».'],
    ['B', 'Сенека говорит неожиданное: жизнь не коротка. Это мы делаем её короткой, раздавая время каждому, кто попросит.'],
    ['A', 'Деньги мы бережём, а временем разбрасываемся. Хотя это единственное, что нельзя купить обратно.'],
    ['music'],
    ['B', 'Эпиктет добавляет вторую половину: одно зависит от нас, другое нет. От нас зависят наши суждения, решения и поступки. Остальное нет.'],
    ['A', 'А Марк Аврелий советовал говорить себе по утрам: сегодня я встречу трудных людей. И всё равно сделаю своё дело хорошо.'],
    ['B', 'Упражнение на сегодня: запиши одну вещь, которая в твоей власти, и сделай её до полудня. Остальным займётся мир.'],
  ],
});

/* ---------- Thought of the day (shown as a card) ---------- */
export const stoicThoughts = () => L({
  pl: [['Seneka', 'Nie dostajemy krótkiego życia, to my je takim czynimy.'], ['Epiktet', 'Niepokoją nas nie rzeczy, ale nasze o nich wyobrażenia.'], ['Marek Aureliusz', 'Masz władzę nad swoim umysłem, nie nad tym, co dzieje się na zewnątrz.']],
  en: [['Seneca', 'We are not given a short life, we make it short.'], ['Epictetus', 'It is not things that disturb us, but our judgements about them.'], ['Marcus Aurelius', 'You have power over your mind, not outside events.']],
  ru: [['Сенека', 'Мы не получаем короткую жизнь, мы делаем её такой.'], ['Эпиктет', 'Людей тревожат не вещи, а их представления о вещах.'], ['Марк Аврелий', 'Ты властен над своим разумом, а не над внешними событиями.']],
});

/* ---------- Demo stories (evergreen, labelled as samples) ---------- */
const STORIES = {
  pl: {
    ai: [['Jak model językowy pisze odpowiedź', 'Model językowy przewiduje kolejne fragmenty tekstu jeden po drugim. Dlatego dobre pytanie z kontekstem daje lepszą odpowiedź niż samo polecenie.'], ['Asystent AI w kalendarzu', 'Coraz więcej narzędzi AI potrafi przygotować spotkanie: zebrać notatki, zaproponować agendę i podsumować ustalenia.'], ['Muzyka generowana na żywo', 'Muzyka w tym radiu powstaje w czasie rzeczywistym. Ma cyfrowy znak wodny, który oznacza treść wygenerowaną przez AI.']],
    beauty: [['Krem z filtrem także zimą', 'Dermatolodzy przypominają, że promieniowanie UV działa również w pochmurne dni. Filtr to najprostszy krok w porannej pielęgnacji.'], ['Kapsułowa szafa', 'Kilkanaście dobrze dobranych ubrań, które łączą się ze sobą, oszczędza czas rano i miejsce w szafie.']],
    sport: [['Dziesięć minut spaceru', 'Krótki spacer po posiłku pomaga utrzymać stabilny poziom cukru. Nie trzeba siłowni, wystarczą schody.'], ['Rozgrzewka przed bieganiem', 'Pięć minut dynamicznej rozgrzewki zmniejsza ryzyko kontuzji bardziej niż statyczne rozciąganie.']],
    funny: [['Ośmiornica ma trzy serca', 'Ośmiornice mają trzy serca i niebieską krew. Dwa serca pompują krew do skrzeli, trzecie do reszty ciała.'], ['Miód się nie psuje', 'Archeolodzy znajdowali w grobowcach miód sprzed tysięcy lat, który nadal nadawał się do jedzenia.']],
    stoic: [['Epiktet o wpływie', 'Epiktet dzielił sprawy na te, które od nas zależą, i te, które nie. Spokój zaczyna się od tego podziału.'], ['Seneka o porankach', 'Seneka zachęcał, by każdy dzień zaczynać jak osobne życie: z jednym celem i bez długów z wczoraj.']],
  },
  en: {
    ai: [['How a language model writes', 'A language model predicts the next piece of text one step at a time. That is why a question with context gets a better answer than a bare command.'], ['AI assistants in your calendar', 'More and more AI tools can prepare a meeting: gather notes, suggest an agenda and summarise what was agreed.'], ['Music generated live', 'The music on this radio is made in real time. It carries a digital watermark that marks it as AI-generated.']],
    beauty: [['Sunscreen in winter too', 'Dermatologists remind us that UV light works on cloudy days as well. Sunscreen is the simplest step in a morning routine.'], ['The capsule wardrobe', 'A dozen well-chosen pieces that all go together save time in the morning and space in the wardrobe.']],
    sport: [['Ten minutes of walking', 'A short walk after a meal helps keep blood sugar steady. No gym needed, the stairs will do.'], ['Warm up before running', 'Five minutes of dynamic warm-up lowers injury risk more than static stretching.']],
    funny: [['An octopus has three hearts', 'Octopuses have three hearts and blue blood. Two hearts pump blood to the gills, the third to the rest of the body.'], ['Honey never spoils', 'Archaeologists have found honey thousands of years old in tombs that was still edible.']],
    stoic: [['Epictetus on control', 'Epictetus divided things into those that depend on us and those that do not. Calm starts with that split.'], ['Seneca on mornings', 'Seneca suggested starting each day like a separate life: with one aim and no debts from yesterday.']],
  },
  ru: {
    ai: [['Как языковая модель пишет ответ', 'Языковая модель предсказывает следующий фрагмент текста шаг за шагом. Поэтому вопрос с контекстом даёт лучший ответ, чем голая команда.'], ['ИИ-ассистент в календаре', 'Всё больше ИИ-инструментов умеют готовить встречу: собирать заметки, предлагать повестку и подводить итоги.'], ['Музыка, созданная вживую', 'Музыка на этом радио создаётся в реальном времени и несёт цифровой водяной знак, отмечающий её как созданную ИИ.']],
    beauty: [['Солнцезащитный крем и зимой', 'Дерматологи напоминают: ультрафиолет действует и в пасмурные дни. Крем с фильтром — самый простой утренний шаг.'], ['Капсульный гардероб', 'Дюжина удачно подобранных вещей, которые сочетаются друг с другом, экономит время утром и место в шкафу.']],
    sport: [['Десять минут прогулки', 'Короткая прогулка после еды помогает держать сахар в крови ровным. Спортзал не нужен, хватит лестницы.'], ['Разминка перед бегом', 'Пять минут динамической разминки снижают риск травмы сильнее, чем статическая растяжка.']],
    funny: [['У осьминога три сердца', 'У осьминогов три сердца и голубая кровь. Два сердца качают кровь к жабрам, третье — ко всему телу.'], ['Мёд не портится', 'Археологи находили в гробницах мёд возрастом в тысячи лет, и он всё ещё был съедобен.']],
    stoic: [['Эпиктет о власти над собой', 'Эпиктет делил дела на те, что зависят от нас, и те, что нет. Спокойствие начинается с этого деления.'], ['Сенека об утре', 'Сенека советовал начинать каждый день как отдельную жизнь: с одной целью и без долгов из вчера.']],
  },
};
export function demoNews(cats) {
  const src = L(STORIES);
  return {
    categories: cats.filter(c => src[c]).map(c => ({
      category: c,
      stories: src[c].map(([title, text], i) => ({ id: `demo-${getLang()}-${c}-${i}`, title, headline: title, radio_text: text, category: c, confirmed: true, audio_ready: true, source_url: '', sample: true })),
    })),
  };
}

/* ---------- Gmail sample inbox (fictional senders, marked as sample) ---------- */
export const gmailSample = () => L({
  pl: [['Faktura za hosting: termin jutro', 'Dostawca hostingu przypomina o fakturze z terminem na jutro. Rada: opłać dziś, zajmie dwie minuty.'], ['Klient pyta o termin wdrożenia', 'Anna z firmy klienta pyta, czy wdrożenie zdąży na piątek. Rada: odpisz przed dziesiątą, nawet jeśli odpowiedź brzmi: jeszcze nie wiem.'], ['Trzy nowe narzędzia AI w newsletterze', 'Newsletter technologiczny opisuje trzy nowe narzędzia. Rada: zostaw na wieczór, nic pilnego.']],
  en: [['Hosting invoice due tomorrow', 'Your hosting provider reminds you of an invoice due tomorrow. Tip: pay it today, it takes two minutes.'], ['Client asks about the launch date', 'Anna from the client asks whether the launch will make it by Friday. Tip: reply before ten, even if the answer is: not sure yet.'], ['Three new AI tools in a newsletter', 'A tech newsletter covers three new tools. Tip: save it for the evening, nothing urgent.']],
  ru: [['Счёт за хостинг: срок завтра', 'Хостинг-провайдер напоминает о счёте со сроком на завтра. Совет: оплати сегодня, это две минуты.'], ['Клиент спрашивает о сроке запуска', 'Анна со стороны клиента спрашивает, успеет ли запуск к пятнице. Совет: ответь до десяти, даже если ответ — пока не знаю.'], ['Три новых ИИ-инструмента в рассылке', 'Технологическая рассылка описывает три новых инструмента. Совет: оставь на вечер, ничего срочного.']],
}).map(([title, text], i) => ({ id: `gmail-sample-${getLang()}-${i}`, title, headline: title, radio_text: text, category: 'personal', confirmed: true, audio_ready: true, source_url: '', sample: true }));

/* ---------- Demo podcast writer (template duet around the user's topic) ---------- */
export function demoPodcast(topic, a, b) {
  const T = topic.trim();
  return L({
    pl: [['A', `Dzień dobry, tu ${a} i ${b}. Dziś na życzenie słuchacza: ${T}.`], ['B', `Zanim zaczniemy: to wersja demonstracyjna. W pełnym radiu ten odcinek pisze AI na podstawie świeżych źródeł.`], ['A', `Dobrze, to pytanie pierwsze. Dlaczego temat „${T}” w ogóle jest ważny?`], ['B', 'Bo dotyczy codziennych decyzji. Jeśli rozumiesz go trochę lepiej, oszczędzasz czas i nerwy.'], ['music'], ['A', 'Gdybyś miał zapamiętać jedną rzecz, co by to było?'], ['B', 'Zacznij od małego kroku, który zrobisz jeszcze dziś. Plan na rok może poczekać.'], ['A', 'A stoicy dodaliby: skup się na tym, co zależy od ciebie.'], ['B', `To był wasz podcast o tym, co nazwaliście: ${T}. Do usłyszenia w DOS Radio.`]],
    en: [['A', `Good morning, it's ${a} and ${b}. Today, at a listener's request: ${T}.`], ['B', 'Before we start: this is the demo version. On the full radio, AI writes this episode from fresh sources.'], ['A', `Right, first question. Why does “${T}” matter at all?`], ['B', 'Because it touches everyday decisions. Understand it a little better and you save time and nerves.'], ['music'], ['A', 'If you had to remember one thing, what would it be?'], ['B', 'Start with one small step you can take today. The plan for the year can wait.'], ['A', 'And the Stoics would add: focus on what is up to you.'], ['B', `That was your podcast on ${T}. Talk soon on DOS Radio.`]],
    ru: [['A', `Доброе утро, это ${a} и ${b}. Сегодня по просьбе слушателя: ${T}.`], ['B', 'Сразу скажем: это демо-версия. В полном радио этот выпуск пишет ИИ по свежим источникам.'], ['A', `Итак, первый вопрос. Почему тема «${T}» вообще важна?`], ['B', 'Потому что она касается ежедневных решений. Поймёшь её чуть лучше — сэкономишь время и нервы.'], ['music'], ['A', 'Если бы нужно было запомнить одно, что бы это было?'], ['B', 'Начни с маленького шага, который сделаешь уже сегодня. План на год подождёт.'], ['A', 'А стоики добавили бы: сосредоточься на том, что зависит от тебя.'], ['B', `Это был ваш подкаст на тему: ${T}. До встречи на DOS Radio.`]],
  });
}

/* script lines → playable parts */
export const toParts = lines => lines.map(([who, text]) => who === 'music' ? { kind: 'bumper' } : { kind: 'tts', who, text });
