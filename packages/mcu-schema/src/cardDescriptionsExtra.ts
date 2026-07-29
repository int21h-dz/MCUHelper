type FragmentId =
  | "physical"
  | "geometry"
  | "source"
  | "registration"
  | "burnupRegistration"
  | "trajectory"
  | "calculationControl"
  | "burnup";

interface ExtraCard {
  label: string;
  title: string;
  syntax: string;
  description: string;
  defaults?: string;
  example?: string;
  fragment?: FragmentId;
}

/** Ручные описания карт, которые плохо извлекаются из TXT (§10–15 UserGuide). */
export const EXTRA_CARD_DESCRIPTIONS: ExtraCard[] = [
  // --- PIN ---
  {
    label: "SI",
    title: "Список нуклидов для печати сечений",
    syntax: "SI list",
    description:
      "Номера или имена нуклидов для печати сечений. Если заданы и SI, и SINOT, используется объединение списков.",
    fragment: "physical",
  },
  {
    label: "SINOT",
    title: "Список нуклидов (альтернатива SI)",
    syntax: "SINOT list",
    description: "Список нуклидов для печати сечений; объединяется со списком SI при одновременном задании.",
    fragment: "physical",
  },
  {
    label: "SIDEN",
    title: "Порог печати сечений",
    syntax: "SIDEN value",
    description:
      "Сечения с вкладом ниже порога не печатаются. Работает независимо от SI/SINOT.",
    fragment: "physical",
  },
  {
    label: "CPM",
    title: "Начало блока размножения материалов",
    syntax: "CPM n",
    description:
      "Начинает блок размножения материалов с шагом n по номеру MATR. Закрывается CPMEND.",
    fragment: "physical",
  },
  {
    label: "CPMEND",
    title: "Конец блока CPM",
    syntax: "CPMEND",
    description: "Окончание блока размножения материалов, открытого картой CPM.",
    fragment: "physical",
  },
  {
    label: "SHOW",
    title: "Директива печати (C= SHOW)",
    syntax: "C= SHOW",
    description:
      "Печатает последние значения параметров вместо накопленных. Задаётся комментарием `C=` в колонках 1-2.",
    fragment: "physical",
  },
  // --- Geometry: накопление источника (не в UserGuide 220519) ---
  {
    label: "LFIXSO",
    title: "Поверхность накопления источника",
    syntax: "LFIXSO <пары объектных номеров>",
    description:
      "Опция расчёта с накоплением источника и с накопленным источником. <список> — пары различных неотрицательных чисел (запятая или пробел); внутри списка пары различны. Каждая пара задаёт поверхность из кусков границ зон: с одной стороны зона с одним объектным номером пары, с другой — с другим. На 1-м этапе — только LFIXSO; на промежуточных — LFIXSO и LBLACK; на последнем — только LBLACK.",
    example: "LFIXSO 2,1",
    fragment: "geometry",
  },
  {
    label: "LBLACK",
    title: "Поверхность поглощения",
    syntax: "LBLACK <пары объектных номеров>",
    description:
      "Опция расчёта с накоплением источника и с накопленным источником. Формат списка как у LFIXSO: пары объектных номеров зон, задающие поверхность поглощения на границах зон. На последнем этапе — только LBLACK; на промежуточных — вместе с LFIXSO.",
    example: "LBLACK 0,1  1,2",
    fragment: "geometry",
  },
  {
    label: "ICE",
    title: "Разложение элементов на изотопы",
    syntax: "ICE list",
    description:
      "Список элементов, которые автоматически раскладываются на изотопы по библиотечным данным.",
    fragment: "physical",
  },
  {
    label: "ICENOT",
    title: "Исключения из разложения ICE",
    syntax: "ICENOT list",
    description: "Элементы, для которых разложение ICE не выполняется (остаются как ICENOT AAAA).",
    fragment: "physical",
  },
  {
    label: "DELN",
    title: "Режим запаздывающих нейтронов",
    syntax: "DELN valdeln",
    description:
      "Управляющий параметр физического модуля (§8.6 UserGuide): режим расчёта запаздывающих нейтронов. valdeln=0 — без разделения на мгновенные и запаздывающие, энергия всех нейтронов разыгрывается по спектру мгновенных. valdeln=1 — разделение включено, энергия запаздывающих нейтронов — по спектру запаздывающих. Целое число.",
    defaults: "valdeln=0",
    fragment: "physical",
  },
  // --- Источники (SPNT / сложный) ---
  {
    label: "ENSO",
    title: "Моноэнергетический SPNT",
    syntax: "ENSO E",
    description:
      "Энергия (эВ) дельта-спектра простого точечного источника SPNT. Несовместима с ESET и SPEC.",
    fragment: "source",
  },
  {
    label: "ESET",
    title: "Границы энергий SPNT",
    syntax: "ESET E1 E2 … E27",
    description:
      "27 границ энергетических интервалов (эВ, по убыванию) для SPNT; частицы рождаются в серединах интервалов. Альтернатива SPEC/ENSO.",
    fragment: "source",
  },
  {
    label: "SPEC",
    title: "Веса интервалов SPNT",
    syntax: "SPEC p1 p2 … p26",
    description:
      "Ненормированные веса 26 энергетических интервалов SPNT в паре с ESET. По умолчанию используется спектр деления 235U.",
    fragment: "source",
  },
  {
    label: "MMES",
    title: "Узлы μ (сложный источник)",
    syntax: "MMES μ1 μ2 …",
    description: "Узлы дискретного/кусочного распределения по косинусу угла μ (аналог EMES для угла).",
    fragment: "source",
  },
  {
    label: "MPRO",
    title: "Вероятности по μ",
    syntax: "MPRO p1 p2 …",
    description: "Вероятности для узлов MMES (пара к MPRO при зависимости E↔μ).",
    fragment: "source",
  },
  {
    label: "LOBJ",
    title: "Объекты источника",
    syntax: "LOBJ n1 n2 …",
    description: "Регистрационные объектные номера, связанные с примитивами сложного источника.",
    fragment: "source",
  },
  {
    label: "WOBJ",
    title: "Веса по объектам источника",
    syntax: "WOBJ w1 w2 …",
    description: "Веса/вероятности для объектных номеров LOBJ.",
    fragment: "source",
  },
  {
    label: "ELEM",
    title: "Элемент сложного источника",
    syntax: "ELEM name TYPE",
    description:
      "Именованный элемент источника и тип частицы (N, PH, EL, PO). Используется вместе с ROOT, BOUN и NORM.",
    fragment: "source",
  },
  {
    label: "NORM",
    title: "Нормализация источника",
    syntax: "NORM ON|OFF",
    description: "Включение/выключение нормализации суммарной интенсивности сложного источника.",
    fragment: "source",
  },
  {
    label: "ROOT",
    title: "Корневая система координат источника",
    syntax: "ROOT ox,oy,oz ex,ey,ez ux,uy,uz",
    description: "Три вектора: начало, ось X и ось Y локальной системы координат элемента источника.",
    fragment: "source",
  },
  {
    label: "BOUN",
    title: "Границы элемента источника",
    syntax: "BOUN mi,ni mj,nj",
    description:
      "Прямоугольные границы в локальных координатах элемента (пары mi,ni и mj,nj) для распределения рождения.",
    fragment: "source",
  },
  {
    label: "PRISOU",
    title: "Печать внутренних массивов источника",
    syntax: "PRISOU",
    description: "Включает отладочную печать внутренних массивов модуля источников в выходной файл.",
    fragment: "source",
  },
  // --- Геометрия NET ---
  {
    label: "V01",
    title: "Картограмма типов NET (V)",
    syntax: "V01 v1 v2 …",
    description:
      "Строка картограммы сети NET: типы ячеек по вершинам (V — vertex). Аналог T01/P01/O01/G01.",
    fragment: "geometry",
  },
  // --- Регистрация ---
  {
    label: "ENERG",
    title: "Энергетические группы (синоним ENERGY)",
    syntax: "ENERG E1 E2 …",
    description: "Нижние границы регистрационных групп (эВ); синоним карты ENERGY.",
    fragment: "registration",
  },
  {
    label: "NREG",
    title: "Число регистраторов",
    syntax: "NREG n",
    description: "Количество разделов детальной регистрации типа N в фрагменте RGS.",
    fragment: "registration",
  },
  {
    label: "REACT",
    title: "Номера реакций (регистрация)",
    syntax: "REACT list",
    description: "Список номеров реакций для регистрации скоростей (см. также RCT).",
    fragment: "registration",
  },
  {
    label: "NUCOFF",
    title: "Отключение регистрации по нуклидам",
    syntax: "NUCOFF",
    description:
      "При наличии этой карты регистрация скоростей реакций для нуклидов в отдельности не производится.",
    fragment: "registration",
  },
  {
    label: "URBMK",
    title: "Пользовательский ввод (RBMK / site-specific)",
    syntax: "URBMK filename",
    description:
      "Кастомная карта (есть не во всех сборках MCU): подключение пользовательского файла ввода. Имя файла — 2-й параметр (например `userf`). При отсутствии файла MCU пишет в LST `USER input file not exist`.",
    fragment: "registration",
  },
  // --- Траектории / CALD неаналог ---
  {
    label: "WTOB",
    title: "Веса по регистрационным объектам",
    syntax: "WTOB w1 w2 …",
    description:
      "Множители веса wi для вторичных частиц, рождённых в регистрационном объекте i; wi=0 — частицы не моделируются.",
    fragment: "trajectory",
  },
  {
    label: "NSKIP",
    title: "Число отбрасываемых серий (синоним NSKI)",
    syntax: "NSKIP n",
    description:
      "Количество первых серий, не попадающих в статистику (в ряде вариантов MCU встречается как NSKIP вместо NSKI).",
    fragment: "trajectory",
  },
  {
    label: "WWEN",
    title: "Границы энергетических отрезков (split/roulette)",
    syntax: "WWEN E1 E2 …",
    description:
      "Упорядоченные по возрастанию границы отрезков по энергии (эВ) для неаналогового моделирования; левая граница первого — 0.",
    fragment: "calculationControl",
  },
  {
    label: "INPE",
    title: "Ценности по энергии",
    syntax: "INPE V1 V2 …",
    description: "Ценности Vi для энергетических отрезков WWEN (расщепление/рулетка).",
    fragment: "calculationControl",
  },
  {
    label: "INPO",
    title: "Ценности по объектам",
    syntax: "INPO V1 V2 …",
    description: "Ценности для регистрационных объектов; недостающие позиции заполняются единицами.",
    fragment: "calculationControl",
  },
  {
    label: "XYZ0",
    title: "Центр весового окна",
    syntax: "XYZ0 x y z | XYZ0 x y",
    description:
      "Центр сферической (3 числа) или ось цилиндрической (2 числа) системы для весового окна по геометрии.",
    fragment: "calculationControl",
  },
  {
    label: "RADS",
    title: "Радиусы слоёв весового окна",
    syntax: "RADS r1 r2 …",
    description: "Возрастающие радиусы слоёв r1<r2<… для разбиения пространства весового окна.",
    fragment: "calculationControl",
  },
  {
    label: "INPM",
    title: "Ценности VE по радиусу и энергии",
    syntax: "INPM …",
    description: "Матрица NR×NE ценностей VEij (по строкам) для весового окна; NR — число слоёв RADS, NE — WWEN.",
    fragment: "calculationControl",
  },
  {
    label: "SANG",
    title: "Разбиение по углу (косинусы)",
    syntax: "SANG s1 s2 …",
    description: "Границы -1<s1<s2<…<1 по косинусу угла для угловой зависимости весового окна.",
    fragment: "calculationControl",
  },
  {
    label: "INRA",
    title: "Ценности по радиусу и углу",
    syntax: "INRA …",
    description: "Матрица NR×NA ценностей VA для углового разбиения SANG (опционально).",
    fragment: "calculationControl",
  },
  {
    label: "SETT",
    title: "Тип частицы для неаналогового блока",
    syntax: "SETT N|PH|EL|PO",
    description:
      "К какому типу частиц относятся следующие карты неаналогового моделирования (N/PH/EL/PO). По умолчанию N.",
    fragment: "calculationControl",
  },
  {
    label: "SERIES",
    title: "Параметры серии расчёта",
    syntax: "SERIES …",
    description: "Управление сериями в шаге CALCULATION (фрагмент CALD, файл NAME.DAT).",
    fragment: "calculationControl",
  },
  // --- Выгорание: CODE-опции и вспомогательные ---
  {
    label: "FINAL",
    title: "Опция FINAL (постобработка STEP)",
    syntax: "FINAL + TIMP …",
    description:
      "Интерполяция концентраций и сечений в дополнительных временных точках; результат в VAR.FNL. Многократные вызовы.",
    fragment: "burnup",
  },
  {
    label: "DELAY",
    title: "Опция DELAY (выдержка)",
    syntax: "DELAY + TIMP/TSEC/…",
    description:
      "Расчёт эволюции изотопов после остановки реактора. Вход: VAR.FNL; результат VAR.DLT.",
    fragment: "burnup",
  },
  {
    label: "FINTAB",
    title: "Опция FINTAB (печать STEP/FINAL)",
    syntax: "FINTAB + ZONP SUMZ CONTEN …",
    description:
      "Постобработка и печать интегральных характеристик, концентраций и сечений после STEP/FINAL.",
    fragment: "burnup",
  },
  {
    label: "DELTAB",
    title: "Опция DELTAB (печать DELAY)",
    syntax: "DELTAB + …",
    description: "Печать результатов опции DELAY; выводит все характеристики, кроме SIGM.",
    fragment: "burnup",
  },
  {
    label: "FINDEN",
    title: "Опция FINDEN (энерговыделение)",
    syntax: "FINDEN + …",
    description: "Расчёт и печать данных об энерговыделении и связанных характеристиках выгорания.",
    fragment: "burnup",
  },
  {
    label: "SOURCE",
    title: "Опция SOURCE (источник запаздывания)",
    syntax: "SOURCE + …",
    description: "Задание параметров источника для расчёта запаздывающих нуклидов после DELAY.",
    fragment: "burnup",
  },
  {
    label: "SHORT",
    title: "Опция SHORT (краткая печать)",
    syntax: "SHORT + …",
    description: "Сокращённый формат печати результатов выгорания.",
    fragment: "burnup",
  },
  {
    label: "FLUX",
    title: "Нормировка на поток",
    syntax: "FLUX f1 t1 f2 t2 …",
    description:
      "Задание потока нейтронов как функции времени (альтернатива POWE/DPOW для нормировки выгорания).",
    fragment: "burnup",
  },
  {
    label: "DPOW",
    title: "Мощность (производная)",
    syntax: "DPOW q1 t1 q2 t2 …",
    description: "Кусочно-заданная мощность Q(кВт) от времени T (сут); взаимоисключающа с POWE.",
    fragment: "burnup",
  },
  {
    label: "DSTP",
    title: "Шаги по длинам интервалов",
    syntax: "DSTP t1 n1 t2 n2 …",
    description:
      "Ступени STEP: t — длина интервала (сут), n — число шагов на интервале. Взаимоисключающа с STEP.",
    fragment: "burnup",
  },
  {
    label: "COLI",
    title: "Способ интерполяции",
    syntax: "COLI q1 t1 q2 t2 …",
    description:
      "Кусочно-линейная (0) или постоянная (1) интерполяция мощности и сечений между узлами STEP.",
    fragment: "burnup",
  },
  {
    label: "SIZI",
    title: "Упорядочение при печати",
    syntax: "SIZI [eps] [t]",
    description: "Сортировка изотопов по убыванию концентрации (eps — порог, t — тип величины).",
    fragment: "burnup",
  },
  {
    label: "TIMP",
    title: "Временные точки (FINAL/DELAY)",
    syntax: "TIMP t1 n1 t2 n2 …",
    description: "Дополнительные временные точки; формат как STEP. Обязательна для FINAL.",
    fragment: "burnup",
  },
  {
    label: "TSEC",
    title: "Времена выдержки (секунды)",
    syntax: "TSEC t1 n1 …",
    description: "Времена после остановки для DELAY в секундах.",
    fragment: "burnup",
  },
  {
    label: "TMIN",
    title: "Времена выдержки (минуты)",
    syntax: "TMIN t1 n1 …",
    description: "Времена после остановки для DELAY в минутах.",
    fragment: "burnup",
  },
  {
    label: "THOU",
    title: "Времена выдержки (часы)",
    syntax: "THOU t1 n1 …",
    description: "Времена после остановки для DELAY в часах.",
    fragment: "burnup",
  },
  {
    label: "TDAY",
    title: "Времена выдержки (сутки)",
    syntax: "TDAY t1 n1 …",
    description: "Времена после остановки для DELAY в сутках.",
    fragment: "burnup",
  },
  {
    label: "TYEA",
    title: "Времена выдержки (годы)",
    syntax: "TYEA t1 n1 …",
    description: "Времена после остановки для DELAY в годах.",
    fragment: "burnup",
  },
];
