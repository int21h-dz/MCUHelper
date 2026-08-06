/**
 * Кэш IAEA LiveChart ground_states (atomic_mass + half_life_sec).
 *
 * Слои (по приоритету чтения):
 * 1. Бандл в VSIX (`data/livechart-ground-states.json`) — офлайн по умолчанию
 * 2. Профиль пользователя `~/.mcuhelper/livechart-ground-states.json` — пополняется сетью
 * 3. Сеть — только если в объединённом кэше нет данных / фоновое обновление по TTL
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import bundledJson from "./data/livechart-ground-states.json";

const LIVECHART_URL = "https://nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides=all";
const USER_AGENT = "Mozilla/5.0 (compatible; McuHelper/0.1; +https://github.com/mcuhelper)";
const USER_CACHE_FILE = path.join(os.homedir(), ".mcuhelper", "livechart-ground-states.json");
/** Фоновый refresh user-кэша не чаще чем раз в 30 суток. */
export const LIVECHART_USER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

export interface LiveChartNuclide {
  z: number;
  a: number;
  mass: number;
  symbol: string;
  halfLifeSec: number | null;
  halfLifeStable: boolean;
}

/** Компактная запись в JSON-кэше. */
interface CompactEntry {
  z: number;
  a: number;
  s?: string;
  m: number;
  h?: number | null;
  st?: boolean;
}

interface LiveChartCacheFile {
  v: number;
  fetchedAt?: string;
  source?: string;
  n?: number;
  e: CompactEntry[];
}

export type LiveChartCacheSource = "bundled" | "user" | "network" | "merged";

export interface LiveChartGroundStatesResult {
  map: Map<string, LiveChartNuclide>;
  source: LiveChartCacheSource;
  fetchedAt?: string;
  entryCount: number;
  /** true — ходили в сеть в этом вызове. */
  usedNetwork: boolean;
}

let memoryMap: Map<string, LiveChartNuclide> | null = null;
let memoryMeta: { source: LiveChartCacheSource; fetchedAt?: string } | null = null;
let networkRefreshPromise: Promise<void> | null = null;

function zaKey(z: number, a: number): string {
  return `${z}:${a}`;
}

function compactToNuclide(e: CompactEntry): LiveChartNuclide | null {
  if (!Number.isFinite(e.z) || !Number.isFinite(e.a) || !Number.isFinite(e.m) || e.m <= 0) return null;
  return {
    z: e.z,
    a: e.a,
    mass: e.m,
    symbol: e.s ?? "",
    halfLifeSec: e.h != null && Number.isFinite(e.h) && e.h > 0 ? e.h : null,
    halfLifeStable: e.st === true,
  };
}

export function parseLiveChartCacheFile(data: LiveChartCacheFile): Map<string, LiveChartNuclide> {
  const map = new Map<string, LiveChartNuclide>();
  if (!data?.e?.length) return map;
  for (const e of data.e) {
    const n = compactToNuclide(e);
    if (!n) continue;
    map.set(zaKey(n.z, n.a), n);
  }
  return map;
}

export function liveChartMapToCacheFile(
  map: Map<string, LiveChartNuclide>,
  fetchedAt = new Date().toISOString()
): LiveChartCacheFile {
  const e: CompactEntry[] = [];
  for (const n of map.values()) {
    const row: CompactEntry = { z: n.z, a: n.a, m: n.mass };
    if (n.symbol) row.s = n.symbol;
    if (n.halfLifeSec != null) row.h = n.halfLifeSec;
    if (n.halfLifeStable) row.st = true;
    e.push(row);
  }
  return {
    v: 1,
    fetchedAt,
    source: "IAEA LiveChart ground_states",
    n: e.length,
    e,
  };
}

/** Парсинг сырого CSV LiveChart → карта (для тестов и refresh-скрипта). */
export function parseLiveChartAtomicMasses(csv: string): Map<string, LiveChartNuclide> {
  const map = new Map<string, LiveChartNuclide>();
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return map;

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const iZ = header.indexOf("z");
  const iN = header.indexOf("n");
  const iSym = header.indexOf("symbol");
  const iMass = header.indexOf("atomic_mass");
  const iHlSec = header.indexOf("half_life_sec");
  const iHl = header.indexOf("half_life");
  if (iZ < 0 || iN < 0 || iMass < 0) return map;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length <= Math.max(iZ, iN, iMass)) continue;
    const z = parseInt(cols[iZ]!, 10);
    const n = parseInt(cols[iN]!, 10);
    const micro = parseFloat(cols[iMass]!);
    if (!Number.isFinite(z) || !Number.isFinite(n) || !Number.isFinite(micro) || micro <= 0) continue;
    const a = z + n;
    const symbol = (iSym >= 0 ? cols[iSym]?.trim() : "") || "";
    const hlRaw = iHl >= 0 ? cols[iHl]?.trim() : "";
    const halfLifeStable = /^stable$/i.test(hlRaw ?? "");
    let halfLifeSec: number | null = null;
    if (iHlSec >= 0) {
      const sec = parseFloat(cols[iHlSec]!);
      if (Number.isFinite(sec) && sec > 0) halfLifeSec = sec;
    }
    map.set(zaKey(z, a), {
      z,
      a,
      mass: micro / 1e6,
      symbol,
      halfLifeSec,
      halfLifeStable,
    });
  }
  return map;
}

function mergeMaps(
  base: Map<string, LiveChartNuclide>,
  overlay: Map<string, LiveChartNuclide>
): Map<string, LiveChartNuclide> {
  const out = new Map(base);
  for (const [k, v] of overlay) out.set(k, v);
  return out;
}

function loadBundledMap(): { map: Map<string, LiveChartNuclide>; fetchedAt?: string } {
  const data = bundledJson as LiveChartCacheFile;
  return { map: parseLiveChartCacheFile(data), fetchedAt: data.fetchedAt };
}

async function loadUserCacheFile(): Promise<{ map: Map<string, LiveChartNuclide>; fetchedAt?: string } | null> {
  try {
    const text = await fs.readFile(USER_CACHE_FILE, "utf8");
    const data = JSON.parse(text) as LiveChartCacheFile;
    if (!data?.e?.length) return null;
    return { map: parseLiveChartCacheFile(data), fetchedAt: data.fetchedAt };
  } catch {
    return null;
  }
}

async function saveUserCache(map: Map<string, LiveChartNuclide>, fetchedAt?: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(USER_CACHE_FILE), { recursive: true });
    const payload = liveChartMapToCacheFile(map, fetchedAt ?? new Date().toISOString());
    await fs.writeFile(USER_CACHE_FILE, JSON.stringify(payload), "utf8");
  } catch {
    // кэш на диске необязателен
  }
}

async function fetchLiveChartCsv(): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LIVECHART_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/csv,*/*" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function cacheAgeMs(fetchedAt?: string): number {
  if (!fetchedAt) return Number.POSITIVE_INFINITY;
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

export interface GetLiveChartOptions {
  /**
   * Разрешить сеть, если локальных данных нет или нужен refresh.
   * По умолчанию true: сеть только при дырах / просроченном user-кэше (фон).
   */
  allowNetwork?: boolean;
  /** Принудительно скачать и обновить user-кэш. */
  forceNetwork?: boolean;
}

/**
 * Карта Z:A → данные LiveChart.
 * По умолчанию: бандл ⊕ user-кэш без сети; сеть — если force / пусто / фоновый TTL.
 */
export async function getLiveChartGroundStates(
  options: GetLiveChartOptions = {}
): Promise<LiveChartGroundStatesResult> {
  const allowNetwork = options.allowNetwork !== false;
  const forceNetwork = options.forceNetwork === true;

  if (memoryMap && memoryMap.size > 0 && !forceNetwork) {
    return {
      map: memoryMap,
      source: memoryMeta?.source ?? "merged",
      fetchedAt: memoryMeta?.fetchedAt,
      entryCount: memoryMap.size,
      usedNetwork: false,
    };
  }

  const bundled = loadBundledMap();
  const user = await loadUserCacheFile();

  let map = bundled.map;
  let source: LiveChartCacheSource = "bundled";
  let fetchedAt = bundled.fetchedAt;

  if (user && user.map.size > 0) {
    map = mergeMaps(bundled.map, user.map);
    source = "merged";
    fetchedAt = user.fetchedAt ?? bundled.fetchedAt;
  }

  let usedNetwork = false;

  // Сеть: только force, пустой локальный кэш, или просроченный/отсутствующий user-кэш.
  const shouldFetch =
    forceNetwork ||
    (allowNetwork && map.size === 0) ||
    (allowNetwork && (!user || cacheAgeMs(user.fetchedAt) > LIVECHART_USER_CACHE_TTL_MS));

  if (shouldFetch) {
    const csv = await fetchLiveChartCsv();
    if (csv) {
      const net = parseLiveChartAtomicMasses(csv);
      if (net.size > 0) {
        map = mergeMaps(map, net);
        source = "network";
        fetchedAt = new Date().toISOString();
        usedNetwork = true;
        await saveUserCache(map, fetchedAt);
      }
    }
  }

  memoryMap = map;
  memoryMeta = { source, fetchedAt };

  return { map, source, fetchedAt, entryCount: map.size, usedNetwork };
}

/** Сброс in-memory (тесты). */
export function clearLiveChartMemoryCache(): void {
  memoryMap = null;
  memoryMeta = null;
}

/**
 * Фоновый refresh user-кэша, если просрочен; не блокирует сверку.
 * Бандл остаётся базой.
 */
export function scheduleLiveChartCacheRefresh(): void {
  if (networkRefreshPromise) return;
  networkRefreshPromise = (async () => {
    const user = await loadUserCacheFile();
    if (user && cacheAgeMs(user.fetchedAt) <= LIVECHART_USER_CACHE_TTL_MS) return;
    await getLiveChartGroundStates({ allowNetwork: true, forceNetwork: !user });
  })()
    .catch(() => undefined)
    .finally(() => {
      networkRefreshPromise = null;
    });
}

/** Путь user-кэша (для логов/тестов). */
export function getLiveChartUserCachePath(): string {
  return USER_CACHE_FILE;
}
