"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.padBurnupLabel = exports.MODULE_TEMPLATES = exports.getCardInsertText = exports.FRAGMENT_DISPLAY = exports.CARD_SNIPPETS = exports.buildCatalogPayload = exports.getNuclideLineParamGroups = exports.NUCLIDE_LINE_PARAM_GROUPS = exports.parseSyntaxRequiredPart = exports.getCardLineParamGroups = exports.CARD_LINE_PARAM_GROUPS = exports.getBodyParamGroups = exports.BODY_PARAM_GROUPS = exports.parseCardArgContext = exports.getCardArgSpec = exports.CARD_ARG_SPECS = exports.normalizeMcuLabel = exports.listAllMcuLabels = exports.isKnownMcuLabel = exports.detectFragmentFromLabel = exports.MCU_LABELS_BY_FRAGMENT = exports.MCU_LABEL_ALIASES = exports.ALL_MCU_LABELS = exports.ALL_CARDS = exports.BOUNDARY_CODES = exports.MODS_VALUES = exports.EXTENDED_CARDS = exports.BODY_TYPES = exports.GEO_CARDS = exports.PIN_CARDS = exports.FRAGMENT_MARKERS = exports.FRAGMENT_ORDER = void 0;
exports.formatCardHover = formatCardHover;
exports.getCardByLabel = getCardByLabel;
exports.getBodyByKey = getBodyByKey;
const keywords_1 = require("./keywords");
const moduleCards_1 = require("./moduleCards");
const userGuideCards_generated_1 = require("./userGuideCards.generated");
const cardDescriptionsExtra_1 = require("./cardDescriptionsExtra");
exports.FRAGMENT_ORDER = [
    "physical",
    "geometry",
    "source",
    "registration",
    "burnupRegistration",
    "trajectory",
    "calculationControl",
    "burnup",
];
exports.FRAGMENT_MARKERS = {
    physical: ["PIN"],
    geometry: ["HEAD", "CONT", "MIR"],
    source: ["SRCD", "SRC"],
    registration: ["REGD", "REG"],
    burnupRegistration: ["BRGD", "BRG"],
    trajectory: ["TRJD", "TRJ"],
    calculationControl: ["CALD", "CAL"],
    burnup: ["BURD", "BURN", "BURNUP"],
};
exports.PIN_CARDS = [
    {
        label: "PIN",
        title: "Заголовок физического модуля",
        syntax: "PIN [value1 value2]",
        description: "Начало фрагмента физического модуля. value1 — печать карт (0/1), value2 — отладочная печать (0–5).",
        defaults: "value1=0, value2=0",
        fragment: "physical",
    },
    {
        label: "MATR",
        title: "Описание материала",
        syntax: "MATR number [T=t GROUP=group NAME=type DENSAA=...] nuclide dens ...",
        description: "Задаёт материал с порядковым номером, температурой, составом нуклидов и опциональными параметрами плотности.",
        fragment: "physical",
        example: "MATR 1\nU235 1.10E-03\nH 0.0001 MODS=G",
    },
    {
        label: "END",
        title: "Конец блока",
        syntax: "END",
        description: "Окончание текущего блока: состав MATR (PIN), секция CELL/LCELL (геометрия), раздел регистратора (после PTYPE…). Перед следующим MATR или FINISH может быть пропущен.",
        example: "END",
    },
    {
        label: "DEF",
        title: "Переопределение DEFAULT.PHY",
        syntax: "DEF name [ACE=ace MODS=mods DTEM=dtem PHT=pht]",
        description: "Изменяет значения по умолчанию для нуклида из DEFAULT.PHY.",
        fragment: "physical",
    },
    {
        label: "TEMPR",
        title: "Температура системы",
        syntax: "TEMPR value",
        description: "Температура (K) для всех материалов. По умолчанию 300 K.",
        fragment: "physical",
    },
    {
        label: "FINISH",
        title: "Конец фрагмента",
        syntax: "FINISH [commentary]",
        description: "Обязательный признак окончания ввода данных текущего фрагмента: PIN, геометрия, источники, регистрация, BRG, BURN и др.",
        example: "FINISH",
    },
    {
        label: "NEUT",
        title: "Моделирование нейтронов",
        syntax: "NEUT valneut",
        description: "valneut=1 — моделировать нейтроны, 0 — нет. По умолчанию 1.",
        fragment: "physical",
    },
    {
        label: "EGRC",
        title: "Энергетические границы подмодулей",
        syntax: "EGRC valegrc1, valegrc2, valegrc3",
        description: "Нижние границы (эВ) для FARION, ФИМБРОЭН, ФИМТОЭН.",
        fragment: "physical",
    },
];
exports.GEO_CARDS = [
    {
        label: "HEAD",
        title: "Заголовок геометрии",
        syntax: "HEAD [print [trace [listSize]]]",
        description: "print: 0–4 (печать на вводе). trace: трассировка. listSize: размер списков поиска (по умолчанию 400).",
        fragment: "geometry",
    },
    {
        label: "CONT",
        title: "Контейнер и граничные условия",
        syntax: "CONT <BC...> [S<angle>] [PRS<angle>]",
        description: "Контейнер — первое тело в секции тел. BC: B (чёрная), W (белое), M (зеркало), C (цилиндр.), T (трансляция).",
        fragment: "geometry",
    },
    {
        label: "MIR",
        title: "Плоскость симметрии",
        syntax: "MIR P Q",
        description: "Плоскость (P,x)+Q=0. Вектор P направлен внутрь контейнера.",
        fragment: "geometry",
    },
    {
        label: "EQU",
        title: "Константа (без переопределения)",
        syntax: "EQU <name> = <expression>",
        description: "Присвоение имени числовому выражению (+−*/(), SIN/COS/TG/SQRT/FUNH/LN; углы тригонометрии в градусах).",
        fragment: "geometry",
    },
    {
        label: "SET",
        title: "Переменная (с переопределением)",
        syntax: "SET <name> = <expression>",
        description: "Как EQU, но значение можно переустанавливать.",
        fragment: "geometry",
    },
    {
        label: "CELL",
        title: "Прототип ячейки сети",
        syntax: "CELL <name> [EXTEND]",
        description: "Описание прототипа ячейки: секции тел и зон. EXTEND — ячейка с решётками.",
        fragment: "geometry",
    },
    {
        label: "NET",
        title: "Сеть",
        syntax: "NET <name> <root> <cols> <rows> [<layers>]",
        description: "Двумерная или трёхмерная сеть ячеек одинаковой формы.",
        fragment: "geometry",
    },
    {
        label: "LCELL",
        title: "Прототип элемента решётки",
        syntax: "LCELL <name>",
        description: "Прототип элемента решётки (тела + зоны). Заканчивается ENDL.",
        fragment: "geometry",
    },
    {
        label: "LATT",
        title: "Решётка",
        syntax: "LATT <type> <zone> LISTEL ... PARM ...",
        description: "Размещение элементов решётки в зоне-носителе.",
        fragment: "geometry",
    },
    {
        label: "TRANSF",
        title: "Преобразование тела",
        syntax: "TRANSF <newName> <protoName> M|R A B f",
        description: "M — отражение, R — поворот вокруг вертикали через (A,B,0).",
        fragment: "geometry",
    },
];
exports.BODY_TYPES = [
    { key: "SPH", letter: "S", title: "Шар", paramCount: 4, paramNames: ["x", "y", "z", "R"], description: "Центр и радиус.", snippet: "SPH ${1:name} ${2:0},${3:0},${4:0} ${5:1}" },
    { key: "RCC", letter: "C", title: "Круговой цилиндр", paramCount: 7, paramNames: ["x", "y", "z", "dx", "dy", "dz", "R"], description: "Центр нижнего основания, вектор высоты, радиус.", snippet: "RCC ${1:name} ${2:0},${3:0},${4:0} ${5:0},${6:0},${7:1} ${8:1}" },
    { key: "RPP", letter: "P", title: "Параллелепипед по осям", paramCount: 6, paramNames: ["X1", "Xs", "Y1", "Ys", "Z1", "Zs"], description: "X1<Xs, Y1<Ys, Z1<Zs.", snippet: "RPP ${1:name} ${2:-1},${3:1} ${4:-1},${5:1} ${6:0},${7:1}" },
    { key: "RCZ", letter: "Z", title: "Цилиндр вдоль OZ", paramCount: 5, paramNames: ["x", "y", "z", "H", "R"], description: "Центр нижнего основания, высота, радиус.", snippet: "RCZ ${1:name} ${2:0},${3:0},${4:0} ${5:1} ${6:1}" },
    { key: "HEX", letter: "H", title: "Шестигранная призма OZ", paramCount: 3, paramNames: ["center", "vector", "optional"], description: "Центр нижнего основания и вектор «под ключ»+высота.", snippet: "HEX ${1:C} ${2:0,0,0} ${3:1.806,0,100}" },
    { key: "HEXX", letter: "H", title: "HEX альтернатива", paramCount: 4, paramNames: ["center", "H", "D", "f"], description: "Центр, высота, размер под ключ, угол поворота.", snippet: "HEXX ${1:C} ${2:0,0,0} ${3:100} ${4:1.806}" },
    { key: "HEXY", letter: "H", title: "HEX поворот 90°", paramCount: 4, paramNames: ["center", "H", "D", "f"], description: "Как HEXX, угол от OY.", snippet: "HEXY ${1:K} ${2:0,0,0} ${3:3} ${4:4}" },
    { key: "BOX", letter: "B", title: "Произвольный параллелепипед", paramCount: 12, paramNames: ["vertex", "e1", "e2", "e3"], description: "Вершина и три ребра.", snippet: "BOX ${1:B} ${2:0,0,0} ${3:1,0,0} ${4:0,1,0} ${5:0,0,1}" },
    { key: "PLG", letter: "d", title: "Полупространство", paramCount: 4, paramNames: ["nx", "ny", "nz", "Q"], description: "(n,x) >= Q.", snippet: "PLG ${1:1} ${2:0},${3:1},${4:0} ${5:0}" },
    { key: "PLX", letter: "X", title: "X >= X0", paramCount: 1, paramNames: ["X0"], description: "Полупространство X>=X0.", snippet: "PLX ${1:0}" },
    { key: "PLY", letter: "Y", title: "Y >= Y0", paramCount: 1, paramNames: ["Y0"], description: "Полупространство Y>=Y0.", snippet: "PLY ${1:0}" },
    { key: "PLZ", letter: "Z", title: "Z >= Z0", paramCount: 1, paramNames: ["Z0"], description: "Полупространство Z>=Z0.", snippet: "PLZ ${1:0}" },
    { key: "SBOX", letter: "X", title: "SBOX из начала координат", paramCount: 9, paramNames: ["e1", "e2", "e3"], description: "Параллелепипед с вершиной в 0.", snippet: "SBOX ${1:S} ${2:10},0,0 ${3:5},5,0 ${4:0},0,3" },
    { key: "SHEX", letter: "I", title: "SHEX из начала", paramCount: 3, paramNames: ["S", "H", "f"], description: "Шестигранник, центр в 0, ось OZ.", snippet: "SHEX ${1:C} ${2:3} ${3:4} ${4:0}" },
    { key: "ARB", letter: "N", title: "Выпуклый многогранник", paramCount: "var", paramNames: ["vertices", "faces"], description: "До 8 вершин, грани после /.", snippet: "ARB ${1:1} ${2:-1,-1,0} ${3:1,-1,0} / ${4:1234}" },
    { key: "QUAD", letter: "Q", title: "Квадратичная форма", paramCount: 10, paramNames: ["coeffs"], description: "Неравенство квадратичной формы или / cx cy cz d.", snippet: "QUAD ${1:q} ${2:1} ${3:0} ${4:0} ${5:1} ${6:0} ${7:1} ${8:0} ${9:0} ${10:0} ${11:-1}" },
];
exports.EXTENDED_CARDS = [
    {
        label: "SPNT",
        title: "Простой точечный источник",
        syntax: "SPNT X,Y,Z [ESET ...] [SPEC ...] [ENSO E] FINISH",
        description: "Точечный источник в координатах (см). Для k-eff достаточно простого источника.",
        fragment: "source",
        example: "SPNT 2.99 0.80 350.",
    },
    {
        label: "SRCD",
        title: "Заголовок модуля источников",
        syntax: "SRCD [print [debug]]",
        description: "Начало фрагмента сложного источника (NPS, PROB, TYPE, спектры).",
        fragment: "source",
    },
    {
        label: "RGS",
        title: "Заголовок модуля регистрации",
        syntax: "RGS [print [debug]]",
        description: "Регистрация: KEFF, детекторы, функционалы по материалам/зонам/объектам.",
        fragment: "registration",
        example: "RGS 1 0",
    },
    {
        label: "REGD",
        title: "Заголовок модуля регистрации",
        syntax: "REGD [print [debug]]",
        description: "Альтернативная метка начала фрагмента регистрации.",
        fragment: "registration",
    },
    {
        label: "KEFF",
        title: "Регистратор k-eff",
        syntax: "KEFF",
        description: "Эффективный коэффициент размножения.",
        fragment: "registration",
    },
    {
        label: "NRET",
        title: "Число историй регистратора",
        syntax: "NRET number [DOWN|UP]",
        description: "Число нейтронных историй для регистратора.",
        fragment: "registration",
    },
    {
        label: "PTYPE",
        title: "Тип частиц регистратора",
        syntax: "PTYPE n",
        description: "Первая карта раздела регистрации. n: 1 — нейтроны, 2 — фотоны, 3 — электроны (нумерация физического модуля).",
        fragment: "registration",
        example: "PTYPE 2",
    },
    {
        label: "TTYPE",
        title: "Способ оценки функционалов",
        syntax: "TTYPE n",
        description: "Оценка функционалов: 0 — по точкам столкновений (по умолч.), 1 — по длине пробега, 2 — по точкам поглощений.",
        fragment: "registration",
        example: "TTYPE 1",
    },
    {
        label: "ENERGY",
        title: "Энергетические группы регистрации",
        syntax: "ENERGY E1 E2 ...",
        description: "Нижние границы регистрационных групп (эВ); 0 задать явно. Верхняя граница последней группы — ∞. Без ENERGY регистрация в разделе не ведётся.",
        fragment: "registration",
        example: "ENERGY 0.",
    },
    {
        label: "ZFLU",
        title: "Потоки по зонам",
        syntax: "ZFLU list",
        description: "Номера регистрационных зон, в которых считаются потоки. Интервалы: 1-4.",
        fragment: "registration",
        example: "ZFLU 1-4",
    },
    {
        label: "MFLU",
        title: "Потоки по материалам",
        syntax: "MFLU list",
        description: "Номера регистрационных материалов для расчёта потоков.",
        fragment: "registration",
    },
    {
        label: "OFLU",
        title: "Потоки по объектам",
        syntax: "OFLU list",
        description: "Номера регистрационных объектов для расчёта потоков.",
        fragment: "registration",
    },
    {
        label: "RCT",
        title: "Номера реакций",
        syntax: "RCT list",
        description: "Номера реакций физического модуля для скоростей в областях MRCT/ZRCT/ORCT. Понуклидный баланс по списку.",
        fragment: "registration",
        example: "RCT 3,918,18",
    },
    {
        label: "ZRCT",
        title: "Зоны для скоростей реакций",
        syntax: "ZRCT list",
        description: "Регистрационные зоны для карт RCT/FRM.",
        fragment: "registration",
        example: "ZRCT 1-4",
    },
    {
        label: "MRCT",
        title: "Материалы для скоростей реакций",
        syntax: "MRCT list",
        description: "Регистрационные материалы для карт RCT/FRM.",
        fragment: "registration",
    },
    {
        label: "ORCT",
        title: "Объекты для скоростей реакций",
        syntax: "ORCT list",
        description: "Регистрационные объекты для карт RCT/FRM.",
        fragment: "registration",
        example: "ORCT 1",
    },
    {
        label: "BRG",
        title: "Регистрация для выгорания",
        syntax: "BRG",
        description: "Фрагмент регистрации для модуля выгорания.",
        fragment: "burnupRegistration",
    },
    {
        label: "BRGD",
        title: "Регистрация для выгорания",
        syntax: "BRGD",
        description: "Альтернативная метка burnupRegistration.",
        fragment: "burnupRegistration",
    },
    {
        label: "TRJD",
        title: "Модуль траекторий",
        syntax: "TRJD",
        description: "Задание траекторий частиц.",
        fragment: "trajectory",
    },
    {
        label: "CALD",
        title: "Управление счётом",
        syntax: "CALD",
        description: "Серии, шаги, имя варианта, ограничения расчёта.",
        fragment: "calculationControl",
    },
    {
        label: "NAMV",
        title: "Имя варианта",
        syntax: "NAMV name",
        description: "Имя варианта (1–8 символов) для NAME.LST, NAME.DAT, …",
        fragment: "calculationControl",
    },
    {
        label: "NBATCH",
        title: "Число батчей",
        syntax: "NBATCH n",
        description: "Число батчей (пакетов историй) на серию. Краткая метка: NBAT.",
        fragment: "calculationControl",
        example: "NBATCH 3",
    },
    {
        label: "NTOT",
        title: "Общее число историй",
        syntax: "NTOT n",
        description: "Число частиц в поколении (историй на серию). Суммарно по варианту: NTOT × MAXSER историй.",
        fragment: "calculationControl",
    },
    {
        label: "BURN",
        title: "Модуль выгорания",
        syntax: "BURN",
        description: "Бесформатный фрагмент выгорания (STEP, FISZ, CODE, …).",
        fragment: "burnup",
    },
    {
        label: "BURD",
        title: "Модуль выгорания",
        syntax: "BURD",
        description: "Альтернативная метка начала выгорания.",
        fragment: "burnup",
    },
    {
        label: "STEP",
        title: "Шаги выгорания",
        syntax: "STEP t1 n1 t2 n2 ...",
        description: "Ступени облучения: время (сут.) и число шагов.",
        fragment: "burnup",
    },
    {
        label: "FISZ",
        title: "Делящиеся материалы",
        syntax: "FISZ list",
        description: "Номера материалов типа F. Диапазоны: 1, 3-5, 7.",
        fragment: "burnup",
    },
    {
        label: "ENDL",
        title: "Конец LCELL",
        syntax: "ENDL",
        description: "Конец прототипа элемента решётки.",
        fragment: "geometry",
    },
    {
        label: "ENDXCL",
        title: "Конец CELL",
        syntax: "ENDXCL",
        description: "Конец прототипа ячейки сети.",
        fragment: "geometry",
    },
    {
        label: "LISTEL",
        title: "Элементы решётки",
        syntax: "LISTEL proto [(C,C0,...)] ...",
        description: "Прототипы LCELL для LATT.",
        fragment: "geometry",
    },
    {
        label: "PARM",
        title: "Параметры генератора решётки",
        syntax: "PARM ...",
        description: "Параметры GLTL/G2AR/G2MP.",
        fragment: "geometry",
    },
    {
        label: "CNTAND",
        title: "Пересечение с контейнером",
        syntax: "CNTAND [0|1]",
        description: "Пересечение всех зон с контейнером (по умолч. вкл.).",
        fragment: "geometry",
    },
    {
        label: "PHOT",
        title: "Моделирование фотонов",
        syntax: "PHOT val",
        description: "1 — моделировать фотоны, 0 — нет.",
        fragment: "physical",
    },
    {
        label: "EGPH",
        title: "Границы для фотонов",
        syntax: "EGPH ...",
        description: "Энергетические границы подмодулей для фотонов (эВ).",
        fragment: "physical",
    },
    {
        label: "WPHO",
        title: "Весовой спектр фотонов",
        syntax: "WPHO ...",
        description: "Параметры весового спектра фотонов.",
        fragment: "physical",
    },
    {
        label: "BUCL",
        title: "Баклинг (вектор B)",
        syntax: "BUCL Bx By Bz",
        description: "Компоненты вектора геометрического параметра B (баклинг) для асимптотической задачи утечки нейтронов. По умолчанию 0,0,0.",
        fragment: "registration",
        example: "BUCL 0.0 0.0 0.099126",
    },
    {
        label: "BMAX",
        title: "Лимит материалов для выгорания",
        syntax: "BMAX maxbur",
        description: "Подготовка сечений только для первых maxbur материалов (ускорение). Не сочетается с BURALL. При maxbur=0 и без BURALL модуль выгорания не работает.",
        fragment: "burnupRegistration",
        example: "BMAX 7",
    },
    {
        label: "BURALL",
        title: "Сечения для всех материалов",
        syntax: "BURALL",
        description: "Подготовка сечений и потоков для всех материалов (рекомендуемый режим модуля выгорания).",
        fragment: "burnupRegistration",
    },
    {
        label: "VOL",
        title: "Объёмы материалов",
        syntax: "VOL V1 V2 ... Vnmat",
        description: "Объёмы материалов (см³) по порядку номеров MATR. Нужны для работы модуля выгорания вместе с BURALL/BMAX.",
        fragment: "burnupRegistration",
        example: "VOL 0.45 0.17 0.76 0.02",
    },
    {
        label: "MAXS",
        title: "Максимальная серия",
        syntax: "MAXS maxser",
        description: "Номер серии, после которой счёт прекращается. Суммарно по варианту: NTOT × MAXSER историй (с учётом NSKI — число регистрируемых серий).",
        fragment: "calculationControl",
        example: "MAXSER 500",
    },
    {
        label: "DTZM",
        title: "Период записи в файл задачи",
        syntax: "DTZM nser",
        description: "Число серий между записями накопленной статистики в файл задачи.",
        fragment: "calculationControl",
        example: "DTZML 50",
    },
    {
        label: "NPRI",
        title: "Период экранного вывода",
        syntax: "NPRI nhys",
        description: "Число историй между информационными строками на экран. Алиасы: NPRINT, NPRIN.",
        fragment: "calculationControl",
        example: "NPRINT 0",
    },
    {
        label: "ECUT",
        title: "Отсечка энергии нейтрона",
        syntax: "ECUT e1",
        description: "Нижняя граница энергии нейтрона (эВ); траектории ниже прерываются. По умолчанию 0 эВ. Редактируется в процессе счёта.",
        fragment: "calculationControl",
        example: "ECUT 0.",
    },
    {
        label: "ECUP",
        title: "Отсечка энергии фотона",
        syntax: "ECUP e1",
        description: "Нижняя граница энергии фотона (эВ); траектории ниже прерываются. По умолчанию 10000 эВ. Редактируется в процессе счёта.",
        fragment: "calculationControl",
        example: "ECUP 100.",
    },
    {
        label: "ECEL",
        title: "Отсечка энергии электрона",
        syntax: "ECEL e1",
        description: "Нижняя граница энергии электрона (эВ); траектории ниже прерываются. По умолчанию 100 эВ. Редактируется в процессе счёта.",
        fragment: "calculationControl",
        example: "ECEL 10000",
    },
    {
        label: "ECPO",
        title: "Отсечка энергии позитрона",
        syntax: "ECPO e1",
        description: "Нижняя граница энергии позитрона (эВ); траектории ниже прерываются. Аналог ECEL для позитронов. По умолчанию 100 эВ. Редактируется в процессе счёта.",
        fragment: "calculationControl",
        example: "ECPO 10000",
    },
    {
        label: "CODE",
        title: "Опция модуля выгорания",
        syntax: "CODE option",
        description: "Режим BURN: RSTP (STEP), RFNL (FINAL), RDEL (DELAY), RFTB/RDTB (FINTAB/DELTAB), RFDN (FINDEN), RSOU (SOURCE), RSHR (SHORT). Обязательна.",
        fragment: "burnup",
        example: "CODE RSTP",
    },
    {
        label: "POWE",
        title: "Мощность (STEP)",
        syntax: "POWE q1 t1 q2 t2 ...",
        description: "Кусочно-постоянная суммарная мощность Q (кВт) от времени T (сут). Пары q, t — значение и верхняя граница интервала.",
        fragment: "burnup",
        example: "POWER 0.146",
    },
    {
        label: "FISZON",
        title: "Делящиеся материалы",
        syntax: "FISZON list",
        description: "Номера материалов типа F. Интервалы: 1, 3-5, 7 → 1 1 3 5 7.",
        fragment: "burnup",
        example: "FISZON 1 1 5 7",
    },
    {
        label: "ZONPRI",
        title: "Печать по материалам",
        syntax: "ZONPRI list",
        description: "Номера материалов, для которых на печать выводятся результаты изменения изотопного состава. Без строки — все материалы.",
        fragment: "burnup",
        example: "ZONPRI 1",
    },
    {
        label: "SUMZON",
        title: "Интегральные характеристики",
        syntax: "SUMZON list",
        description: "Печать интегральных характеристик: SUMB, ZONB, SUMS, ZONS, SUMR, ZONR, SUMG, ZONG.",
        fragment: "burnup",
        example: "SUMZON ZONB",
    },
    {
        label: "CONTEN",
        title: "Печать характеристик изотопов",
        syntax: "CONTEN list",
        description: "Печать по изотопам: DENS, SIGM, CURI, HEAT, HGAM, HBET, QUOT, SPNU. Пустой список — DENS.",
        fragment: "burnup",
        example: "CONTEN",
    },
];
exports.MODS_VALUES = ["G", "T", "COHR", "H2OK", "CH2K", "ZRHK", "HYH", "D2OK", "BEOK"];
exports.BOUNDARY_CODES = [
    { code: "B", title: "Чёрная граница (поглощение)" },
    { code: "W", title: "Белое отражение" },
    { code: "M", title: "Зеркальное отражение" },
    { code: "C", title: "Белое цилиндрическое отражение" },
    { code: "T", title: "Трансляционная симметрия" },
];
const HAND_CRAFTED_CARDS = [
    ...exports.PIN_CARDS,
    ...moduleCards_1.PHYSICAL_EXTRA_CARDS,
    ...exports.GEO_CARDS,
    ...exports.EXTENDED_CARDS,
    ...moduleCards_1.SOURCE_CARDS,
    ...moduleCards_1.REGISTRATION_EXTRA_CARDS,
];
function buildAllCards() {
    const byLabel = new Map();
    const put = (card, force = false) => {
        const u = card.label.toUpperCase();
        const prev = byLabel.get(u);
        const next = { ...card, label: u, title: card.title || u };
        if (!prev || force || card.description.length > prev.description.length) {
            byLabel.set(u, next);
        }
    };
    for (const raw of userGuideCards_generated_1.USER_GUIDE_CARDS) {
        put({ ...raw, title: raw.title || raw.label });
    }
    for (const raw of cardDescriptionsExtra_1.EXTRA_CARD_DESCRIPTIONS) {
        put({ ...raw, title: raw.title || raw.label }, true);
    }
    for (const card of HAND_CRAFTED_CARDS)
        put(card, true);
    for (const label of keywords_1.ALL_MCU_LABELS) {
        if (byLabel.has(label))
            continue;
        const canon = (0, keywords_1.normalizeMcuLabel)(label);
        if (canon !== label && byLabel.has(canon)) {
            const base = byLabel.get(canon);
            put({ ...base, label });
        }
    }
    return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
}
exports.ALL_CARDS = buildAllCards();
const FRAGMENT_TITLES = {
    physical: "физический модуль (PIN)",
    geometry: "геометрия (NCGSIM)",
    source: "источники",
    registration: "регистрация",
    burnupRegistration: "регистрация для выгорания",
    trajectory: "траектории",
    calculationControl: "управление счётом",
    burnup: "выгорание",
};
function formatCardHover(card) {
    const parts = [`**${card.title}**`, "", `\`${card.syntax}\``, "", card.description];
    if (card.fragment) {
        parts.push("", `*Фрагмент: ${FRAGMENT_TITLES[card.fragment] ?? card.fragment}*`);
    }
    if (card.defaults)
        parts.push("", `По умолчанию: ${card.defaults}`);
    if (card.example)
        parts.push("", "Пример:", "```", card.example, "```");
    return parts.join("\n");
}
function getCardByLabel(label) {
    const u = label.toUpperCase();
    const canon = (0, keywords_1.normalizeMcuLabel)(u);
    const order = canon === u ? [u] : [canon, u];
    for (const key of order) {
        const card = exports.ALL_CARDS.find((c) => c.label === key);
        if (card)
            return card;
    }
    return undefined;
}
function getBodyByKey(key) {
    return exports.BODY_TYPES.find((b) => b.key === key.toUpperCase());
}
var keywords_2 = require("./keywords");
Object.defineProperty(exports, "ALL_MCU_LABELS", { enumerable: true, get: function () { return keywords_2.ALL_MCU_LABELS; } });
Object.defineProperty(exports, "MCU_LABEL_ALIASES", { enumerable: true, get: function () { return keywords_2.MCU_LABEL_ALIASES; } });
Object.defineProperty(exports, "MCU_LABELS_BY_FRAGMENT", { enumerable: true, get: function () { return keywords_2.MCU_LABELS_BY_FRAGMENT; } });
Object.defineProperty(exports, "detectFragmentFromLabel", { enumerable: true, get: function () { return keywords_2.detectFragmentFromLabel; } });
Object.defineProperty(exports, "isKnownMcuLabel", { enumerable: true, get: function () { return keywords_2.isKnownMcuLabel; } });
Object.defineProperty(exports, "listAllMcuLabels", { enumerable: true, get: function () { return keywords_2.listAllMcuLabels; } });
Object.defineProperty(exports, "normalizeMcuLabel", { enumerable: true, get: function () { return keywords_2.normalizeMcuLabel; } });
var cardArgEnums_1 = require("./cardArgEnums");
Object.defineProperty(exports, "CARD_ARG_SPECS", { enumerable: true, get: function () { return cardArgEnums_1.CARD_ARG_SPECS; } });
Object.defineProperty(exports, "getCardArgSpec", { enumerable: true, get: function () { return cardArgEnums_1.getCardArgSpec; } });
Object.defineProperty(exports, "parseCardArgContext", { enumerable: true, get: function () { return cardArgEnums_1.parseCardArgContext; } });
var bodyParamGroups_1 = require("./bodyParamGroups");
Object.defineProperty(exports, "BODY_PARAM_GROUPS", { enumerable: true, get: function () { return bodyParamGroups_1.BODY_PARAM_GROUPS; } });
Object.defineProperty(exports, "getBodyParamGroups", { enumerable: true, get: function () { return bodyParamGroups_1.getBodyParamGroups; } });
var cardLineParamGroups_1 = require("./cardLineParamGroups");
Object.defineProperty(exports, "CARD_LINE_PARAM_GROUPS", { enumerable: true, get: function () { return cardLineParamGroups_1.CARD_LINE_PARAM_GROUPS; } });
Object.defineProperty(exports, "getCardLineParamGroups", { enumerable: true, get: function () { return cardLineParamGroups_1.getCardLineParamGroups; } });
Object.defineProperty(exports, "parseSyntaxRequiredPart", { enumerable: true, get: function () { return cardLineParamGroups_1.parseSyntaxRequiredPart; } });
var nuclideLineParamGroups_1 = require("./nuclideLineParamGroups");
Object.defineProperty(exports, "NUCLIDE_LINE_PARAM_GROUPS", { enumerable: true, get: function () { return nuclideLineParamGroups_1.NUCLIDE_LINE_PARAM_GROUPS; } });
Object.defineProperty(exports, "getNuclideLineParamGroups", { enumerable: true, get: function () { return nuclideLineParamGroups_1.getNuclideLineParamGroups; } });
var catalog_1 = require("./catalog");
Object.defineProperty(exports, "buildCatalogPayload", { enumerable: true, get: function () { return catalog_1.buildCatalogPayload; } });
Object.defineProperty(exports, "CARD_SNIPPETS", { enumerable: true, get: function () { return catalog_1.CARD_SNIPPETS; } });
Object.defineProperty(exports, "FRAGMENT_DISPLAY", { enumerable: true, get: function () { return catalog_1.FRAGMENT_DISPLAY; } });
Object.defineProperty(exports, "getCardInsertText", { enumerable: true, get: function () { return catalog_1.getCardInsertText; } });
Object.defineProperty(exports, "MODULE_TEMPLATES", { enumerable: true, get: function () { return catalog_1.MODULE_TEMPLATES; } });
Object.defineProperty(exports, "padBurnupLabel", { enumerable: true, get: function () { return catalog_1.padBurnupLabel; } });
//# sourceMappingURL=index.js.map