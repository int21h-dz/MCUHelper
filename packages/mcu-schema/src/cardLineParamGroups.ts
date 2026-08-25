export interface CardLineParamHint {
  label: string;
  documentation: string;
}

/** Параметры на одной строке карты (без хвостов в [скобках] и без FINISH). */
export const CARD_LINE_PARAM_GROUPS: Record<string, CardLineParamHint[]> = {
  SPNT: [{ label: "x,y,z", documentation: "Координаты точечного источника (см)" }],
  SRCD: [
    { label: "print", documentation: "Печать карт (0/1), опционально" },
    { label: "debug", documentation: "Отладочная печать (0–5), опционально" },
  ],
  SRC: [
    { label: "print", documentation: "Печать карт (0/1), опционально" },
    { label: "debug", documentation: "Отладочная печать (0–5), опционально" },
  ],
  RGS: [
    { label: "print", documentation: "Печать карт (0/1), опционально" },
    { label: "debug", documentation: "Отладочная печать (0–5), опционально" },
  ],
  REGD: [
    { label: "print", documentation: "Печать карт (0/1), опционально" },
    { label: "debug", documentation: "Отладочная печать (0–5), опционально" },
  ],
  PIN: [
    { label: "print", documentation: "Печать карт (0/1)" },
    { label: "debug", documentation: "Отладочная печать (0–5)" },
  ],
  HEAD: [
    { label: "print", documentation: "Печать карт (0/1)" },
    { label: "trace", documentation: "Трассировка (0/1)" },
    { label: "listSize", documentation: "Размер списка" },
  ],
  CONT: [
    {
      label: "BC…",
      documentation:
        "Граничные условия по граням контейнера (B|W|M|C|T; W/M/C с вероятностью в () или []). Число = число граней первого тела.",
    },
    {
      label: "[Sα [rot]]",
      documentation: "Угол зеркальной симметрии 180|90|60|45|30; опциональный поворот вокруг OZ (градусы).",
    },
    {
      label: "[PRSα [rot]]",
      documentation: "Парные плоскости симметрии относительно OXZ; угол к OX; опциональный поворот.",
    },
  ],
  CNTAND: [
    {
      label: "[0|1]",
      documentation: "1 — пересечение всех зон с контейнером (по умолчанию); 0 — выкл. Ставить перед CONT.",
    },
  ],
  MATR: [
    { label: "number", documentation: "Номер материала (целое, произвольный)" },
    { label: "T=…", documentation: "Температура материала, K (≥ 0; по умолчанию 300)" },
    {
      label: "GROUP=имя",
      documentation:
        "Произвольное символьное имя группы (напр. fuel, MOD, clad). Материалы с одной GROUP задаются в геометрии по имени группы; номер MATR внутри группы — внутренний.",
    },
    {
      label: "NAME=MCU|ZA|lib",
      documentation:
        "MCU|ZA — формат имён нуклидов; иначе имя файла .DBM (≤6 символов) в корне MDBNR (§8.11), состав — одно кодовое имя",
    },
    { label: "DENSAA=…", documentation: "Ядерная плотность материала, режим атомных долей (яд/см³)" },
    { label: "DENSWA=…", documentation: "Плотность материала, г/см³, режим атомных долей" },
    { label: "DENSAW=…", documentation: "Ядерная плотность, режим весовых долей" },
    { label: "DENSWW=…", documentation: "Плотность, г/см³, режим весовых долей" },
    { label: "VOL=…", documentation: "Объём материала, см³" },
    { label: "BUR=…", documentation: "Параметры выгорания материала" },
  ],
  TEMPR: [{ label: "T", documentation: "Температура системы (K)" }],
  PTYPE: [{ label: "n", documentation: "Тип регистрации потоков" }],
  TTYPE: [{ label: "n", documentation: "Тип регистрации времени" }],
  NRET: [
    { label: "number", documentation: "Номер регистратора" },
    { label: "DOWN|UP", documentation: "Направление, опционально" },
  ],
  SI: [
    {
      label: "list",
      documentation: "Список нуклидов, входящих в суммарный изотоп (UserGuide §8.5)",
    },
  ],
  SINOT: [
    {
      label: "list",
      documentation:
        "Список нуклидов, не входящих в суммарный изотоп; остальные входят (UserGuide §8.5)",
    },
  ],
  SIDEN: [
    {
      label: "value",
      documentation:
        "Порог ядерной плотности: нуклиды с плотностью меньше value входят в суммарный изотоп (UserGuide §8.5)",
    },
  ],
  ICE: [
    {
      label: "list",
      documentation: "Список элементов, подлежащих разложению на изотопы (UserGuide §8.7)",
    },
  ],
  ICENOT: [
    {
      label: "list",
      documentation:
        "Список элементов, не подлежащих разложению на изотопы; пустой список / AAAA — разложение отключено (UserGuide §8.7)",
    },
  ],
};

export function getCardLineParamGroups(cardLabel: string): CardLineParamHint[] | undefined {
  return CARD_LINE_PARAM_GROUPS[cardLabel.toUpperCase()];
}

/** Обязательная часть syntax до первой `[…]`. */
export function parseSyntaxRequiredPart(syntax: string): string[] {
  const rest = syntax.replace(/^\S+\s*/, "");
  const beforeOptional = rest.split(/\[/)[0]?.trim() ?? "";
  if (!beforeOptional) return [];
  return beforeOptional.split(/\s+/).filter(Boolean);
}
