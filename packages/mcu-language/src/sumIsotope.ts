import type { ConstantNode, DocumentAst, MaterialNode, NuclideEntry, SourceRange, StatementNode } from "./ast";
import { buildScopedVars } from "./constantScope";
import { resolveNuclideConcentration } from "./materialDensity";
import { isSiSumIsotopeCardLine } from "./siCardVsNuclide";
import { getAwLibEntry, getAwLibTable } from "./awLib";

/** Режим списка суммарного изотопа (UserGuide §8.5). */
export type SumIsotopeListMode = "si" | "sinot" | "none";

export interface SumIsotopeState {
  listMode: SumIsotopeListMode;
  /** Имена/номера из активной карты SI или SINOT (верхний регистр). */
  list: ReadonlySet<string>;
  /** Порог SIDEN (яд/см³); null — карта не задана. */
  siden: number | null;
}

export type SumIsotopeReasonKind = "si" | "sinot" | "siden";

export interface SumIsotopeMembership {
  inSum: boolean;
  /** Человекочитаемые причины (может быть несколько: SI + SIDEN). */
  reasons: string[];
  kinds: SumIsotopeReasonKind[];
}

const SUM_LIST_CARDS = new Set(["SI", "SINOT"]);

function tokensAfterLabel(text: string): string[] {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length <= 1) return [];
  return parts.slice(1);
}

function parseSidenValue(text: string, vars: Map<string, number>): number | null {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length < 2) return null;
  return resolveNuclideConcentration(parts[1]!, vars);
}

type MutableSumState = {
  listMode: SumIsotopeListMode;
  list: Set<string>;
  siden: number | null;
};

function applySumCard(stmt: StatementNode, constants: ConstantNode[], state: MutableSumState): void {
  if (stmt.fragment && stmt.fragment !== "physical") return;
  const label = stmt.label.toUpperCase();
  if (label !== "SIDEN" && !SUM_LIST_CARDS.has(label)) return;

  // ⚠ АГЕНТАМ: `SI dens` — кремний в MATR, НЕ карта суммарного изотопа (siCardVsNuclide.ts).
  if (label === "SI" && !isSiSumIsotopeCardLine(stmt.text)) return;

  const vars = buildScopedVars(constants, stmt.range.offset, "global");
  if (label === "SIDEN") {
    state.siden = parseSidenValue(stmt.text, vars);
    return;
  }

  const tokens = tokensAfterLabel(stmt.text).map((t) => t.toUpperCase());
  if (tokens.length === 0) {
    state.listMode = "none";
    state.list = new Set();
    return;
  }
  state.listMode = label === "SI" ? "si" : "sinot";
  state.list = new Set(tokens);
}

/**
 * Состояние SI/SINOT/SIDEN непосредственно перед offset (карта на offset не учитывается).
 * SI и SINOT: активен последний объявленный; пустой список сбрасывает режим.
 * SIDEN активна всегда после объявления (UserGuide §8.5).
 *
 * statements должны быть в порядке возрастания offset (как после parseDocument).
 */
export function resolveSumIsotopeStateAt(
  statements: StatementNode[],
  offset: number,
  constants: ConstantNode[] = []
): SumIsotopeState {
  const state: MutableSumState = { listMode: "none", list: new Set(), siden: null };
  for (const stmt of statements) {
    if (stmt.range.offset >= offset) break;
    applySumCard(stmt, constants, state);
  }
  return { listMode: state.listMode, list: state.list, siden: state.siden };
}

/**
 * Однопроходный расчёт состояния SI/SINOT/SIDEN перед каждым offset.
 * Нужен для больших файлов: N×полный скан statements — минуты на full-core.
 */
export function buildSumIsotopeStatesByOffset(
  statements: StatementNode[],
  offsets: readonly number[],
  constants: ConstantNode[] = []
): Map<number, SumIsotopeState> {
  const targets = [...new Set(offsets)].sort((a, b) => a - b);
  const out = new Map<number, SumIsotopeState>();
  if (targets.length === 0) return out;

  const state: MutableSumState = { listMode: "none", list: new Set(), siden: null };
  let ti = 0;

  const snap = (): SumIsotopeState => ({
    listMode: state.listMode,
    list: new Set(state.list),
    siden: state.siden,
  });

  for (const stmt of statements) {
    while (ti < targets.length && targets[ti]! <= stmt.range.offset) {
      out.set(targets[ti]!, snap());
      ti++;
    }
    if (ti >= targets.length) break;
    applySumCard(stmt, constants, state);
  }
  while (ti < targets.length) {
    out.set(targets[ti]!, snap());
    ti++;
  }
  return out;
}

function formatSidenThreshold(value: number): string {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 0.01 && abs < 1e6) {
    const s = value.toPrecision(6).replace(/\.?0+$/, "");
    return s;
  }
  return value.toExponential(4);
}

function listHit(name: string, list: ReadonlySet<string>): boolean {
  const u = name.toUpperCase();
  if (list.has(u)) return true;
  // Номера в списке SI/SINOT — редкий случай; сравниваем как строку.
  return list.has(u.replace(/^0+/, "")) && /^\d+$/.test(u);
}

/**
 * Входит ли нуклид в суммарный изотоп при данном состоянии карт.
 *
 * Правила (проектные):
 * - по умолчанию — не в сумме;
 * - SI: перечисленные → в сумме;
 * - SINOT: перечисленные → не в сумме (вето, в т.ч. против SIDEN);
 * - SIDEN: dens &lt; value → в сумме (если не в списке активного SINOT);
 * - SI и SINOT взаимоисключающи (активен последний объявленный список).
 */
export function evaluateSumIsotopeMembership(
  nuclide: Pick<NuclideEntry, "name" | "density">,
  state: SumIsotopeState,
  vars: Map<string, number> = new Map()
): SumIsotopeMembership {
  const reasons: string[] = [];
  const kinds: SumIsotopeReasonKind[] = [];
  const nameU = nuclide.name.toUpperCase();
  const blockedBySinot = state.listMode === "sinot" && listHit(nameU, state.list);

  if (state.listMode === "si" && listHit(nameU, state.list)) {
    kinds.push("si");
    reasons.push(`входит в суммарный изотоп (указан в SI)`);
  }

  if (!blockedBySinot && state.siden != null) {
    const dens = resolveNuclideConcentration(nuclide.density, vars);
    if (dens != null && dens < state.siden) {
      kinds.push("siden");
      reasons.push(
        `входит в суммарный изотоп (SIDEN: плотность ${nuclide.density} меньше ${formatSidenThreshold(state.siden)})`
      );
    }
  }

  return { inSum: reasons.length > 0, reasons, kinds };
}

/** Только факт membership — без строк причин. Нужен для счётчиков CodeLens на full-core. */
export function isSumIsotopeMember(
  nuclide: Pick<NuclideEntry, "name" | "density">,
  state: SumIsotopeState,
  vars: Map<string, number> = new Map()
): boolean {
  const nameU = nuclide.name.toUpperCase();
  const blockedBySinot = state.listMode === "sinot" && listHit(nameU, state.list);
  if (state.listMode === "si" && listHit(nameU, state.list)) return true;
  if (blockedBySinot || state.siden == null) return false;
  const dens = resolveNuclideConcentration(nuclide.density, vars);
  return dens != null && dens < state.siden;
}

export interface SumIsotopeNuclideMark {
  materialNumber: number;
  name: string;
  concentration: string;
  range: SourceRange;
  reasons: string[];
  kinds: SumIsotopeReasonKind[];
  inAwLib?: boolean;
}

/** Все нуклиды материалов, входящие в суммарный изотоп, с причинами.
 * `maxMarks`: остановиться после max+1 (caller может отбросить oversized payload). */
export function collectSumIsotopeMarks(
  ast: DocumentAst,
  options?: { maxMarks?: number; lineFrom?: number; lineTo?: number }
): SumIsotopeNuclideMark[] {
  const hasAwLib = Boolean(getAwLibTable()?.entryCount);
  const max = options?.maxMarks;
  const lineFrom = options?.lineFrom;
  const lineTo = options?.lineTo;
  const mats =
    lineFrom != null && lineTo != null
      ? ast.materials.filter((m) =>
          m.nuclides.some((n) => n.range.start.line >= lineFrom! && n.range.start.line <= lineTo!)
        )
      : ast.materials;
  const states = buildSumIsotopeStatesByOffset(
    ast.statements,
    mats.map((m) => m.range.offset),
    ast.constants
  );
  const marks: SumIsotopeNuclideMark[] = [];
  for (const mat of mats) {
    const state = states.get(mat.range.offset) ?? {
      listMode: "none" as const,
      list: new Set<string>(),
      siden: null,
    };
    const vars = buildScopedVars(ast.constants, mat.range.offset, "global");
    for (const n of mat.nuclides) {
      if (lineFrom != null && n.range.start.line < lineFrom) continue;
      if (lineTo != null && n.range.start.line > lineTo) continue;
      const m = evaluateSumIsotopeMembership(n, state, vars);
      if (!m.inSum) continue;
      marks.push({
        materialNumber: mat.number,
        name: n.name,
        concentration: n.density,
        range: n.range,
        reasons: m.reasons,
        kinds: m.kinds,
        ...(hasAwLib ? { inAwLib: Boolean(getAwLibEntry(n.name)) } : {}),
      });
      if (max != null && marks.length > max) return marks;
    }
  }
  return marks;
}

/** Membership для нуклида материала (по offset карты MATR). */
export function sumIsotopeForNuclide(
  ast: DocumentAst,
  material: MaterialNode,
  nuclide: Pick<NuclideEntry, "name" | "density">
): SumIsotopeMembership {
  const state = resolveSumIsotopeStateAt(ast.statements, material.range.offset, ast.constants);
  const vars = buildScopedVars(ast.constants, material.range.offset, "global");
  return evaluateSumIsotopeMembership(nuclide, state, vars);
}
