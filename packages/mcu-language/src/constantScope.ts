import type { ConstantNode, DocumentAst, SourceRange, StatementNode } from "./ast";
import { evaluateExpression } from "./expression";

import { applyGeometryScopeTransition, initialGeometryScopeState } from "./geometryScope";

/** Ключ имени константы в пределах scope (global | cell:NAME | lcell:NAME). */
export function constScopeKey(scope: string | undefined, name: string): string {
  return `${scope ?? "global"}::${name}`;
}

export function isConstantDefinedBefore(
  c: ConstantNode,
  line: number,
  character = Number.MAX_SAFE_INTEGER
): boolean {
  const { start } = c.range;
  return start.line < line || (start.line === line && start.character < character);
}

/**
 * Scope геометрии на строке line (0-based): global | lcell:NAME | cell:NAME.
 * CELL: первый END — конец тел; второй END — конец зон (EXTEND: затем LATT, закрытие ENDXCL).
 */
export function resolveScopeAtLine(statements: StatementNode[], line: number): string {
  const state = initialGeometryScopeState();
  const ordered = [...statements].sort((a, b) => {
    const d = a.range.start.line - b.range.start.line;
    return d !== 0 ? d : a.range.start.character - b.range.start.character;
  });
  for (const stmt of ordered) {
    if (stmt.range.start.line > line) break;
    const label = stmt.label?.toUpperCase() ?? "";
    applyGeometryScopeTransition(state, label, stmt.text);
  }
  return state.scope;
}

export function resolveScopeAtPosition(ast: DocumentAst, line: number, character?: number): string {
  return resolveScopeAtLine(ast.statements, line);
}

export interface VisibleConstant {
  name: string;
  expression: string;
  value: number | null;
  mutable: boolean;
  /** scope определения (global или прототип) */
  scope: string;
  range: SourceRange;
}

/**
 * Эффективный набор констант/переменных в позиции курсора: global + локальные прототипа,
 * локальные перекрывают global с тем же именем.
 */
export function listVisibleConstants(
  constants: ConstantNode[],
  contextScope: string,
  line: number,
  character = Number.MAX_SAFE_INTEGER
): VisibleConstant[] {
  const vars = new Map<string, number>();
  const effective = new Map<string, VisibleConstant>();
  const ordered = [...constants].sort((a, b) => a.range.offset - b.range.offset);

  for (const c of ordered) {
    if (!isConstantDefinedBefore(c, line, character)) continue;
    const scope = c.scope ?? "global";
    if (scope !== "global" && scope !== contextScope) continue;
    const v = evaluateExpression(c.expression, vars);
    if (v !== null) {
      vars.set(c.name, v);
      effective.set(c.name, {
        name: c.name,
        expression: c.expression,
        value: v,
        mutable: c.mutable,
        scope,
        range: c.range,
      });
    }
  }

  return [...effective.values()].sort((a, b) => a.range.offset - b.range.offset);
}

/**
 * Константы/переменные, видимые в точке beforeOffset внутри contextScope.
 * Глобальные EQU/SET + локальные прототипа (перекрывают глобальные с тем же именем).
 * См. UserGuide: CELL §9.2.2, LCELL §9.2.5 (txt ~3264, ~3541).
 */
export function buildScopedVars(
  constants: ConstantNode[],
  beforeOffset: number,
  contextScope = "global"
): Map<string, number> {
  const vars = new Map<string, number>();
  for (const c of constants) {
    if (c.range.offset >= beforeOffset) break;
    const scope = c.scope ?? "global";
    if (scope !== "global" && scope !== contextScope) continue;
    const v = evaluateExpression(c.expression, vars);
    if (v !== null) vars.set(c.name, v);
  }
  return vars;
}
