/**
 * PNNL Materials Compendium → slim-каталог, поиск, черновик MATR, перевод имён.
 * Сырой JSON не мутируем; русские названия — отдельный словарь по ключу Name.
 */

import { awLibNameFromIaeaLabel, getAwLibEntry, getAwLibAtomicWeight, getAwLibTable, setAwLibTableFromCatalog } from "./awLib";
import { formatNuclearDensity, iaeaLabelToMcuNuclide } from "./naturalIsotopes";
import { computeMaterialMassDensityGcm3, mcuNuclideAtomicWeight, MCU_NUCLEAR_DENSITY_SCALE } from "./materialDensity";

/** Атомная единица массы, г (как в materialDensity). */
const ATOMIC_MASS_G = 1.660_539_066_60e-24;

const MATR_BLOCK_STOP = new Set([
  "MATR",
  "END",
  "FINISH",
  "DEF",
  "TEMPR",
  "PIN",
  "HEAD",
  "CONT",
  "RGS",
  "BURN",
  "SOURCE",
  "NPS",
  "GEO",
  "TRX",
]);

export interface SlimIsotope {
  isotope: string;
  zaid: string;
  weightFraction: number;
  atomFraction: number;
  isotopicAtomDensity: number;
}

export interface SlimElement {
  element: string;
  zaid: string;
  weightFraction: number;
  atomFraction: number;
  isotopes: SlimIsotope[];
}

export interface SlimMaterial {
  name: string;
  formula: string | null;
  acronym: string | null;
  density: number;
  materialAtomDensity: number;
  comment: string[];
  source: string;
  references: string[];
  elements: SlimElement[];
}

export interface SlimCatalog {
  siteVersion: string;
  sourceSha?: string;
  generatedAt?: string;
  materialCount: number;
  materials: SlimMaterial[];
}

export type DensMode = "denswa" | "isotope";

export interface DraftNuclide {
  name: string;
  value: number;
  impurity?: boolean;
  inAwLib?: boolean;
}

export interface MaterialDraft {
  sourceName?: string;
  number: number;
  temperature?: number | null;
  densityGcm3: number;
  mode: DensMode;
  /** Пользовательская заметка (строки через перевод). В банк — `comment[]`. */
  comment?: string;
  nuclides: DraftNuclide[];
  warnings: string[];
}

export interface MatrInsertHint {
  /** 0-based номер строки, перед которой вставлять. */
  line: number;
  nextNumber: number;
}

export interface TranslationDiff {
  missing: string[];
  orphan: string[];
}

/** Запись пользовательского банка (не PNNL slim). */
export interface UserMaterialRecord {
  name: string;
  density: number;
  mode: DensMode;
  temperature?: number | null;
  comment?: string[];
  formula?: string | null;
  nuclides: Array<{ name: string; value: number; impurity?: boolean }>;
  savedAt?: string;
}

export interface UserCatalogFile {
  version: number;
  materials: UserMaterialRecord[];
}

let translations = new Map<string, string>();

function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asString).filter((s) => s.length > 0);
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

function asFinite(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function acronymOf(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (Array.isArray(v)) {
    const parts = v.map(asString).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

function formatElementSymbol(sym: string): string {
  const t = sym.trim();
  if (!t) return t;
  return t[0].toUpperCase() + t.slice(1).toLowerCase();
}

/** IAEA-лейбл из PNNL (H1 / Ca40 / U-235) → H-1 / Ca-40 / U-235. */
export function pnnlNuclideToIaea(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const hyphen = t.match(/^([A-Za-z]{1,2})-(\d+)$/);
  if (hyphen) return `${formatElementSymbol(hyphen[1])}-${hyphen[2]}`;
  const glued = t.match(/^([A-Z][a-z]?)(\d+)$/) ?? t.match(/^([A-Za-z]{1,2})(\d+)$/);
  if (glued) return `${formatElementSymbol(glued[1])}-${glued[2]}`;
  return null;
}

/** PNNL-нуклид/элемент → имя MCU; inAwLib только при загруженной таблице. */
export function pnnlNuclideToMcu(raw: string): { mcuName: string; inAwLib?: boolean } {
  const t = raw.trim();
  if (!t) return { mcuName: "", inAwLib: false };

  const loaded = Boolean(getAwLibTable());
  const hit = (name: string): { mcuName: string; inAwLib?: boolean } => {
    const e = getAwLibEntry(name);
    if (e) return { mcuName: e.name, inAwLib: true };
    return { mcuName: name, inAwLib: loaded ? false : undefined };
  };

  if (/^[A-Za-z]{1,2}$/.test(t)) {
    return hit(t.toUpperCase());
  }

  const iaea = pnnlNuclideToIaea(t);
  if (iaea) {
    const fromLib = awLibNameFromIaeaLabel(iaea);
    if (fromLib) return { mcuName: fromLib, inAwLib: true };
    return hit(iaeaLabelToMcuNuclide(iaea));
  }

  return hit(t.replace(/-/g, "").toUpperCase());
}

export { setAwLibTableFromCatalog };

/** Имя из строки MATR как в файле. Не гоняем через PNNL (AG07 не станет AG7). */
export function matrLineNuclideToMcu(raw: string): { mcuName: string; inAwLib?: boolean } {
  const name = raw.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,5}$/.test(name)) return pnnlNuclideToMcu(raw);
  const loaded = Boolean(getAwLibTable());
  const e = getAwLibEntry(name);
  if (e) return { mcuName: e.name, inAwLib: true };
  return { mcuName: name, inAwLib: loaded ? false : undefined };
}

export function loadNameTranslations(map: Record<string, string> | Map<string, string>): void {
  translations = map instanceof Map ? new Map(map) : new Map(Object.entries(map));
}

export function clearNameTranslations(): void {
  translations = new Map();
}

/** Русское имя или оригинал, если перевода нет. */
export function displayName(originalName: string): string {
  return translations.get(originalName) ?? originalName;
}

export function hasTranslation(originalName: string): boolean {
  return translations.has(originalName);
}

export function diffNameTranslations(
  catalogNames: Iterable<string>,
  dict: Record<string, string> | Map<string, string> = translations
): TranslationDiff {
  const map = dict instanceof Map ? dict : new Map(Object.entries(dict));
  const names = new Set(catalogNames);
  const missing: string[] = [];
  for (const n of names) {
    if (!map.has(n)) missing.push(n);
  }
  missing.sort((a, b) => a.localeCompare(b));
  const orphan: string[] = [];
  for (const k of map.keys()) {
    if (!names.has(k)) orphan.push(k);
  }
  orphan.sort((a, b) => a.localeCompare(b));
  return { missing, orphan };
}

function slimIsotope(obj: unknown): SlimIsotope | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const isotope = asString(rec.Isotope);
  if (!isotope) return null;
  return {
    isotope,
    zaid: asString(rec.ZAID),
    weightFraction: asFinite(rec.WeightFraction),
    atomFraction: asFinite(rec.AtomFraction),
    isotopicAtomDensity: asFinite(rec.IsotopicAtomDensity),
  };
}

function slimElement(obj: unknown): SlimElement | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const element = asString(rec.Element);
  if (!element) return null;
  const isotopes = Array.isArray(rec.Isotopes)
    ? rec.Isotopes.map(slimIsotope).filter((x): x is SlimIsotope => x != null)
    : [];
  return {
    element,
    zaid: asString(rec.ZAID),
    weightFraction: asFinite(rec.WeightFraction),
    atomFraction: asFinite(rec.AtomFraction),
    isotopes,
  };
}

function slimDatum(obj: unknown): SlimMaterial | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const name = asString(rec.Name);
  if (!name) return null;
  const formulaRaw = rec.Formula;
  const formula =
    typeof formulaRaw === "string" && formulaRaw.trim() && formulaRaw !== "None" ? formulaRaw.trim() : null;
  const elements = Array.isArray(rec.Elements)
    ? rec.Elements.map(slimElement).filter((x): x is SlimElement => x != null)
    : [];
  return {
    name,
    formula,
    acronym: acronymOf(rec.Acronym),
    density: asFinite(rec.Density),
    materialAtomDensity: asFinite(rec.MaterialAtomDensity),
    comment: asStringList(rec.Comment),
    source: asString(rec.Source),
    references: asStringList(rec.References),
    elements,
  };
}

/** Зачистка сырого PNNL JSON: без Contact, *_whole, MatNum, Mols. Comment/References остаются. */
export function slimMaterialsCompendium(
  raw: unknown,
  meta?: { sourceSha?: string; generatedAt?: string }
): SlimCatalog {
  if (!raw || typeof raw !== "object") {
    throw new Error("Materials Compendium: ожидался объект JSON");
  }
  const rec = raw as Record<string, unknown>;
  const data = Array.isArray(rec.data) ? rec.data : Array.isArray(rec.materials) ? rec.materials : null;
  if (!data) {
    throw new Error("Materials Compendium: нет массива data/materials");
  }
  const materials = data.map(slimDatum).filter((x): x is SlimMaterial => x != null);
  return {
    siteVersion: asString(rec.siteVersion),
    sourceSha: meta?.sourceSha,
    generatedAt: meta?.generatedAt,
    materialCount: materials.length,
    materials,
  };
}

/** Уже slim или сырой PNNL — нормализуем к SlimCatalog. */
export function loadCatalogJson(raw: unknown, meta?: { sourceSha?: string; generatedAt?: string }): SlimCatalog {
  if (raw && typeof raw === "object" && Array.isArray((raw as { materials?: unknown }).materials)) {
    const rec = raw as SlimCatalog;
    return {
      siteVersion: rec.siteVersion ?? "",
      sourceSha: rec.sourceSha ?? meta?.sourceSha,
      generatedAt: rec.generatedAt ?? meta?.generatedAt,
      materialCount: rec.materials.length,
      materials: rec.materials,
    };
  }
  return slimMaterialsCompendium(raw, meta);
}

function haystack(mat: SlimMaterial): string {
  const parts = [
    mat.name,
    displayName(mat.name),
    mat.formula ?? "",
    mat.acronym ?? "",
    mat.source,
    ...mat.comment,
    ...mat.references,
  ];
  for (const el of mat.elements) {
    parts.push(el.element, el.zaid);
    for (const iso of el.isotopes) {
      parts.push(iso.isotope, iso.zaid);
    }
  }
  return parts.join("\n").toLowerCase();
}

/**
 * AND по токенам: имя (en+ru), формула, акроним, описания, элементы/изотопы.
 * «Fe Cr Ni» — материал, где встречаются все токены.
 */
export function searchCatalog(catalog: SlimCatalog, query: string): SlimMaterial[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return catalog.materials.slice();
  return catalog.materials.filter((mat) => {
    const hay = haystack(mat);
    return tokens.every((tok) => hay.includes(tok));
  });
}

export function catalogCompositionWarning(mat: SlimMaterial): string | undefined {
  const blob = [mat.name, ...mat.comment].join(" ");
  if (/LEU|Wt%\s*U234|isotopic/i.test(blob)) {
    return "В справочнике задан конкретный изотопный состав (часто LEU) — проверьте перед вставкой в топливную колоду.";
  }
  return undefined;
}

export function draftFromCatalog(mat: SlimMaterial, mode: DensMode, number = 1): MaterialDraft {
  const warnings: string[] = [];
  const leu = catalogCompositionWarning(mat);
  if (leu) warnings.push(leu);

  const nuclides: DraftNuclide[] = [];
  if (mode === "denswa") {
    for (const el of mat.elements) {
      if (!(el.weightFraction > 0)) continue;
      const mapped = pnnlNuclideToMcu(el.element);
      nuclides.push({
        name: mapped.mcuName,
        value: el.weightFraction,
        inAwLib: mapped.inAwLib,
      });
      if (!mapped.inAwLib && getAwLibEntry(mapped.mcuName) == null) {
        /* таблица может быть не загружена — не шумим, если AW.LIB пуст */
      }
    }
  } else {
    for (const el of mat.elements) {
      for (const iso of el.isotopes) {
        if (!(iso.isotopicAtomDensity > 0)) continue;
        const mapped = pnnlNuclideToMcu(iso.isotope);
        nuclides.push({
          name: mapped.mcuName,
          value: iso.isotopicAtomDensity,
          inAwLib: mapped.inAwLib,
        });
      }
    }
  }

  if (!nuclides.length) warnings.push("В справочнике нет ненулевого состава.");

  return {
    sourceName: mat.name,
    number,
    densityGcm3: mat.density,
    mode,
    nuclides,
    warnings,
  };
}

function sameUserName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function splitDraftComment(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinDraftComment(lines: string[] | undefined): string {
  return (lines ?? []).map((s) => s.trim()).filter(Boolean).join("\n");
}

function parseUserMaterial(raw: unknown): UserMaterialRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const name = asString(rec.name).trim();
  if (!name) return null;
  const mode: DensMode = rec.mode === "isotope" ? "isotope" : "denswa";
  const nuclides: UserMaterialRecord["nuclides"] = [];
  if (Array.isArray(rec.nuclides)) {
    for (const row of rec.nuclides) {
      if (!row || typeof row !== "object") continue;
      const n = row as Record<string, unknown>;
      const nm = asString(n.name).trim();
      const value = asFinite(n.value, NaN);
      if (!nm || !Number.isFinite(value) || value <= 0) continue;
      nuclides.push({
        name: nm,
        value,
        impurity: n.impurity === true ? true : undefined,
      });
    }
  }
  if (!nuclides.length) return null;
  const t = rec.temperature;
  const temperature =
    t == null || t === ""
      ? null
      : Number.isFinite(asFinite(t, NaN))
        ? asFinite(t)
        : null;
  return {
    name,
    density: asFinite(rec.density, 0),
    mode,
    temperature,
    comment: asStringList(rec.comment),
    formula: asString(rec.formula).trim() || null,
    nuclides,
    savedAt: asString(rec.savedAt) || undefined,
  };
}

export function parseUserCatalog(raw: unknown): UserCatalogFile {
  if (!raw || typeof raw !== "object") return { version: 1, materials: [] };
  const rec = raw as Record<string, unknown>;
  const list = Array.isArray(rec.materials) ? rec.materials : [];
  const materials: UserMaterialRecord[] = [];
  for (const item of list) {
    const m = parseUserMaterial(item);
    if (m) materials.push(m);
  }
  return { version: 1, materials };
}

export function draftToUserMaterial(draft: MaterialDraft, name: string): UserMaterialRecord {
  const n = name.trim();
  if (!n) throw new Error("Укажите имя материала.");
  const nuclides = draft.nuclides
    .filter((row) => row.name && Number.isFinite(row.value) && row.value > 0)
    .map((row) => ({
      name: row.name,
      value: row.value,
      impurity: row.impurity ? true : undefined,
    }));
  if (!nuclides.length) throw new Error("Нет нуклидов с положительной концентрацией.");
  const comment = splitDraftComment(draft.comment);
  if (draft.sourceName && !sameUserName(draft.sourceName, n)) {
    const from = `из ${draft.sourceName}`;
    if (!comment.some((c) => c.toLowerCase() === from.toLowerCase())) comment.push(from);
  }
  return {
    name: n,
    density: draft.densityGcm3,
    mode: draft.mode,
    temperature: draft.temperature ?? null,
    comment,
    nuclides,
    savedAt: new Date().toISOString(),
  };
}

export function draftFromUserMaterial(mat: UserMaterialRecord, number = 1): MaterialDraft {
  return {
    sourceName: mat.name,
    number,
    temperature: mat.temperature ?? null,
    densityGcm3: mat.density,
    mode: mat.mode,
    comment: joinDraftComment(mat.comment),
    nuclides: mat.nuclides.map((row) => {
      const mapped = pnnlNuclideToMcu(row.name);
      return {
        name: mapped.mcuName || row.name,
        value: row.value,
        impurity: row.impurity,
        inAwLib: mapped.inAwLib,
      };
    }),
    warnings: [],
  };
}

export function upsertUserMaterial(file: UserCatalogFile, mat: UserMaterialRecord): UserCatalogFile {
  const name = mat.name.trim();
  const materials = file.materials.filter((m) => !sameUserName(m.name, name));
  materials.push({ ...mat, name });
  return { version: 1, materials };
}

export function findUserMaterial(file: UserCatalogFile, name: string): UserMaterialRecord | undefined {
  return file.materials.find((m) => sameUserName(m.name, name));
}

function formatUserJsonNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return formatMatrValue(n);
}

function formatUserNuclideLine(row: UserMaterialRecord["nuclides"][number]): string {
  const bits = [`"name": ${JSON.stringify(row.name)}`, `"value": ${formatUserJsonNumber(row.value)}`];
  if (row.impurity) bits.push(`"impurity": true`);
  return `{ ${bits.join(", ")} }`;
}

/** Читаемый JSON банка: отступы, нуклид в одну строку, пустые поля не пишем. */
export function formatUserCatalogJson(file: UserCatalogFile): string {
  const mats = file.materials;
  const lines: string[] = ["{", `  "version": 1,`];
  if (!mats.length) {
    lines.push(`  "materials": []`);
  } else {
    lines.push(`  "materials": [`);
    mats.forEach((mat, i) => {
      const comma = i < mats.length - 1 ? "," : "";
      const body: string[] = [`    {`, `      "name": ${JSON.stringify(mat.name)},`];
      body.push(`      "density": ${formatUserJsonNumber(mat.density)},`);
      body.push(`      "mode": ${JSON.stringify(mat.mode)}`);
      if (mat.temperature != null && Number.isFinite(mat.temperature)) {
        body[body.length - 1] += ",";
        body.push(`      "temperature": ${formatUserJsonNumber(mat.temperature)}`);
      }
      const comments = (mat.comment ?? []).map((c) => c.trim()).filter(Boolean);
      if (comments.length === 1) {
        body[body.length - 1] += ",";
        body.push(`      "comment": ${JSON.stringify(comments[0])}`);
      } else if (comments.length > 1) {
        body[body.length - 1] += ",";
        body.push(`      "comment": [`);
        comments.forEach((c, k) => {
          const cc = k < comments.length - 1 ? "," : "";
          body.push(`        ${JSON.stringify(c)}${cc}`);
        });
        body.push(`      ]`);
      }
      if (mat.formula) {
        body[body.length - 1] += ",";
        body.push(`      "formula": ${JSON.stringify(mat.formula)}`);
      }
      body[body.length - 1] += ",";
      if (!mat.nuclides.length) {
        body.push(`      "nuclides": []`);
      } else {
        body.push(`      "nuclides": [`);
        mat.nuclides.forEach((row, j) => {
          const nc = j < mat.nuclides.length - 1 ? "," : "";
          body.push(`        ${formatUserNuclideLine(row)}${nc}`);
        });
        body.push(`      ]`);
      }
      body.push(`    }${comma}`);
      lines.push(...body);
    });
    lines.push(`  ]`);
  }
  lines.push("}", "");
  return lines.join("\n");
}

export function emptyDraft(number = 1): MaterialDraft {
  return {
    number,
    densityGcm3: 1,
    mode: "denswa",
    comment: "",
    nuclides: [],
    warnings: [],
  };
}

/**
 * Примесь в весовых %: доля примеси = p/100, остальные перенормируются к (1 − p/100).
 * В режиме isotope dens примесь добавляется ядерной концентрацией из ρ и A.
 */
export function addImpurity(draft: MaterialDraft, nuclideName: string, weightPercent: number): MaterialDraft {
  const mapped = pnnlNuclideToMcu(nuclideName);
  const name = mapped.mcuName;
  if (!name) return draft;
  if (!Number.isFinite(weightPercent) || weightPercent <= 0) return draft;

  const frac = weightPercent / 100;
  if (frac >= 1) {
    return {
      ...draft,
      nuclides: [{ name, value: draft.mode === "denswa" ? 1 : draft.nuclides[0]?.value ?? 0, impurity: true, inAwLib: mapped.inAwLib }],
      warnings: [...draft.warnings, "Примесь ≥100% — состав заменён на один нуклид."],
    };
  }

  const scale = 1 - frac;
  const warnings = draft.warnings.slice();

  if (draft.mode === "denswa") {
    const others = draft.nuclides
      .filter((n) => n.name.toUpperCase() !== name)
      .map((n) => ({ ...n, value: n.value * scale }));
    return {
      ...draft,
      nuclides: [...others, { name, value: frac, impurity: true, inAwLib: mapped.inAwLib }],
      warnings,
    };
  }

  const weight = mcuNuclideAtomicWeight(name) ?? getAwLibAtomicWeight(name);
  if (weight == null || !(draft.densityGcm3 > 0)) {
    warnings.push(`Не удалось пересчитать dens для примеси ${name} — добавлена строка с нулём, поправьте вручную.`);
    return {
      ...draft,
      nuclides: [...draft.nuclides, { name, value: 0, impurity: true, inAwLib: mapped.inAwLib }],
      warnings,
    };
  }
  const dens = (frac * draft.densityGcm3) / (weight * MCU_NUCLEAR_DENSITY_SCALE * ATOMIC_MASS_G);
  const others = draft.nuclides.map((n) => ({ ...n, value: n.value * scale }));
  return {
    ...draft,
    nuclides: [...others, { name, value: dens, impurity: true, inAwLib: mapped.inAwLib }],
    warnings,
  };
}

export function formatMatrValue(n: number): string {
  return formatNuclearDensity(n);
}

export function buildMatrCard(draft: MaterialDraft): { text: string; warnings: string[] } {
  const warnings = draft.warnings.slice();
  const lines: string[] = [];
  const title = draft.sourceName ? displayName(draft.sourceName) : "";
  if (title) lines.push(`** ${title}`);
  for (const note of splitDraftComment(draft.comment)) {
    if (title && note === title) continue;
    lines.push(`** ${note}`);
  }

  const num = Number.isFinite(draft.number) && draft.number > 0 ? Math.floor(draft.number) : 1;
  const header: string[] = [`MATR ${num}`, "NAME=MCU"];
  if (draft.temperature != null && Number.isFinite(draft.temperature)) {
    header.push(`T=${formatMatrValue(draft.temperature)}`);
  }
  if (draft.mode === "denswa") {
    if (!(draft.densityGcm3 > 0)) warnings.push("DENSWA: задайте плотность ρ > 0.");
    header.push(`DENSWA=${formatMatrValue(draft.densityGcm3)}`);
  }
  lines.push(header.join(" "));

  const rows = draft.nuclides.filter((n) => n.name && Number.isFinite(n.value) && n.value > 0);
  if (!rows.length) warnings.push("Нет нуклидов с положительной концентрацией.");
  for (const n of rows) {
    const mark = n.impurity ? "  ; примесь" : "";
    lines.push(`${n.name} ${formatMatrValue(n.value)}${mark}`);
  }
  return { text: lines.join("\n") + "\n", warnings };
}

function lineLabel(line: string): string {
  const t = line.trim();
  if (!t || t.startsWith("**") || t.startsWith(";")) return "";
  return t.split(/\s+/)[0]?.toUpperCase() ?? "";
}

/**
 * Вставка нового MATR: после последнего блока MATR в PIN (видимый текст файла).
 * Номер = номер последнего MATR + 1. Не смотрим курсор / expanded #include.
 */
export function findMatrInsert(text: string): MatrInsertHint {
  const lines = text.split(/\r?\n/);
  let pin = -1;
  let finish = -1;
  for (let i = 0; i < lines.length; i++) {
    const lab = lineLabel(lines[i] ?? "");
    if (lab === "PIN" && pin < 0) pin = i;
    if (pin >= 0 && lab === "FINISH") {
      finish = i;
      break;
    }
  }
  const from = pin >= 0 ? pin : 0;
  const to = finish >= 0 ? finish : lines.length;
  const matrIdx: number[] = [];
  let lastNum = 0;
  for (let i = from; i < to; i++) {
    const m = (lines[i] ?? "").trim().match(/^MATR\s+(\d+)/i);
    if (m) {
      matrIdx.push(i);
      const n = parseInt(m[1]!, 10);
      if (Number.isFinite(n)) lastNum = n;
    }
  }
  const nextNumber = lastNum > 0 ? lastNum + 1 : 1;
  if (!matrIdx.length) {
    return { line: finish >= 0 ? finish : pin >= 0 ? pin + 1 : lines.length, nextNumber };
  }
  const last = matrIdx[matrIdx.length - 1]!;
  let end = last + 1;
  while (end < to) {
    const raw = (lines[end] ?? "").trim();
    if (!raw || raw.startsWith("**") || raw.startsWith(";")) {
      end++;
      continue;
    }
    const lab = lineLabel(raw);
    if (MATR_BLOCK_STOP.has(lab)) break;
    end++;
  }
  return { line: end, nextNumber };
}

export interface VisibleMatrHint {
  headerLine: number;
  endLine: number;
  number: number;
}

function pinWindow(lines: string[]): { from: number; to: number } {
  let pin = -1;
  let finish = -1;
  for (let i = 0; i < lines.length; i++) {
    const lab = lineLabel(lines[i] ?? "");
    if (lab === "PIN" && pin < 0) pin = i;
    if (pin >= 0 && lab === "FINISH") {
      finish = i;
      break;
    }
  }
  return { from: pin >= 0 ? pin : 0, to: finish >= 0 ? finish : lines.length };
}

/** MATR в видимом тексте, в чьей секции строка (0-based). Без expanded #include. */
export function findVisibleMatrAtLine(text: string, line: number): VisibleMatrHint | null {
  const lines = text.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return null;
  const { from, to } = pinWindow(lines);
  const headers: number[] = [];
  for (let i = from; i < to; i++) {
    if (/^MATR\s+\d+/i.test((lines[i] ?? "").trim())) headers.push(i);
  }
  if (!headers.length) return null;

  let header = -1;
  for (const h of headers) {
    if (h <= line) header = h;
  }
  if (header < 0) {
    const next = headers.find((h) => h > line);
    if (next != null) {
      const onlyComments = lines.slice(line, next).every((raw) => {
        const t = raw.trim();
        return !t || t.startsWith("**") || t.startsWith(";");
      });
      if (onlyComments) header = next;
    }
  }
  if (header < 0) return null;
  const end = findMatrBlockEndLine(text, header);
  if (line > end) return null;
  const num = parseInt((lines[header] ?? "").trim().match(/^MATR\s+(\d+)/i)?.[1] ?? "", 10);
  if (!Number.isFinite(num)) return null;
  return { headerLine: header, endLine: end, number: num };
}

const NUCLIDE_LINE =
  /^\/?([A-Za-z][A-Za-z0-9]{0,5})\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?)/;

const DENS_HEADER_RE = /(DENSAA|DENSWA|DENSAW|DENSWW)\s*=\s*([\d.Ee+-]+)/i;

function parseDensHeader(header: string): { param?: string; value?: number } {
  const densM = header.match(DENS_HEADER_RE);
  if (!densM) return {};
  const value = parseFloat(densM[2]!);
  return {
    param: densM[1]!.toUpperCase(),
    value: Number.isFinite(value) ? value : undefined,
  };
}

/**
 * Заголовок из `** …` над MATR: не берём разделители (`-----`, `====`).
 */
export function matrCommentTitle(raw: string): string | undefined {
  const t = raw.replace(/^\*\*\s*/, "").trim();
  if (!t || t.length < 2) return undefined;
  if (/^[-_=.*~]+$/.test(t)) return undefined;
  return t;
}

/**
 * В режиме ядерных dens ρ считается по составу (AW.LIB), как CodeLens/ховер.
 * DENSWA — ρ задаёт пользователь, не трогаем.
 */
export function syncDraftMassDensity(draft: MaterialDraft): MaterialDraft {
  if (draft.mode !== "isotope") return draft;
  draft.densityGcm3 = massDensityFromVisibleMatr(undefined, undefined, draft.nuclides);
  return draft;
}

/** ρ, г/см³: DENSWA/DENSWW как написано, иначе как в ховере — из ядерных dens. */
function massDensityFromVisibleMatr(
  densParam: string | undefined,
  densValue: number | undefined,
  nuclides: DraftNuclide[]
): number {
  const param = densParam?.toUpperCase();
  if ((param === "DENSWA" || param === "DENSWW") && densValue != null && densValue > 0) {
    return densValue;
  }
  const nuclearParam = param === "DENSAA" || param === "DENSAW" ? param : undefined;
  const rho = computeMaterialMassDensityGcm3({
    nuclides: nuclides.map((n) => ({ name: n.name, density: String(n.value) })),
    densParam: nuclearParam,
    densValue: nuclearParam != null ? densValue : undefined,
  } as Parameters<typeof computeMaterialMassDensityGcm3>[0]);
  if (rho == null || !Number.isFinite(rho) || !(rho > 0)) return 0;
  const rounded = Number(rho.toPrecision(6));
  return Number.isFinite(rounded) ? rounded : rho;
}

/** Черновик из MATR под курсором (видимый файл). */
export function draftFromVisibleMatr(text: string, line: number): MaterialDraft | null {
  const hit = findVisibleMatrAtLine(text, line);
  if (!hit) return null;
  const lines = text.split(/\r?\n/);
  let sourceName: string | undefined;
  for (let i = hit.headerLine - 1; i >= 0; i--) {
    const t = (lines[i] ?? "").trim();
    if (!t) continue;
    if (t.startsWith("**")) sourceName = matrCommentTitle(t);
    break;
  }

  let headerText = lines[hit.headerLine] ?? "";
  const nuclides: DraftNuclide[] = [];
  for (let i = hit.headerLine + 1; i <= hit.endLine; i++) {
    const t = (lines[i] ?? "").trim();
    if (!t || t.startsWith("**") || t.startsWith(";")) continue;
    const lab = lineLabel(t);
    if (MATR_BLOCK_STOP.has(lab)) break;
    if (DENS_HEADER_RE.test(t) && !NUCLIDE_LINE.test(t)) {
      headerText += " " + t;
      continue;
    }
    const m = t.match(NUCLIDE_LINE);
    if (!m) continue;
    const mapped = matrLineNuclideToMcu(m[1]!);
    const value = parseFloat(m[2]!);
    if (!mapped.mcuName || !Number.isFinite(value) || value <= 0) continue;
    nuclides.push({
      name: mapped.mcuName,
      value,
      impurity: /примес/i.test(t) ? true : undefined,
      inAwLib: mapped.inAwLib,
    });
  }
  if (!nuclides.length) return null;

  const tempM = headerText.match(/T\s*=\s*([\d.Ee+-]+)/i);
  const dens = parseDensHeader(headerText);
  const mode: DensMode = dens.param === "DENSWA" || dens.param === "DENSAW" ? "denswa" : "isotope";

  return {
    sourceName,
    number: hit.number,
    temperature: tempM && Number.isFinite(parseFloat(tempM[1]!)) ? parseFloat(tempM[1]!) : null,
    densityGcm3: massDensityFromVisibleMatr(dens.param, dens.value, nuclides),
    mode,
    nuclides,
    warnings: [],
  };
}

/** Конец блока MATR (включительно), 0-based. */
export function findMatrBlockEndLine(text: string, headerLine: number): number {
  const lines = text.split(/\r?\n/);
  let end = headerLine;
  for (let i = headerLine + 1; i < lines.length; i++) {
    const raw = (lines[i] ?? "").trim();
    if (!raw || raw.startsWith("**") || raw.startsWith(";")) {
      end = i;
      continue;
    }
    const lab = lineLabel(raw);
    if (MATR_BLOCK_STOP.has(lab)) break;
    end = i;
  }
  return end;
}
