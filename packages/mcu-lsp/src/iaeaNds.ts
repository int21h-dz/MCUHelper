import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  computeMcuIsotopeLines,
  iaeaLabelToMcuNuclide,
  mcuNuclideToIaeaElement,
  mcuNuclideToIaeaTarget,
  type McuIsotopeLine,
} from "@mcuhelper/mcu-language";
import { bundledNaturalAbundanceMap } from "./bundledNaturalAbundance";

const API_BASE = "https://nds.iaea.org/exfor";
const LIVECHART_BASE = "https://nds.iaea.org/relnsd/v1/data";
const USER_AGENT = "Mozilla/5.0 (compatible; McuHelper/0.1; +https://github.com/mcuhelper)";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000;
/** Смена формата hover — инвалидирует старый markdown на диске. */
const CACHE_FORMAT = "v4";
const FETCH_TIMEOUT_MS = 8000;
const CACHE_FILE = path.join(os.homedir(), ".mcuhelper", "iaea-nds-cache.json");
const NATURAL_ABUNDANCE_FILE = path.join(os.homedir(), ".mcuhelper", "natural-abundance-index.json");
const PREFERRED_LIBS = ["ENDF/B-VIII.1", "ENDF/B-VIII.0", "ENDF/B-VII.1", "JEFF-3.3"];
const THERMAL_EV = 0.0253;
const FAST_ENERGIES_EV = [1e6, 14e6] as const;

interface CacheEntry {
  markdown: string | null;
  expires: number;
}

interface IsotopeAbundance {
  mass: number;
  abundance: number;
  label: string;
}

export interface NaturalInsertContext {
  uri: string;
  line: number;
  character: number;
  nuclideName: string;
  concentration: string;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | null>>();
let naturalAbundanceIndex: Map<string, IsotopeAbundance[]> | null = null;
let naturalAbundanceExpiry = 0;
let naturalAbundanceUpgradePromise: Promise<void> | null = null;
let naturalAbundancePersistTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let diskCacheLoaded = false;

interface EndfSection {
  SectID: number;
  PenSectID?: number;
  LibName?: string;
  Targ?: string;
  RC?: string;
  DATE?: string;
  AUTH?: string;
}

interface EndfListResponse {
  sections?: EndfSection[];
}

interface DecayMode {
  txRTYP?: string;
  Branching?: number;
  DecayQ?: number;
  uDecayQ?: string;
}

interface DecayResponse {
  Nucleus?: string;
  Library?: string;
  AUTH?: string;
  T12?: number;
  uT12?: string;
  dT12?: number;
  Spin?: number;
  Parity?: string;
  DecayModes?: DecayMode[];
  Ealpha?: number;
  uEalpha?: string;
  Ebeta?: number;
  uEbeta?: string;
}

interface SigPoint {
  E: number;
  Sig: number;
  dSig?: number;
}

interface SigDataset {
  pts?: SigPoint[];
  LIBRARY?: string;
  REACTION?: string;
}

interface SigResponse {
  datasets?: SigDataset[];
}

const NEUTRON_REACTIONS: Array<{ reaction: string; label: string }> = [
  { reaction: "n,g", label: "(n,g)" },
  { reaction: "n,f", label: "(n,f)" },
  { reaction: "n,el", label: "(n,el)" },
  { reaction: "n,2n", label: "(n,2n)" },
  { reaction: "n,3n", label: "(n,3n)" },
  { reaction: "n,a", label: "(n,a)" },
];

async function fetchJson<T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pickSection(sections: EndfSection[]): EndfSection | undefined {
  for (const lib of PREFERRED_LIBS) {
    const hit = sections.find((s) => s.LibName === lib);
    if (hit) return hit;
  }
  return sections[0];
}

function formatSci(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e4 || (abs > 0 && abs < 1e-2)) {
    return value.toExponential(Math.max(1, digits - 1));
  }
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 10) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(3);
  return value.toPrecision(digits);
}

function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "-";
  const pct = fraction * 100;
  if (pct >= 0.01) return `${pct.toFixed(2)}%`;
  if (pct > 0) return `${formatSci(pct, 2)}%`;
  return "0%";
}

function formatParity(p?: string): string {
  if (!p) return "";
  const map: Record<string, string> = { plus: "+", minus: "-", "+": "+", "-": "-" };
  return map[p.toLowerCase()] ?? p;
}

function formatSpinJpi(spin?: number, parity?: string): string | null {
  if (spin == null) return null;
  const p = formatParity(parity);
  const spinText = Number.isInteger(spin) ? String(spin) : String(spin);
  return p ? `${spinText}${p}` : spinText;
}

function halfLifeToSeconds(t12: number, unit: string): number {
  const u = unit.toLowerCase();
  const factors: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    y: 31_557_600,
    a: 31_557_600,
  };
  return t12 * (factors[u] ?? 1);
}

function formatHalfLife(t12?: number, unit?: string, dt?: number): string | null {
  if (t12 == null || !unit) return null;
  const unc = dt != null && dt > 0 ? ` +/- ${formatSci(dt, 2)}` : "";
  const units: Record<string, string> = {
    s: "с",
    m: "мин",
    h: "ч",
    d: "сут",
    y: "лет",
    a: "лет",
  };
  const label = units[unit.toLowerCase()] ?? unit;
  const seconds = halfLifeToSeconds(t12, unit);
  if (seconds >= 86400 * 365) {
    return `${formatSci(t12, 3)}${unc} ${label}`;
  }
  if (seconds >= 3600) return `${formatSci(t12, 3)}${unc} ${label}`;
  if (seconds >= 1) return `${formatSci(t12, 3)}${unc} ${label}`;
  return `${formatSci(seconds, 3)} с`;
}

/** GFM-таблица; безопасна, если в тексте нет сырого `<` (ломает markdown HTML). */
function mdTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return "";
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = [
    `| ${headers.map(esc).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((c) => esc(String(c))).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function formatBarn(value: number | null | undefined, unc?: number): string {
  if (value == null || !Number.isFinite(value)) return "-";
  if (unc != null && Number.isFinite(unc) && unc > 0) {
    return `${formatSci(value)} +/- ${formatSci(unc)}`;
  }
  return formatSci(value);
}

function nearestSigma(pts: SigPoint[] | undefined, energyEv: number): { sig: number; dSig?: number } | null {
  if (!pts?.length) return null;
  let best: SigPoint | null = null;
  for (const p of pts) {
    if (p.Sig == null || !Number.isFinite(p.Sig) || p.Sig <= 0) continue;
    if (!best || Math.abs(p.E - energyEv) < Math.abs(best.E - energyEv)) best = p;
  }
  return best ? { sig: best.Sig, dSig: best.dSig } : null;
}

/** Стриминг PenSectID: ищем σ на тепловой энергии без загрузки всего JSON. */
async function fetchThermalSigmaBarn(penSectId: number, energyEv = THERMAL_EV): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/e4sig?PenSectID=${penSectId}&json`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const energyPatterns = [
      `"E":${energyEv}`,
      `"E":${energyEv.toFixed(4)}`,
      `"E":${energyEv.toFixed(1)}`,
    ];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      for (const marker of energyPatterns) {
        const idx = buf.indexOf(marker);
        if (idx < 0) continue;
        const slice = buf.slice(idx, idx + 120);
        const sigM = slice.match(/"Sig"\s*:\s*([0-9.Ee+-]+)/);
        if (sigM) {
          await reader.cancel();
          return parseFloat(sigM[1]);
        }
      }

      if (buf.length > 400_000) buf = buf.slice(-150_000);
      if (buf.length > 2_500_000) break;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSigmaCurve(sectId: number): Promise<SigPoint[] | null> {
  const data = await fetchJson<SigResponse>(`${API_BASE}/e4sig?SectID=${sectId}&json`);
  return data?.datasets?.[0]?.pts ?? null;
}

interface CrossSectionRow {
  label: string;
  thermal: string;
  at1MeV: string;
  at14MeV: string;
}

async function fetchCrossSectionRows(target: string): Promise<CrossSectionRow[]> {
  const lists = await Promise.all(
    NEUTRON_REACTIONS.map(async ({ reaction, label }) => {
      const list = await fetchJson<EndfListResponse>(
        `${API_BASE}/e4list?Target=${encodeURIComponent(target)}&Reaction=${reaction}&Quantity=SIG&json`,
        5000
      );
      const section = pickSection(list?.sections ?? []);
      return { label, section };
    })
  );

  const rows: CrossSectionRow[] = [];
  for (const { label, section } of lists) {
    if (!section?.SectID) continue;

    const [thermal, pts] = await Promise.all([
      section.PenSectID && section.PenSectID > 0
        ? fetchThermalSigmaBarn(section.PenSectID)
        : Promise.resolve(null),
      fetchSigmaCurve(section.SectID),
    ]);

    const thermalVal =
      thermal ??
      nearestSigma(pts ?? undefined, THERMAL_EV)?.sig ??
      null;
    const fast1 = nearestSigma(pts ?? undefined, FAST_ENERGIES_EV[0]);
    const fast14 = nearestSigma(pts ?? undefined, FAST_ENERGIES_EV[1]);

    if (thermalVal == null && !fast1 && !fast14) continue;

    rows.push({
      label,
      thermal: formatBarn(thermalVal),
      at1MeV: formatBarn(fast1?.sig, fast1?.dSig),
      at14MeV: formatBarn(fast14?.sig, fast14?.dSig),
    });
  }
  return rows;
}

function formatDecayBlock(target: string, decay: DecayResponse, section: EndfSection): string {
  const nucleus = decay.Nucleus ?? target;
  const metaRows: string[][] = [];
  if (decay.Library) metaRows.push(["Библиотека", decay.Library]);
  if (decay.AUTH) metaRows.push(["Оценка", decay.AUTH.trim()]);
  const hl = formatHalfLife(decay.T12, decay.uT12, decay.dT12);
  if (hl) metaRows.push(["T1/2", hl]);
  const jpi = formatSpinJpi(decay.Spin, decay.Parity);
  if (jpi) metaRows.push(["Jpi", jpi]);
  if (decay.Ealpha != null) metaRows.push(["E-alpha", `${formatSci(decay.Ealpha)} ${decay.uEalpha ?? "keV"}`]);
  if (decay.Ebeta != null) metaRows.push(["E-beta", `${formatSci(decay.Ebeta)} ${decay.uEbeta ?? "keV"}`]);

  const lines: string[] = [
    "",
    `**[IAEA NDS - ${nucleus}](https://www-nds.iaea.org/exfor/x4guide/API/#ENDF)**`,
  ];

  if (metaRows.length) {
    lines.push("", mdTable(["Параметр", "Значение"], metaRows));
  }

  if (decay.DecayModes?.length) {
    const modeRows = decay.DecayModes.filter((dm) => dm.Branching == null || dm.Branching >= 1e-8)
      .sort((a, b) => (b.Branching ?? 0) - (a.Branching ?? 0))
      .map((dm) => [
        dm.txRTYP ?? "?",
        dm.Branching != null ? formatPercent(dm.Branching) : "-",
        dm.DecayQ != null ? `${formatSci(dm.DecayQ)} ${dm.uDecayQ ?? "keV"}` : "-",
      ]);
    if (modeRows.length) {
      lines.push("", "**Распад**", "", mdTable(["Режим", "Вклад", "Q"], modeRows));
    }
  }

  lines.push(
    "",
    `[ENDF decay](${API_BASE}/e4list?Target=${encodeURIComponent(target)}&Reaction=decay&json) · SectID ${section.SectID}`
  );
  return lines.join("\n");
}

function formatCrossSectionBlock(target: string, rows: CrossSectionRow[], library?: string): string {
  if (!rows.length) return "";
  const libNote = library ? ` (${library})` : "";
  const lines = [
    "",
    `**Сечения ENDF${libNote}**, barn`,
    "",
    mdTable(
      ["Реакция", `sigma @ ${THERMAL_EV} eV`, "sigma @ 1 MeV", "sigma @ 14 MeV"],
      rows.map((r) => [r.label, r.thermal, r.at1MeV, r.at14MeV])
    ),
    "",
    `[ENDF sigma](${API_BASE}/e4list?Target=${encodeURIComponent(target)}&Reaction=n,g&Quantity=SIG&json)`,
  ];
  return lines.join("\n");
}

async function fetchIsotopeMarkdown(target: string): Promise<string | null> {
  const decayList = await fetchJson<EndfListResponse>(
    `${API_BASE}/e4list?Target=${encodeURIComponent(target)}&Reaction=decay&json`
  );
  const decaySection = pickSection(decayList?.sections ?? []);

  const [decay, xsecRows] = await Promise.all([
    decaySection?.SectID
      ? fetchJson<DecayResponse>(`${API_BASE}/e4decay?SectID=${decaySection.SectID}&json`)
      : Promise.resolve(null),
    fetchCrossSectionRows(target),
  ]);

  const parts: string[] = [];
  if (decay && decaySection) {
    parts.push(formatDecayBlock(target, decay, decaySection));
  } else if (xsecRows.length) {
    parts.push(
      "",
      `**[IAEA NDS - ${target}](https://www-nds.iaea.org/exfor/x4guide/API/#ENDF)**`
    );
  }

  if (xsecRows.length) {
    parts.push(formatCrossSectionBlock(target, xsecRows, PREFERRED_LIBS[0]));
  }

  if (!parts.length) return null;
  return parts.join("\n");
}

function parseNaturalAbundanceCsv(csv: string): Map<string, IsotopeAbundance[]> {
  const map = new Map<string, IsotopeAbundance[]>();
  const lines = csv.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const abundanceRaw = cols[5]?.trim();
    if (!abundanceRaw) continue;
    const z = parseInt(cols[0], 10);
    const n = parseInt(cols[1], 10);
    const sym = cols[2]?.trim();
    const abundance = parseFloat(abundanceRaw);
    if (!sym || !Number.isFinite(z) || !Number.isFinite(n) || !Number.isFinite(abundance)) continue;
    const mass = z + n;
    const key = sym.toUpperCase();
    const list = map.get(key) ?? [];
    list.push({ mass, abundance, label: `${sym}-${mass}` });
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.mass - b.mass);
  }
  return map;
}

interface NaturalAbundanceDiskFile {
  expires: number;
  elements: Record<string, IsotopeAbundance[]>;
}

function mergeAbundanceMaps(
  base: Map<string, IsotopeAbundance[]>,
  overlay: Map<string, IsotopeAbundance[]>
): Map<string, IsotopeAbundance[]> {
  const merged = new Map(base);
  for (const [key, list] of overlay) {
    merged.set(key, list);
  }
  return merged;
}

function setNaturalAbundanceIndex(map: Map<string, IsotopeAbundance[]>, expires: number): void {
  naturalAbundanceIndex = map;
  naturalAbundanceExpiry = expires;
  scheduleNaturalAbundancePersist();
}

function scheduleNaturalAbundancePersist(): void {
  if (!naturalAbundanceIndex) return;
  if (naturalAbundancePersistTimer) clearTimeout(naturalAbundancePersistTimer);
  naturalAbundancePersistTimer = setTimeout(() => {
    naturalAbundancePersistTimer = null;
    void persistNaturalAbundanceIndex();
  }, 500);
}

async function persistNaturalAbundanceIndex(): Promise<void> {
  if (!naturalAbundanceIndex) return;
  try {
    await fs.mkdir(path.dirname(NATURAL_ABUNDANCE_FILE), { recursive: true });
    const elements: Record<string, IsotopeAbundance[]> = {};
    for (const [key, list] of naturalAbundanceIndex) {
      elements[key] = list;
    }
    const payload: NaturalAbundanceDiskFile = {
      expires: naturalAbundanceExpiry,
      elements,
    };
    await fs.writeFile(NATURAL_ABUNDANCE_FILE, JSON.stringify(payload), "utf8");
  } catch {
    // ignore disk errors
  }
}

async function loadNaturalAbundanceFromDisk(): Promise<{ map: Map<string, IsotopeAbundance[]>; expires: number } | null> {
  try {
    const text = await fs.readFile(NATURAL_ABUNDANCE_FILE, "utf8");
    const data = JSON.parse(text) as NaturalAbundanceDiskFile;
    if (!data.elements || data.expires <= Date.now()) return null;
    const map = new Map<string, IsotopeAbundance[]>();
    for (const [key, list] of Object.entries(data.elements)) {
      if (list?.length) map.set(key.toUpperCase(), list);
    }
    return map.size ? { map, expires: data.expires } : null;
  } catch {
    return null;
  }
}

/** Мгновенный in-memory индекс из bundled — не ждёт сеть. */
function ensureBundledNaturalAbundanceIndex(): void {
  if (naturalAbundanceIndex && naturalAbundanceExpiry > Date.now()) return;
  naturalAbundanceIndex = bundledNaturalAbundanceMap();
  naturalAbundanceExpiry = Date.now() + CACHE_TTL_MS;
}

async function runNaturalAbundanceUpgrade(): Promise<void> {
  const now = Date.now();
  ensureBundledNaturalAbundanceIndex();

  const disk = await loadNaturalAbundanceFromDisk();
  if (disk) {
    naturalAbundanceIndex = mergeAbundanceMaps(bundledNaturalAbundanceMap(), disk.map);
    naturalAbundanceExpiry = disk.expires;
    scheduleNaturalAbundancePersist();
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  let csv: string | null = null;
  try {
    const res = await fetch(`${LIVECHART_BASE}?fields=ground_states&nuclides=all`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/csv" },
      signal: ctrl.signal,
    });
    if (res.ok) csv = await res.text();
  } catch {
    csv = null;
  } finally {
    clearTimeout(timer);
  }

  if (csv) {
    const parsed = parseNaturalAbundanceCsv(csv);
    const base = naturalAbundanceIndex ?? bundledNaturalAbundanceMap();
    naturalAbundanceIndex = mergeAbundanceMaps(base, parsed);
    naturalAbundanceExpiry = now + CACHE_TTL_MS;
    scheduleNaturalAbundancePersist();
  }
}

/** Фоновое обновление с диска/IAEA; не блокирует expand для элементов из bundled. */
function scheduleNaturalAbundanceUpgrade(): void {
  if (naturalAbundanceUpgradePromise) return;
  naturalAbundanceUpgradePromise = runNaturalAbundanceUpgrade().finally(() => {
    naturalAbundanceUpgradePromise = null;
  });
}

/** Дождаться полного индекса (disk + IAEA) — только если элемента нет в текущем кэше. */
async function loadNaturalAbundanceIndex(): Promise<Map<string, IsotopeAbundance[]> | null> {
  ensureBundledNaturalAbundanceIndex();
  scheduleNaturalAbundanceUpgrade();
  if (naturalAbundanceUpgradePromise) {
    await naturalAbundanceUpgradePromise;
  }
  return naturalAbundanceIndex;
}

/** Фоновая подгрузка индекса природного состава при старте LSP. */
export function warmupNaturalAbundanceIndex(): void {
  ensureBundledNaturalAbundanceIndex();
  scheduleNaturalAbundanceUpgrade();
}

function formatNaturalInsertButton(ctx: NaturalInsertContext): string {
  const args = {
    uri: ctx.uri,
    line: ctx.line,
    character: ctx.character,
    nuclideName: ctx.nuclideName,
    concentration: ctx.concentration,
  };
  const query = encodeURIComponent(JSON.stringify([args]));
  return `\n\n**[⇄ Разложить на изотопы (ICE)](command:mcuhelper.expandNaturalIsotope?${query})**`;
}

export function formatNaturalInsertHoverButton(ctx: NaturalInsertContext): string {
  return formatNaturalInsertButton(ctx);
}

function formatNaturalMarkdown(
  element: string,
  isotopes: IsotopeAbundance[],
  insert?: NaturalInsertContext
): string {
  const endfTarget = `${element}-0`;
  const rows = isotopes.map((iso) => [iso.label, `${iso.abundance}%`]);
  const lines: string[] = [
    "",
    `**[IAEA NDS - природный ${element}](https://www-nds.iaea.org/relnsd/vcharthtml/api_v0_guide.html)**`,
    "",
    mdTable(["Изотоп", "Мольная доля"], rows),
    "",
    `[LiveChart](${LIVECHART_BASE}?fields=ground_states&nuclides=all) · [ENDF ${endfTarget}](${API_BASE}/e4list?Target=${encodeURIComponent(endfTarget)}&Reaction=n,g&Quantity=SIG&json)`,
  ];
  if (insert) lines.push(formatNaturalInsertButton(insert));
  return lines.join("\n");
}

async function fetchNaturalCompositionMarkdown(
  element: string,
  insert?: NaturalInsertContext
): Promise<string | null> {
  const index = await loadNaturalAbundanceIndex();
  if (!index) return null;
  const isotopes = index.get(element.toUpperCase());
  if (!isotopes?.length) return null;
  return formatNaturalMarkdown(element, isotopes, insert);
}

function getCachedNaturalIsotopes(element: string): IsotopeAbundance[] | null {
  ensureBundledNaturalAbundanceIndex();
  if (!naturalAbundanceIndex) return null;
  const list = naturalAbundanceIndex.get(element.toUpperCase());
  return list?.length ? list : null;
}

export function prefetchNaturalAbundance(element: string): void {
  ensureBundledNaturalAbundanceIndex();
  scheduleNaturalAbundanceUpgrade();
  const key = `${CACHE_FORMAT}:natural:${element.toUpperCase()}`;
  if (readCacheEntry(key) || inFlight.has(key)) return;
  const job = (async () => {
    const md = await fetchNaturalCompositionMarkdown(element);
    writeCacheEntry(key, md, md ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS);
    return md;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
}

export async function getNaturalIsotopeLines(
  element: string,
  concentration: string
): Promise<McuIsotopeLine[] | null> {
  ensureBundledNaturalAbundanceIndex();

  let isotopes = getCachedNaturalIsotopes(element);
  if (!isotopes?.length) {
    await loadNaturalAbundanceIndex();
    isotopes = getCachedNaturalIsotopes(element);
  } else {
    scheduleNaturalAbundanceUpgrade();
  }

  if (!isotopes?.length) return null;
  const total = parseFloat(concentration);
  if (!Number.isFinite(total)) return null;
  return computeMcuIsotopeLines(
    total,
    isotopes.map((iso) => ({
      mcuName: iaeaLabelToMcuNuclide(iso.label),
      abundancePercent: iso.abundance,
    }))
  );
}

function formatCachedNaturalMarkdown(element: string, insert?: NaturalInsertContext): string | null {
  const isotopes = getCachedNaturalIsotopes(element);
  if (!isotopes) return null;
  return formatNaturalMarkdown(element, isotopes, insert);
}

async function loadDiskCache(): Promise<void> {
  if (diskCacheLoaded) return;
  diskCacheLoaded = true;
  try {
    const text = await fs.readFile(CACHE_FILE, "utf8");
    const data = JSON.parse(text) as Record<string, CacheEntry>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(data)) {
      if (entry.expires > now) cache.set(key, entry);
    }
  } catch {
    // нет файла или битый JSON — начинаем с пустого кэша
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistDiskCache();
  }, 2000);
}

async function persistDiskCache(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const now = Date.now();
    const snapshot: Record<string, CacheEntry> = {};
    for (const [key, entry] of cache) {
      if (entry.expires > now) snapshot[key] = entry;
    }
    await fs.writeFile(CACHE_FILE, JSON.stringify(snapshot), "utf8");
  } catch {
    // запись кэша необязательна
  }
}

function resolveCacheKey(nuclideName: string): string | null {
  const target = mcuNuclideToIaeaTarget(nuclideName);
  if (target) return `${CACHE_FORMAT}:iso:${target}`;
  const element = mcuNuclideToIaeaElement(nuclideName);
  if (element) return `${CACHE_FORMAT}:natural:${element.toUpperCase()}`;
  return null;
}

function readCacheEntry(key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    if (entry) cache.delete(key);
    return undefined;
  }
  return entry;
}

function writeCacheEntry(key: string, markdown: string | null, ttlMs: number): void {
  cache.set(key, { markdown, expires: Date.now() + ttlMs });
  schedulePersist();
}

void loadDiskCache();

async function fetchNuclideMarkdown(nuclideName: string, insert?: NaturalInsertContext): Promise<string | null> {
  const target = mcuNuclideToIaeaTarget(nuclideName);
  if (target) return fetchIsotopeMarkdown(target);
  const element = mcuNuclideToIaeaElement(nuclideName);
  if (!element) return null;
  return fetchNaturalCompositionMarkdown(element, insert);
}

async function fetchAndCacheNuclide(
  nuclideName: string,
  key: string,
  insert?: NaturalInsertContext
): Promise<string | null> {
  await loadDiskCache();
  const markdown = await fetchNuclideMarkdown(nuclideName, insert);
  writeCacheEntry(key, markdown, markdown ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS);
  return markdown;
}

/** Синхронно: кэш IAEA; для природных элементов — кнопка вставки при наличии индекса. */
function stripNaturalInsertButton(markdown: string): string {
  return markdown
    .replace(/\n\n\[\$\(replace\)[^\n]*\]\(command:[^\)]+\)[^\n]*/g, "")
    .replace(/\n\n\*\*\[⇄[^\n]*\]\(command:[^\)]+\)\*\*/g, "");
}

export function getCachedNuclideIaeaMarkdown(
  nuclideName: string,
  insert?: NaturalInsertContext
): string | null {
  const key = resolveCacheKey(nuclideName);
  if (!key) return null;
  const entry = readCacheEntry(key);
  const element = mcuNuclideToIaeaElement(nuclideName);

  if (element && insert) {
    const live = formatCachedNaturalMarkdown(element, insert);
    if (live) return live;
    if (entry?.markdown) {
      return stripNaturalInsertButton(entry.markdown) + formatNaturalInsertButton(insert);
    }
  }

  if (entry?.markdown) return entry.markdown;

  return null;
}

function hasCachedLookup(nuclideName: string): boolean {
  const key = resolveCacheKey(nuclideName);
  return key != null && readCacheEntry(key) !== undefined;
}

/** Фоновая подгрузка IAEA; повторные вызовы не дублируют запрос. */
export function prefetchNuclideIaeaHover(nuclideName: string, insert?: NaturalInsertContext): void {
  const key = resolveCacheKey(nuclideName);
  if (!key) return;

  const element = mcuNuclideToIaeaElement(nuclideName);
  if (element) prefetchNaturalAbundance(element);

  if (hasCachedLookup(nuclideName) && !insert) return;
  if (inFlight.has(key)) return;
  const job = fetchAndCacheNuclide(nuclideName, key, insert).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, job);
}

/** Дополнение hover-текста справочником IAEA NDS (ENDF + LiveChart). Ждёт сеть — только для тестов/CLI. */
export async function enrichNuclideHoverWithIaea(nuclideName: string): Promise<string | null> {
  const key = resolveCacheKey(nuclideName);
  if (!key) return null;

  const cached = readCacheEntry(key);
  if (cached) return cached.markdown;

  if (inFlight.has(key)) return inFlight.get(key)!;

  const job = fetchAndCacheNuclide(nuclideName, key).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, job);
  return job;
}
