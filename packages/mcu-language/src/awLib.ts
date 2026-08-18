/**
 * Парсер AW.LIB (атомные веса природных смесей и изотопов в корне MDBNR).
 * Формат строки данных: NAME  ZAID  ATOMIC_WEIGHT
 * ZAID = Z*1000 + A; A=0 (xxx000) — природная смесь / характерный вес элемента.
 */

export interface AwLibEntry {
  /** Имя MCU (CS33, U235, H). */
  name: string;
  /** Символ элемента без массового числа (CS, U, H). */
  symbol: string;
  zaid: number;
  /** Атомная масса / средний атомный вес, а.е.м. */
  atomicWeight: number;
  z: number;
  /** Массовое число; null для природной смеси (ZAID % 1000 === 0). */
  a: number | null;
  isNatural: boolean;
}

export interface AwLibTable {
  byName: Map<string, AwLibEntry>;
  /** Ключ `${Z}:${A}` для изотопов; природные не индексируются. */
  byZA: Map<string, AwLibEntry>;
  path?: string;
  entryCount: number;
}

let currentTable: AwLibTable | null = null;

const DATA_LINE =
  /^([A-Za-z][A-Za-z0-9]*)\s+(\d+)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?)\s*$/;

function formatElementSymbol(sym: string): string {
  const u = sym.toUpperCase();
  if (u.length === 1) return u;
  return u[0] + u.slice(1).toLowerCase();
}

function zaKey(z: number, a: number): string {
  return `${z}:${a}`;
}

/** Разбор текста AW.LIB. */
export function parseAwLib(text: string, sourcePath?: string): AwLibTable {
  const byName = new Map<string, AwLibEntry>();
  const byZA = new Map<string, AwLibEntry>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("*")) continue;
    const m = line.match(DATA_LINE);
    if (!m) continue;

    const name = m[1].toUpperCase();
    const zaid = parseInt(m[2], 10);
    const atomicWeight = parseFloat(m[3]);
    if (!Number.isFinite(zaid) || !Number.isFinite(atomicWeight)) continue;

    const z = Math.floor(zaid / 1000);
    const aRem = zaid % 1000;
    const isNatural = aRem === 0;
    const a = isNatural ? null : aRem;

    const symMatch = name.match(/^([A-Z]{1,2})/);
    const symbol = (symMatch?.[1] ?? name).toUpperCase();

    const entry: AwLibEntry = {
      name,
      symbol,
      zaid,
      atomicWeight,
      z,
      a,
      isNatural,
    };
    byName.set(name, entry);
    if (a != null) byZA.set(zaKey(z, a), entry);
  }

  return {
    byName,
    byZA,
    path: sourcePath,
    entryCount: byName.size,
  };
}

export function setAwLibTable(table: AwLibTable | null): void {
  currentTable = table;
}

export function getAwLibTable(): AwLibTable | null {
  return currentTable;
}

export function clearAwLibTable(): void {
  currentTable = null;
}

export function getAwLibEntry(name: string): AwLibEntry | null {
  if (!currentTable) return null;
  return currentTable.byName.get(name.trim().toUpperCase()) ?? null;
}

/** Атомная масса из AW.LIB или null, если таблица не загружена / имя отсутствует. */
export function getAwLibAtomicWeight(name: string): number | null {
  return getAwLibEntry(name)?.atomicWeight ?? null;
}

/**
 * MCU → IAEA Target по ZAID из AW.LIB (CS33 → Cs-133).
 * Природные смеси → null.
 */
export function awLibToIaeaTarget(name: string): string | null {
  const e = getAwLibEntry(name);
  if (!e || e.a == null) return null;
  return `${formatElementSymbol(e.symbol)}-${e.a}`;
}

/** IAEA label (Cs-133) → имя MCU из AW.LIB (CS33), если есть. */
export function awLibNameFromIaeaLabel(label: string): string | null {
  if (!currentTable) return null;
  const m = label.trim().match(/^([A-Za-z]{1,2})-(\d+)$/);
  if (!m) return null;
  const sym = m[1].toUpperCase();
  const a = parseInt(m[2], 10);
  if (!Number.isFinite(a)) return null;

  const natural = currentTable.byName.get(sym);
  if (natural) {
    const hit = currentTable.byZA.get(zaKey(natural.z, a));
    if (hit) return hit.name;
  }
  for (const e of currentTable.byName.values()) {
    if (!e.isNatural && e.symbol === sym && e.a === a) return e.name;
  }
  return null;
}

export interface AwLibCatalogItem {
  name: string;
  zaid: number;
  atomicWeight: number;
  isNatural: boolean;
}

/** Плоский список AW.LIB для combobox конструктора материалов. */
export function listAwLibCatalog(): AwLibCatalogItem[] {
  if (!currentTable) return [];
  return [...currentTable.byName.values()]
    .map((e) => ({
      name: e.name,
      zaid: e.zaid,
      atomicWeight: e.atomicWeight,
      isNatural: e.isNatural,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function formatAtomicWeightAmu(aw: number): string {
  if (!Number.isFinite(aw)) return "—";
  if (Math.abs(aw - Math.round(aw)) < 1e-12) return String(Math.round(aw));
  let s = aw.toFixed(8);
  s = s.replace(/\.?0+$/, "");
  return s;
}

/** Таблица AW.LIB из каталога LSP — чтобы конструктор считал ρ теми же A, что ховер. */
export function setAwLibTableFromCatalog(items: AwLibCatalogItem[], sourcePath?: string): void {
  if (!items.length) {
    setAwLibTable(null);
    return;
  }
  const byName = new Map<string, AwLibEntry>();
  const byZA = new Map<string, AwLibEntry>();
  for (const item of items) {
    const name = item.name.trim().toUpperCase();
    if (!name || !Number.isFinite(item.zaid) || !Number.isFinite(item.atomicWeight)) continue;
    const z = Math.floor(item.zaid / 1000);
    const aRem = item.zaid % 1000;
    const isNatural = item.isNatural || aRem === 0;
    const a = isNatural ? null : aRem;
    const symMatch = name.match(/^([A-Z]{1,2})/);
    const entry: AwLibEntry = {
      name,
      symbol: (symMatch?.[1] ?? name).toUpperCase(),
      zaid: item.zaid,
      atomicWeight: item.atomicWeight,
      z,
      a,
      isNatural,
    };
    byName.set(name, entry);
    if (a != null) byZA.set(zaKey(z, a), entry);
  }
  setAwLibTable({ byName, byZA, path: sourcePath, entryCount: byName.size });
}
