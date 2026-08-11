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
