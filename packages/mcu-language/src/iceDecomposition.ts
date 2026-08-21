import type { DocumentAst, MaterialNode, StatementNode } from "./ast";

/**
 * Состояние карт ICE / ICENOT (UserGuide §8.7).
 * Список действует с момента объявления; последняя карта побеждает.
 * `ICE list` — allowlist элементов для разложения; `ICENOT list` — blocklist.
 * Пустой список — с этого момента разложение не производится.
 * `ICENOT AAAA` — исключить все элементы (рекомендация руководства).
 */
export type IceListMode = "ice" | "icenot" | "off" | "none";

export interface IceDecompositionState {
  listMode: IceListMode;
  /** Имена элементов из активной карты (верхний регистр). */
  list: ReadonlySet<string>;
}

const ICE_CARDS = new Set(["ICE", "ICENOT"]);

function tokensAfterLabel(text: string): string[] {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length <= 1) return [];
  return parts.slice(1);
}

type MutableIceState = {
  listMode: IceListMode;
  list: Set<string>;
};

function applyIceCard(stmt: StatementNode, state: MutableIceState): void {
  if (stmt.fragment && stmt.fragment !== "physical") return;
  const label = stmt.label.toUpperCase();
  if (!ICE_CARDS.has(label)) return;

  const tokens = tokensAfterLabel(stmt.text).map((t) => t.toUpperCase());
  if (tokens.length === 0) {
    state.listMode = "off";
    state.list = new Set();
    return;
  }
  state.listMode = label === "ICE" ? "ice" : "icenot";
  state.list = new Set(tokens);
}

/**
 * Состояние ICE/ICENOT непосредственно перед offset (карта на offset не учитывается).
 * statements — в порядке возрастания offset (как после parseDocument).
 */
export function resolveIceDecompositionStateAt(
  statements: StatementNode[],
  offset: number
): IceDecompositionState {
  const state: MutableIceState = { listMode: "none", list: new Set() };
  for (const stmt of statements) {
    if (stmt.range.offset >= offset) break;
    applyIceCard(stmt, state);
  }
  return { listMode: state.listMode, list: state.list };
}

/**
 * Нуклид (природная смесь) не разлагается MCU при текущем ICE/ICENOT.
 * UserGuide §8.7: ICE = allowlist, ICENOT = blocklist, пустой list / off — разложение выкл.
 * Тогда в hover не предлагаем «Разложить на изотопы».
 */
export function isIceExpandBlocked(
  nuclideName: string,
  state: IceDecompositionState
): boolean {
  if (state.listMode === "off") return true;
  if (state.listMode === "none") return false;
  const key = nuclideName.trim().toUpperCase();
  if (state.listMode === "ice") {
    // Allowlist: разложение только для перечисленных элементов.
    return !state.list.has(key);
  }
  // icenot
  if (state.list.has("AAAA")) return true;
  return state.list.has(key);
}

/** Блокировка expand-кнопки для нуклида материала (по offset карты MATR). */
export function isIceExpandBlockedForMaterial(
  ast: DocumentAst,
  material: MaterialNode,
  nuclideName: string
): boolean {
  const state = resolveIceDecompositionStateAt(ast.statements, material.range.offset);
  return isIceExpandBlocked(nuclideName, state);
}
