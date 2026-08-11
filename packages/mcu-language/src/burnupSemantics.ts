import type { DiagnosticMessage, DocumentAst, SourceRange, StatementNode } from "./ast";
import {
  isIncrementalStepTimeValues,
  parseDstpPlateaus,
  parseStatementNumbers,
  parseStepPlateausCumulative,
} from "./burnupLoad";
import { evaluateExpression } from "./expression";
import { normalizeMcuLabel } from "./schemaBridge";

/** Минимальный размер шага выгорания (сут), UserGuide §15.1. */
export const BURNUP_MIN_DT_DAYS = 0.02;

export const BURNUP_CODE_OPTIONS = [
  "RSTP",
  "RFNL",
  "RDEL",
  "RFTB",
  "RDTB",
  "RFDN",
  "RSOU",
  "RSHR",
] as const;

export type BurnupCodeOption = (typeof BURNUP_CODE_OPTIONS)[number];

const CODE_SET = new Set<string>(BURNUP_CODE_OPTIONS);
const PBUR_SET = new Set(["FST", "THR"]);

const STEP_STYLE_LABELS = new Set([
  "POWE",
  "POWER",
  "DPOW",
  "FLUX",
  "STEP",
  "DSTP",
  "FISZ",
  "FISZON",
  "ABSZ",
  "POWZ",
]);

export type BurnupIssueCode =
  | "burnup-missing-code"
  | "burnup-missing-finish"
  | "burnup-missing-power"
  | "burnup-missing-step"
  | "burnup-powe-dpow-conflict"
  | "burnup-step-dstp-conflict"
  | "burnup-fisz-unknown"
  | "burnup-absz-unknown"
  | "burnup-powz-unknown"
  | "burnup-missing-fisz-absz"
  | "burnup-bur-mismatch"
  | "burnup-dt-small"
  | "burnup-time-order"
  | "burnup-pbur-invalid"
  | "burnup-code-invalid";

export interface BurnupValidationIssue {
  code: BurnupIssueCode;
  message: string;
  severity?: "error" | "warning";
}

function buildVars(ast: Pick<DocumentAst, "constants">): Map<string, number> {
  const vars = new Map<string, number>();
  for (const c of ast.constants) {
    const v = evaluateExpression(c.expression, vars);
    if (v !== null) vars.set(c.name, v);
  }
  return vars;
}

function normLabel(label: string): string {
  return normalizeMcuLabel(label.toUpperCase());
}

function tokensAfterLabel(text: string): string[] {
  return text
    .trim()
    .replace(/^\S+\s*/, "")
    .split(/[\s,]+/)
    .filter(Boolean);
}

function stmtByNorm(
  stmts: StatementNode[],
  ...labels: string[]
): StatementNode | undefined {
  const want = new Set(labels.map((l) => normalizeMcuLabel(l.toUpperCase())));
  let found: StatementNode | undefined;
  for (const s of stmts) {
    if (want.has(normLabel(s.label))) found = s;
  }
  return found;
}

function hasNorm(stmts: StatementNode[], ...labels: string[]): boolean {
  return stmtByNorm(stmts, ...labels) != null;
}

/**
 * Список FISZ/ABSZ/POWZ: пары (начало, конец); непарный хвост — одиночный номер.
 * UserGuide §15.1: нечётные позиции — начала интервалов, чётные — окончания.
 */
export function expandMaterialIntervals(values: number[]): number[] {
  const out = new Set<number>();
  for (let i = 0; i < values.length; i += 2) {
    const a = values[i];
    if (!Number.isFinite(a)) continue;
    const start = Math.trunc(a);
    const end = i + 1 < values.length && Number.isFinite(values[i + 1]) ? Math.trunc(values[i + 1]) : start;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    for (let n = lo; n <= hi; n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

export function parseBurTagsFromMatrStatements(
  stmts: StatementNode[]
): Map<number, { bur: string; range: SourceRange }> {
  const map = new Map<number, { bur: string; range: SourceRange }>();
  for (const stmt of stmts) {
    if (stmt.label?.toUpperCase() !== "MATR") continue;
    const numM = stmt.text.match(/^MATR\s+(\d+)/i);
    if (!numM) continue;
    const burM = stmt.text.match(/\bBUR\s*=\s*(\S+)/i);
    if (!burM) continue;
    const bur = burM[1].replace(/[,;].*$/, "").toUpperCase();
    map.set(parseInt(numM[1], 10), { bur, range: stmt.range });
  }
  return map;
}

function unknownMatCode(kind: "FISZ" | "ABSZ" | "POWZ"): BurnupIssueCode {
  if (kind === "FISZ") return "burnup-fisz-unknown";
  if (kind === "ABSZ") return "burnup-absz-unknown";
  return "burnup-powz-unknown";
}

function checkMaterialList(
  issues: BurnupValidationIssue[],
  kind: "FISZ" | "ABSZ" | "POWZ",
  numbers: number[],
  knownMats: Set<number>
): void {
  for (const n of numbers) {
    if (!knownMats.has(n)) {
      issues.push({
        code: unknownMatCode(kind),
        message: `${kind}: материал ${n} не описан в MATR`,
      });
    }
  }
}

function checkCumulativeTimes(values: number[], card: string): BurnupValidationIssue[] {
  const issues: BurnupValidationIssue[] = [];
  const times: number[] = [];
  for (let i = 0; i < values.length; i += 2) {
    if (Number.isFinite(values[i])) times.push(values[i]);
  }
  for (let i = 1; i < times.length; i++) {
    if (times[i] <= times[i - 1]) {
      issues.push({
        code: "burnup-time-order",
        message: `${card}: границы времени должны строго возрастать (${times[i - 1]} → ${times[i]})`,
      });
      break;
    }
  }
  return issues;
}

function checkDtFromPlateaus(
  plateaus: { dtDays: number }[],
  card: string
): BurnupValidationIssue[] {
  const issues: BurnupValidationIssue[] = [];
  for (let i = 0; i < plateaus.length; i++) {
    const dt = plateaus[i].dtDays;
    if (!Number.isFinite(dt)) continue;
    if (dt <= BURNUP_MIN_DT_DAYS) {
      issues.push({
        code: "burnup-dt-small",
        message: `${card}: шаг dT=${dt} сут должен быть > ${BURNUP_MIN_DT_DAYS} (отрезок ${i + 1})`,
      });
    }
  }
  return issues;
}

/**
 * Чистые проверки опции STEP / связанных карт (UserGuide §15.1).
 * `stepOptionActive` — CODE=RSTP или уже есть POWE/STEP-стиль карт.
 */
export function validateBurnupStepOption(input: {
  code?: string | null;
  hasFinish: boolean;
  hasPowe: boolean;
  hasDpow: boolean;
  hasFlux: boolean;
  hasStep: boolean;
  hasDstp: boolean;
  hasFisz: boolean;
  hasAbsz: boolean;
  hasPowz: boolean;
  fiszMats: number[];
  abszMats: number[];
  powzMats: number[];
  knownMats: Set<number>;
  burByMat: Map<number, string>;
  stepValues: number[];
  dstpValues: number[];
  poweValues: number[];
  dpowValues: number[];
  fluxValues: number[];
  pbur?: string | null;
  stepOptionActive: boolean;
}): BurnupValidationIssue[] {
  const issues: BurnupValidationIssue[] = [];
  const {
    code,
    hasFinish,
    hasPowe,
    hasDpow,
    hasFlux,
    hasStep,
    hasDstp,
    hasFisz,
    hasAbsz,
    hasPowz,
    fiszMats,
    abszMats,
    powzMats,
    knownMats,
    burByMat,
    stepValues,
    dstpValues,
    poweValues,
    dpowValues,
    fluxValues,
    pbur,
    stepOptionActive,
  } = input;

  if (!hasFinish) {
    issues.push({
      code: "burnup-missing-finish",
      message: "BURN: отсутствует обязательная карта FINISH",
    });
  }

  if (code == null || code === "") {
    issues.push({
      code: "burnup-missing-code",
      message: "BURN: отсутствует обязательная карта CODE",
    });
  } else if (!CODE_SET.has(code.toUpperCase())) {
    issues.push({
      code: "burnup-code-invalid",
      message: `CODE: недопустимое значение «${code}» (ожидается ${BURNUP_CODE_OPTIONS.join(", ")})`,
    });
  }

  if (pbur != null && pbur !== "" && !PBUR_SET.has(pbur.toUpperCase())) {
    issues.push({
      code: "burnup-pbur-invalid",
      message: `PBUR: ожидается FST или THR, получено «${pbur}»`,
    });
  }

  if (hasPowe && hasDpow) {
    issues.push({
      code: "burnup-powe-dpow-conflict",
      message: "BURN: нельзя задавать одновременно POWE и DPOW",
    });
  }
  if (hasStep && hasDstp) {
    issues.push({
      code: "burnup-step-dstp-conflict",
      message: "BURN: нельзя задавать одновременно STEP и DSTP",
    });
  }

  if (stepOptionActive) {
    if (!hasPowe && !hasDpow && !hasFlux) {
      issues.push({
        code: "burnup-missing-power",
        message: "BURN (STEP): нужна одна из карт POWE, DPOW или FLUX",
      });
    }
    if (!hasStep && !hasDstp) {
      issues.push({
        code: "burnup-missing-step",
        message: "BURN (STEP): нужна одна из карт STEP или DSTP",
      });
    }
    if (!hasFisz && !hasAbsz) {
      issues.push({
        code: "burnup-missing-fisz-absz",
        message: "BURN (STEP): нужна хотя бы одна из карт FISZ или ABSZ",
      });
    }
  }

  if (hasFisz) checkMaterialList(issues, "FISZ", fiszMats, knownMats);
  if (hasAbsz) checkMaterialList(issues, "ABSZ", abszMats, knownMats);
  if (hasPowz) checkMaterialList(issues, "POWZ", powzMats, knownMats);

  if (burByMat.size > 0 && (hasFisz || hasAbsz || hasPowz || stepOptionActive)) {
    const fiszSet = new Set(fiszMats);
    const abszSet = new Set(abszMats);
    const powzSet = new Set(powzMats);

    for (const [mat, bur] of burByMat) {
      const inF = fiszSet.has(mat);
      const inA = abszSet.has(mat);
      const inP = powzSet.has(mat);
      if (bur === "F" && hasFisz && !inF) {
        issues.push({
          code: "burnup-bur-mismatch",
          message: `MATR ${mat} BUR=F, но материал не указан в FISZ`,
        });
      } else if (bur === "A" && hasAbsz && !inA) {
        issues.push({
          code: "burnup-bur-mismatch",
          message: `MATR ${mat} BUR=A, но материал не указан в ABSZ`,
        });
      } else if (bur === "P" && hasPowz && !inP) {
        issues.push({
          code: "burnup-bur-mismatch",
          message: `MATR ${mat} BUR=P, но материал не указан в POWZ`,
        });
      } else if (bur === "N" && (inF || inA || inP)) {
        const where = inF ? "FISZ" : inA ? "ABSZ" : "POWZ";
        issues.push({
          code: "burnup-bur-mismatch",
          message: `MATR ${mat} BUR=N, но материал указан в ${where}`,
        });
      }
    }

    for (const n of fiszMats) {
      const bur = burByMat.get(n);
      if (bur && bur !== "F") {
        issues.push({
          code: "burnup-bur-mismatch",
          message: `FISZ: материал ${n} имеет BUR=${bur}, ожидается F`,
        });
      }
    }
    for (const n of abszMats) {
      const bur = burByMat.get(n);
      if (bur && bur !== "A") {
        issues.push({
          code: "burnup-bur-mismatch",
          message: `ABSZ: материал ${n} имеет BUR=${bur}, ожидается A`,
        });
      }
    }
    for (const n of powzMats) {
      const bur = burByMat.get(n);
      if (bur && bur !== "P") {
        issues.push({
          code: "burnup-bur-mismatch",
          message: `POWZ: материал ${n} имеет BUR=${bur}, ожидается P`,
        });
      }
    }
  }

  if (hasStep && stepValues.length) {
    const incremental = isIncrementalStepTimeValues(stepValues);
    if (!incremental) {
      issues.push(...checkCumulativeTimes(stepValues, "STEP"));
    }
    const plateaus = incremental
      ? parseDstpPlateaus(stepValues)
      : parseStepPlateausCumulative(stepValues);
    issues.push(...checkDtFromPlateaus(plateaus, "STEP"));
  }

  if (hasDstp && dstpValues.length) {
    const plateaus = parseDstpPlateaus(dstpValues);
    issues.push(...checkDtFromPlateaus(plateaus, "DSTP"));
    for (let i = 0; i < dstpValues.length; i += 2) {
      const span = dstpValues[i];
      if (Number.isFinite(span) && span <= 0) {
        issues.push({
          code: "burnup-time-order",
          message: `DSTP: длина отрезка должна быть > 0 (позиция ${i + 1}: ${span})`,
        });
        break;
      }
    }
  }

  if (hasPowe && poweValues.length >= 3) {
    // POWE: пары q,t — монотонность по t (индексы 1,3,5,…)
    const times: number[] = [];
    for (let i = 1; i < poweValues.length; i += 2) {
      if (Number.isFinite(poweValues[i])) times.push(poweValues[i]);
    }
    for (let i = 1; i < times.length; i++) {
      if (times[i] <= times[i - 1]) {
        issues.push({
          code: "burnup-time-order",
          message: `POWE: границы времени должны строго возрастать (${times[i - 1]} → ${times[i]})`,
        });
        break;
      }
    }
  }

  if (hasDpow && dpowValues.length >= 2) {
    for (let i = 1; i < dpowValues.length; i += 2) {
      const dt = dpowValues[i];
      if (Number.isFinite(dt) && dt < 0) {
        issues.push({
          code: "burnup-time-order",
          message: `DPOW: интервал времени не может быть отрицательным (${dt})`,
        });
        break;
      }
    }
  }

  if (hasFlux && fluxValues.length >= 3) {
    const times: number[] = [];
    for (let i = 1; i < fluxValues.length; i += 2) {
      if (Number.isFinite(fluxValues[i])) times.push(fluxValues[i]);
    }
    for (let i = 1; i < times.length; i++) {
      if (times[i] <= times[i - 1]) {
        issues.push({
          code: "burnup-time-order",
          message: `FLUX: границы времени должны строго возрастать (${times[i - 1]} → ${times[i]})`,
        });
        break;
      }
    }
  }

  return issues;
}

function pushIssue(
  diags: DiagnosticMessage[],
  issue: BurnupValidationIssue,
  range: SourceRange
): void {
  diags.push({
    severity: issue.severity ?? "error",
    message: issue.message,
    code: issue.code,
    range,
  });
}

function attachRange(
  burnStmts: StatementNode[],
  fallback: SourceRange,
  preferLabels: string[]
): SourceRange {
  const pref = stmtByNorm(burnStmts, ...preferLabels);
  if (pref) return pref.range;
  const burn = stmtByNorm(burnStmts, "BURN", "BURD", "BURNUP");
  return burn?.range ?? fallback;
}

/** Семантика фрагмента BURN (UserGuide §15). VOL/BRG — см. `crossModuleAudit.ts` (`brg-vol-short`). */
export function analyzeBurnupSemantics(ast: DocumentAst): DiagnosticMessage[] {
  const burnStmts = ast.statements.filter((s) => s.fragment === "burnup");
  const hasBurnFragment =
    burnStmts.length > 0 || ast.fragments.some((f) => f.id === "burnup");

  const diags: DiagnosticMessage[] = [];
  if (!hasBurnFragment) return diags;

  const vars = buildVars(ast);
  const knownMats = new Set(ast.materials.map((m) => m.number));
  const burTags = parseBurTagsFromMatrStatements(ast.statements);
  const burByMat = new Map<number, string>();
  for (const [n, info] of burTags) burByMat.set(n, info.bur);

  const fallbackRange =
    burnStmts[0]?.range ??
    ({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
      offset: 0,
      endOffset: 0,
    } satisfies SourceRange);

  const codeStmt = stmtByNorm(burnStmts, "CODE");
  const codeTok = codeStmt ? tokensAfterLabel(codeStmt.text)[0] : null;
  const code = codeTok?.toUpperCase() ?? null;

  const pburStmt = stmtByNorm(burnStmts, "PBUR");
  const pbur = pburStmt ? tokensAfterLabel(pburStmt.text)[0] ?? "" : null;

  const hasPowe = hasNorm(burnStmts, "POWE", "POWER");
  const hasDpow = hasNorm(burnStmts, "DPOW");
  const hasFlux = hasNorm(burnStmts, "FLUX");
  const hasStep = hasNorm(burnStmts, "STEP");
  const hasDstp = hasNorm(burnStmts, "DSTP");
  const hasFisz = hasNorm(burnStmts, "FISZ", "FISZON");
  const hasAbsz = hasNorm(burnStmts, "ABSZ");
  const hasPowz = hasNorm(burnStmts, "POWZ");
  const hasFinish = hasNorm(burnStmts, "FINISH");

  const hasStepStyle = burnStmts.some((s) => STEP_STYLE_LABELS.has(s.label.toUpperCase()));
  const stepOptionActive = code === "RSTP" || hasStepStyle;

  const fiszStmt = stmtByNorm(burnStmts, "FISZ", "FISZON");
  const abszStmt = stmtByNorm(burnStmts, "ABSZ");
  const powzStmt = stmtByNorm(burnStmts, "POWZ");
  const stepStmt = stmtByNorm(burnStmts, "STEP");
  const dstpStmt = stmtByNorm(burnStmts, "DSTP");
  const poweStmt = stmtByNorm(burnStmts, "POWE", "POWER");
  const dpowStmt = stmtByNorm(burnStmts, "DPOW");
  const fluxStmt = stmtByNorm(burnStmts, "FLUX");

  const fiszMats = fiszStmt
    ? expandMaterialIntervals(parseStatementNumbers(fiszStmt.text, vars))
    : [];
  const abszMats = abszStmt
    ? expandMaterialIntervals(parseStatementNumbers(abszStmt.text, vars))
    : [];
  const powzMats = powzStmt
    ? expandMaterialIntervals(parseStatementNumbers(powzStmt.text, vars))
    : [];

  const issues = validateBurnupStepOption({
    code,
    hasFinish,
    hasPowe,
    hasDpow,
    hasFlux,
    hasStep,
    hasDstp,
    hasFisz,
    hasAbsz,
    hasPowz,
    fiszMats,
    abszMats,
    powzMats,
    knownMats,
    burByMat,
    stepValues: stepStmt ? parseStatementNumbers(stepStmt.text, vars) : [],
    dstpValues: dstpStmt ? parseStatementNumbers(dstpStmt.text, vars) : [],
    poweValues: poweStmt ? parseStatementNumbers(poweStmt.text, vars) : [],
    dpowValues: dpowStmt ? parseStatementNumbers(dpowStmt.text, vars) : [],
    fluxValues: fluxStmt ? parseStatementNumbers(fluxStmt.text, vars) : [],
    pbur,
    stepOptionActive,
  });

  for (const issue of issues) {
    let range = fallbackRange;
    switch (issue.code) {
      case "burnup-missing-code":
      case "burnup-code-invalid":
        range = attachRange(burnStmts, fallbackRange, ["CODE", "BURN"]);
        break;
      case "burnup-missing-finish":
        range = attachRange(burnStmts, fallbackRange, ["BURN"]);
        break;
      case "burnup-missing-power":
      case "burnup-powe-dpow-conflict":
        range = attachRange(burnStmts, fallbackRange, ["POWE", "POWER", "DPOW", "FLUX", "CODE", "BURN"]);
        break;
      case "burnup-missing-step":
      case "burnup-step-dstp-conflict":
        range = attachRange(burnStmts, fallbackRange, ["STEP", "DSTP", "CODE", "BURN"]);
        break;
      case "burnup-missing-fisz-absz":
        range = attachRange(burnStmts, fallbackRange, ["FISZ", "FISZON", "ABSZ", "CODE", "BURN"]);
        break;
      case "burnup-fisz-unknown":
        range = fiszStmt?.range ?? fallbackRange;
        break;
      case "burnup-absz-unknown":
        range = abszStmt?.range ?? fallbackRange;
        break;
      case "burnup-powz-unknown":
        range = powzStmt?.range ?? fallbackRange;
        break;
      case "burnup-bur-mismatch": {
        const matM = issue.message.match(/MATR\s+(\d+)/i) ?? issue.message.match(/материал\s+(\d+)/i);
        const matN = matM ? parseInt(matM[1], 10) : NaN;
        const burInfo = Number.isFinite(matN) ? burTags.get(matN) : undefined;
        if (burInfo) range = burInfo.range;
        else if (/^FISZ/i.test(issue.message)) range = fiszStmt?.range ?? fallbackRange;
        else if (/^ABSZ/i.test(issue.message)) range = abszStmt?.range ?? fallbackRange;
        else if (/^POWZ/i.test(issue.message)) range = powzStmt?.range ?? fallbackRange;
        else range = fallbackRange;
        break;
      }
      case "burnup-dt-small":
      case "burnup-time-order":
        if (/^DSTP/i.test(issue.message)) range = dstpStmt?.range ?? fallbackRange;
        else if (/^STEP/i.test(issue.message)) range = stepStmt?.range ?? fallbackRange;
        else if (/^POWE/i.test(issue.message)) range = poweStmt?.range ?? fallbackRange;
        else if (/^DPOW/i.test(issue.message)) range = dpowStmt?.range ?? fallbackRange;
        else if (/^FLUX/i.test(issue.message)) range = fluxStmt?.range ?? fallbackRange;
        else range = fallbackRange;
        break;
      case "burnup-pbur-invalid":
        range = pburStmt?.range ?? fallbackRange;
        break;
      default:
        range = fallbackRange;
    }
    pushIssue(diags, issue, range);
  }

  return diags;
}
