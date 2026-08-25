import * as fs from "fs";
import * as path from "path";

/**
 * Runtime-загрузка модулей mcu-language (как catalogBridge / defaultPhyLib).
 * `paths` в tsconfig не попадают в emit — `require("@mcuhelper/…")` в Extension Host ломается.
 */
function resolveLanguageModule(fileBase: string): string {
  const candidates = [
    path.join(__dirname, "..", "vendor", "mcu-language", `${fileBase}.js`),
    path.join(__dirname, "..", "..", "packages", "mcu-language", "dist", `${fileBase}.js`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `mcu-language/${fileBase}.js не найден. Выполните npm run build в корне проекта.`
  );
}

function requireLanguage<T>(fileBase: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(resolveLanguageModule(fileBase)) as T;
}

export type RegistrationBuilderInput = {
  ptype: 1 | 2 | 3;
  ttype?: 0 | 1 | 2;
  materials?: number[];
  zones?: number[];
  objects?: number[];
  energy?: number[];
  reactions?: number[];
  includeFlux?: boolean;
  includeReactions?: boolean;
};

export function loadRegistrationBuilderApi(): {
  buildRegistrationSection: (input: RegistrationBuilderInput) => { text: string; warnings: string[] };
  findRegistrationInsertLine: (text: string) => number | undefined;
} {
  return requireLanguage("registrationBuilder");
}

export type BodyParamField = {
  id: string;
  label: string;
  defaultValue: string;
  hint?: string;
};

export type BodyTypeOption = {
  key: string;
  title: string;
  description: string;
  fields: BodyParamField[];
  formatGroups: number[][];
};

export type BodyGeneratorInput = {
  bodyType: string;
  name: string;
  params: string[];
};

export function loadBodyArrayGeneratorApi(): {
  buildPatternInstances: (input: {
    group: string;
    mode?: string;
    values?: Record<string, number | string | boolean | undefined>;
    seedAnchor?: { x: number; y: number; z: number };
  }) => {
    instances: Array<{ index: number; pose: { kind: string; [k: string]: number | string } }>;
    warnings: string[];
    ok: boolean;
    useTransfCandidate: boolean;
    summary: string;
  };
  emitBodyArray: (input: {
    seed: BodyGeneratorInput;
    instances: Array<{ index: number; pose: { kind: string; [k: string]: number | string } }>;
    expand: boolean;
    canUseTransf: boolean;
    existingNames?: Iterable<string>;
    transformExpanded?: (pose: { kind: string; [k: string]: number | string }) => string[] | null;
  }) => {
    text: string;
    warnings: string[];
    okToInsert: boolean;
    summary: string;
    names: string[];
  };
  patternCanUseTransf: (bodyType: string, useTransfCandidate: boolean) => { ok: boolean; reason: string };
  hexLatticeInstanceCount: (rings: number) => number;
  applyTranslateToBodyParamStrings: (
    bodyType: string,
    params: string[],
    dx: number,
    dy: number,
    dz: number
  ) => string[] | null;
  mergePreservedParamStrings: (seedParams: string[], resolvedNums: number[], nextNums: number[]) => string[];
  applyPatternExclusions: (
    instances: Array<{ index: number; pose: { kind: string; [k: string]: number | string } }>,
    excludedIndices?: number[]
  ) => {
    instances: Array<{ index: number; pose: { kind: string; [k: string]: number | string } }>;
    excludedCount: number;
    warnings: string[];
    ok: boolean;
  };
  pruneExcludedIndices: (excludedIndices: number[] | undefined, instanceCount: number) => number[];
  MAX_BODY_ARRAY_COUNT: number;
} {
  return requireLanguage("bodyArrayGenerator");
}

export function loadBodyGeneratorApi(): {
  listBodyGeneratorTypes: () => BodyTypeOption[];
  getBodyGeneratorType: (key: string) => BodyTypeOption | undefined;
  buildBodyStatement: (input: BodyGeneratorInput) => {
    text: string;
    warnings: string[];
    okToInsert: boolean;
  };
  resolveBodyParamNumbers: (
    params: string[],
    vars: Map<string, number>
  ) => { nums: number[]; warnings: string[] };
  resolveTransfParams: (
    params: string[],
    vars: Map<string, number>
  ) => {
    protoName: string;
    mode: string;
    A: number;
    B: number;
    f: number;
    warnings: string[];
    ok: boolean;
  };
  constantsToVarMap: (
    constants: Array<{ name: string; value?: number | null; expression?: string }>
  ) => Map<string, number>;
  isValidBodyName: (name: string) => boolean;
  sanitizeBodyName: (raw: string) => string;
  allocateBodyName: (bodyType: string, existingNames: Iterable<string>) => string;
  parseBodySourceStatement: (text: string) => {
    bodyType: string;
    name: string;
    params: string[];
  } | null;
  collectContinuedStatement: (
    lines: readonly string[],
    lineIndex: number
  ) => { text: string; startLine: number; endLine: number } | null;
} {
  return requireLanguage("bodyGenerator");
}

export type LatticeGeneratorInput = {
  latticeType: "G2MP" | "G2AR" | "GLTL";
  zoneName: string;
  elements: string[];
  cols: number;
  rows: number;
  iMin: number;
  iMax: number;
  jMin: number;
  jMax: number;
  vectorA: [string, string, string];
  vectorB: [string, string, string];
  vectorC: [string, string, string];
  cartogram: string[][];
  placements: Array<{ element: string; protoIndex?: number; x: string; y: string; z: string }>;
  lfixso: string;
  lblack: string;
  footprints: Array<{
    name: string;
    shapes: Array<
      | { kind: "rect"; x1: number; y1: number; x2: number; y2: number }
      | { kind: "circle"; x: number; y: number; r: number }
      | { kind: "poly"; points: Array<{ x: number; y: number }> }
    >;
  }>;
};

export function loadLatticeGeneratorApi(): {
  buildLatticeStatement: (input: LatticeGeneratorInput) => {
    text: string;
    warnings: string[];
    okToInsert: boolean;
  };
  buildG2mpLatticeStatement: (input: LatticeGeneratorInput) => {
    text: string;
    warnings: string[];
    okToInsert: boolean;
  };
  buildG2arLatticeStatement: (input: LatticeGeneratorInput) => {
    text: string;
    warnings: string[];
    okToInsert: boolean;
  };
  buildGltlLatticeStatement: (input: LatticeGeneratorInput) => {
    text: string;
    warnings: string[];
    okToInsert: boolean;
  };
  buildLcellStub: (name: string) => {
    text: string;
    warnings: string[];
    okToInsert: boolean;
  };
  defaultLatticeGeneratorInput: () => LatticeGeneratorInput;
  emptyCartogram: (cols: number, rows: number, fill?: string) => string[][];
  resizeCartogram: (prev: string[][], cols: number, rows: number, fill?: string) => string[][];
  formatG2mpRowLabel: (rowIndex1Based: number) => string;
  isValidMcuName: (name: string) => boolean;
  findLatticeBlockAtLine: (
    lines: readonly string[],
    line: number
  ) => { startLine: number; endLine: number } | null;
  parseLatticeBlockText: (blockText: string) => LatticeGeneratorInput | null;
  parseLatticeAtLine: (
    fullText: string,
    line: number,
    opts?: { uri?: string }
  ) => {
    input: LatticeGeneratorInput;
    range: { startLine: number; endLine: number };
  } | null;
  parseGltlLatticeAtLine: (
    fullText: string,
    line: number,
    opts?: { uri?: string }
  ) => {
    input: LatticeGeneratorInput;
    range: { startLine: number; endLine: number };
  } | null;
  parseG2arLatticeAtLine: (
    fullText: string,
    line: number,
    opts?: { uri?: string }
  ) => {
    input: LatticeGeneratorInput;
    range: { startLine: number; endLine: number };
  } | null;
  parseG2mpLatticeAtLine: (
    fullText: string,
    line: number,
    opts?: { uri?: string }
  ) => {
    input: LatticeGeneratorInput;
    range: { startLine: number; endLine: number };
  } | null;
  findNearestLatticeLine: (
    fullText: string,
    preferLine: number,
    types?: Array<"G2MP" | "G2AR" | "GLTL">
  ) => number | null;
  findNearestGltlLatticeLine: (fullText: string, preferLine: number) => number | null;
  rebuildGltlPlacements: (
    parmText: string,
    elements: string[]
  ) => Array<{ element: string; protoIndex?: number; x: string; y: string; z: string }>;
  ensureLcellFootprints: (
    fullText: string,
    elements: string[],
    existing?: LatticeGeneratorInput["footprints"]
  ) => LatticeGeneratorInput["footprints"];
  inferGltlGridSize: (placements: LatticeGeneratorInput["placements"]) => {
    cols: number;
    rows: number;
    layers: number;
    xs: number[];
    ys: number[];
    zs: number[];
  };
  convertLatticeGeneratorType: (
    input: LatticeGeneratorInput,
    target: "G2MP" | "G2AR" | "GLTL"
  ) => LatticeGeneratorInput;
} {
  return requireLanguage("latticeGenerator");
}

export function loadZoneStatementApi(): {
  looksLikeZoneStatement: (text: string) => boolean;
} {
  return requireLanguage("zoneStatement");
}

export type ResultSummary = {
  sourcePath: string;
  keff?: number;
  keffSigma?: number;
  errorCount: number;
  warningCount: number;
  firstError?: string;
  seriesDone?: number;
};

export type ResultDelta = {
  field: string;
  left: string;
  right: string;
  changed: boolean;
};

export function loadResultSummaryApi(): {
  summarizeMcuResultText: (text: string, sourcePath: string) => ResultSummary;
  compareResultSummaries: (a: ResultSummary, b: ResultSummary) => ResultDelta[];
  formatResultCompareCsv: (deltas: ResultDelta[]) => string;
} {
  return requireLanguage("resultSummary");
}

export type WaterSteamState = {
  T: number;
  P: number;
  rho: number;
  nH: number;
  nO: number;
  phase: "liquid" | "vapor" | "unknown";
  quality: number | null;
  warning?: string;
};

export type SaturationPoint = {
  T: number;
  P: number;
  rhoF: number;
  rhoG: number;
};

export type PressureUnit = "Pa" | "kPa" | "MPa" | "atm" | "bar";

export function loadWaterSteamApi(): {
  ATM_MPA: number;
  DEFAULT_WATER_T_K: number;
  PRESSURE_UNITS: ReadonlyArray<{ id: PressureUnit; label: string }>;
  pressureToMPa: (value: number, unit: PressureUnit) => number;
  pressureFromMPa: (pMPa: number, unit: PressureUnit) => number;
  nuclearHOFromMassDensity: (rhoGcm3: number) => { nH: number; nO: number };
  waterElementFamily: (name: string) => "H" | "O" | null;
  materialHasHO: (nuclideNames: ReadonlyArray<string>) => boolean;
  WATER_DENSITY_MIXTURE_FOOTNOTE: string;
  extractWaterComponentFromNuclides: (
    nuclides: ReadonlyArray<{ name: string; concentration: string }>
  ) => {
    nH: number;
    nO: number;
    rhoGcm3: number;
    nH2O: number;
    nHTotal: number;
    nOTotal: number;
    warning?: string;
  } | null;
  massDensityGcm3FromHONuclides: (
    nuclides: ReadonlyArray<{ name: string; concentration: string }>
  ) => number | null;
  stateFromPT: (pMPa: number, T: number) => WaterSteamState;
  stateFromTRho: (
    T: number,
    rhoGcm3: number,
    pMPa?: number,
    opts?: { forcePsat?: boolean }
  ) => WaterSteamState;
  stateFromPRho: (pMPa: number, rhoGcm3: number) => WaterSteamState;
  stateFromPsat: (
    pMPa: number,
    opts?: { phase?: "liquid" | "vapor" | "unknown"; rho?: number | null }
  ) => WaterSteamState;
  psatAtT: (T: number) => SaturationPoint;
  satAtP: (pMPa: number) => SaturationPoint;
  defaultAmbientState: () => WaterSteamState;
  initialStateFromMaterial: (opts: { T?: number | null; rho?: number | null }) => WaterSteamState;
  buildSaturationCurve: (opts?: {
    tMin?: number;
    tMax?: number;
    steps?: number;
  }) => SaturationPoint[];
  formatMcuNuclearDens: (n: number) => string;
} {
  return requireLanguage("waterSteam");
}

export type DensMode = "denswa" | "isotope";

export type SlimIsotope = {
  isotope: string;
  zaid: string;
  weightFraction: number;
  atomFraction: number;
  isotopicAtomDensity: number;
};

export type SlimElement = {
  element: string;
  zaid: string;
  weightFraction: number;
  atomFraction: number;
  isotopes: SlimIsotope[];
};

export type SlimMaterial = {
  name: string;
  formula: string | null;
  acronym: string | null;
  density: number;
  materialAtomDensity: number;
  comment: string[];
  source: string;
  references: string[];
  elements: SlimElement[];
};

export type SlimCatalog = {
  siteVersion: string;
  sourceSha?: string;
  generatedAt?: string;
  materialCount: number;
  materials: SlimMaterial[];
};

export type DraftNuclide = {
  name: string;
  value: number;
  impurity?: boolean;
  inAwLib?: boolean;
};

export type MaterialDraft = {
  sourceName?: string;
  number: number;
  temperature?: number | null;
  densityGcm3: number;
  mode: DensMode;
  comment?: string;
  nuclides: DraftNuclide[];
  warnings: string[];
};

export type UserMaterialRecord = {
  name: string;
  density: number;
  mode: DensMode;
  temperature?: number | null;
  comment?: string[];
  formula?: string | null;
  nuclides: Array<{ name: string; value: number; impurity?: boolean }>;
  savedAt?: string;
};

export type UserCatalogFile = {
  version: number;
  materials: UserMaterialRecord[];
};

export function loadMaterialsCompendiumApi(): {
  slimMaterialsCompendium: (
    raw: unknown,
    meta?: { sourceSha?: string; generatedAt?: string }
  ) => SlimCatalog;
  loadCatalogJson: (raw: unknown, meta?: { sourceSha?: string; generatedAt?: string }) => SlimCatalog;
  loadNameTranslations: (map: Record<string, string>) => void;
  displayName: (originalName: string) => string;
  searchCatalog: (catalog: SlimCatalog, query: string) => SlimMaterial[];
  draftFromCatalog: (mat: SlimMaterial, mode: DensMode, number?: number) => MaterialDraft;
  emptyDraft: (number?: number) => MaterialDraft;
  addImpurity: (draft: MaterialDraft, nuclideName: string, weightPercent: number) => MaterialDraft;
  buildMatrCard: (draft: MaterialDraft) => { text: string; warnings: string[] };
  findMatrInsert: (text: string) => { line: number; nextNumber: number };
  findMatrBlockEndLine: (text: string, headerLine: number) => number;
  pnnlNuclideToMcu: (raw: string) => { mcuName: string; inAwLib?: boolean };
  formatMatrValue: (n: number) => string;
  parseUserCatalog: (raw: unknown) => UserCatalogFile;
  draftToUserMaterial: (draft: MaterialDraft, name: string) => UserMaterialRecord;
  draftFromUserMaterial: (mat: UserMaterialRecord, number?: number) => MaterialDraft;
  upsertUserMaterial: (file: UserCatalogFile, mat: UserMaterialRecord) => UserCatalogFile;
  findUserMaterial: (file: UserCatalogFile, name: string) => UserMaterialRecord | undefined;
  formatUserCatalogJson: (file: UserCatalogFile) => string;
  draftFromVisibleMatr: (text: string, line: number) => MaterialDraft | null;
  syncDraftMassDensity: (draft: MaterialDraft) => MaterialDraft;
  setAwLibTableFromCatalog: (
    items: Array<{ name: string; zaid: number; atomicWeight: number; isNatural: boolean }>
  ) => void;
} {
  return requireLanguage("materialsCompendium");
}

export function loadCatalogJson(raw: unknown): SlimCatalog {
  return loadMaterialsCompendiumApi().loadCatalogJson(raw);
}

export function loadNameTranslations(map: Record<string, string>): void {
  loadMaterialsCompendiumApi().loadNameTranslations(map);
}

export function slimMaterialsCompendium(
  raw: unknown,
  meta?: { sourceSha?: string; generatedAt?: string }
): SlimCatalog {
  return loadMaterialsCompendiumApi().slimMaterialsCompendium(raw, meta);
}
