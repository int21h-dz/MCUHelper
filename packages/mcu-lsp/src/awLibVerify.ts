/**
 * Загрузка AW.LIB из MDBNR и сверка атомных масс с IAEA NDS.
 * Bulk: LiveChart ground_states atomic_mass (AME).
 * Точечно: ENDF MF8/MT457 AWR → m = AWR · m_n (см. e4decay).
 * API: https://www-nds.iaea.org/exfor/x4guide/API/#ENDF
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  clearAwLibTable,
  getAwLibEntry,
  getAwLibTable,
  parseAwLib,
  setAwLibTable,
  buildSumIsotopeStatesByOffset,
  buildScopedVars,
  evaluateSumIsotopeMembership,
  type AwLibEntry,
  type AwLibTable,
  type DocumentAst,
} from "@mcuhelper/mcu-language";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";
import {
  getLiveChartGroundStates,
  parseLiveChartAtomicMasses,
  scheduleLiveChartCacheRefresh,
  type LiveChartNuclide,
} from "./iaeaLiveChartCache";

const API_BASE = "https://nds.iaea.org/exfor";
/** Масса нейтрона, а.е.м. (CODATA) — для перевода ENDF AWR → атомная масса. */
export const NEUTRON_MASS_AMU = 1.008_664_915_95;
/** Абсолютный порог |Δ| (а.е.м.) для пометки расхождения. */
export const AW_MISMATCH_ABS_EPS = 5e-4;
/** Относительный порог |Δ|/m. */
export const AW_MISMATCH_REL_EPS = 5e-6;

export type LiveChartMass = LiveChartNuclide;
export { parseLiveChartAtomicMasses, getLiveChartGroundStates, scheduleLiveChartCacheRefresh };

export interface AwMassMismatch {
  name: string;
  zaid: number;
  awLib: number;
  iaea: number;
  delta: number;
  relDelta: number;
  source: "livechart" | "endf-awr";
  iaeaTarget: string;
}

export interface AwLibVerificationResult {
  compared: number;
  mismatches: AwMassMismatch[];
  missingInIaea: string[];
  source: string;
  awLibPath?: string;
  ok: boolean;
  message: string;
}

export interface AwLibLoadResult {
  ok: boolean;
  path?: string;
  entryCount: number;
  message: string;
}

let lastVerification: AwLibVerificationResult | null = null;
const mismatchByName = new Map<string, AwMassMismatch>();
let verifyInFlight: Promise<AwLibVerificationResult | null> | null = null;

export function getLastAwLibVerification(): AwLibVerificationResult | null {
  return lastVerification;
}

export function getAwMassMismatch(name: string): AwMassMismatch | null {
  return mismatchByName.get(name.trim().toUpperCase()) ?? null;
}

/** Тестовый/ручной ввод карты расхождений (также задаёт lastVerification). */
export function setAwMassMismatchesForTest(list: AwMassMismatch[]): void {
  mismatchByName.clear();
  for (const m of list) mismatchByName.set(m.name.toUpperCase(), m);
  lastVerification = {
    compared: list.length,
    mismatches: [...list],
    missingInIaea: [],
    source: "test",
    ok: list.length === 0,
    message: list.length ? `test: ${list.length} mismatches` : "test: ok",
  };
}

export function clearAwMassMismatchesForTest(): void {
  mismatchByName.clear();
  lastVerification = null;
}

export function atomicMassFromEndfAwr(awr: number): number {
  return awr * NEUTRON_MASS_AMU;
}

/** LiveChart atomic_mass хранится как A·10⁶ (µu). */
export function atomicMassFromLiveChartMicroU(microU: number): number {
  return microU / 1e6;
}

export function formatMassDelta(delta: number): string {
  const abs = Math.abs(delta);
  if (abs === 0) return "0";
  if (abs >= 1e-2) return delta.toFixed(6);
  return delta.toExponential(2);
}

function isMismatch(awLib: number, iaea: number): boolean {
  const delta = awLib - iaea;
  const abs = Math.abs(delta);
  const rel = abs / Math.max(Math.abs(iaea), 1e-30);
  return abs > AW_MISMATCH_ABS_EPS || rel > AW_MISMATCH_REL_EPS;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Ищет AW.LIB в корне MDBNR (и aw.lib). */
export async function resolveAwLibPath(constantsLibPath: string): Promise<string | null> {
  if (!constantsLibPath?.trim()) return null;
  const root = constantsLibPath.trim();
  for (const name of ["AW.LIB", "aw.lib", "Aw.lib"]) {
    const p = path.join(root, name);
    if (await fileExists(p)) return p;
  }
  return null;
}

export async function loadAwLibFromConstantsPath(constantsLibPath: string): Promise<AwLibLoadResult> {
  if (!constantsLibPath?.trim()) {
    clearAwLibTable();
    lastVerification = null;
    mismatchByName.clear();
    return { ok: false, entryCount: 0, message: "Путь MDBNR не задан — AW.LIB не загружен" };
  }

  const awPath = await resolveAwLibPath(constantsLibPath);
  if (!awPath) {
    clearAwLibTable();
    lastVerification = null;
    mismatchByName.clear();
    return {
      ok: false,
      entryCount: 0,
      message: `AW.LIB не найден в ${constantsLibPath}`,
    };
  }

  try {
    const text = await fs.readFile(awPath, "utf8");
    const table = parseAwLib(text, awPath);
    setAwLibTable(table);
    // Старые расхождения до новой сверки не подчёркиваем.
    mismatchByName.clear();
    lastVerification = null;
    return {
      ok: true,
      path: awPath,
      entryCount: table.entryCount,
      message: `AW.LIB: ${table.entryCount} записей (${awPath})`,
    };
  } catch (e) {
    clearAwLibTable();
    return {
      ok: false,
      path: awPath,
      entryCount: 0,
      message: `Не удалось прочитать AW.LIB: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function formatElement(sym: string): string {
  if (sym.length <= 1) return sym.toUpperCase();
  return sym[0].toUpperCase() + sym.slice(1).toLowerCase();
}

function compareEntry(
  entry: AwLibEntry,
  iaeaMass: number,
  source: AwMassMismatch["source"],
  target: string
): AwMassMismatch | null {
  if (!isMismatch(entry.atomicWeight, iaeaMass)) return null;
  const delta = entry.atomicWeight - iaeaMass;
  return {
    name: entry.name,
    zaid: entry.zaid,
    awLib: entry.atomicWeight,
    iaea: iaeaMass,
    delta,
    relDelta: Math.abs(delta) / Math.max(Math.abs(iaeaMass), 1e-30),
    source,
    iaeaTarget: target,
  };
}

/**
 * Сверка изотопов AW.LIB с IAEA LiveChart atomic_mass.
 * Данные: бандл ⊕ ~/.mcuhelper (сеть только если локально пусто / force).
 * Природные смеси (A=0) пропускаются.
 */
export async function verifyAwLibAgainstIaea(
  table: AwLibTable = getAwLibTable() ?? parseAwLib(""),
  iaeaMap?: Map<string, LiveChartMass> | null
): Promise<AwLibVerificationResult> {
  const isotopes = [...table.byName.values()].filter((e) => !e.isNatural && e.a != null);
  if (!isotopes.length) {
    const empty: AwLibVerificationResult = {
      compared: 0,
      mismatches: [],
      missingInIaea: [],
      source: "none",
      awLibPath: table.path,
      ok: true,
      message: "Нет изотопов в AW.LIB для сверки",
    };
    lastVerification = empty;
    mismatchByName.clear();
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
    const fail: AwLibVerificationResult = {
      compared: 0,
      mismatches: [],
      missingInIaea: [],
      source: "iaea-unreachable",
      awLibPath: table.path,
      ok: false,
      message: "Нет локального кэша IAEA LiveChart — сверка AW.LIB пропущена",
    };
    lastVerification = fail;
    return fail;
  }

  const mismatches: AwMassMismatch[] = [];
  const missingInIaea: string[] = [];
  let compared = 0;

  for (const entry of isotopes) {
    const a = entry.a!;
    const hit = iaea.get(`${entry.z}:${a}`);
    const target = `${formatElement(entry.symbol)}-${a}`;
    if (!hit) {
      missingInIaea.push(entry.name);
      continue;
    }
    compared++;
    const m = compareEntry(entry, hit.mass, "livechart", target);
    if (m) mismatches.push(m);
  }

  mismatches.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  mismatchByName.clear();
  for (const m of mismatches) mismatchByName.set(m.name, m);

  const ok = mismatches.length === 0;
  const message = ok
    ? `AW.LIB ≈ IAEA: сверено ${compared} изотопов, расхождений нет (${cacheSource})`
    : `AW.LIB ⚠ IAEA: ${mismatches.length} расхождений из ${compared} (порог |Δ|>${AW_MISMATCH_ABS_EPS} или rel>${AW_MISMATCH_REL_EPS}; кэш ${cacheSource})`;

  const result: AwLibVerificationResult = {
    compared,
    mismatches,
    missingInIaea,
    source: `IAEA LiveChart atomic_mass [${cacheSource}] · ENDF AWR = m/mₙ`,
    awLibPath: table.path,
    ok,
    message,
  };
  lastVerification = result;
  return result;
}

export function scheduleAwLibVerification(
  onDone?: (r: AwLibVerificationResult) => void
): void {
  const table = getAwLibTable();
  if (!table?.entryCount) return;
  if (verifyInFlight) return;
  verifyInFlight = verifyAwLibAgainstIaea(table)
    .then((r) => {
      onDone?.(r);
      return r;
    })
    .finally(() => {
      verifyInFlight = null;
    });
}

export function formatAwMismatchHoverLine(m: AwMassMismatch): string {
  const sign = m.delta >= 0 ? "+" : "−";
  const abs = formatMassDelta(Math.abs(m.delta));
  const rel = m.relDelta.toExponential(1);
  return (
    `⚠ IAEA NDS (${m.source}): **${m.iaea.toFixed(6)}** а.е.м. ` +
    `(Δ = ${sign}${abs}, rel ${rel}) · [${m.iaeaTarget}]` +
    `(${API_BASE}/e4list?Target=${encodeURIComponent(m.iaeaTarget)}&Reaction=decay&json)`
  );
}

/**
 * Warning-диагностики на именах нуклидов в MATR, у которых AW.LIB ≠ IAEA.
 * Появляются после фоновой сверки; range сужается до токена имени на строке.
 */
export function collectAwLibMassDiagnostics(
  doc: {
    getText: (r: { start: { line: number; character: number }; end: { line: number; character: number } }) => string;
    lineCount: number;
  },
  materials: Array<{ nuclides: Array<{ name: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }> }>,
  mismatches: Map<string, AwMassMismatch> = mismatchByName
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
      // предпочитаем совпадение на границе токена
      while (idx >= 0) {
        const before = idx === 0 || /[\s,/]/.test(lineText[idx - 1]!);
        const after = idx + needle.length >= lineText.length || /[\s,/]/.test(lineText[idx + needle.length]!);
        if (before && after) break;
        idx = upper.indexOf(needle, idx + 1);
      }
      const startChar = idx >= 0 ? idx : n.range.start.character;
      const endChar = idx >= 0 ? idx + needle.length : Math.min(startChar + needle.length, lineText.length);

      const sign = m.delta >= 0 ? "+" : "−";
      out.push({
        severity: DiagnosticSeverity.Warning,
        message:
          `Атомная масса ${n.name}: AW.LIB ${m.awLib.toFixed(6)} ≠ IAEA ${m.iaea.toFixed(6)} а.е.м. ` +
          `(Δ = ${sign}${formatMassDelta(Math.abs(m.delta))}, ${m.iaeaTarget})`,
        range: {
          start: { line, character: startChar },
          end: { line, character: endChar },
        },
        code: "aw-mass-mismatch",
        source: "mcuhelper",
      });
    }
  }
  return out;
}

function locateNuclideTokenRange(
  doc: {
    getText: (r: { start: { line: number; character: number }; end: { line: number; character: number } }) => string;
    lineCount: number;
  },
  nuclide: { name: string; range: { start: { line: number; character: number } } }
): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
  const line = nuclide.range.start.line;
  if (line < 0 || line >= doc.lineCount) return null;
  const lineText = doc.getText({
    start: { line, character: 0 },
    end: { line, character: 1_000_000 },
  });
  const upper = lineText.toUpperCase();
  const needle = nuclide.name.toUpperCase();
  let idx = upper.indexOf(needle);
  while (idx >= 0) {
    const before = idx === 0 || /[\s,/]/.test(lineText[idx - 1]!);
    const after = idx + needle.length >= lineText.length || /[\s,/]/.test(lineText[idx + needle.length]!);
    if (before && after) break;
    idx = upper.indexOf(needle, idx + 1);
  }
  const startChar = idx >= 0 ? idx : nuclide.range.start.character;
  const endChar = idx >= 0 ? idx + needle.length : Math.min(startChar + needle.length, lineText.length);
  return {
    start: { line, character: startChar },
    end: { line, character: endChar },
  };
}

/**
 * Нуклид отсутствует в AW.LIB:
 * - уже в суммарном изотопе через SI → игнор;
 * - только через SIDEN → warning (лучше явно в SI);
 * - не в сумме → error (добавить в SI).
 * SINOT только исключает из суммы и сам по себе покрытие AW.LIB не даёт.
 */
export function collectAwLibMissingDiagnostics(
  doc: {
    getText: (r: { start: { line: number; character: number }; end: { line: number; character: number } }) => string;
    lineCount: number;
  },
  ast: DocumentAst
): Diagnostic[] {
  const table = getAwLibTable();
  if (!table?.entryCount) return [];
  const out: Diagnostic[] = [];
  /** Один diag на имя нуклида — иначе full-core (100k+) убивает Problems и event loop. */
  const seen = new Set<string>();
  // Один проход SI/SIDEN по материалам: N×resolveSumIsotopeStateAt на full-core = минуты.
  const sumStates = buildSumIsotopeStatesByOffset(
    ast.statements,
    ast.materials.map((m) => m.range.offset),
    ast.constants
  );

  for (const mat of ast.materials) {
    const sumState = sumStates.get(mat.range.offset) ?? {
      listMode: "none" as const,
      list: new Set<string>(),
      siden: null,
    };
    const vars = buildScopedVars(ast.constants, mat.range.offset, "global");

    for (const n of mat.nuclides) {
      const key = n.name.trim().toUpperCase();
      if (seen.has(key)) continue;
      if (getAwLibEntry(n.name)) continue;

      const sum = evaluateSumIsotopeMembership(n, sumState, vars);
      if (sum.kinds.includes("si")) continue;

      const range = locateNuclideTokenRange(doc, n);
      if (!range) continue;
      seen.add(key);

      if (sum.kinds.includes("siden")) {
        out.push({
          severity: DiagnosticSeverity.Warning,
          message:
            `Нуклид ${n.name} отсутствует в AW.LIB и попал в суммарный изотоп только через SIDEN — ` +
            `лучше явно указать его в карте SI`,
          range,
          code: "aw-mass-missing-siden",
          source: "mcuhelper",
        });
        continue;
      }

      out.push({
        severity: DiagnosticSeverity.Error,
        message: `Нуклид ${n.name} отсутствует в AW.LIB — добавьте его в суммарный изотоп (карта SI)`,
        range,
        code: "aw-mass-missing",
        source: "mcuhelper",
      });
    }
  }
  return out;
}

export function formatAwVerificationReport(r: AwLibVerificationResult): string {
  const lines = [
    r.message,
    r.awLibPath ? `Файл: ${r.awLibPath}` : "",
    `Источник сверки: ${r.source}`,
    `Сверено: ${r.compared}; нет в IAEA: ${r.missingInIaea.length}`,
  ].filter(Boolean);

  if (r.mismatches.length) {
    lines.push("", `Расхождения (${r.mismatches.length}) (имя | AW.LIB | IAEA | Δ):`);
    for (const m of r.mismatches) {
      lines.push(
        `  ${m.name.padEnd(6)} ${m.awLib.toFixed(6)}  ${m.iaea.toFixed(6)}  ${formatMassDelta(m.delta)}`
      );
    }
  }
  return lines.join("\n");
}
