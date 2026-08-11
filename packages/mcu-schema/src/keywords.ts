type FragmentId =
  | "physical"
  | "geometry"
  | "source"
  | "registration"
  | "burnupRegistration"
  | "trajectory"
  | "calculationControl"
  | "burnup";

/**
 * Канонические имена карт MCU-NR по фрагментам (UserGuide 220519 + RUNTEST).
 * `shared` — только универсальные маркеры (FINISH/END/STOP/SHOW).
 * EQU/SET — только геометрия и источники (UserGuide §A: «В геометрическом модуле и
 * модуле источников…»); в физическом модуле (PIN) недопустимы.
 * Метки в нескольких модулях (VOL, BUCL, WWEN, …) перечисляются в каждом списке явно.
 */
export const MCU_LABELS_BY_FRAGMENT: Record<FragmentId | "shared", readonly string[]> = {
  shared: ["FINISH", "END", "STOP", "SHOW"],
  physical: [
    "PIN",
    "MATR",
    "DEF",
    "TEMPR",
    "NEUT",
    "DELN",
    "EGRC",
    "SINOT",
    "SIDEN",
    // ⚠ АГЕНТАМ: метка карты SI list (суммарный изотоп). Омоним с нуклидом кремния
    // `SI dens` в MATR — см. mcu-language/siCardVsNuclide.ts и TextMate dens-lookahead.
    // Не путать отображение карты и кремния; SI в каталоге карт оставлять.
    "SI",
    "ICE",
    "ICENOT",
    "CPM",
    "CPMEND",
    "PSIN",
    "PSGR",
    "MATFIL",
    "MATPRN",
    "SIPRN",
    "DEFPRN",
    "MATWGT",
    "MATREP",
    "ACEPT",
    "ACERR",
    "PHOT",
    "WPHO",
    "IWPHN",
    "EGPH",
    "ELEC",
    "EGEL",
    "VOL",
  ],
  geometry: [
    "HEAD",
    "CONT",
    "MIR",
    "CNTAND",
    "CELL",
    "NET",
    "LCELL",
    "LATT",
    "LISTEL",
    "PARM",
    "LFIXSO",
    "LBLACK",
    "V01",
    "ENDL",
    "ENDXCL",
    "TRANSF",
    "EQU",
    "SET",
  ],
  source: [
    "SRCD",
    "SRC",
    "SPNT",
    "TYPE",
    "ENSO",
    "ESET",
    "SPEC",
    "NPS",
    "PROB",
    "ANGLEN",
    "MDIS",
    "EDIS",
    "MMES",
    "MPRO",
    "EMES",
    "EPRO",
    "SNAM",
    "REPER",
    "NOBJ",
    "LOBJ",
    "WOBJ",
    "ELEM",
    "HGRI",
    "HPC",
    "RGRI",
    "RPC",
    "RCZD",
    "PRISOU",
    "BOUN",
    "ROOT",
    "NORM",
    "FUNC",
    "EQU",
    "SET",
  ],
  registration: [
    "REGD",
    "REG",
    "RGS",
    "KEFF",
    "LIFE",
    "BAL",
    "MOM4",
    "BUCL",
    "BCRIT",
    "EABS",
    "MNEN",
    "ZNEN",
    "ONEN",
    "MPHEN",
    "ZPHEN",
    "OPHEN",
    "MELEN",
    "ZELEN",
    "OELEN",
    "NUCOFF",
    "PERC",
    "FIXED",
    "NRET",
    "NREG",
    "PTYPE",
    "TTYPE",
    "MSMT",
    "OSMT",
    "ENERG",
    "ENERGY",
    "SPECTR",
    "SFLUX",
    "DPNT",
    "DRING",
    "NENRG",
    "NFUNC",
    "PENRG",
    "PFUNC",
    "DOS",
    "MDOS",
    "ZDOS",
    "ODOS",
    "MCUR",
    "ZCUR",
    "OCUR",
    "MFLU",
    "ZFLU",
    "OFLU",
    "MRCT",
    "ZRCT",
    "ORCT",
    "RCT",
    "REACT",
    "GROU",
    "GRBL",
    "GRBU",
    "GRIN",
    "GZAZI",
    "GZAZO",
    "CNTU",
    "CROD",
    "ZELCH",
    "ZPOCH",
    "ZPOEN",
    "ZSMT",
    "ZRTB",
    "URBMK",
  ],
  burnupRegistration: ["BRGD", "BRG", "BURALL", "BMAX", "BUCL", "VOL"],
  trajectory: [
    "TRJD",
    "TRJ",
    "ISTR",
    "NTOT",
    "NBAT",
    "NBATCH",
    "NSKI",
    "NSKIP",
    "WTOB",
    "MIXG",
    "WWEN",
    "INPE",
  ],
  calculationControl: [
    "CALD",
    "CAL",
    "NAMV",
    "NAMVAR",
    "MAXS",
    "MAXSER",
    "DTZM",
    "DTZML",
    "NPRI",
    "NPRINT",
    "NPRIN",
    "BETA",
    "NRAN",
    "ECUT",
    "ECUP",
    "ECEL",
    "ECPO",
    "SERIES",
    "WWEN",
    "INPE",
    "INPO",
    "XYZ0",
    "RADS",
    "INPM",
    "SANG",
    "INRA",
    "SETT",
  ],
  burnup: [
    "BURD",
    "BURN",
    "BURNUP",
    "PBUR",
    "CODE",
    "FISZ",
    "FISZON",
    "ABSZ",
    "POWZ",
    "POWE",
    "POWER",
    "DPOW",
    "FLUX",
    "STEP",
    "DSTP",
    "COLI",
    "EPSM",
    "EOPT",
    "CLEZ",
    "CLEF",
    "ADDZ",
    "ADDF",
    "TIMP",
    "TSEC",
    "TMIN",
    "THOU",
    "TDAY",
    "TYEA",
    "GLIB",
    "ZONP",
    "ZONPRI",
    "SUMZ",
    "SUMZON",
    "CONTEN",
    "ACTI",
    "FISP",
    "PARA",
    "SIZI",
    "LIST",
    "FINAL",
    "DELAY",
    "FINTAB",
    "DELTAB",
    "FINDEN",
    "SOURCE",
    "SHORT",
  ],
};

/** Длинные/альтернативные имена из реальных вариантов → канон из UserGuide */
export const MCU_LABEL_ALIASES: Record<string, string> = {
  NAMVAR: "NAMV",
  MAXSER: "MAXS",
  DTZML: "DTZM",
  NPRINT: "NPRI",
  NPRIN: "NPRI",
  ENERG: "ENERGY",
  FISZON: "FISZ",
  POWER: "POWE",
  ZONPRI: "ZONP",
  SUMZON: "SUMZ",
  // CONTEN — отдельная карта выгорания, не путать с геом. CONT
  NBAT: "NBATCH",
  REG: "REGD",
  SRC: "SRCD",
  TRJ: "TRJD",
  CAL: "CALD",
  BURD: "BURN",
  BURNUP: "BURN",
  BRGD: "BRG",
  NSKIP: "NSKI",
};

const _all = new Set<string>();
for (const group of Object.values(MCU_LABELS_BY_FRAGMENT)) {
  for (const label of group) {
    _all.add(label.toUpperCase());
  }
}
for (const alias of Object.keys(MCU_LABEL_ALIASES)) {
  _all.add(alias.toUpperCase());
}

/** Все известные метки карт (верхний регистр), не считаются именами геометрических зон */
export const ALL_MCU_LABELS: ReadonlySet<string> = _all;

export function normalizeMcuLabel(label: string): string {
  const u = label.toUpperCase();
  return MCU_LABEL_ALIASES[u] ?? u;
}

const FRAGMENT_ORDER: readonly FragmentId[] = [
  "physical",
  "geometry",
  "source",
  "registration",
  "burnupRegistration",
  "trajectory",
  "calculationControl",
  "burnup",
];

const FRAGMENT_LABEL_MAP: { id: FragmentId; labels: readonly string[] }[] = [
  { id: "physical", labels: MCU_LABELS_BY_FRAGMENT.physical },
  { id: "geometry", labels: MCU_LABELS_BY_FRAGMENT.geometry },
  { id: "source", labels: MCU_LABELS_BY_FRAGMENT.source },
  { id: "registration", labels: MCU_LABELS_BY_FRAGMENT.registration },
  { id: "burnupRegistration", labels: MCU_LABELS_BY_FRAGMENT.burnupRegistration },
  { id: "trajectory", labels: MCU_LABELS_BY_FRAGMENT.trajectory },
  { id: "calculationControl", labels: MCU_LABELS_BY_FRAGMENT.calculationControl },
  { id: "burnup", labels: MCU_LABELS_BY_FRAGMENT.burnup },
];

/** label → все фрагменты, где метка допустима (без shared). */
const _fragmentsByLabel = new Map<string, FragmentId[]>();

function addLabelFragment(raw: string, id: FragmentId): void {
  const u = raw.toUpperCase();
  const canon = MCU_LABEL_ALIASES[u] ?? u;
  for (const key of new Set([u, canon])) {
    const list = _fragmentsByLabel.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    _fragmentsByLabel.set(key, list);
  }
}

for (const { id, labels } of FRAGMENT_LABEL_MAP) {
  for (const raw of labels) addLabelFragment(raw, id);
}
for (const [alias, canon] of Object.entries(MCU_LABEL_ALIASES)) {
  const frags = _fragmentsByLabel.get(canon);
  if (frags) _fragmentsByLabel.set(alias.toUpperCase(), [...frags]);
}

/** Первичный фрагмент метки (для переключения вперёд при current=null). */
const _primaryFragmentByLabel = new Map<string, FragmentId>();
for (const [label, frags] of _fragmentsByLabel) {
  const ordered = FRAGMENT_ORDER.filter((f) => frags.includes(f));
  if (ordered.length) _primaryFragmentByLabel.set(label, ordered[0]);
}

/** Явные маркеры начала фрагмента (приоритетные) */
const FRAGMENT_STARTERS: Record<string, FragmentId> = {
  PIN: "physical",
  HEAD: "geometry",
  CONT: "geometry",
  MIR: "geometry",
  SRCD: "source",
  SRC: "source",
  SPNT: "source",
  RGS: "registration",
  REGD: "registration",
  REG: "registration",
  BRG: "burnupRegistration",
  BRGD: "burnupRegistration",
  TRJD: "trajectory",
  TRJ: "trajectory",
  NTOT: "trajectory",
  NAMV: "calculationControl",
  NAMVAR: "calculationControl",
  CALD: "calculationControl",
  CAL: "calculationControl",
  BURN: "burnup",
  BURD: "burnup",
  BURNUP: "burnup",
};
/** Фрагменты, в которых допустима карта (пустой — неизвестная метка). Shared → все. */
export function fragmentsForLabel(label: string): readonly FragmentId[] {
  const u = label.toUpperCase();
  const canon = normalizeMcuLabel(u);
  if ((MCU_LABELS_BY_FRAGMENT.shared as readonly string[]).includes(u) ||
      (MCU_LABELS_BY_FRAGMENT.shared as readonly string[]).includes(canon)) {
    return FRAGMENT_ORDER;
  }
  return _fragmentsByLabel.get(canon) ?? _fragmentsByLabel.get(u) ?? [];
}

/** Допустима ли карта в текущем фрагменте. */
export function labelAllowedInFragment(label: string, fragment: FragmentId | null): boolean {
  if (fragment == null) return true;
  const u = label.toUpperCase();
  const canon = normalizeMcuLabel(u);
  if ((MCU_LABELS_BY_FRAGMENT.shared as readonly string[]).includes(u) ||
      (MCU_LABELS_BY_FRAGMENT.shared as readonly string[]).includes(canon)) {
    return true;
  }
  const frags = fragmentsForLabel(label);
  return frags.includes(fragment);
}

export function detectFragmentFromLabel(label: string, current: FragmentId | null): FragmentId | null {
  const u = label.toUpperCase();
  if (FRAGMENT_STARTERS[u]) return FRAGMENT_STARTERS[u];
  if (u.startsWith("BUR") || u === "FINAL" || u === "DELAY") return "burnup";

  // EQU/SET не стартуют модуль и не переключают фрагмент (UserGuide: геометрия/источники).
  // После PIN остаются в physical → card-wrong-fragment; до HEAD считаем geometry.
  if (u === "EQU" || u === "SET") {
    return current ?? "geometry";
  }

  const frags = fragmentsForLabel(u);
  if (!frags.length) return current;
  // Multi-home / родная карта текущего модуля — не переключаем.
  if (current != null && frags.includes(current)) return current;

  const primary = _primaryFragmentByLabel.get(normalizeMcuLabel(u)) ?? frags[0];
  if (current == null) return primary;
  // Чужая карта: переключение только «вперёд» (NPS после geometry → source; DELN в RGS → stay).
  if (FRAGMENT_ORDER.indexOf(primary!) > FRAGMENT_ORDER.indexOf(current)) return primary!;
  return current;
}

export function isKnownMcuLabel(label: string): boolean {
  return ALL_MCU_LABELS.has(label.toUpperCase());
}

/** Для подсветки и cSpell: отсортированный список */
export function listAllMcuLabels(): string[] {
  return [...ALL_MCU_LABELS].sort();
}
