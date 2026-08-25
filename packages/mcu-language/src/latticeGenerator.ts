/**
 * Конструктор LATT: G2MP / G2AR / GLTL (UserGuide §9.2.6).
 * Парсинг блока из документа → форма; сборка текста → вставка/замена.
 */

import type { BodyNode, DocumentAst, LatticeNode } from "./ast";
import { evaluateExpression } from "./expression";
import { rangeCoversEditorLine, remapRangeToMainDocument } from "./includeLineMap";
import { parseDocument } from "./parser";

export type LatticeType = "G2MP" | "G2AR" | "GLTL";

export type GltlPlacement = {
  /** Имя из LISTEL (или пусто → тип 1). */
  element: string;
  /** 1-based номер в LISTEL (/n в PARM). */
  protoIndex?: number;
  x: string;
  y: string;
  z: string;
};

/** XY-контур тела прототипа (локальные координаты LCELL). */
export type ProtoShape =
  | { kind: "rect"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "poly"; points: Array<{ x: number; y: number }> };

export type ProtoFootprint = {
  name: string;
  shapes: ProtoShape[];
};

export type LatticeGeneratorInput = {
  latticeType: LatticeType;
  zoneName: string;
  elements: string[];
  /** G2MP: столбцы I / строки J. G2AR: ширина/высота сетки индексов. */
  cols: number;
  rows: number;
  /** G2AR: границы индексов i, j (включительно). */
  iMin: number;
  iMax: number;
  jMin: number;
  jMax: number;
  vectorA: [string, string, string];
  vectorB: [string, string, string];
  vectorC: [string, string, string];
  /**
   * G2MP: имя прототипа или «0».
   * G2AR: «0» = исключение; иначе имя из LISTEL (пустые клетки при сборке → тип 1).
   */
  cartogram: string[][];
  /** GLTL: явные сдвиги. */
  placements: GltlPlacement[];
  lfixso: string;
  lblack: string;
  /** Контуры LCELL для превью (локальные XY). */
  footprints: ProtoFootprint[];
};

export type LatticeGeneratorResult = {
  text: string;
  warnings: string[];
  okToInsert: boolean;
};

export type LatticeBlockRange = {
  startLine: number;
  endLine: number;
};

const NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,5}$/;

const LATT_STOP = new Set([
  "FINISH",
  "LATT",
  "LCELL",
  "CELL",
  "NET",
  "HEAD",
  "CONT",
  "PIN",
  "SRCD",
  "SRC",
  "SPNT",
  "RGS",
  "REGD",
  "REG",
  "BRG",
  "BRGD",
  "NTOT",
  "NAMVAR",
  "NAMV",
  "BURN",
  "BURD",
  "V01",
  "SHOW",
  "STOP",
]);

export function isValidMcuName(name: string): boolean {
  return NAME_RE.test(name);
}

export function formatG2mpRowLabel(rowIndex1Based: number): string {
  return `L${String(rowIndex1Based).padStart(2, "0")}`;
}

export function emptyCartogram(cols: number, rows: number, fill = "0"): string[][] {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  return Array.from({ length: r }, () => Array.from({ length: c }, () => fill));
}

export function resizeCartogram(
  prev: string[][],
  cols: number,
  rows: number,
  fill = "0"
): string[][] {
  const next = emptyCartogram(cols, rows, fill);
  for (let j = 0; j < next.length; j++) {
    const src = prev[j];
    if (!src) continue;
    for (let i = 0; i < next[j]!.length; i++) {
      const v = src[i];
      if (v !== undefined && v !== "") next[j]![i] = v;
    }
  }
  return next;
}

function lineLabel(raw: string): string {
  const t = raw.trim();
  if (!t || t.startsWith("*") || t.startsWith("C=")) return "";
  const m = t.match(/^([A-Za-z][A-Za-z0-9]{0,5})/);
  return m ? m[1]!.toUpperCase() : "";
}

/** Блок LATT… до следующего стоп-лейбла (включая LFIXSO/LBLACK и L01…). */
export function findLatticeBlockAtLine(
  lines: readonly string[],
  line: number
): LatticeBlockRange | null {
  if (line < 0 || line >= lines.length) return null;
  let start = -1;
  for (let i = line; i >= 0; i--) {
    if (lineLabel(lines[i]!) === "LATT") {
      start = i;
      break;
    }
  }
  if (start < 0) {
    for (let i = line; i < lines.length; i++) {
      if (lineLabel(lines[i]!) === "LATT") {
        start = i;
        break;
      }
    }
  }
  if (start < 0) return null;

  let end = start;
  for (let j = start + 1; j < lines.length; j++) {
    const lab = lineLabel(lines[j]!);
    if (!lab) {
      end = j;
      continue;
    }
    if (LATT_STOP.has(lab)) break;
    end = j;
  }
  return { startLine: start, endLine: end };
}

function vecLine(v: [string, string, string]): string {
  return `${v[0].trim()},${v[1].trim()},${v[2].trim()}`;
}

function normalizeCell(raw: string): string {
  const t = raw.trim();
  if (!t || t === "0" || t === "-" || t.toLowerCase() === "empty") return "0";
  return t;
}

function commonValidate(
  input: LatticeGeneratorInput,
  warnings: string[]
): { zoneName: string; elements: string[] } {
  const zoneName = input.zoneName.trim();
  if (!zoneName || !isValidMcuName(zoneName)) {
    warnings.push("Зона-носитель: имя MCU (буква + до 5 букв/цифр).");
  }
  const elements = input.elements.map((e) => e.trim()).filter(Boolean);
  if (!elements.length) {
    warnings.push("LISTEL: укажите хотя бы один прототип LCELL.");
  }
  for (const el of elements) {
    if (!isValidMcuName(el)) {
      warnings.push(`Имя прототипа «${el}» недопустимо (≤6 символов, буква+…).`);
    }
  }
  const uniq = new Set(elements.map((e) => e.toUpperCase()));
  if (uniq.size !== elements.length) {
    warnings.push("LISTEL: повторяющиеся имена прототипов.");
  }
  return { zoneName, elements };
}

function appendSourceOpts(lines: string[], input: LatticeGeneratorInput): void {
  const fix = input.lfixso?.trim();
  const blk = input.lblack?.trim();
  if (fix) lines.push(`LFIXSO ${fix}`);
  if (blk) lines.push(`LBLACK ${blk}`);
}

function softOrHard(warnings: string[]): { hard: boolean } {
  return {
    hard: warnings.some((w) => !w.includes("будет вставлена") && !w.includes("как есть")),
  };
}

export function buildG2mpLatticeStatement(input: LatticeGeneratorInput): LatticeGeneratorResult {
  const warnings: string[] = [];
  const { zoneName, elements } = commonValidate(input, warnings);
  const cols = Math.floor(input.cols);
  const rows = Math.floor(input.rows);
  if (!(cols >= 1 && cols <= 99)) warnings.push("Число столбцов I: целое 1…99.");
  if (!(rows >= 1 && rows <= 99)) warnings.push("Число строк J: целое 1…99.");
  for (const [v, lab] of [
    [input.vectorA, "A"],
    [input.vectorB, "B"],
    [input.vectorC, "C"],
  ] as const) {
    if (v.some((x) => !String(x ?? "").trim())) {
      warnings.push(`Вектор ${lab}: заполните все три координаты.`);
    }
  }
  const elementSet = new Set(elements);
  const map = resizeCartogram(input.cartogram ?? [], cols, rows);
  for (const row of map) {
    for (const cell of row) {
      const n = normalizeCell(cell);
      if (n !== "0" && !elementSet.has(n)) {
        warnings.push(`Ячейка «${n}» не входит в LISTEL — будет вставлена как есть.`);
      }
    }
  }
  if (softOrHard(warnings).hard) return { text: "", warnings, okToInsert: false };

  const lines: string[] = [
    `LATT G2MP ${zoneName}`,
    `LISTEL ${elements.join(" ")}`,
    `PARM ${cols},${rows} ${vecLine(input.vectorA)} ${vecLine(input.vectorB)} ${vecLine(input.vectorC)}`,
  ];
  for (let j = 0; j < rows; j++) {
    const cells = map[j]!.map((c) => normalizeCell(c));
    lines.push(`${formatG2mpRowLabel(j + 1)} ${cells.join(" ")}`);
  }
  appendSourceOpts(lines, input);
  lines.push("");
  return { text: lines.join("\n"), warnings, okToInsert: true };
}

function formatIndexBound(min: number, max: number): string {
  return min === 0 ? String(max) : `${min}:${max}`;
}

function expandIndexPairToken(tok: string): Array<[number, number]> {
  const m = tok.match(/^(-?\d+(?::\-?\d+)?),(-?\d+(?::\-?\d+)?)$/);
  if (!m) return [];
  const expand = (s: string): number[] => {
    if (s.includes(":")) {
      const [a, b] = s.split(":").map((x) => parseInt(x, 10));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
      const out: number[] = [];
      if (a! <= b!) for (let x = a!; x <= b!; x++) out.push(x);
      else for (let x = a!; x >= b!; x--) out.push(x);
      return out;
    }
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? [n] : [];
  };
  const is = expand(m[1]!);
  const js = expand(m[2]!);
  const out: Array<[number, number]> = [];
  for (const i of is) for (const j of js) out.push([i, j]);
  return out;
}

function compactPairs(pairs: Array<[number, number]>): string {
  if (!pairs.length) return "";
  // Горизонтальные прогоны: a:b,j (как в UserGuide §9.2.6.2)
  const byJ = new Map<number, number[]>();
  for (const [i, j] of pairs) {
    const list = byJ.get(j) ?? [];
    list.push(i);
    byJ.set(j, list);
  }
  const tokens: string[] = [];
  for (const j of [...byJ.keys()].sort((a, b) => a - b)) {
    const uniq = [...new Set(byJ.get(j)!)].sort((a, b) => a - b);
    let start = uniq[0]!;
    let prev = uniq[0]!;
    const flush = (from: number, to: number) => {
      tokens.push(from === to ? `${from},${j}` : `${from}:${to},${j}`);
    };
    for (let k = 1; k < uniq.length; k++) {
      const cur = uniq[k]!;
      if (cur === prev + 1) {
        prev = cur;
      } else {
        flush(start, prev);
        start = cur;
        prev = cur;
      }
    }
    flush(start, prev);
  }
  return tokens.join(" ");
}

export function buildG2arLatticeStatement(input: LatticeGeneratorInput): LatticeGeneratorResult {
  const warnings: string[] = [];
  const { zoneName, elements } = commonValidate(input, warnings);
  let iMin = Math.floor(input.iMin);
  let iMax = Math.floor(input.iMax);
  let jMin = Math.floor(input.jMin);
  let jMax = Math.floor(input.jMax);
  if (iMax < iMin) [iMin, iMax] = [iMax, iMin];
  if (jMax < jMin) [jMin, jMax] = [jMax, jMin];
  const cols = iMax - iMin + 1;
  const rows = jMax - jMin + 1;
  if (cols < 1 || rows < 1 || cols > 99 || rows > 99) {
    warnings.push("G2AR: границы индексов i/j задайте так, чтобы сетка была 1…99.");
  }
  for (const [v, lab] of [
    [input.vectorA, "A"],
    [input.vectorB, "B"],
    [input.vectorC, "C"],
  ] as const) {
    if (v.some((x) => !String(x ?? "").trim())) {
      warnings.push(`Вектор ${lab}: заполните все три координаты.`);
    }
  }
  if (softOrHard(warnings).hard) return { text: "", warnings, okToInsert: false };

  const fillDefault = elements[0] ?? "0";
  const map = resizeCartogram(input.cartogram ?? [], cols, rows, fillDefault);
  const exclusions: Array<[number, number]> = [];
  const byType = new Map<number, Array<[number, number]>>();

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cell = normalizeCell(map[j]![i]!);
      const ii = iMin + i;
      const jj = jMin + j;
      if (cell === "0") {
        exclusions.push([ii, jj]);
        continue;
      }
      const idx = elements.indexOf(cell);
      if (idx < 0) {
        warnings.push(`Ячейка «${cell}» не в LISTEL — пропущена.`);
        continue;
      }
      if (idx === 0) continue;
      const list = byType.get(idx + 1) ?? [];
      list.push([ii, jj]);
      byType.set(idx + 1, list);
    }
  }

  const listelLines =
    elements.length <= 1
      ? [`LISTEL ${elements[0] ?? ""}`]
      : [`LISTEL ${elements[0]}`, ...elements.slice(1).map((e) => `          ${e}`)];

  // Как в рис. А.57: размерность+векторы, затем исключения, затем /n списки
  const lines: string[] = [
    `LATT G2AR ${zoneName}`,
    ...listelLines,
    `PARM ${formatIndexBound(iMin, iMax)} ${formatIndexBound(jMin, jMax)} ${vecLine(input.vectorA)} ${vecLine(input.vectorB)} ${vecLine(input.vectorC)}`,
  ];
  if (exclusions.length) {
    lines.push(`     ${compactPairs(exclusions)}`);
  }
  for (const [n, pairs] of [...byType.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(`     /${n} ${compactPairs(pairs)}`);
  }
  appendSourceOpts(lines, input);
  lines.push("");
  return { text: lines.join("\n"), warnings, okToInsert: true };
}

export function buildGltlLatticeStatement(input: LatticeGeneratorInput): LatticeGeneratorResult {
  const warnings: string[] = [];
  const { zoneName, elements } = commonValidate(input, warnings);
  const placements = (input.placements ?? []).filter(
    (p) => String(p.x ?? "").trim() || String(p.y ?? "").trim() || String(p.z ?? "").trim()
  );
  if (!placements.length) {
    warnings.push("GLTL: добавьте хотя бы один сдвиг (x,y,z).");
  }
  for (const p of placements) {
    if (!String(p.x).trim() || !String(p.y).trim() || !String(p.z).trim()) {
      warnings.push("GLTL: у каждого сдвига заполните x,y,z.");
      break;
    }
    if (p.element && !elements.includes(p.element) && isValidMcuName(p.element)) {
      warnings.push(`Сдвиг «${p.element}» не в LISTEL — будет вставлен по индексу, если найдётся.`);
    }
  }
  if (softOrHard(warnings).hard) return { text: "", warnings, okToInsert: false };

  const chunks: string[] = [];
  for (const p of placements) {
    const el = p.element.trim();
    let idx = p.protoIndex && p.protoIndex >= 1 ? p.protoIndex : 1;
    if (el) {
      const found = elements.indexOf(el);
      if (found >= 0) idx = found + 1;
    }
    const triple = `${p.x.trim()},${p.y.trim()},${p.z.trim()}`;
    // каждый сдвиг — со своим /n (как в примерах UserGuide)
    chunks.push(`/${idx} ${triple}`);
  }

  const listelLines =
    elements.length <= 1
      ? [`LISTEL ${elements[0] ?? ""}`]
      : [`LISTEL ${elements[0]}`, ...elements.slice(1).map((e) => `          ${e}`)];

  // PARM: по одному размещению на строку (продолжение с отступом)
  const parmLines = chunks.length
    ? chunks.map((c, i) => (i === 0 ? `PARM ${c}` : `     ${c}`))
    : ["PARM"];

  const lines: string[] = [`LATT GLTL ${zoneName}`, ...listelLines, ...parmLines];
  appendSourceOpts(lines, input);
  lines.push("");
  return { text: lines.join("\n"), warnings, okToInsert: true };
}

export function buildLatticeStatement(input: LatticeGeneratorInput): LatticeGeneratorResult {
  const t = (input.latticeType || "G2MP").toUpperCase();
  if (t === "GLTL") return buildGltlLatticeStatement(input);
  if (t === "G2AR") return buildG2arLatticeStatement(input);
  return buildG2mpLatticeStatement({ ...input, latticeType: "G2MP" });
}

function parseCoordNum(raw: string): number | null {
  const v = parseFloat(String(raw ?? "").replace(/,/g, ".").trim());
  return Number.isFinite(v) ? v : null;
}

function fmtCoordNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}

/** A + k·B + m·C покомпонентно (числа → число; иначе выражение). */
function combineRootVector(
  a: [string, string, string],
  k: number,
  b: [string, string, string],
  m: number,
  c: [string, string, string]
): [string, string, string] {
  if (k === 0 && m === 0) return [...a] as [string, string, string];
  const out: [string, string, string] = ["0", "0", "0"];
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? "0";
    const bv = b[i] ?? "0";
    const cv = c[i] ?? "0";
    const an = parseCoordNum(av);
    const bn = parseCoordNum(bv);
    const cn = parseCoordNum(cv);
    if (an != null && bn != null && cn != null) {
      out[i] = fmtCoordNum(an + k * bn + m * cn);
      continue;
    }
    const parts: string[] = [av.trim() || "0"];
    if (k !== 0) {
      parts.push(k === 1 ? `(${bv})` : `(${k})*(${bv})`);
    }
    if (m !== 0) {
      parts.push(m === 1 ? `(${cv})` : `(${m})*(${cv})`);
    }
    out[i] = parts.join("+");
  }
  return out;
}

function cartogramWorldPosG2ar(
  i: number,
  j: number,
  a: [string, string, string],
  b: [string, string, string],
  c: [string, string, string]
): { x: number; y: number; z: number } | null {
  const va = a.map(parseCoordNum);
  const vb = b.map(parseCoordNum);
  const vc = c.map(parseCoordNum);
  if (va.some((v) => v == null) || vb.some((v) => v == null) || vc.some((v) => v == null)) {
    return null;
  }
  return {
    x: va[0]! + i * vb[0]! + j * vc[0]!,
    y: va[1]! + i * vb[1]! + j * vc[1]!,
    z: va[2]! + i * vb[2]! + j * vc[2]!,
  };
}

function cartogramWorldPosG2mp(
  i1: number,
  j1: number,
  a: [string, string, string],
  b: [string, string, string],
  c: [string, string, string]
): { x: number; y: number; z: number } | null {
  return cartogramWorldPosG2ar(i1 - 1, j1 - 1, a, b, c);
}

function g2arBoundsOf(input: LatticeGeneratorInput): {
  iMin: number;
  iMax: number;
  jMin: number;
  jMax: number;
  cols: number;
  rows: number;
} {
  let iMin = Math.floor(input.iMin);
  let iMax = Math.floor(input.iMax);
  let jMin = Math.floor(input.jMin);
  let jMax = Math.floor(input.jMax);
  if (iMax < iMin) [iMin, iMax] = [iMax, iMin];
  if (jMax < jMin) [jMin, jMax] = [jMax, jMin];
  return {
    iMin,
    iMax,
    jMin,
    jMax,
    cols: Math.max(1, iMax - iMin + 1),
    rows: Math.max(1, jMax - jMin + 1),
  };
}

function cloneInput(input: LatticeGeneratorInput): LatticeGeneratorInput {
  return {
    ...input,
    elements: [...input.elements],
    vectorA: [...input.vectorA] as [string, string, string],
    vectorB: [...input.vectorB] as [string, string, string],
    vectorC: [...input.vectorC] as [string, string, string],
    cartogram: (input.cartogram ?? []).map((r) => [...r]),
    placements: (input.placements ?? []).map((p) => ({ ...p })),
    footprints: input.footprints ?? [],
  };
}

function toG2arFromG2mp(input: LatticeGeneratorInput): LatticeGeneratorInput {
  const out = cloneInput(input);
  const cols = Math.max(1, Math.floor(input.cols) || 1);
  const rows = Math.max(1, Math.floor(input.rows) || 1);
  out.latticeType = "G2AR";
  out.iMin = 0;
  out.iMax = cols - 1;
  out.jMin = 0;
  out.jMax = rows - 1;
  out.cols = cols;
  out.rows = rows;
  out.cartogram = resizeCartogram(input.cartogram ?? [], cols, rows, "0");
  out.placements = [];
  return out;
}

function toG2mpFromG2ar(input: LatticeGeneratorInput): LatticeGeneratorInput {
  const out = cloneInput(input);
  const b = g2arBoundsOf(input);
  out.latticeType = "G2MP";
  out.cols = b.cols;
  out.rows = b.rows;
  out.iMin = 0;
  out.iMax = b.cols - 1;
  out.jMin = 0;
  out.jMax = b.rows - 1;
  // G2MP A — корень (1,1) ≡ G2AR (iMin,jMin)
  out.vectorA = combineRootVector(
    input.vectorA,
    b.iMin,
    input.vectorB,
    b.jMin,
    input.vectorC
  );
  out.cartogram = resizeCartogram(input.cartogram ?? [], b.cols, b.rows, "0");
  out.placements = [];
  return out;
}

function cartogramToGltlPlacements(
  cartogram: string[][],
  elements: string[],
  worldAt: (ci: number, cj: number) => { x: number; y: number; z: number } | null
): GltlPlacement[] {
  const placements: GltlPlacement[] = [];
  for (let cj = 0; cj < cartogram.length; cj++) {
    const row = cartogram[cj] ?? [];
    for (let ci = 0; ci < row.length; ci++) {
      const cell = String(row[ci] ?? "0").trim() || "0";
      if (cell === "0") continue;
      const w = worldAt(ci, cj);
      if (!w) continue;
      const pi = Math.max(1, elements.indexOf(cell) + 1);
      placements.push({
        element: cell,
        protoIndex: pi,
        x: fmtCoordNum(w.x),
        y: fmtCoordNum(w.y),
        z: fmtCoordNum(w.z),
      });
    }
  }
  return placements;
}

function toGltlFromCartogram(input: LatticeGeneratorInput, asG2mp: boolean): LatticeGeneratorInput {
  const out = cloneInput(input);
  out.latticeType = "GLTL";
  const els = out.elements.length ? out.elements : ["A"];
  if (asG2mp) {
    const cols = Math.max(1, Math.floor(input.cols) || 1);
    const rows = Math.max(1, Math.floor(input.rows) || 1);
    const map = resizeCartogram(input.cartogram ?? [], cols, rows, "0");
    out.placements = cartogramToGltlPlacements(map, els, (ci, cj) =>
      cartogramWorldPosG2mp(ci + 1, cj + 1, input.vectorA, input.vectorB, input.vectorC)
    );
  } else {
    const b = g2arBoundsOf(input);
    const map = resizeCartogram(input.cartogram ?? [], b.cols, b.rows, "0");
    out.placements = cartogramToGltlPlacements(map, els, (ci, cj) =>
      cartogramWorldPosG2ar(b.iMin + ci, b.jMin + cj, input.vectorA, input.vectorB, input.vectorC)
    );
  }
  if (!out.placements.length) {
    out.placements = [{ element: els[0]!, protoIndex: 1, x: "0", y: "0", z: "0" }];
  }
  out.cartogram = [];
  return out;
}

function toCartogramFromGltl(
  input: LatticeGeneratorInput,
  target: "G2AR" | "G2MP"
): LatticeGeneratorInput {
  const out = cloneInput(input);
  const els = out.elements.length ? out.elements : ["A"];
  const grid = inferGltlGridSize(input.placements ?? []);
  const xs = grid.xs.length ? grid.xs : [0];
  const ys = grid.ys.length ? grid.ys : [0];
  const cols = Math.max(1, xs.length);
  const rows = Math.max(1, ys.length);
  const dx = cols > 1 ? xs[1]! - xs[0]! : 25;
  const dy = rows > 1 ? ys[1]! - ys[0]! : 25;
  const pitchX = Math.abs(dx) > 1e-9 ? dx : 25;
  const pitchY = Math.abs(dy) > 1e-9 ? dy : 25;
  const a: [string, string, string] = [
    fmtCoordNum(xs[0]!),
    fmtCoordNum(ys[0]!),
    fmtCoordNum(grid.zs[0] ?? 0),
  ];
  const bVec: [string, string, string] = [fmtCoordNum(pitchX), "0", "0"];
  const cVec: [string, string, string] = ["0", fmtCoordNum(pitchY), "0"];
  const map = emptyCartogram(cols, rows, "0");

  for (const p of input.placements ?? []) {
    const x = parseCoordNum(p.x);
    const y = parseCoordNum(p.y);
    if (x == null || y == null) continue;
    let bestI = 0;
    let bestJ = 0;
    let bestD = Infinity;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const d = Math.hypot(x - xs[i]!, y - ys[j]!);
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    const tol = 0.55 * Math.max(Math.abs(pitchX), Math.abs(pitchY), 1);
    if (bestD > tol) continue;
    const pi =
      p.protoIndex && p.protoIndex >= 1
        ? p.protoIndex
        : Math.max(1, els.indexOf(p.element) + 1);
    map[bestJ]![bestI] = els[pi - 1] ?? p.element ?? els[0]!;
  }

  out.vectorA = a;
  out.vectorB = bVec;
  out.vectorC = cVec;
  out.cartogram = map;
  out.cols = cols;
  out.rows = rows;
  out.placements = [];
  if (target === "G2MP") {
    out.latticeType = "G2MP";
    out.iMin = 0;
    out.iMax = cols - 1;
    out.jMin = 0;
    out.jMax = rows - 1;
  } else {
    out.latticeType = "G2AR";
    out.iMin = 0;
    out.iMax = cols - 1;
    out.jMin = 0;
    out.jMax = rows - 1;
  }
  return out;
}

/**
 * Автоконвертация формы PARM при смене генератора (GLTL ↔ G2AR ↔ G2MP).
 * G2AR↔G2MP: картограмма + сдвиг корня A; GLTL↔*: сетка по уникальным X/Y.
 */
export function convertLatticeGeneratorType(
  input: LatticeGeneratorInput,
  target: LatticeType
): LatticeGeneratorInput {
  const from = (input.latticeType || "GLTL").toUpperCase() as LatticeType;
  const to = target.toUpperCase() as LatticeType;
  if (from === to) return cloneInput({ ...input, latticeType: to });
  if (from === "G2MP" && to === "G2AR") return toG2arFromG2mp(input);
  if (from === "G2AR" && to === "G2MP") return toG2mpFromG2ar(input);
  if (from === "G2MP" && to === "GLTL") return toGltlFromCartogram(input, true);
  if (from === "G2AR" && to === "GLTL") return toGltlFromCartogram(input, false);
  if (from === "GLTL" && (to === "G2AR" || to === "G2MP")) {
    return toCartogramFromGltl(input, to);
  }
  return cloneInput({ ...input, latticeType: to });
}

export function buildLcellStub(name: string): LatticeGeneratorResult {
  const n = name.trim();
  const warnings: string[] = [];
  if (!isValidMcuName(n)) {
    warnings.push("LCELL: имя MCU (буква + до 5 букв/цифр).");
    return { text: "", warnings, okToInsert: false };
  }
  const text = `LCELL ${n}
RPP BL -0.5,0.5 -0.5,0.5 0,1
END
Z BL /1:1
END
ENDL
`;
  return { text, warnings, okToInsert: true };
}

function parseDimToken(tok: string): { min: number; max: number } | null {
  if (/^-?\d+:\-?\d+$/.test(tok)) {
    const [a, b] = tok.split(":").map((x) => parseInt(x, 10));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { min: Math.min(a!, b!), max: Math.max(a!, b!) };
  }
  if (/^-?\d+$/.test(tok)) {
    const max = parseInt(tok, 10);
    return { min: 0, max };
  }
  return null;
}

function splitVecTriple(tok: string): string[] | null {
  const parts = tok.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length === 3 ? parts : null;
}

function takeThreeExprs(tokens: string[], start: number): { vals: [string, string, string]; next: number } | null {
  if (start >= tokens.length) return null;
  const asTriple = splitVecTriple(tokens[start]!);
  if (asTriple) {
    return { vals: [asTriple[0]!, asTriple[1]!, asTriple[2]!], next: start + 1 };
  }
  if (start + 2 < tokens.length) {
    return {
      vals: [tokens[start]!, tokens[start + 1]!, tokens[start + 2]!],
      next: start + 3,
    };
  }
  return null;
}

function tokenizeParm(raw: string): string[] {
  return raw
    .replace(/^PARM\s*/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function parseG2mpParm(tokens: string[]): Partial<LatticeGeneratorInput> | null {
  if (!tokens.length) return null;
  let cols: number;
  let rows: number;
  let i = 0;
  if (tokens[0]!.includes(",")) {
    const [c, r] = tokens[0]!.split(",").map((x) => parseInt(x.trim(), 10));
    if (!Number.isFinite(c) || !Number.isFinite(r)) return null;
    cols = c!;
    rows = r!;
    i = 1;
  } else {
    if (tokens.length < 2) return null;
    cols = parseInt(tokens[0]!.replace(/,/g, ""), 10);
    rows = parseInt(tokens[1]!.replace(/,/g, ""), 10);
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
    i = 2;
  }
  const a = takeThreeExprs(tokens, i);
  if (!a) return null;
  const b = takeThreeExprs(tokens, a.next);
  if (!b) return null;
  const c = takeThreeExprs(tokens, b.next);
  if (!c) return null;
  return {
    cols,
    rows,
    vectorA: a.vals,
    vectorB: b.vals,
    vectorC: c.vals,
  };
}

function parseG2arParm(
  tokens: string[],
  elements: string[]
): Partial<LatticeGeneratorInput> | null {
  if (tokens.length < 2) return null;
  const di = parseDimToken(tokens[0]!);
  const dj = parseDimToken(tokens[1]!);
  if (!di || !dj) return null;
  const a = takeThreeExprs(tokens, 2);
  if (!a) return null;
  const b = takeThreeExprs(tokens, a.next);
  if (!b) return null;
  const c = takeThreeExprs(tokens, b.next);
  if (!c) return null;

  const cols = di.max - di.min + 1;
  const rows = dj.max - dj.min + 1;
  const fill = elements[0] ?? "A";
  const cartogram = emptyCartogram(cols, rows, fill);

  let mode = 0; // 0 exclusions, else type number
  for (let t = c.next; t < tokens.length; t++) {
    const tok = tokens[t]!;
    if (/^\/\d+$/.test(tok)) {
      mode = parseInt(tok.slice(1), 10);
      continue;
    }
    const pairs = expandIndexPairToken(tok);
    if (!pairs.length) continue;
    for (const [ii, jj] of pairs) {
      const ci = ii - di.min;
      const cj = jj - dj.min;
      if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) continue;
      if (mode === 0) cartogram[cj]![ci] = "0";
      else {
        const el = elements[mode - 1];
        if (el) cartogram[cj]![ci] = el;
      }
    }
  }

  return {
    iMin: di.min,
    iMax: di.max,
    jMin: dj.min,
    jMax: dj.max,
    cols,
    rows,
    vectorA: a.vals,
    vectorB: b.vals,
    vectorC: c.vals,
    cartogram,
  };
}

function parseGltlParm(tokens: string[], elements: string[]): GltlPlacement[] {
  const placements: GltlPlacement[] = [];
  let pending = 1;
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (/^\/\d+$/.test(tok)) {
      pending = parseInt(tok.slice(1), 10) || 1;
      i++;
      continue;
    }
    const push = (x: string, y: string, z: string) => {
      const idx = Math.max(1, pending);
      placements.push({
        element: elements[idx - 1] ?? "",
        protoIndex: idx,
        x,
        y,
        z,
      });
      pending = 1;
    };
    const triple = splitVecTriple(tok);
    if (triple) {
      push(triple[0]!, triple[1]!, triple[2]!);
      i++;
      continue;
    }
    if (i + 2 < tokens.length) {
      // не глотать следующий /n как координату
      if (/^\/\d+$/.test(tokens[i]!)) {
        i++;
        continue;
      }
      push(tokens[i]!, tokens[i + 1]!, tokens[i + 2]!);
      i += 3;
      continue;
    }
    i++;
  }
  return placements;
}

/** Пересобрать GLTL-сдвиги из сырого PARM при известном LISTEL (источник правды — сайдбар/AST). */
export function rebuildGltlPlacements(
  parmText: string,
  elements: readonly string[]
): GltlPlacement[] {
  const tokens = tokenizeParm(parmText.startsWith("PARM") ? parmText : `PARM ${parmText}`);
  return parseGltlParm(tokens, [...elements]);
}

/** Размер регулярной сетки по уникальным X/Y (и слоям Z). */
export function inferGltlGridSize(placements: readonly GltlPlacement[]): {
  cols: number;
  rows: number;
  layers: number;
  xs: number[];
  ys: number[];
  zs: number[];
} {
  const toN = (s: string) => {
    const v = parseFloat(String(s).replace(/,/g, "."));
    return Number.isFinite(v) ? v : null;
  };
  const uniq = (arr: number[]) => [...new Set(arr)].sort((a, b) => a - b);
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (const p of placements) {
    const x = toN(p.x);
    const y = toN(p.y);
    const z = toN(p.z);
    if (x != null) xs.push(x);
    if (y != null) ys.push(y);
    if (z != null) zs.push(z);
  }
  const ux = uniq(xs);
  const uy = uniq(ys);
  const uz = uniq(zs);
  return {
    cols: Math.max(1, ux.length),
    rows: Math.max(1, uy.length),
    layers: Math.max(1, uz.length),
    xs: ux,
    ys: uy,
    zs: uz,
  };
}

type G2mpCartogramRow = { row: number; cells: string[] };

function parseG2mpRowLabel(raw: string): number | null {
  const m = raw.trim().match(/^L(\d{2,})$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function cartogramFromLabeledRows(
  entries: readonly G2mpCartogramRow[],
  colsHint: number,
  rowsHint: number
): { cols: number; rows: number; cartogram: string[][] } {
  const maxRow = Math.max(rowsHint, ...entries.map((e) => e.row), 1);
  const cols = Math.max(colsHint, ...entries.map((e) => e.cells.length), 1);
  const cartogram = emptyCartogram(cols, maxRow);
  for (const { row, cells } of entries) {
    if (row < 1 || row > maxRow) continue;
    for (let i = 0; i < cols; i++) {
      const v = cells[i];
      if (v !== undefined && v !== "") cartogram[row - 1]![i] = v;
    }
  }
  return { cols, rows: maxRow, cartogram };
}

function extractCardLines(blockLines: string[]): {
  latt: string;
  listel: string;
  parm: string;
  cartogramRows: string[][];
  g2mpCartogramRows: G2mpCartogramRow[];
  lfixso: string;
  lblack: string;
} {
  let latt = "";
  let listel = "";
  let parm = "";
  let lfixso = "";
  let lblack = "";
  const cartogramRows: string[][] = [];
  const g2mpCartogramRows: G2mpCartogramRow[] = [];
  /** После LISTEL/PARM до следующей карты — дописываем продолжения (в т.ч. без ведущего пробела). */
  let mode: "none" | "listel" | "parm" = "none";

  const stopListel = new Set([
    "PARM",
    "LFIXSO",
    "LBLACK",
    "LATT",
    "FINISH",
    "LCELL",
    "CELL",
    "NET",
    "HEAD",
    "CONT",
    "END",
    "ENDL",
    "SHOW",
    "V01",
  ]);

  for (const raw of blockLines) {
    const t = raw.trim();
    if (!t || t.startsWith("*") || t.startsWith("C=")) continue;
    const lab = lineLabel(raw);
    const isCont = raw.length > 0 && (raw[0] === " " || raw[0] === "\t");

    if (lab === "LATT") {
      latt = t;
      mode = "none";
      continue;
    }
    if (lab === "LISTEL") {
      listel = t.replace(/^LISTEL\s*/i, "").trim();
      mode = "listel";
      continue;
    }
    if (lab === "PARM") {
      parm = t;
      mode = "parm";
      continue;
    }
    if (lab === "LFIXSO") {
      lfixso = t.replace(/^LFIXSO\s*/i, "").trim();
      mode = "none";
      continue;
    }
    if (lab === "LBLACK") {
      lblack = t.replace(/^LBLACK\s*/i, "").trim();
      mode = "none";
      continue;
    }
    if (/^L\d{2,}$/i.test(lab)) {
      const cells = t.split(/\s+/).slice(1);
      cartogramRows.push(cells);
      const row = parseG2mpRowLabel(lab);
      if (row != null) g2mpCartogramRows.push({ row, cells });
      mode = "none";
      continue;
    }

    if (mode === "listel") {
      if (lab && stopListel.has(lab)) {
        mode = "none";
        // fall through — не должно случиться: PARM/LFIXSO уже обработаны выше
      } else {
        // TVS281 / PustYa2 на отдельных строках (часто с ведущим пробелом)
        listel = `${listel} ${t}`.trim();
        continue;
      }
    }

    if (mode === "parm") {
      if (lab && stopListel.has(lab) && lab !== "PARM") {
        mode = "none";
      } else if (isCont || !lab || t.startsWith("/")) {
        parm += ` ${t}`;
        continue;
      }
    } else if (parm && isCont && !lab) {
      parm += ` ${t}`;
    }
  }
  return { latt, listel, parm, cartogramRows, g2mpCartogramRows, lfixso, lblack };
}

/** Разбор текстового блока LATT… в форму конструктора. */
export function parseLatticeBlockText(blockText: string): LatticeGeneratorInput | null {
  const blockLines = blockText.replace(/\r\n/g, "\n").split("\n");
  const { latt, listel, parm, cartogramRows, g2mpCartogramRows, lfixso, lblack } =
    extractCardLines(blockLines);
  if (!latt) return null;
  const lattParts = latt.split(/\s+/);
  const latticeType = (lattParts[1] || "G2MP").toUpperCase() as LatticeType;
  const zoneName = (lattParts[2] || "ZL").replace(/,/g, "");
  const elements = listel
    .split(/[\s,]+/)
    .map((s) => s.replace(/\([^)]*\)$/, "").trim())
    .filter((s) => /^[A-Za-z][A-Za-z0-9]{0,5}$/.test(s));

  const base = defaultLatticeGeneratorInput();
  base.latticeType = ["G2MP", "G2AR", "GLTL"].includes(latticeType) ? latticeType : "G2MP";
  base.zoneName = zoneName;
  base.elements = elements.length ? elements : base.elements;
  base.lfixso = lfixso;
  base.lblack = lblack;

  const tokens = tokenizeParm(parm || "PARM");
  if (base.latticeType === "G2MP") {
    const p = parseG2mpParm(tokens);
    if (p) Object.assign(base, p);
    if (g2mpCartogramRows.length) {
      const mapped = cartogramFromLabeledRows(g2mpCartogramRows, base.cols, base.rows);
      base.cols = mapped.cols;
      base.rows = mapped.rows;
      base.cartogram = mapped.cartogram;
    } else if (cartogramRows.length) {
      const cols = Math.max(base.cols, ...cartogramRows.map((r) => r.length));
      const rows = cartogramRows.length;
      base.cols = cols;
      base.rows = rows;
      base.cartogram = resizeCartogram(cartogramRows, cols, rows);
    }
    return base;
  }
  if (base.latticeType === "G2AR") {
    const p = parseG2arParm(tokens, base.elements);
    if (p) Object.assign(base, p);
    return base;
  }
  base.placements = parseGltlParm(tokens, base.elements);
  if (!base.placements.length) {
    base.placements = [{ element: base.elements[0] ?? "", x: "0", y: "0", z: "0" }];
  }
  return base;
}

function buildScopedVars(ast: DocumentAst, scope: string): Map<string, number> {
  const vars = new Map<string, number>();
  for (const c of ast.constants) {
    const sc = c.scope ?? "global";
    if (sc !== "global" && sc !== scope) continue;
    const v = evaluateExpression(c.expression, vars);
    if (v != null) vars.set(c.name, v);
  }
  return vars;
}

function resolveNum(raw: string, vars: Map<string, number>): number | null {
  return evaluateExpression(String(raw ?? "").trim(), vars);
}

function hexVerticesXY(
  cx: number,
  cy: number,
  flatToFlat: number,
  phiRad: number
): Array<{ x: number; y: number }> {
  const D = Math.abs(flatToFlat);
  if (!(D > 0)) return [];
  // MCU: D — размер «под ключ»; вершины на R = D/√3 (см. mcu-geometry/hex2d)
  const R = D / Math.sqrt(3);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const a = phiRad + i * (Math.PI / 3);
    pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return pts;
}

function bodyToShapes(body: BodyNode, vars: Map<string, number>): ProtoShape[] {
  const t = body.bodyType.toUpperCase();
  const p = body.params.map((x) => resolveNum(x, vars));
  const need = (n: number) => p.slice(0, n).every((x) => x != null);
  if (t === "RPP" && need(4)) {
    return [{ kind: "rect", x1: p[0]!, y1: p[2]!, x2: p[1]!, y2: p[3]! }];
  }
  if (t === "RCZ" && need(5)) {
    return [{ kind: "circle", x: p[0]!, y: p[1]!, r: Math.abs(p[4]!) }];
  }
  if (t === "SPH" && need(4)) {
    return [{ kind: "circle", x: p[0]!, y: p[1]!, r: Math.abs(p[3]!) }];
  }
  if (t === "RCC" && need(7)) {
    // проекция основания на XY
    return [{ kind: "circle", x: p[0]!, y: p[1]!, r: Math.abs(p[6]!) }];
  }
  if (t === "HEX" && p[0] != null && p[1] != null && p[3] != null && p[4] != null) {
    const cx = p[0]!;
    const cy = p[1]!;
    const D = Math.hypot(p[3]!, p[4]!);
    const phi = Math.atan2(p[4]!, p[3]!);
    const points = hexVerticesXY(cx, cy, D, phi);
    return points.length ? [{ kind: "poly", points }] : [];
  }
  if ((t === "HEXX" || t === "HEXY") && p[0] != null && p[1] != null && p[4] != null) {
    const cx = p[0]!;
    const cy = p[1]!;
    const D = Math.abs(p[4]!);
    const fDeg = p[5] ?? 0;
    const phi = ((fDeg + (t === "HEXY" ? 90 : 0)) * Math.PI) / 180;
    const points = hexVerticesXY(cx, cy, D, phi);
    return points.length ? [{ kind: "poly", points }] : [];
  }
  if (t === "SHEX" && p[0] != null) {
    const D = Math.abs(p[0]!);
    const fDeg = p[2] ?? 0;
    const phi = (fDeg * Math.PI) / 180;
    const points = hexVerticesXY(0, 0, D, phi);
    return points.length ? [{ kind: "poly", points }] : [];
  }
  if (t === "BOX" || t === "SBOX") {
    // BOX: C + Vx + Vy + Vz — берём parallelogram в XY из Vx,Vy
    if (need(9)) {
      const ox = p[0]!;
      const oy = p[1]!;
      const vx = p[3]!;
      const vy = p[4]!;
      const wx = p[6]!;
      const wy = p[7]!;
      return [
        {
          kind: "poly",
          points: [
            { x: ox, y: oy },
            { x: ox + vx, y: oy + vy },
            { x: ox + vx + wx, y: oy + vy + wy },
            { x: ox + wx, y: oy + wy },
          ],
        },
      ];
    }
  }
  return [];
}

/** Контуры тел LCELL (XY) для превью решётки. */
export function collectLcellFootprints(
  ast: DocumentAst,
  elementNames: readonly string[]
): ProtoFootprint[] {
  const out: ProtoFootprint[] = [];
  for (const name of elementNames) {
    const scope = `lcell:${name}`;
    const vars = buildScopedVars(ast, scope);
    const shapes: ProtoShape[] = [];
    for (const b of ast.bodies) {
      if ((b.scope ?? "global") !== scope) continue;
      shapes.push(...bodyToShapes(b, vars));
    }
    out.push({ name, shapes });
  }
  return out;
}

/**
 * Достать LCELL…ENDL из текста файла (в т.ч. когда #include не раскрылся в AST)
 * и построить XY-контуры для превью.
 */
export function collectLcellFootprintsFromText(
  fullText: string,
  elementNames: readonly string[]
): ProtoFootprint[] {
  const names = elementNames.map((n) => n.trim()).filter(Boolean);
  if (!names.length) return [];
  const blocks: string[] = [];
  const normalized = fullText.replace(/\r\n/g, "\n");
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^LCELL\\s+${escaped}\\b[\\s\\S]*?^ENDL\\b`, "gim");
    const m = re.exec(normalized);
    if (m?.[0]) blocks.push(m[0]);
  }
  if (!blocks.length) {
    return names.map((name) => ({ name, shapes: [] as ProtoShape[] }));
  }
  const stub = `HEAD 1 0
CONT T T T
RCZ C 0 0 0 10 5
END
Z C /1:1
END
${blocks.join("\n")}
`;
  try {
    const ast = parseDocument(stub, { uri: "lcell-footprints.mcu" });
    return collectLcellFootprints(ast, names);
  } catch {
    return names.map((name) => ({ name, shapes: [] as ProtoShape[] }));
  }
}

/** Дополнить пустые footprints из сырого текста. */
export function ensureLcellFootprints(
  fullText: string,
  elements: readonly string[],
  existing: ProtoFootprint[] | undefined
): ProtoFootprint[] {
  const cur = existing?.length
    ? existing
    : elements.map((name) => ({ name, shapes: [] as ProtoShape[] }));
  if (cur.some((f) => f.shapes.length > 0)) {
    // добить только пустые имена
    const missing = elements.filter(
      (n) => !cur.some((f) => f.name.toUpperCase() === n.toUpperCase() && f.shapes.length > 0)
    );
    if (!missing.length) return cur;
    const extra = collectLcellFootprintsFromText(fullText, missing);
    const by = new Map(cur.map((f) => [f.name.toUpperCase(), f]));
    for (const f of extra) {
      const prev = by.get(f.name.toUpperCase());
      if (!prev || !prev.shapes.length) by.set(f.name.toUpperCase(), f);
    }
    return elements.map(
      (n) => by.get(n.toUpperCase()) ?? { name: n, shapes: [] as ProtoShape[] }
    );
  }
  return collectLcellFootprintsFromText(fullText, elements);
}

function mergeUniqueNames(...lists: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const n of list) {
      const t = n.trim();
      if (!t || !/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(t)) continue;
      const u = t.toUpperCase();
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(t);
    }
  }
  return out;
}

/**
 * Имена из AST LISTEL + «голые» метки в блоке, совпадающие с LCELL
 * (когда продолжения LISTEL без ведущего пробела → отдельные statements).
 */
function enrichListelFromAst(
  ast: DocumentAst,
  lat: LatticeNode,
  range: LatticeBlockRange,
  fromText: string[]
): string[] {
  const known = new Map(ast.latticeElements.map((e) => [e.name.toUpperCase(), e.name]));
  const fromStmts: string[] = [];
  for (const stmt of ast.statements) {
    const ln = stmt.range.start.line;
    if (ln < range.startLine || ln > range.endLine) continue;
    const lab = (stmt.label || "").trim();
    if (!lab) continue;
    const real = known.get(lab.toUpperCase());
    if (real) fromStmts.push(real);
  }
  return mergeUniqueNames(lat.elements, fromText, fromStmts);
}

function inputFromAstLattice(
  ast: DocumentAst,
  lat: LatticeNode,
  range: LatticeBlockRange,
  textFallback: LatticeGeneratorInput | null
): LatticeGeneratorInput {
  const base = textFallback ?? defaultLatticeGeneratorInput();
  const type = lat.latticeType.toUpperCase().replace(/\s+/g, "") as LatticeType;
  base.latticeType = ["G2MP", "G2AR", "GLTL"].includes(type) ? type : base.latticeType;
  base.zoneName =
    (lat.zoneNames?.[0] || lat.zoneName || base.zoneName).replace(/,/g, "") || base.zoneName;

  // LISTEL: AST + продолжения без пробела (как statements) + текстовый fallback
  const fromText = textFallback?.elements ?? [];
  base.elements = enrichListelFromAst(ast, lat, range, fromText);

  // LFIXSO / LBLACK из statements блока
  for (const stmt of ast.statements) {
    const ln = stmt.range.start.line;
    if (ln < range.startLine || ln > range.endLine) continue;
    const lab = stmt.label.toUpperCase();
    if (lab === "LFIXSO") {
      base.lfixso = stmt.text.replace(/^LFIXSO\s*/i, "").trim();
    }
    if (lab === "LBLACK") {
      base.lblack = stmt.text.replace(/^LBLACK\s*/i, "").trim();
    }
  }

  const parmText = lat.positions.join(" ");
  const tokens = tokenizeParm(parmText ? `PARM ${parmText}` : "PARM");

  if (base.latticeType === "G2MP") {
    const p = parseG2mpParm(tokens);
    if (p) Object.assign(base, p);
    // Текст блока (метки L01…) надёжнее порядка typeMap в AST при L15…L01.
    if (textFallback?.cartogram?.length) {
      base.cartogram = textFallback.cartogram;
      base.cols = textFallback.cols;
      base.rows = textFallback.rows;
      if (textFallback.vectorA) base.vectorA = textFallback.vectorA;
      if (textFallback.vectorB) base.vectorB = textFallback.vectorB;
      if (textFallback.vectorC) base.vectorC = textFallback.vectorC;
    } else if (lat.typeMap?.length) {
      const cols = Math.max(base.cols, ...lat.typeMap.map((r) => r.length), 1);
      const rows = Math.max(base.rows, lat.typeMap.length, 1);
      base.cols = cols;
      base.rows = rows;
      base.cartogram = resizeCartogram(lat.typeMap, cols, rows);
    }
  } else if (base.latticeType === "G2AR") {
    const p = parseG2arParm(tokens, base.elements);
    if (p) Object.assign(base, p);
    else if (textFallback) {
      Object.assign(base, {
        iMin: textFallback.iMin,
        iMax: textFallback.iMax,
        jMin: textFallback.jMin,
        jMax: textFallback.jMax,
        cols: textFallback.cols,
        rows: textFallback.rows,
        vectorA: textFallback.vectorA,
        vectorB: textFallback.vectorB,
        vectorC: textFallback.vectorC,
        cartogram: textFallback.cartogram,
      });
    }
  } else {
    // GLTL: PARM из текста блока редактора — надёжнее AST.positions (continuation-строки)
    const fromAst = parseGltlParm(tokens, base.elements);
    const fromBlock = textFallback?.placements ?? [];
    base.placements =
      fromBlock.length >= fromAst.length && fromBlock.length > 0 ? fromBlock : fromAst;
    if (!base.placements.length) {
      base.placements = [
        {
          element: base.elements[0] ?? "",
          protoIndex: 1,
          x: "0",
          y: "0",
          z: "0",
        },
      ];
    }
  }

  base.footprints = collectLcellFootprints(ast, base.elements);
  return base;
}

function findAstLatticeForEditorBlock(
  ast: DocumentAst,
  editorLine: number,
  range: LatticeBlockRange,
  uri?: string
): LatticeNode | undefined {
  const byCursor = ast.lattices.find((l) =>
    rangeCoversEditorLine(l.range, editorLine, ast.includeLineMap, uri)
  );
  if (byCursor) return byCursor;

  return ast.lattices.find((l) => {
    const mapped = remapRangeToMainDocument(l.range, ast.includeLineMap);
    const start = mapped?.start.line ?? l.range.start.line;
    return start >= range.startLine && start <= range.endLine;
  });
}

/**
 * Разобрать LATT под курсором (координаты строк — редактор / main).
 * LISTEL и PARM для GLTL берутся из AST так же, как в сайдбаре.
 */
export function parseLatticeAtLine(
  fullText: string,
  line: number,
  opts?: { uri?: string }
): { input: LatticeGeneratorInput; range: LatticeBlockRange } | null {
  const lines = fullText.replace(/\r\n/g, "\n").split("\n");
  const range = findLatticeBlockAtLine(lines, line);
  if (!range) return null;
  const block = lines.slice(range.startLine, range.endLine + 1).join("\n");
  const textFallback = parseLatticeBlockText(block);

  let ast: DocumentAst;
  try {
    ast = parseDocument(fullText, { uri: opts?.uri ?? "lattice-context.mcu" });
  } catch {
    if (!textFallback) return null;
    return { input: textFallback, range };
  }

  const lat = findAstLatticeForEditorBlock(ast, line, range, opts?.uri);

  if (!lat) {
    if (!textFallback) return null;
    textFallback.footprints = ensureLcellFootprints(
      fullText,
      textFallback.elements,
      collectLcellFootprints(ast, textFallback.elements)
    );
    return { input: textFallback, range };
  }

  const input = inputFromAstLattice(ast, lat, range, textFallback);
  input.footprints = ensureLcellFootprints(fullText, input.elements, input.footprints);
  return { input, range };
}

/** Только GLTL: иначе null (для конструктора §9.2.6.1). */
export function parseGltlLatticeAtLine(
  fullText: string,
  line: number,
  opts?: { uri?: string }
): { input: LatticeGeneratorInput; range: LatticeBlockRange } | null {
  const hit = parseLatticeAtLine(fullText, line, opts);
  if (!hit) return null;
  if (hit.input.latticeType !== "GLTL") return null;
  return hit;
}

/** Только G2AR (§9.2.6.2). */
export function parseG2arLatticeAtLine(
  fullText: string,
  line: number,
  opts?: { uri?: string }
): { input: LatticeGeneratorInput; range: LatticeBlockRange } | null {
  const hit = parseLatticeAtLine(fullText, line, opts);
  if (!hit) return null;
  if (hit.input.latticeType !== "G2AR") return null;
  return hit;
}

/** Только G2MP (§9.2.6.3). */
export function parseG2mpLatticeAtLine(
  fullText: string,
  line: number,
  opts?: { uri?: string }
): { input: LatticeGeneratorInput; range: LatticeBlockRange } | null {
  const hit = parseLatticeAtLine(fullText, line, opts);
  if (!hit) return null;
  if (hit.input.latticeType !== "G2MP") return null;
  return hit;
}

/** Найти ближайший блок LATT с указанными генераторами. */
export function findNearestLatticeLine(
  fullText: string,
  preferLine: number,
  types: readonly LatticeType[] = ["GLTL", "G2AR", "G2MP"]
): number | null {
  const want = new Set(types.map((t) => t.toUpperCase()));
  const lines = fullText.replace(/\r\n/g, "\n").split("\n");
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < lines.length; i++) {
    if (lineLabel(lines[i]!) !== "LATT") continue;
    const parts = lines[i]!.trim().split(/\s+/);
    const gen = (parts[1] || "").toUpperCase();
    if (!want.has(gen)) continue;
    const d = Math.abs(i - preferLine);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Найти ближайший блок LATT GLTL в файле (если курсор не на LATT). */
export function findNearestGltlLatticeLine(fullText: string, preferLine: number): number | null {
  return findNearestLatticeLine(fullText, preferLine, ["GLTL"]);
}

export function defaultLatticeGeneratorInput(): LatticeGeneratorInput {
  return {
    latticeType: "GLTL",
    zoneName: "ZL",
    elements: ["Pogl20", "TVS281", "PustY2"],
    cols: 4,
    rows: 4,
    iMin: 0,
    iMax: 3,
    jMin: 0,
    jMax: 3,
    vectorA: ["0", "0", "0"],
    vectorB: ["25", "0", "0"],
    vectorC: ["0", "25", "0"],
    cartogram: emptyCartogram(4, 4),
    placements: [
      { element: "TVS281", protoIndex: 2, x: "0", y: "0", z: "0" },
      { element: "TVS281", protoIndex: 2, x: "25", y: "0", z: "0" },
      { element: "Pogl20", protoIndex: 1, x: "0", y: "75", z: "0" },
    ],
    lfixso: "",
    lblack: "",
    footprints: [],
  };
}
