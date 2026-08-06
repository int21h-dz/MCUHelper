/**
 * Парсер PARAMETE.THR / PARAMETE.FST (BURN6): периоды полураспада T1/2 из блоков LIST.
 * Строка: NAME  INAME  AW  [T1/2 unit]
 * INAME = Z*10000 + A*10 + isomer (0=ground, 1=m, …).
 */

import { getAwLibEntry } from "./awLib";

/** Z по символу элемента (для сверки, когда INAME в PARAMETE врёт). */
const ELEMENT_Z: Record<string, number> = {
  H: 1, D: 1, T: 1, HE: 2, LI: 3, BE: 4, B: 5, C: 6, N: 7, O: 8, F: 9, NE: 10,
  NA: 11, MG: 12, AL: 13, SI: 14, P: 15, S: 16, CL: 17, AR: 18, K: 19, CA: 20,
  SC: 21, TI: 22, V: 23, CR: 24, MN: 25, FE: 26, CO: 27, NI: 28, CU: 29, ZN: 30,
  GA: 31, GE: 32, AS: 33, SE: 34, BR: 35, KR: 36, RB: 37, SR: 38, Y: 39, ZR: 40,
  NB: 41, MO: 42, TC: 43, RU: 44, RH: 45, PD: 46, AG: 47, CD: 48, IN: 49, SN: 50,
  SB: 51, TE: 52, I: 53, XE: 54, CS: 55, BA: 56, LA: 57, CE: 58, PR: 59, ND: 60,
  PM: 61, SM: 62, EU: 63, GD: 64, TB: 65, DY: 66, HO: 67, ER: 68, TM: 69, YB: 70,
  LU: 71, HF: 72, TA: 73, W: 74, RE: 75, OS: 76, IR: 77, PT: 78, AU: 79, HG: 80,
  TL: 81, PB: 82, BI: 83, PO: 84, AT: 85, RN: 86, FR: 87, RA: 88, AC: 89, TH: 90,
  PA: 91, U: 92, NP: 93, PU: 94, AM: 95, CM: 96, BK: 97, CF: 98, ES: 99, FM: 100,
};

export type HalfLifeUnit = "s" | "m" | "h" | "d" | "y" | "a";

export interface ParameteThrEntry {
  /** Имя в файле, нормализованное (U-235, Am-242m). */
  name: string;
  /** INAME ZZAAAI (может расходиться с Z символа — баг некоторых строк THR). */
  iname: number;
  /** Z из INAME. */
  z: number;
  a: number;
  isomer: number;
  /** Z по символу элемента в NAME (предпочтительнее для IAEA). */
  zFromSymbol: number | null;
  atomicWeightApprox: number;
  /** Есть ли T1/2 (иначе считается стабильным в списке). */
  hasHalfLife: boolean;
  halfLifeValue: number | null;
  halfLifeUnit: HalfLifeUnit | null;
  /** T1/2 в секундах; null если стабилен / нет данных. */
  halfLifeSec: number | null;
  section: "longlife" | "shortlife" | "other";
}

export interface ParameteThrTable {
  /** Ключ — нормализованное имя (U-235). */
  byName: Map<string, ParameteThrEntry>;
  /** Ключ INAME. */
  byIname: Map<number, ParameteThrEntry>;
  /** Ключ `${Z}:${A}:${isomer}` */
  byZAI: Map<string, ParameteThrEntry>;
  path?: string;
  entryCount: number;
  withHalfLifeCount: number;
}

let currentTable: ParameteThrTable | null = null;

const SEC_PER: Record<HalfLifeUnit, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86_400,
  y: 31_557_600,
  a: 31_557_600,
};

const DATA_LINE =
  /^([A-Za-z]{1,2})\s*-\s*(\d+)(m?)\s+(\d{5,7})\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?)(?:\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?)\s*([sSmMhHdDyYaA]))?\s*$/;

const SECTION_STOP =
  /^(DECAY|CAPTURE|YIELD|ENERGY|EXCLUSION|CHAINES|BRANCHING|INDEPENDENT|stop)\b/i;

function normalizeUnit(u: string): HalfLifeUnit {
  const x = u.toLowerCase() as HalfLifeUnit;
  return x === "a" ? "y" : x;
}

export function halfLifeToSeconds(value: number, unit: HalfLifeUnit | string): number {
  const u = normalizeUnit(String(unit));
  return value * (SEC_PER[u] ?? 1);
}

export function formatHalfLifeValue(value: number, unit: HalfLifeUnit | string): string {
  const u = normalizeUnit(String(unit));
  const labels: Record<HalfLifeUnit, string> = {
    s: "с",
    m: "мин",
    h: "ч",
    d: "сут",
    y: "лет",
    a: "лет",
  };
  let s = value.toPrecision(4).replace(/\.?0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  if (s.endsWith(".")) s = s.slice(0, -1);
  return `${s} ${labels[u] ?? u}`;
}

export function formatHalfLifeSec(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  if (sec >= SEC_PER.y) return formatHalfLifeValue(sec / SEC_PER.y, "y");
  if (sec >= SEC_PER.d) return formatHalfLifeValue(sec / SEC_PER.d, "d");
  if (sec >= SEC_PER.h) return formatHalfLifeValue(sec / SEC_PER.h, "h");
  if (sec >= SEC_PER.m) return formatHalfLifeValue(sec / SEC_PER.m, "m");
  return formatHalfLifeValue(sec, "s");
}

function zaiKey(z: number, a: number, isomer: number): string {
  return `${z}:${a}:${isomer}`;
}

function normalizeParameteName(sym: string, mass: string, meta: string): string {
  const s = sym.length === 1 ? sym.toUpperCase() : sym[0].toUpperCase() + sym.slice(1).toLowerCase();
  return `${s}-${mass}${meta.toLowerCase() === "m" ? "m" : ""}`;
}

/** Разбор текста PARAMETE.THR / .FST (блоки LIST внутри LONGLIFE/SHORTLIFE). */
export function parseParameteThr(text: string, sourcePath?: string): ParameteThrTable {
  const byName = new Map<string, ParameteThrEntry>();
  const byIname = new Map<number, ParameteThrEntry>();
  const byZAI = new Map<string, ParameteThrEntry>();

  let inList = false;
  let section: ParameteThrEntry["section"] = "other";
  let withHalfLifeCount = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;

    const upper = trimmed.toUpperCase();
    if (upper.startsWith("LONGLIFE")) {
      section = "longlife";
      continue;
    }
    if (upper.startsWith("SHORTLIFE")) {
      section = "shortlife";
      continue;
    }
    if (/^LIST\b/i.test(trimmed)) {
      inList = true;
      continue;
    }
    if (SECTION_STOP.test(trimmed)) {
      inList = false;
      continue;
    }
    if (!inList) continue;
    if (trimmed.startsWith("*")) continue;
    // категории actinide / fisprod / …
    if (/^[a-z]{3,}$/i.test(trimmed) && !trimmed.includes("-")) continue;
    if (/^\*{3,}/.test(trimmed)) continue;

    const m = trimmed.match(DATA_LINE);
    if (!m) continue;

    const name = normalizeParameteName(m[1], m[2], m[3] ?? "");
    const iname = parseInt(m[4], 10);
    const aw = parseFloat(m[5]);
    if (!Number.isFinite(iname) || !Number.isFinite(aw)) continue;

    const z = Math.floor(iname / 10_000);
    const aFromIname = Math.floor((iname % 10_000) / 10);
    const isomer = iname % 10;
    const a = parseInt(m[2], 10);
    const zFromSymbol = ELEMENT_Z[m[1].toUpperCase()] ?? null;

    let hasHalfLife = false;
    let halfLifeValue: number | null = null;
    let halfLifeUnit: HalfLifeUnit | null = null;
    let halfLifeSec: number | null = null;
    if (m[6] != null && m[7] != null) {
      const v = parseFloat(m[6]);
      if (Number.isFinite(v) && v > 0) {
        hasHalfLife = true;
        halfLifeValue = v;
        halfLifeUnit = normalizeUnit(m[7]);
        halfLifeSec = halfLifeToSeconds(v, halfLifeUnit);
        withHalfLifeCount++;
      }
    }

    const entry: ParameteThrEntry = {
      name,
      iname,
      z,
      a: Number.isFinite(a) ? a : aFromIname,
      isomer,
      zFromSymbol,
      atomicWeightApprox: aw,
      hasHalfLife,
      halfLifeValue,
      halfLifeUnit,
      halfLifeSec,
      section,
    };

    // Поздние LIST (SHORTLIFE) перекрывают LONGLIFE при том же ключе имени.
    byName.set(name.toUpperCase(), entry);
    byIname.set(iname, entry);
    // Индекс Z:A по символу (если известен), иначе по INAME.
    const zKey = zFromSymbol ?? z;
    byZAI.set(zaiKey(zKey, entry.a, isomer), entry);
  }

  return {
    byName,
    byIname,
    byZAI,
    path: sourcePath,
    entryCount: byIname.size,
    withHalfLifeCount,
  };
}

export function setParameteThrTable(table: ParameteThrTable | null): void {
  currentTable = table;
}

export function getParameteThrTable(): ParameteThrTable | null {
  return currentTable;
}

export function clearParameteThrTable(): void {
  currentTable = null;
}

export function getParameteThrEntryByName(name: string): ParameteThrEntry | null {
  if (!currentTable) return null;
  return currentTable.byName.get(name.trim().toUpperCase()) ?? null;
}

export function getParameteThrEntryByZAI(z: number, a: number, isomer = 0): ParameteThrEntry | null {
  if (!currentTable) return null;
  return currentTable.byZAI.get(zaiKey(z, a, isomer)) ?? null;
}

/**
 * Поиск записи по имени MCU (CS37, U235, AM2M).
 * Ground state: через AW.LIB ZAID → Z:A:0.
 */
export function getParameteThrForMcuNuclide(mcuName: string): ParameteThrEntry | null {
  if (!currentTable) return null;
  const raw = mcuName.trim().toUpperCase();

  const aw = getAwLibEntry(raw);
  if (aw && aw.a != null) {
    const ground = getParameteThrEntryByZAI(aw.z, aw.a, 0);
    if (ground) return ground;
  }

  if (raw === "AM2M") {
    return currentTable.byName.get("AM-242M") ?? getParameteThrEntryByZAI(95, 242, 1);
  }

  return null;
}
