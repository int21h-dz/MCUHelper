import { normalizeMcuLabel, ALL_MCU_LABELS, detectFragmentFromLabel } from "./keywords";
import { getBodyParamGroups } from "./bodyParamGroups";
import { PHYSICAL_EXTRA_CARDS, REGISTRATION_EXTRA_CARDS, SOURCE_CARDS } from "./moduleCards";
import { USER_GUIDE_CARDS } from "./userGuideCards.generated";
import { EXTRA_CARD_DESCRIPTIONS } from "./cardDescriptionsExtra";

export interface CardSchema {
  label: string;
  title: string;
  syntax: string;
  description: string;
  defaults?: string;
  example?: string;
  fragment?: string;
}

export interface BodyTypeSchema {
  key: string;
  letter: string;
  title: string;
  paramCount: number | "var";
  paramNames: string[];
  description: string;
  snippet: string;
}

export const FRAGMENT_ORDER = [
  "physical",
  "geometry",
  "source",
  "registration",
  "burnupRegistration",
  "trajectory",
  "calculationControl",
  "burnup",
] as const;

export type FragmentId = (typeof FRAGMENT_ORDER)[number];

export const FRAGMENT_MARKERS: Record<FragmentId, string[]> = {
  physical: ["PIN"],
  geometry: ["HEAD", "CONT", "MIR"],
  source: ["SRCD", "SRC"],
  registration: ["REGD", "REG"],
  burnupRegistration: ["BRGD", "BRG"],
  trajectory: ["TRJD", "TRJ"],
  calculationControl: ["CALD", "CAL"],
  burnup: ["BURD", "BURN", "BURNUP"],
};

export const PIN_CARDS: CardSchema[] = [
  {
    label: "PIN",
    title: "Заголовок физического модуля",
    syntax: "PIN [value1 value2]",
    description:
      "Начало физического модуля. value1 включает печать карт (0/1), value2 задаёт уровень отладочной печати (0-5).",
    defaults: "value1=0, value2=0",
    fragment: "physical",
  },
  {
    label: "MATR",
    title: "Описание материала",
    syntax: "MATR number [T=t GROUP=group NAME=type DENSAA=...] nuclide dens ...",
    description:
      "Задаёт номер материала, температуру, состав нуклидов и параметры плотности.",
    fragment: "physical",
    example: "MATR 1\nU235 1.10E-03\nH 0.0001 MODS=G",
  },
  {
    label: "END",
    title: "Конец блока",
    syntax: "END",
    description:
      "Закрывает текущий блок: состав MATR, секцию CELL/LCELL или раздел регистратора. Перед следующим MATR или FINISH может отсутствовать.",
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
    description:
      "Обязательное завершение текущего фрагмента: PIN, геометрия, источники, регистрация, BRG, BURN и др.",
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

export const GEO_CARDS: CardSchema[] = [
  {
    label: "HEAD",
    title: "Заголовок геометрии",
    syntax: "HEAD [print [trace [listSize]]]",
    description:
      "print: 0-4 для печати на вводе, trace включает трассировку, listSize задаёт размер списков поиска (по умолчанию 400).",
    fragment: "geometry",
  },
  {
    label: "CONT",
    title: "Контейнер и граничные условия",
    syntax: "CONT <BC...> [S<angle>] [PRS<angle>]",
    description:
      "Первое тело в секции тел считается контейнером. BC: B - чёрная, W - белая, M - зеркальная, C - цилиндрическая, T - трансляционная граница.",
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
    description:
      "Присваивает имя числовому выражению. Поддерживаются + - * / (), SIN/COS/TG/SQRT/FUNH/LN; углы задаются в градусах.",
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
    syntax: "LATT <type> <zone> LISTEL ... PARM ... [LFIXSO ...] [LBLACK ...]",
    description: "Размещение элементов решётки в зоне-носителе (GLTL / G2AR / G2MP).",
    fragment: "geometry",
  },
  {
    label: "LFIXSO",
    title: "Поверхность накопления источника",
    syntax: "LFIXSO <пары объектных номеров>",
    description:
      "Задаёт поверхность накопления источника парами объектных номеров. На первом этапе используется только LFIXSO, на промежуточных - вместе с LBLACK.",
    fragment: "geometry",
    example: "LFIXSO 2,1",
  },
  {
    label: "LBLACK",
    title: "Поверхность поглощения (накопление источника)",
    syntax: "LBLACK <пары объектных номеров>",
    description:
      "Задаёт поверхность поглощения по тем же парам объектных номеров, что и LFIXSO. На последнем этапе используется только LBLACK, на промежуточных - вместе с LFIXSO.",
    fragment: "geometry",
    example: "LBLACK 0,1  1,2",
  },
  {
    label: "TRANSF",
    title: "Преобразование тела",
    syntax: "TRANSF <newName> <protoName> M|R A B f",
    description: "M — отражение, R — поворот вокруг вертикали через (A,B,0).",
    fragment: "geometry",
  },
];

export const BODY_TYPES: BodyTypeSchema[] = [
  { key: "SPH", letter: "S", title: "Шар", paramCount: 4, paramNames: ["x", "y", "z", "R"], description: "Центр и радиус.", snippet: "SPH ${1:name} ${2:0},${3:0},${4:0} ${5:1}" },
  { key: "RCC", letter: "C", title: "Круговой цилиндр", paramCount: 7, paramNames: ["x", "y", "z", "dx", "dy", "dz", "R"], description: "Центр нижнего основания, вектор высоты, радиус.", snippet: "RCC ${1:name} ${2:0},${3:0},${4:0} ${5:0},${6:0},${7:1} ${8:1}" },
  { key: "RPP", letter: "P", title: "Параллелепипед по осям", paramCount: 6, paramNames: ["X1", "Xs", "Y1", "Ys", "Z1", "Zs"], description: "X1<Xs, Y1<Ys, Z1<Zs.", snippet: "RPP ${1:name} ${2:-1},${3:1} ${4:-1},${5:1} ${6:0},${7:1}" },
  { key: "RCZ", letter: "Z", title: "Цилиндр вдоль OZ", paramCount: 5, paramNames: ["x", "y", "z", "H", "R"], description: "Центр нижнего основания, высота, радиус.", snippet: "RCZ ${1:name} ${2:0},${3:0},${4:0} ${5:1} ${6:1}" },
  { key: "HEX", letter: "H", title: "Шестигранная призма OZ", paramCount: 3, paramNames: ["center", "vector", "optional"], description: "Центр нижнего основания и вектор «под ключ»+высота.", snippet: "HEX ${1:C} ${2:0,0,0} ${3:1.806,0,100}" },
  { key: "HEXX", letter: "H", title: "HEX альтернатива", paramCount: 4, paramNames: ["center", "H", "D", "f"], description: "Центр, высота, размер под ключ, угол поворота.", snippet: "HEXX ${1:C} ${2:0,0,0} ${3:100} ${4:1.806}" },
  { key: "HEXY", letter: "H", title: "HEX поворот 90°", paramCount: 4, paramNames: ["center", "H", "D", "f"], description: "Как HEXX, угол от OY.", snippet: "HEXY ${1:K} ${2:0,0,0} ${3:3} ${4:4}" },
  { key: "BOX", letter: "B", title: "Произвольный параллелепипед", paramCount: 12, paramNames: ["B", "P1", "P2", "P3"], description: "Параллелепипед: вершина B и три вектора рёбер P1, P2, P3 из этой вершины. Четыре тройки чисел (x,y,z).", snippet: "BOX ${1:B} ${2:0,0,0} ${3:1,0,0} ${4:0,1,0} ${5:0,0,1}" },
  { key: "PLG", letter: "d", title: "Полупространство", paramCount: 4, paramNames: ["nx", "ny", "nz", "Q"], description: "(n,x) >= Q.", snippet: "PLG ${1:1} ${2:0},${3:1},${4:0} ${5:0}" },
  { key: "PLX", letter: "X", title: "X >= X0", paramCount: 1, paramNames: ["X0"], description: "Полупространство X>=X0.", snippet: "PLX ${1:0}" },
  { key: "PLY", letter: "Y", title: "Y >= Y0", paramCount: 1, paramNames: ["Y0"], description: "Полупространство Y>=Y0.", snippet: "PLY ${1:0}" },
  { key: "PLZ", letter: "Z", title: "Z >= Z0", paramCount: 1, paramNames: ["Z0"], description: "Полупространство Z>=Z0.", snippet: "PLZ ${1:0}" },
  { key: "SBOX", letter: "X", title: "SBOX из начала координат", paramCount: 9, paramNames: ["P1", "P2", "P3"], description: "Параллелепипед с вершиной в начале координат. Три тройки чисел — векторы рёбер P1, P2, P3.", snippet: "SBOX ${1:S} ${2:10},0,0 ${3:5},5,0 ${4:0},0,3" },
  { key: "SHEX", letter: "I", title: "SHEX из начала", paramCount: 3, paramNames: ["S", "H", "f"], description: "Шестигранник, центр в 0, ось OZ.", snippet: "SHEX ${1:C} ${2:3} ${3:4} ${4:0}" },
  { key: "ARB", letter: "N", title: "Выпуклый многогранник", paramCount: "var", paramNames: ["vertices", "faces"], description: "До 8 вершин, грани после /.", snippet: "ARB ${1:1} ${2:-1,-1,0} ${3:1,-1,0} / ${4:1234}" },
  { key: "QUAD", letter: "Q", title: "Квадратичная форма", paramCount: 10, paramNames: ["coeffs"], description: "Неравенство квадратичной формы или / cx cy cz d.", snippet: "QUAD ${1:q} ${2:1} ${3:0} ${4:0} ${5:1} ${6:0} ${7:1} ${8:0} ${9:0} ${10:0} ${11:-1}" },
];

export const EXTENDED_CARDS: CardSchema[] = [
  {
    label: "SPNT",
    title: "Простой точечный источник",
    syntax: "SPNT X,Y,Z [ESET ...] [SPEC ...] [ENSO E] FINISH",
    description:
      "Точечный источник в координатах (см). Для k-eff достаточно простого источника.",
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
    description:
      "Первая карта раздела регистрации. n: 1 — нейтроны, 2 — фотоны, 3 — электроны (нумерация физического модуля).",
    fragment: "registration",
    example: "PTYPE 2",
  },
  {
    label: "TTYPE",
    title: "Способ оценки функционалов",
    syntax: "TTYPE n",
    description:
      "Оценка функционалов: 0 — по точкам столкновений (по умолч.), 1 — по длине пробега, 2 — по точкам поглощений.",
    fragment: "registration",
    example: "TTYPE 1",
  },
  {
    label: "ENERGY",
    title: "Энергетические группы регистрации",
    syntax: "ENERGY E1 E2 ...",
    description:
      "Нижние границы регистрационных групп (эВ); 0 задать явно. Верхняя граница последней группы — ∞. Список по возрастанию (0, E1, …) или по убыванию (…, 0). Без ENERGY регистрация в разделе не ведётся.",
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
    description:
      "Номера реакций физического модуля для скоростей в областях MRCT/ZRCT/ORCT. Понуклидный баланс по списку.",
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
    fragment: "trajectory",
    example: "NBATCH 3",
  },
  {
    label: "NTOT",
    title: "Общее число историй",
    syntax: "NTOT n",
    description:
      "Число частиц в поколении (историй на серию). Суммарно по варианту: NTOT × MAXSER историй.",
    fragment: "trajectory",
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
    description:
      "Компоненты вектора геометрического параметра B (баклинг) для асимптотической задачи утечки нейтронов. По умолчанию 0,0,0.",
    fragment: "registration",
    example: "BUCL 0.0 0.0 0.099126",
  },
  {
    label: "BMAX",
    title: "Лимит материалов для выгорания",
    syntax: "BMAX maxbur",
    description:
      "Подготовка сечений только для первых maxbur материалов (ускорение). Не сочетается с BURALL. При maxbur=0 и без BURALL модуль выгорания не работает.",
    fragment: "burnupRegistration",
    example: "BMAX 7",
  },
  {
    label: "BURALL",
    title: "Сечения для всех материалов",
    syntax: "BURALL",
    description:
      "Подготовка сечений и потоков для всех материалов (рекомендуемый режим модуля выгорания).",
    fragment: "burnupRegistration",
  },
  {
    label: "VOL",
    title: "Объёмы материалов",
    syntax: "VOL V1 V2 ... Vnmat",
    description:
      "Объёмы материалов (см³) по порядку номеров MATR. Допустимы в физическом модуле (§8.6) и в регистрации для выгорания (с BURALL/BMAX).",
    fragment: "physical",
    example: "VOL 0.45 0.17 0.76 0.02",
  },
  {
    label: "MAXS",
    title: "Максимальная серия",
    syntax: "MAXS maxser",
    description:
      "Номер серии, после которой счёт прекращается. Суммарно по варианту: NTOT × MAXSER историй (с учётом NSKI — число регистрируемых серий).",
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
    description:
      "Нижняя граница энергии нейтрона (эВ); траектории ниже прерываются. По умолчанию 0 эВ. Редактируется в процессе счёта.",
    fragment: "calculationControl",
    example: "ECUT 0.",
  },
  {
    label: "ECUP",
    title: "Отсечка энергии фотона",
    syntax: "ECUP e1",
    description:
      "Нижняя граница энергии фотона (эВ); траектории ниже прерываются. По умолчанию 10000 эВ. Редактируется в процессе счёта.",
    fragment: "calculationControl",
    example: "ECUP 100.",
  },
  {
    label: "ECEL",
    title: "Отсечка энергии электрона",
    syntax: "ECEL e1",
    description:
      "Нижняя граница энергии электрона (эВ); траектории ниже прерываются. По умолчанию 100 эВ. Редактируется в процессе счёта.",
    fragment: "calculationControl",
    example: "ECEL 10000",
  },
  {
    label: "ECPO",
    title: "Отсечка энергии позитрона",
    syntax: "ECPO e1",
    description:
      "Нижняя граница энергии позитрона (эВ); траектории ниже прерываются. Аналог ECEL для позитронов. По умолчанию 100 эВ. Редактируется в процессе счёта.",
    fragment: "calculationControl",
    example: "ECPO 10000",
  },
  {
    label: "CODE",
    title: "Опция модуля выгорания",
    syntax: "CODE option",
    description:
      "Режим BURN: RSTP (STEP), RFNL (FINAL), RDEL (DELAY), RFTB/RDTB (FINTAB/DELTAB), RFDN (FINDEN), RSOU (SOURCE), RSHR (SHORT). Обязательна.",
    fragment: "burnup",
    example: "CODE RSTP",
  },
  {
    label: "POWE",
    title: "Мощность (STEP)",
    syntax: "POWE q1 t1 q2 t2 ...",
    description:
      "Кусочно-постоянная суммарная мощность Q (кВт) от времени T (сут). Пары q, t — значение и верхняя граница интервала.",
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
    description:
      "Номера материалов, для которых на печать выводятся результаты изменения изотопного состава. Без строки — все материалы.",
    fragment: "burnup",
    example: "ZONPRI 1",
  },
  {
    label: "SUMZON",
    title: "Интегральные характеристики",
    syntax: "SUMZON list",
    description:
      "Печать интегральных характеристик: SUMB, ZONB, SUMS, ZONS, SUMR, ZONR, SUMG, ZONG.",
    fragment: "burnup",
    example: "SUMZON ZONB",
  },
  {
    label: "CONTEN",
    title: "Печать характеристик изотопов",
    syntax: "CONTEN list",
    description:
      "Печать по изотопам: DENS, SIGM, CURI, HEAT, HGAM, HBET, QUOT, SPNU. Пустой список — DENS.",
    fragment: "burnup",
    example: "CONTEN",
  },
];

export const MODS_VALUES = ["G", "T", "COHR", "H2OK", "CH2K", "ZRHK", "HYH", "D2OK", "BEOK"];

export const BOUNDARY_CODES = [
  { code: "B", title: "Чёрная граница (поглощение)" },
  { code: "W", title: "Белое отражение" },
  { code: "M", title: "Зеркальное отражение" },
  { code: "C", title: "Белое цилиндрическое отражение" },
  { code: "T", title: "Трансляционная симметрия" },
];

const HAND_CRAFTED_CARDS: CardSchema[] = [
  ...PIN_CARDS,
  ...PHYSICAL_EXTRA_CARDS,
  ...GEO_CARDS,
  ...EXTENDED_CARDS,
  ...SOURCE_CARDS,
  ...REGISTRATION_EXTRA_CARDS,
];

function buildAllCards(): CardSchema[] {
  const byLabel = new Map<string, CardSchema>();
  const put = (card: CardSchema, force = false) => {
    const u = card.label.toUpperCase();
    const prev = byLabel.get(u);
    const next = { ...card, label: u, title: card.title || u };
    if (!prev || force || card.description.length > prev.description.length) {
      byLabel.set(u, next);
    }
  };
  for (const raw of USER_GUIDE_CARDS as ReadonlyArray<CardSchema>) {
    put({ ...raw, title: raw.title || raw.label });
  }
  for (const raw of EXTRA_CARD_DESCRIPTIONS) {
    put({ ...raw, title: raw.title || raw.label }, true);
  }
  for (const card of HAND_CRAFTED_CARDS) put(card, true);
  for (const label of ALL_MCU_LABELS) {
    if (byLabel.has(label)) continue;
    const canon = normalizeMcuLabel(label);
    if (canon !== label && byLabel.has(canon)) {
      const base = byLabel.get(canon)!;
      put({ ...base, label });
    }
  }
  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export const ALL_CARDS: CardSchema[] = buildAllCards();

const FRAGMENT_TITLES: Record<string, string> = {
  physical: "физический модуль (PIN)",
  geometry: "геометрия (NCGSIM)",
  source: "источники",
  registration: "регистрация",
  burnupRegistration: "регистрация для выгорания",
  trajectory: "траектории",
  calculationControl: "управление счётом",
  burnup: "выгорание",
};

export function formatCardHover(card: CardSchema): string {
  const parts = [`**${card.title}**`, "", `\`${card.syntax}\``, "", card.description];
  if (card.fragment) {
    parts.push("", `*Фрагмент: ${FRAGMENT_TITLES[card.fragment] ?? card.fragment}*`);
  }
  if (card.defaults) parts.push("", `По умолчанию: ${card.defaults}`);
  if (card.example) parts.push("", "Пример:", "```", card.example, "```");
  return parts.join("\n");
}

export function formatBodyHover(body: BodyTypeSchema): string {
  const groups = getBodyParamGroups(body.key);
  const parts = [`**${body.title}** (\`${body.key}\`)`, "", body.description];
  const args = groups?.filter((g) => g.label !== "name");
  if (args?.length) {
    parts.push("", "Параметры (тройки x,y,z — через запятую или пробел):");
    for (const g of args) {
      parts.push(`- **${g.label}** — ${g.documentation}`);
    }
  } else if (body.paramNames.length) {
    parts.push("", `Параметры: ${body.paramNames.join(", ")}`);
  }
  if (body.key === "BOX") {
    parts.push("", "Пример:", "`BOX B 0,0,0 1,0,0 0,1,0 0,0,1`");
  }
  return parts.join("\n");
}

export function getCardByLabel(label: string): CardSchema | undefined {
  const u = label.toUpperCase();
  const canon = normalizeMcuLabel(u);
  const order = canon === u ? [u] : [canon, u];
  for (const key of order) {
    const card = ALL_CARDS.find((c) => c.label === key);
    if (card) return card;
  }
  return undefined;
}

export function getBodyByKey(key: string): BodyTypeSchema | undefined {
  return BODY_TYPES.find((b) => b.key === key.toUpperCase());
}

/**
 * Ключи геометрических тел (parser BODY_KEYS): схемы BODY_TYPES + редкие/legacy типы.
 * Единый список для парсера и UI-навигации.
 */
export const GEO_BODY_KEYS: ReadonlySet<string> = new Set([
  ...BODY_TYPES.map((b) => b.key),
  "ELL",
  "WED",
  "UCX",
  "UCY",
  "UCZ",
  "SLA",
  "SLB",
  "REC",
  "TRC",
  "HEXG",
  "TRANSF",
  "UPOLY",
]);

export function isGeoBodyLabel(label: string): boolean {
  return GEO_BODY_KEYS.has(label.toUpperCase());
}

export {
  ALL_MCU_LABELS,
  MCU_LABEL_ALIASES,
  MCU_LABELS_BY_FRAGMENT,
  detectFragmentFromLabel,
  fragmentsForLabel,
  isKnownMcuLabel,
  labelAllowedInFragment,
  listAllMcuLabels,
  normalizeMcuLabel,
} from "./keywords";
export {
  CARD_ARG_SPECS,
  getCardArgSpec,
  parseCardArgContext,
  type CardArgContext,
  type CardArgEnumValue,
  type CardArgSpec,
} from "./cardArgEnums";
export { BODY_PARAM_GROUPS, getBodyParamGroups, type BodyParamGroup } from "./bodyParamGroups";
export {
  CARD_LINE_PARAM_GROUPS,
  getCardLineParamGroups,
  parseSyntaxRequiredPart,
} from "./cardLineParamGroups";
export {
  NUCLIDE_LINE_PARAM_GROUPS,
  getNuclideLineParamGroups,
  type NuclideLineParamHint,
} from "./nuclideLineParamGroups";
export {
  buildCatalogPayload,
  CARD_SNIPPETS,
  FRAGMENT_DISPLAY,
  getCardInsertText,
  MODULE_TEMPLATES,
  padBurnupLabel,
  type CatalogCardGroup,
  type CatalogCardItem,
  type CatalogModulePayload,
  type InsertFormat,
} from "./catalog";
