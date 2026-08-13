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
  constantsToVarMap: (
    constants: Array<{ name: string; value?: number | null; expression?: string }>
  ) => Map<string, number>;
  isValidBodyName: (name: string) => boolean;
  sanitizeBodyName: (raw: string) => string;
  allocateBodyName: (bodyType: string, existingNames: Iterable<string>) => string;
} {
  return requireLanguage("bodyGenerator");
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
