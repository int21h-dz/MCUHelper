import type { DiagnosticMessage, DocumentAst, SourceRange } from "./ast";
import { parseStatementNumbers } from "./burnupLoad";
import { evaluateExpression } from "./expression";

function buildVars(ast: Pick<DocumentAst, "constants">): Map<string, number> {
  const vars = new Map<string, number>();
  for (const c of ast.constants) {
    const v = evaluateExpression(c.expression, vars);
    if (v !== null) vars.set(c.name, v);
  }
  return vars;
}

export interface PositiveQtyIssue {
  code: "positive-qty" | "positive-step-count";
  message: string;
}

function tokensAfterLabel(text: string): string[] {
  return text
    .trim()
    .replace(/^\S+\s*/, "")
    .split(/[\s,]+/)
    .filter(Boolean);
}

function evalToken(token: string, vars: Map<string, number>): number | null {
  const v = evaluateExpression(token, vars);
  if (v !== null) return v;
  const n = parseFloat(token);
  return Number.isFinite(n) ? n : null;
}

/** Значение ≥ 0 (0 допустим). */
export function checkNonNegativeToken(
  token: string,
  vars: Map<string, number>,
  fieldLabel: string
): PositiveQtyIssue | null {
  const v = evalToken(token, vars);
  if (v === null) return null;
  if (!Number.isFinite(v)) {
    return { code: "positive-qty", message: `${fieldLabel}: нечисловое значение «${token}»` };
  }
  if (v < 0) {
    return { code: "positive-qty", message: `${fieldLabel}: отрицательное значение (${v})` };
  }
  return null;
}

function checkAllNonNegative(
  tokens: string[],
  vars: Map<string, number>,
  cardLabel: string,
  valueName: string
): PositiveQtyIssue[] {
  const issues: PositiveQtyIssue[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const issue = checkNonNegativeToken(tokens[i], vars, `${cardLabel}: ${valueName} [${i + 1}]`);
    if (issue) issues.push(issue);
  }
  return issues;
}

/** POWER: q, t, q, t, … — мощность и время ≥ 0. */
function checkPowerTokens(tokens: string[], vars: Map<string, number>, cardLabel: string): PositiveQtyIssue[] {
  const issues: PositiveQtyIssue[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const role = i % 2 === 0 ? "мощность" : "время";
    const issue = checkNonNegativeToken(tokens[i], vars, `${cardLabel}: ${role} [${i + 1}]`);
    if (issue) issues.push(issue);
  }
  return issues;
}

/** STEP/DSTP/TIMP/TSEC/…: t, n, t, n, … — время ≥ 0, число шагов ≥ 1. */
function checkStepLikeTokens(tokens: string[], vars: Map<string, number>, cardLabel: string): PositiveQtyIssue[] {
  const issues: PositiveQtyIssue[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i % 2 === 0) {
      const issue = checkNonNegativeToken(tokens[i], vars, `${cardLabel}: время [${i + 1}]`);
      if (issue) issues.push(issue);
    } else {
      const v = evalToken(tokens[i], vars);
      if (v === null) continue;
      if (!Number.isFinite(v) || v < 1 || Math.round(v) !== v) {
        issues.push({
          code: "positive-step-count",
          message: `${cardLabel}: число шагов [${i + 1}] должно быть целым ≥ 1 (сейчас ${v})`,
        });
      }
    }
  }
  return issues;
}

const STEP_LIKE_LABELS = new Set(["STEP", "DSTP", "TIMP", "TSEC", "TMIN", "THOU", "TDAY", "TYEA"]);
const POWER_LABELS = new Set(["POWER", "POWE"]);
const VOLUME_LABELS = new Set(["VOL"]);

function pushIssues(
  diags: DiagnosticMessage[],
  issues: PositiveQtyIssue[],
  range: SourceRange
): void {
  for (const issue of issues) {
    diags.push({
      severity: "error",
      message: issue.message,
      code: issue.code,
      range,
    });
  }
}

function analyzeMatrStatement(
  text: string,
  matNumber: number | null,
  nuclides: { name: string; density: string }[],
  vars: Map<string, number>
): PositiveQtyIssue[] {
  const issues: PositiveQtyIssue[] = [];
  const prefix = matNumber != null ? `MATR ${matNumber}` : "MATR";

  const tempM = text.match(/T\s*=\s*(\S+)/i);
  if (tempM) {
    const issue = checkNonNegativeToken(tempM[1], vars, `${prefix}: температура T`);
    if (issue) issues.push(issue);
  }

  const densM = text.match(/(DENSAA|DENSWA|DENSAW|DENSWW)\s*=\s*(\S+)/i);
  if (densM) {
    const issue = checkNonNegativeToken(densM[2], vars, `${prefix}: ${densM[1]}`);
    if (issue) issues.push(issue);
  }

  for (const n of nuclides) {
    const issue = checkNonNegativeToken(n.density, vars, `${prefix}: концентрация ${n.name}`);
    if (issue) issues.push(issue);
  }

  return issues;
}

export function analyzePositiveQuantities(ast: DocumentAst): DiagnosticMessage[] {
  const vars = buildVars(ast);
  const diags: DiagnosticMessage[] = [];

  for (const stmt of ast.statements) {
    const label = stmt.label?.toUpperCase() ?? "";
    const tokens = tokensAfterLabel(stmt.text);

    if (label === "TEMPR" && tokens.length) {
      const issue = checkNonNegativeToken(tokens[0], vars, "TEMPR: температура");
      if (issue) pushIssues(diags, [issue], stmt.range);
      continue;
    }

    if (VOLUME_LABELS.has(label)) {
      pushIssues(diags, checkAllNonNegative(tokens, vars, label, "объём"), stmt.range);
      continue;
    }

    if (POWER_LABELS.has(label)) {
      pushIssues(diags, checkPowerTokens(tokens, vars, label), stmt.range);
      continue;
    }

    if (STEP_LIKE_LABELS.has(label)) {
      pushIssues(diags, checkStepLikeTokens(tokens, vars, label), stmt.range);
      continue;
    }

    if (label === "MATR") {
      const numM = stmt.text.match(/^MATR\s+(\d+)/i);
      const matNumber = numM ? parseInt(numM[1], 10) : null;
      const mat = matNumber != null ? ast.materials.find((m) => m.number === matNumber) : undefined;
      pushIssues(diags, analyzeMatrStatement(stmt.text, matNumber, mat?.nuclides ?? [], vars), stmt.range);
    }
  }

  // MATR без отдельной карты (только нуклиды на продолжении) — nuclides уже в ast.materials
  const matrStmtNumbers = new Set(
    ast.statements.filter((s) => s.label?.toUpperCase() === "MATR").map((s) => {
      const m = s.text.match(/^MATR\s+(\d+)/i);
      return m ? parseInt(m[1], 10) : -1;
    })
  );
  for (const mat of ast.materials) {
    if (matrStmtNumbers.has(mat.number)) continue;
    pushIssues(
      diags,
      mat.nuclides
        .map((n) => checkNonNegativeToken(n.density, vars, `MATR ${mat.number}: концентрация ${n.name}`))
        .filter(Boolean) as PositiveQtyIssue[],
      mat.range
    );
  }

  return diags;
}

/** Для тестов: все числа после метки карты. */
export function parseCardNumbers(text: string, vars: Map<string, number>): number[] {
  return parseStatementNumbers(text, vars);
}
