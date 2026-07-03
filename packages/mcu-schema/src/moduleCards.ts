type FragmentId =
  | "physical"
  | "geometry"
  | "source"
  | "registration"
  | "burnupRegistration"
  | "trajectory"
  | "calculationControl"
  | "burnup";

interface ModuleCardSchema {
  label: string;
  title: string;
  syntax: string;
  description: string;
  defaults?: string;
  example?: string;
  fragment?: FragmentId;
}

/** Карты модуля источников (UserGuide §10.2). */
export const SOURCE_CARDS: ModuleCardSchema[] = [
  {
    label: "NPS",
    title: "Число примитивных источников",
    syntax: "NPS Ns [BIAS M]",
    description: "Число примитивных источников в сложном источнике (SRCD).",
    fragment: "source",
    example: "NPS 2",
  },
  {
    label: "PROB",
    title: "Веса примитивных источников",
    syntax: "PROB w1 w2 ...",
    description: "Веса вероятностей срабатывания примитивных источников (длина Ns или 2Ns при BIAS).",
    fragment: "source",
    example: "PROB 1 2.61",
  },
  {
    label: "ANGLEN",
    title: "Заголовок спектра",
    syntax: "ANGLEN name [NO|MTOE|ETOM|FUNC] [L]",
    description:
      "Имя спектра (≤4 символа) и зависимость E/μ: NO, MTOE, ETOM, FUNC; L — линейный переход.",
    fragment: "source",
    example: "ANGLEN elRh NO",
  },
  {
    label: "MDIS",
    title: "Распределение μ",
    syntax: "MDIS type [n] [BIAS M]",
    description: "Тип распределения косинуса угла: D — дискретное, L — линейное, S — изотропное.",
    fragment: "source",
    example: "MDIS S",
  },
  {
    label: "EDIS",
    title: "Распределение энергии",
    syntax: "EDIS type [n] [BIAS M]",
    description: "Тип распределения энергии E: D, L, S (стандартный спектр), …",
    fragment: "source",
    example: "EDIS D 59",
  },
  {
    label: "EMES",
    title: "Узлы энергии / μ",
    syntax: "EMES E1 E2 ...",
    description: "Узлы дискретного или кусочного распределения энергии (или μ для MTOE/ETOM).",
    fragment: "source",
  },
  {
    label: "EPRO",
    title: "Вероятности спектра",
    syntax: "EPRO p1 p2 ...",
    description: "Вероятности для узлов EMES (матрица при зависимости E↔μ).",
    fragment: "source",
  },
  {
    label: "TYPE",
    title: "Тип частицы источника",
    syntax: "TYPE kind",
    description: "Тип частицы примитива: N — нейтроны, PH — фотоны, EL — электроны, PO — позитроны.",
    fragment: "source",
    example: "TYPE EL",
  },
  {
    label: "RCZD",
    title: "Цилиндрический контейнер источника",
    syntax: "RCZD x0 y0 z0 Nh Nr ...",
    description:
      "Контейнер с внутренним распределением вероятности рождения; доп. HGRI/HPC, RGRI/RPC.",
    fragment: "source",
    example: "RCZD 0 0 0 -1 -1",
  },
  {
    label: "REPER",
    title: "Реперный вектор источника",
    syntax: "REPER nx ny nz",
    description: "Направление реперного вектора для углового распределения μ.",
    fragment: "source",
    example: "REPER 1 0 0",
  },
  {
    label: "SNAM",
    title: "Имя спектра",
    syntax: "SNAM name",
    description: "Ссылка на спектр, заданный картой ANGLEN.",
    fragment: "source",
    example: "SNAM elRh",
  },
  {
    label: "NOBJ",
    title: "Объектный номер источника",
    syntax: "NOBJ n",
    description: "Регистрационный объект для источника (0 — по умолчанию).",
    fragment: "source",
    example: "NOBJ 0",
  },
  {
    label: "HGRI",
    title: "Сетка RCZD по высоте",
    syntax: "HGRI h1 h2 ...",
    description: "Узлы разбиения по высоте для контейнера RCZD.",
    fragment: "source",
    example: "HGRI 0",
  },
  {
    label: "HPC",
    title: "Вероятности по высоте RCZD",
    syntax: "HPC p1 p2 ...",
    description: "Вероятности рождения по слоям высоты (RCZD + HGRI).",
    fragment: "source",
    example: "HPC 1,1",
  },
  {
    label: "RGRI",
    title: "Сетка RCZD по радиусу",
    syntax: "RGRI r1 r2 ...",
    description: "Узлы разбиения по радиусу для контейнера RCZD.",
    fragment: "source",
    example: "RGRI 0",
  },
  {
    label: "RPC",
    title: "Вероятности по радиусу RCZD",
    syntax: "RPC p1 p2 ...",
    description: "Вероятности рождения по радиальным слоям (RCZD + RGRI).",
    fragment: "source",
    example: "RPC 1 1",
  },
];

/** Дополнительные карты регистрации (энергетические группы по зонам). */
export const REGISTRATION_EXTRA_CARDS: ModuleCardSchema[] = [
  {
    label: "ZELEN",
    title: "Зоны: энергетические группы",
    syntax: "ZELEN list",
    description: "Номера регистрационных зон для энергетической регистрации (аналог MELEN/OELEN).",
    fragment: "registration",
    example: "ZELEN 1 2 3 4 5 6",
  },
  {
    label: "ZELCH",
    title: "Зоны: зарядовые состояния (электроны)",
    syntax: "ZELCH list",
    description: "Регистрационные зоны для учёта зарядовых состояний электронов.",
    fragment: "registration",
    example: "ZELCH 1 2 3 4 5 6",
  },
  {
    label: "ZPHEN",
    title: "Зоны: энергии фотонов",
    syntax: "ZPHEN list",
    description: "Номера зон для регистрации по энергиям фотонов.",
    fragment: "registration",
    example: "ZPHEN 1 2 3 4 5 6",
  },
  {
    label: "ZPOEN",
    title: "Зоны: позитроны (энергии)",
    syntax: "ZPOEN list",
    description: "Регистрационные зоны для энергетической регистрации позитронов.",
    fragment: "registration",
    example: "ZPOEN 1 2 3 4 5 6",
  },
  {
    label: "ZPOCH",
    title: "Зоны: позитроны (заряды)",
    syntax: "ZPOCH list",
    description: "Регистрационные зоны для зарядовых состояний позитронов.",
    fragment: "registration",
    example: "ZPOCH 1 2 3 4 5 6",
  },
];

/** Карты физического модуля (дополнение к PIN_CARDS). */
export const PHYSICAL_EXTRA_CARDS: ModuleCardSchema[] = [
  {
    label: "ELEC",
    title: "Моделирование электронов",
    syntax: "ELEC val",
    description: "val=1 — моделировать электроны, 0 — нет.",
    fragment: "physical",
    example: "ELEC 1",
  },
  {
    label: "EGEL",
    title: "Границы энергий электронов",
    syntax: "EGEL Emax Emin",
    description: "Верхняя и нижняя границы энергии электронов (эВ).",
    fragment: "physical",
    example: "EGEL 7.0E6 1.0E4",
  },
];
