import type { DocumentAst } from "./ast";
import { evaluateExpression } from "./expression";

function buildVars(ast: Pick<DocumentAst, "constants">): Map<string, number> {
  const vars = new Map<string, number>();
  for (const c of ast.constants) {
    const v = evaluateExpression(c.expression, vars);
    if (v !== null) vars.set(c.name, v);
  }
  return vars;
}

/** Первое числовое поле карты (после метки). */
export function parseStatementFirstNumber(text: string, vars: Map<string, number>): number | null {
  const m = text.trim().match(/^\S+\s+([\d.Ee+-]+)/);
  if (!m) return null;
  const fromExpr = evaluateExpression(m[1], vars);
  if (fromExpr !== null) return fromExpr;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

export interface TotalHistoriesEstimate {
  ntot: number;
  maxser: number;
  total: number;
  nski?: number;
}

/** Суммарное число моделируемых историй: NTOT × MAXSER (последние значения в варианте). */
export function getTotalHistoriesEstimate(ast: DocumentAst): TotalHistoriesEstimate | null {
  const vars = buildVars(ast);
  let ntot: number | null = null;
  let maxser: number | null = null;
  let nski: number | null = null;

  for (const stmt of ast.statements) {
    const label = stmt.label.toUpperCase();
    if (label === "NTOT") {
      const v = parseStatementFirstNumber(stmt.text, vars);
      if (v !== null) ntot = v;
    } else if (label === "MAXS" || label === "MAXSER") {
      const v = parseStatementFirstNumber(stmt.text, vars);
      if (v !== null) maxser = v;
    } else if (label === "NSKI" || label === "NSKIP") {
      const v = parseStatementFirstNumber(stmt.text, vars);
      if (v !== null) nski = v;
    }
  }

  if (ntot == null || maxser == null) return null;
  return {
    ntot,
    maxser,
    total: ntot * maxser,
    nski: nski ?? undefined,
  };
}

export function formatTotalHistoriesEstimate(estimate: TotalHistoriesEstimate): string {
  const fmt = (n: number) => n.toLocaleString("ru-RU");
  const lines = [
    `**Всего историй:** NTOT × MAXSER = ${fmt(estimate.ntot)} × ${fmt(estimate.maxser)} = **${fmt(estimate.total)}**`,
  ];
  if (estimate.nski != null && estimate.nski > 0) {
    lines.push(
      `*NSKI = ${fmt(estimate.nski)}: в статистику пойдёт ${fmt(estimate.maxser)} серий после отбрасывания (UserGuide §14.1).*`
    );
  }
  return lines.join("\n\n");
}
