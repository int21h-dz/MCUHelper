export interface NuclideLineParamHint {
  label: string;
  documentation: string;
}

/** Параметры одной записи нуклида в MATR (UserGuide §8.2). */
export const NUCLIDE_LINE_PARAM_GROUPS: NuclideLineParamHint[] = [
  { label: "name", documentation: "Имя нуклида в формате MCU (DEFAULT.PHY)" },
  {
    label: "dens",
    documentation:
      "Ядерная концентрация, яд/см³ (без множителя 10²⁴); при DENSAA/DENSWA — атомная доля; при DENSAW/DENSWW — весовая доля",
  },
  { label: "ACE=ace", documentation: "Файл оценённых ядерных данных ACE/MCU (опционально)" },
  {
    label: "MODS=mods",
    documentation:
      "Модель рассеяния в области термализации (опционально): G, T, COHR, H2OK, CH2K, ZRHK, HYH, D2OK, BEOK",
  },
  { label: "DTEM=dtem", documentation: "Допуск по температуре при поиске в VESTA2, K (опционально)" },
  { label: "PHT=pht", documentation: "Файл библиотеки GAMTRA для подмодуля GTR (опционально)" },
];

export function getNuclideLineParamGroups(): NuclideLineParamHint[] {
  return NUCLIDE_LINE_PARAM_GROUPS;
}
