/**
 * Разворачивает токены картограммы NET: `56*1` → пятьдесят шесть «1»,
 * обычное число остаётся как есть. Предел повторов — защита от гигантских массивов.
 *
 * Метки строк UserGuide §9.2.3: `P<kk><jj>` / `O…` / `M…` —
 * kk = номер условного указателя, jj = номер строки сети.
 */
import type { NetCartogramRow, NetNode } from "./ast";

const MAX_CART_REPEAT = 10_000;

export function expandCartogramToken(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  // 2*(5,6,9) → 5,6,9,5,6,9
  const group = t.match(/^(\d+)\*\(([^)]+)\)$/);
  if (group) {
    const count = parseInt(group[1]!, 10);
    const parts = group[2]!.split(/[\s,]+/).filter(Boolean);
    if (!Number.isFinite(count) || count < 0 || parts.length === 0) return [t];
    const capped = Math.min(count, Math.floor(MAX_CART_REPEAT / parts.length) || 1);
    const out: string[] = [];
    for (let i = 0; i < capped; i++) out.push(...parts);
    return out;
  }
  const m = t.match(/^(\d+)\*([+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?)$/);
  if (m) {
    const count = parseInt(m[1]!, 10);
    if (!Number.isFinite(count) || count < 0) return [t];
    if (count > MAX_CART_REPEAT) return Array(MAX_CART_REPEAT).fill(m[2]!);
    return Array(count).fill(m[2]!);
  }
  return [t];
}

export function expandCartogramTokens(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const t of raw) out.push(...expandCartogramToken(t));
  return out;
}

/** Уникальные материальные номера из развёрнутой картограммы M**. */
export function uniqueMaterialNumsFromCartogram(raw: readonly string[]): number[] {
  const set = new Set<number>();
  for (const t of expandCartogramTokens(raw)) {
    const n = Number(t);
    if (Number.isFinite(n) && n > 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

export type CartogramKind = "reg" | "obj" | "mat";

export interface ParsedCartogramLabel {
  kind: CartogramKind;
  /** Номер условного указателя (УРУ/УОУ/УМУ), 1-based. */
  pointerIndex: number;
  /** Номер строки сети j (1-based); undefined при ALL / LAY-заголовке. */
  rowIndex?: number;
  /** Слой k (1-based) для LAY. */
  layer?: number;
  all?: boolean;
  /** Строка `PkkLAY <n>` — только объявление слоя, без значений. */
  layHeader?: boolean;
}

/**
 * Разбор метки картограммы NET: P0101, P1105, P02ALL, O01ALL, M0156, P01LAY.
 * UserGuide §9.2.3: `P<kk><jj>` — kk = указатель, jj = строка.
 */
export function parseCartogramLabel(label: string): ParsedCartogramLabel | null {
  const m = label.trim().match(/^([POM])(\d{2})(?:ALL|LAY|(\d{2}))?$/i);
  if (!m) return null;
  const letter = m[1]!.toUpperCase();
  const kind: CartogramKind = letter === "P" ? "reg" : letter === "O" ? "obj" : "mat";
  const pointerIndex = parseInt(m[2]!, 10);
  if (!Number.isFinite(pointerIndex) || pointerIndex <= 0) return null;

  const upper = label.trim().toUpperCase();
  if (upper.endsWith("ALL")) {
    return { kind, pointerIndex, all: true };
  }
  if (upper.endsWith("LAY")) {
    return { kind, pointerIndex, layHeader: true };
  }
  if (m[3]) {
    const rowIndex = parseInt(m[3], 10);
    if (!Number.isFinite(rowIndex) || rowIndex <= 0) return null;
    return { kind, pointerIndex, rowIndex };
  }
  // P01 / M1 без jj — трактуем как pointer + row отсутствует (legacy короткие метки)
  return { kind, pointerIndex, rowIndex: 1 };
}

/** Собрать NetCartogramRow из метки и токенов строки (после метки). */
export function buildNetCartogramRow(label: string, rawTokens: readonly string[]): NetCartogramRow | null {
  const parsed = parseCartogramLabel(label);
  if (!parsed || parsed.layHeader) return null;

  const values = expandCartogramTokens(rawTokens);
  if (parsed.all) {
    return {
      label,
      pointerIndex: parsed.pointerIndex,
      all: true,
      layer: parsed.layer,
      values: values.length > 0 ? values : ["0"],
    };
  }
  return {
    label,
    pointerIndex: parsed.pointerIndex,
    rowIndex: parsed.rowIndex,
    layer: parsed.layer,
    values,
  };
}

/**
 * Значение ячейки (i,j,k) 1-based из картограммы указателя pointerIndex.
 * Возвращает сырую строку токена или null.
 */
export function cartogramValueAt(
  rows: readonly NetCartogramRow[] | undefined,
  pointerIndex: number,
  i: number,
  j: number,
  k: number,
  cols: number
): string | null {
  if (!rows || pointerIndex <= 0) return null;
  const matching = rows.filter((r) => r.pointerIndex === pointerIndex);
  if (matching.length === 0) return null;

  const layerRows = matching.filter((r) => r.layer == null || r.layer === k);
  const pool = layerRows.length > 0 ? layerRows : matching;

  const allRow = pool.find((r) => r.all);
  if (allRow) {
    return allRow.values[0] ?? null;
  }

  const row = pool.find((r) => r.rowIndex === j) ?? pool.find((r) => r.rowIndex == null);
  if (!row) return null;

  // Колонка i (1-based) в строке; если values длиннее cols — vertex-layout, берём по i.
  const col = i - 1;
  if (col < 0) return null;
  if (row.values.length === 1 && cols > 1) {
    // одно значение на всю строку
    return row.values[0] ?? null;
  }
  return row.values[col] ?? row.values[0] ?? null;
}

/** Уникальные положительные числа из картограмм (для audit). */
export function uniquePositiveIntsFromCartogramRows(rows: readonly NetCartogramRow[] | undefined): number[] {
  const set = new Set<number>();
  if (!rows) return [];
  for (const row of rows) {
    for (const t of row.values) {
      const n = Number(t);
      if (Number.isInteger(n) && n > 0) set.add(n);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** Совместимость: плоский список values[][] из NetCartogramRow[] (как старый matMaps layer). */
export function cartogramRowsToLegacyMaps(rows: readonly NetCartogramRow[] | undefined): string[][][] | undefined {
  if (!rows || rows.length === 0) return undefined;
  return rows.map((r) => [r.values]);
}

export function cartogramKindField(
  kind: CartogramKind
): "regCartogram" | "objCartogram" | "matCartogram" {
  if (kind === "reg") return "regCartogram";
  if (kind === "obj") return "objCartogram";
  return "matCartogram";
}

export function appendCartogramRow(net: NetNode, kind: CartogramKind, row: NetCartogramRow): void {
  const field = cartogramKindField(kind);
  if (!net[field]) net[field] = [];
  net[field]!.push(row);
  // legacy mirrors
  if (kind === "reg") {
    if (!net.regMaps) net.regMaps = [];
    net.regMaps.push([row.values]);
  } else if (kind === "obj") {
    if (!net.objMaps) net.objMaps = [];
    net.objMaps.push([row.values]);
  } else {
    if (!net.matMaps) net.matMaps = [];
    net.matMaps.push([row.values]);
  }
}
