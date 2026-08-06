/**
 * Загрузка PARAMETE.THR (BURN6) и сверка T1/2 с IAEA LiveChart half_life_sec.
 * Пути: <MDBNR>/BURN6/PARAMETE.THR или <MDBNR>/PARAMETE.THR.
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  awLibNameFromIaeaLabel,
  clearParameteThrTable,
  formatHalfLifeSec,
  formatHalfLifeValue,
  getParameteThrForMcuNuclide,
  getParameteThrTable,
  parseParameteThr,
  setParameteThrTable,
  type ParameteThrEntry,
  type ParameteThrTable,
} from "@mcuhelper/mcu-language";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";
import {
  getLiveChartGroundStates,
  scheduleLiveChartCacheRefresh,
  type LiveChartNuclide,
} from "./iaeaLiveChartCache";

const API_BASE = "https://nds.iaea.org/exfor";
/** Относительный порог |Δ|/T для полураспада. */
export const HL_MISMATCH_REL_EPS = 0.05;
/** Абсолютный порог в секундах (для очень коротких). */
export const HL_MISMATCH_ABS_SEC = 1;

export interface HalfLifeMismatch {
  /** Имя MCU (CS37), если удалось сопоставить; иначе PARAMETE name. */
  mcuName: string;
  parameteName: string;
  iname: number;
  thrSec: number;
  iaeaSec: number;
  deltaSec: number;
  relDelta: number;
  iaeaTarget: string;
}

export interface ParameteThrVerificationResult {
  compared: number;
  mismatches: HalfLifeMismatch[];
  missingInIaea: string[];
  source: string;
  thrPath?: string;
  ok: boolean;
  message: string;
}

export interface ParameteThrLoadResult {
  ok: boolean;
  path?: string;
  entryCount: number;
  withHalfLifeCount: number;
  message: string;
}

let lastVerification: ParameteThrVerificationResult | null = null;
/** Ключ — MCU name. */
const mismatchByMcu = new Map<string, HalfLifeMismatch>();
let verifyInFlight: Promise<ParameteThrVerificationResult | null> | null = null;

export function getLastParameteThrVerification(): ParameteThrVerificationResult | null {
  return lastVerification;
}

export function getHalfLifeMismatch(mcuName: string): HalfLifeMismatch | null {
  return mismatchByMcu.get(mcuName.trim().toUpperCase()) ?? null;
}

export function setHalfLifeMismatchesForTest(list: HalfLifeMismatch[]): void {
  mismatchByMcu.clear();
  for (const m of list) mismatchByMcu.set(m.mcuName.toUpperCase(), m);
  lastVerification = {
    compared: list.length,
    mismatches: [...list],
    missingInIaea: [],
    source: "test",
    ok: list.length === 0,
    message: list.length ? `test: ${list.length} mismatches` : "test: ok",
  };
}

export function clearHalfLifeMismatchesForTest(): void {
  mismatchByMcu.clear();
  lastVerification = null;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Ищет PARAMETE.THR в BURN6/ и в корне MDBNR. */
export async function resolveParameteThrPath(constantsLibPath: string): Promise<string | null> {
  if (!constantsLibPath?.trim()) return null;
  const root = constantsLibPath.trim();
  const candidates = [
    path.join(root, "BURN6", "PARAMETE.THR"),
    path.join(root, "BURN6", "paramete.thr"),
    path.join(root, "PARAMETE.THR"),
    path.join(root, "paramete.thr"),
  ];
  for (const p of candidates) {
    if (await fileExists(p)) return p;
  }
  return null;
}

export async function loadParameteThrFromConstantsPath(
  constantsLibPath: string
): Promise<ParameteThrLoadResult> {
  if (!constantsLibPath?.trim()) {
    clearParameteThrTable();
    lastVerification = null;
    mismatchByMcu.clear();
    return { ok: false, entryCount: 0, withHalfLifeCount: 0, message: "Путь MDBNR не задан — PARAMETE.THR не загружен" };
  }

  const thrPath = await resolveParameteThrPath(constantsLibPath);
  if (!thrPath) {
    clearParameteThrTable();
    lastVerification = null;
    mismatchByMcu.clear();
    return {
      ok: false,
      entryCount: 0,
      withHalfLifeCount: 0,
      message: `PARAMETE.THR не найден (BURN6/ или корень) в ${constantsLibPath}`,
    };
  }

  try {
    const text = await fs.readFile(thrPath, "utf8");
    const table = parseParameteThr(text, thrPath);
    setParameteThrTable(table);
    mismatchByMcu.clear();
    lastVerification = null;
    return {
      ok: true,
      path: thrPath,
      entryCount: table.entryCount,
      withHalfLifeCount: table.withHalfLifeCount,
      message: `PARAMETE.THR: ${table.withHalfLifeCount} с T1/2 из ${table.entryCount} (${thrPath})`,
    };
  } catch (e) {
    clearParameteThrTable();
    return {
      ok: false,
      path: thrPath,
      entryCount: 0,
      withHalfLifeCount: 0,
      message: `Не удалось прочитать PARAMETE.THR: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function formatElement(sym: string): string {
  if (sym.length <= 1) return sym.toUpperCase();
  return sym[0].toUpperCase() + sym.slice(1).toLowerCase();
}

function resolveMcuName(entry: ParameteThrEntry): string {
  if (entry.isomer === 1 && entry.z === 95 && entry.a === 242) return "AM2M";
  if (entry.isomer === 0) {
    const label = entry.name.replace(/m$/i, "");
    const fromLib = awLibNameFromIaeaLabel(label);
    if (fromLib) return fromLib;
    return label.replace(/-/g, "").toUpperCase();
  }
  return entry.name.replace(/-/g, "").toUpperCase();
}

function isHalfLifeMismatch(thrSec: number, iaeaSec: number): boolean {
  const abs = Math.abs(thrSec - iaeaSec);
  const rel = abs / Math.max(iaeaSec, 1e-30);
  return rel > HL_MISMATCH_REL_EPS && abs > HL_MISMATCH_ABS_SEC;
}

/**
 * Сверка T1/2 из PARAMETE.THR с IAEA LiveChart (ground state, isomer=0).
 * Metastable (isomer>0) пропускаются — в bulk CSV нет отдельного m-состояния.
 */
export async function verifyParameteThrAgainstIaea(
  table: ParameteThrTable = getParameteThrTable() ?? parseParameteThr(""),
  iaeaMap?: Map<string, LiveChartNuclide> | null
): Promise<ParameteThrVerificationResult> {
  const withHl = [...table.byIname.values()].filter(
    (e) => e.hasHalfLife && e.halfLifeSec != null && e.isomer === 0
  );
  if (!withHl.length) {
    const empty: ParameteThrVerificationResult = {
      compared: 0,
      mismatches: [],
      missingInIaea: [],
      source: "none",
      thrPath: table.path,
      ok: true,
      message: "Нет T1/2 в PARAMETE.THR для сверки",
    };
    lastVerification = empty;
    mismatchByMcu.clear();
    return empty;
  }

  let iaea = iaeaMap ?? null;
  let cacheSource = "provided";
  if (!iaea) {
    const gs = await getLiveChartGroundStates({ allowNetwork: false });
    iaea = gs.map;
    cacheSource = gs.source;
    scheduleLiveChartCacheRefresh();
  }
  if (!iaea.size) {
    const fail: ParameteThrVerificationResult = {
      compared: 0,
      mismatches: [],
      missingInIaea: [],
      source: "iaea-unreachable",
      thrPath: table.path,
      ok: false,
      message: "Нет локального кэша IAEA LiveChart — сверка PARAMETE.THR пропущена",
    };
    lastVerification = fail;
    return fail;
  }

  const mismatches: HalfLifeMismatch[] = [];
  const missingInIaea: string[] = [];
  let compared = 0;

  for (const entry of withHl) {
    const zLookup = entry.zFromSymbol ?? entry.z;
    const hit = iaea.get(`${zLookup}:${entry.a}`);
    const sym = entry.name.split("-")[0] ?? "";
    const target = `${formatElement(sym)}-${entry.a}`;
    const mcuName = resolveMcuName(entry);
    if (!hit || hit.halfLifeStable || hit.halfLifeSec == null) {
      missingInIaea.push(mcuName || entry.name);
      continue;
    }
    compared++;
    const thrSec = entry.halfLifeSec!;
    if (!isHalfLifeMismatch(thrSec, hit.halfLifeSec)) continue;
    const deltaSec = thrSec - hit.halfLifeSec;
    mismatches.push({
      mcuName: mcuName || entry.name,
      parameteName: entry.name,
      iname: entry.iname,
      thrSec,
      iaeaSec: hit.halfLifeSec,
      deltaSec,
      relDelta: Math.abs(deltaSec) / Math.max(hit.halfLifeSec, 1e-30),
      iaeaTarget: target,
    });
  }

  mismatches.sort((a, b) => b.relDelta - a.relDelta);
  mismatchByMcu.clear();
  for (const m of mismatches) mismatchByMcu.set(m.mcuName.toUpperCase(), m);

  const ok = mismatches.length === 0;
  const message = ok
    ? `PARAMETE.THR ≈ IAEA T1/2: сверено ${compared}, расхождений нет (${cacheSource})`
    : `PARAMETE.THR ⚠ IAEA T1/2: ${mismatches.length} расхождений из ${compared} (порог rel>${HL_MISMATCH_REL_EPS}; кэш ${cacheSource})`;

  const result: ParameteThrVerificationResult = {
    compared,
    mismatches,
    missingInIaea,
    source: `IAEA LiveChart half_life_sec [${cacheSource}]`,
    thrPath: table.path,
    ok,
    message,
  };
  lastVerification = result;
  return result;
}

export function scheduleParameteThrVerification(
  onDone?: (r: ParameteThrVerificationResult) => void,
  iaeaMap?: Map<string, LiveChartNuclide> | null
): void {
  const table = getParameteThrTable();
  if (!table?.entryCount) return;
  if (verifyInFlight) return;
  verifyInFlight = verifyParameteThrAgainstIaea(table, iaeaMap)
    .then((r) => {
      onDone?.(r);
      return r;
    })
    .finally(() => {
      verifyInFlight = null;
    });
}

export function formatHalfLifeMismatchHoverLine(m: HalfLifeMismatch): string {
  const sign = m.deltaSec >= 0 ? "+" : "−";
  const pct = (Math.abs(m.relDelta) * 100).toFixed(1);
  return (
    `⚠ IAEA NDS T1/2: **${formatHalfLifeSec(m.iaeaSec)}** ` +
    `(Δrel = ${sign}${pct}%, ${m.iaeaTarget}) · ` +
    `[${m.iaeaTarget}](${API_BASE}/e4list?Target=${encodeURIComponent(m.iaeaTarget)}&Reaction=decay&json)`
  );
}

export function formatParameteThrHoverLines(mcuName: string): string[] {
  const entry = getParameteThrForMcuNuclide(mcuName);
  if (!entry) return [];
  const lines: string[] = [];
  if (entry.hasHalfLife && entry.halfLifeValue != null && entry.halfLifeUnit) {
    lines.push(
      `Период полураспада: **${formatHalfLifeValue(entry.halfLifeValue, entry.halfLifeUnit)}** (PARAMETE.THR)`
    );
    const mismatch = getHalfLifeMismatch(mcuName);
    if (mismatch) lines.push(formatHalfLifeMismatchHoverLine(mismatch));
  } else {
    lines.push(`Период полураспада: **стабилен / не задан** (PARAMETE.THR)`);
  }
  return lines;
}

export function collectHalfLifeMismatchDiagnostics(
  doc: {
    getText: (r: { start: { line: number; character: number }; end: { line: number; character: number } }) => string;
    lineCount: number;
  },
  materials: Array<{ nuclides: Array<{ name: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }> }>,
  mismatches: Map<string, HalfLifeMismatch> = mismatchByMcu
): Diagnostic[] {
  if (!mismatches.size) return [];
  const out: Diagnostic[] = [];
  /** Одно предупреждение на изотоп (первое вхождение в документе). */
  const seen = new Set<string>();

  for (const mat of materials) {
    for (const n of mat.nuclides) {
      const key = n.name.trim().toUpperCase();
      const m = mismatches.get(key);
      if (!m) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const line = n.range.start.line;
      if (line < 0 || line >= doc.lineCount) continue;

      const lineText = doc.getText({
        start: { line, character: 0 },
        end: { line, character: 1_000_000 },
      });
      const upper = lineText.toUpperCase();
      const needle = n.name.toUpperCase();
      let idx = upper.indexOf(needle);
      while (idx >= 0) {
        const before = idx === 0 || /[\s,/]/.test(lineText[idx - 1]!);
        const after = idx + needle.length >= lineText.length || /[\s,/]/.test(lineText[idx + needle.length]!);
        if (before && after) break;
        idx = upper.indexOf(needle, idx + 1);
      }
      const startChar = idx >= 0 ? idx : n.range.start.character;
      const endChar = idx >= 0 ? idx + needle.length : Math.min(startChar + needle.length, lineText.length);

      out.push({
        severity: DiagnosticSeverity.Warning,
        message:
          `T1/2 ${n.name}: PARAMETE.THR ${formatHalfLifeSec(m.thrSec)} ≠ IAEA ${formatHalfLifeSec(m.iaeaSec)} ` +
          `(Δrel = ${(m.relDelta * 100).toFixed(1)}%, ${m.iaeaTarget})`,
        range: {
          start: { line, character: startChar },
          end: { line, character: endChar },
        },
        code: "thr-halflife-mismatch",
        source: "mcuhelper",
      });
    }
  }
  return out;
}

export function formatParameteThrVerificationReport(r: ParameteThrVerificationResult): string {
  const lines = [
    r.message,
    r.thrPath ? `Файл: ${r.thrPath}` : "",
    `Источник сверки: ${r.source}`,
    `Сверено: ${r.compared}; нет/STABLE в IAEA: ${r.missingInIaea.length}`,
  ].filter(Boolean);

  if (r.mismatches.length) {
    lines.push("", `Расхождения T1/2 (${r.mismatches.length}) (MCU | THR | IAEA | Δrel):`);
    for (const m of r.mismatches) {
      lines.push(
        `  ${m.mcuName.padEnd(6)} ${formatHalfLifeSec(m.thrSec).padEnd(14)} ${formatHalfLifeSec(m.iaeaSec).padEnd(14)} ${(m.relDelta * 100).toFixed(1)}%`
      );
    }
  }
  return lines.join("\n");
}
