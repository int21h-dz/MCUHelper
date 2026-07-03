import type { DiagnosticMessage, DocumentAst } from "./ast";
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

export type EnergyGroupIssueCode =
  | "energy-empty"
  | "energy-non-finite"
  | "energy-negative"
  | "energy-order"
  | "energy-missing-zero";

export interface EnergyGroupValidationIssue {
  code: EnergyGroupIssueCode;
  message: string;
}

type EnergyListOrder = "ascending" | "descending";

function isStrictlyMonotonic(values: number[], order: EnergyListOrder): boolean {
  for (let i = 0; i < values.length - 1; i++) {
    const a = values[i];
    const b = values[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (order === "ascending" ? a >= b : a <= b) return false;
  }
  return true;
}

function detectEnergyListOrder(values: number[]): EnergyListOrder | null {
  if (values.length < 2) return "ascending";
  const asc = isStrictlyMonotonic(values, "ascending");
  const desc = isStrictlyMonotonic(values, "descending");
  if (asc && !desc) return "ascending";
  if (desc && !asc) return "descending";
  return null;
}

/**
 * Нижние границы ENERGY (UserGuide §11): ≥ 0, 0 задать явно, верх последней группы — ∞.
 * Допустимы два порядка записи (как в pr2 и RUNTEST):
 * — возрастающий: 0, E1, E2, … (последняя конечная граница перед ∞);
 * — убывающий: …, E2, E1, 0.
 */
export function validateEnergyGroupValues(values: number[]): EnergyGroupValidationIssue[] {
  const issues: EnergyGroupValidationIssue[] = [];
  if (!values.length) {
    issues.push({
      code: "energy-empty",
      message: "ENERGY: пустой список нижних границ энергетических групп",
    });
    return issues;
  }

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      issues.push({
        code: "energy-non-finite",
        message: `ENERGY: нечисловое значение в позиции ${i + 1}`,
      });
    } else if (v < 0) {
      issues.push({
        code: "energy-negative",
        message: `ENERGY: отрицательная граница в позиции ${i + 1} (${v})`,
      });
    }
  }

  const order = detectEnergyListOrder(values);
  if (!order) {
    issues.push({
      code: "energy-order",
      message:
        "ENERGY: границы должны быть строго монотонны — либо по возрастанию (0, E1, E2, …), либо по убыванию (…, E2, E1, 0)",
    });
    return issues;
  }

  if (order === "ascending") {
    if (values[0] !== 0) {
      issues.push({
        code: "energy-missing-zero",
        message: "ENERGY: при возрастающем списке первая нижняя граница должна быть явно задана как 0",
      });
    }
  } else if (values[values.length - 1] !== 0) {
    issues.push({
      code: "energy-missing-zero",
      message: "ENERGY: при убывающем списке последняя нижняя граница должна быть явно задана как 0",
    });
  }

  return issues;
}

export function analyzeEnergyGroupStatements(ast: DocumentAst): DiagnosticMessage[] {
  const vars = buildVars(ast);
  const diags: DiagnosticMessage[] = [];

  for (const stmt of ast.statements) {
    const label = stmt.label?.toUpperCase();
    if (label !== "ENERGY" && label !== "ENERG") continue;

    const values = parseStatementNumbers(stmt.text, vars);
    for (const issue of validateEnergyGroupValues(values)) {
      diags.push({
        severity: "error",
        message: issue.message,
        code: issue.code,
        range: stmt.range,
      });
    }
  }

  return diags;
}
