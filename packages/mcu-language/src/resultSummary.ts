/**
 * Извлечение ключевых метрик из LST/FIN для сравнения прогонов.
 */

export interface ResultSummary {
  sourcePath: string;
  keff?: number;
  keffSigma?: number;
  errorCount: number;
  warningCount: number;
  firstError?: string;
  seriesDone?: number;
}

const KEFF_RE =
  /(?:Keff|K-eff|K_EFF|эффективн\w*\s+коэффициент\w*)[^\d\-]*([+-]?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?)/i;
const SIGMA_RE = /(?:sigma|σ|погрешность)[^\d\-]*([+-]?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?)/i;
const ERROR_LINE = /\berror\s*:?\s*\d*\b|^\s*ERROR:/im;
const WARNING_LINE = /\bWARNING\b/i;

export function summarizeMcuResultText(text: string, sourcePath: string): ResultSummary {
  const lines = text.split(/\r?\n/);
  let errorCount = 0;
  let warningCount = 0;
  let firstError: string | undefined;
  let keff: number | undefined;
  let keffSigma: number | undefined;
  let seriesDone: number | undefined;

  for (const line of lines) {
    if (/ERRORS\s+in\s+initial\s+data|WARNINGS\s+in\s+initial\s+data/i.test(line)) {
      continue;
    }
    if (ERROR_LINE.test(line) && !/summary/i.test(line)) {
      errorCount++;
      if (!firstError) firstError = line.trim().slice(0, 200);
    } else if (WARNING_LINE.test(line) && !/summary/i.test(line)) {
      warningCount++;
    }
    if (keff === undefined) {
      const km = KEFF_RE.exec(line);
      if (km) keff = Number(km[1]);
    }
    if (keffSigma === undefined) {
      const sm = SIGMA_RE.exec(line);
      if (sm) keffSigma = Number(sm[1]);
    }
    const ser = /(?:series|сери[йя])[^\d]*(\d+)/i.exec(line);
    if (ser) seriesDone = Number(ser[1]);
  }

  return {
    sourcePath,
    keff: keff !== undefined && Number.isFinite(keff) ? keff : undefined,
    keffSigma: keffSigma !== undefined && Number.isFinite(keffSigma) ? keffSigma : undefined,
    errorCount,
    warningCount,
    firstError,
    seriesDone,
  };
}

export interface ResultDelta {
  field: string;
  left: string;
  right: string;
  changed: boolean;
}

export function compareResultSummaries(a: ResultSummary, b: ResultSummary): ResultDelta[] {
  const fmt = (v: number | undefined) => (v === undefined ? "—" : String(v));
  const rows: Array<[string, string, string]> = [
    ["keff", fmt(a.keff), fmt(b.keff)],
    ["keffSigma", fmt(a.keffSigma), fmt(b.keffSigma)],
    ["errors", String(a.errorCount), String(b.errorCount)],
    ["warnings", String(a.warningCount), String(b.warningCount)],
    ["series", fmt(a.seriesDone), fmt(b.seriesDone)],
  ];
  return rows.map(([field, left, right]) => ({
    field,
    left,
    right,
    changed: left !== right,
  }));
}

export function formatResultCompareCsv(deltas: ResultDelta[]): string {
  const lines = ["field,left,right,changed"];
  for (const d of deltas) {
    lines.push(`${d.field},${d.left},${d.right},${d.changed}`);
  }
  return lines.join("\n");
}
