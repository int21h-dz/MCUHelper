/** Дерево навигации для Webview sidebar (данные из LSP getIndex). */

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { isGeoBodyLabel } from "./catalogBridge";

type DbmCatalogApi = {
  listDbmCatalog: (libRoot: string) => Array<{
    library: string;
    fsPath: string;
    materials: Array<{
      library: string;
      code: string;
      nuclideCount: number;
      densType: 1 | 2;
      headerLine: number;
      fsPath: string;
      nuclidesPreview: string;
    }>;
  }>;
  buildMatrDbmInsertSnippet: (
    libraryName: string,
    materialCode: string,
    suggestedNumber?: number
  ) => string;
};

function loadDbmCatalogApi(): DbmCatalogApi | null {
  const candidates = [
    path.join(__dirname, "..", "vendor", "mcu-language", "dbmLib.js"),
    path.join(__dirname, "..", "..", "packages", "mcu-language", "dist", "dbmLib.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(p) as DbmCatalogApi;
    }
  }
  return null;
}

export interface SourceRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface NavTreeNode {
  id: string;
  label: string;
  description?: string;
  badges?: string[];
  /** Выделить элемент предупреждающим стилем. */
  warning?: boolean;
  /** Серый/приглушённый вид (суммарный изотоп и т.п.). */
  muted?: boolean;
  /** Подсказка при наведении (причина muted и др.). */
  tooltip?: string;
  uri?: string;
  range?: SourceRange;
  children?: NavTreeNode[];
  /** CSV всей группы для кнопки «копировать» (диагностика сверки изотопов). */
  copyCsv?: string;
  /** Кнопка действия на листе (например «В SI»). */
  action?: {
    id: string;
    label: string;
    title?: string;
    command: string;
    args?: unknown;
  };
  /** Текст для drag-and-drop / клика (как в каталоге карт). */
  insertText?: string;
  insertFormat?: "snippet" | "plain";
}

export interface IndexPayload {
  fragments?: Array<{
    id:
      | "physical"
      | "geometry"
      | "source"
      | "registration"
      | "burnupRegistration"
      | "trajectory"
      | "calculationControl"
      | "burnup";
    startLine: number;
    endLine: number;
  }>;
  statements?: Array<{
    label: string;
    text: string;
    fragment:
      | "physical"
      | "geometry"
      | "source"
      | "registration"
      | "burnupRegistration"
      | "trajectory"
      | "calculationControl"
      | "burnup";
    range: SourceRange;
  }>;
  /** Директивы `#include` для панели «Навигация» (клик → строка в main). */
  includes?: Array<{
    path: string;
    uri?: string;
    exists?: boolean;
    fragment:
      | "physical"
      | "geometry"
      | "source"
      | "registration"
      | "burnupRegistration"
      | "trajectory"
      | "calculationControl"
      | "burnup";
    range: SourceRange;
  }>;
  /** Граф main → `#include` (клик открывает файл include). */
  includeGraph?: Array<{
    path: string;
    uri?: string;
    fsPath?: string;
    exists: boolean;
    encoding?: string;
    diagCount?: number;
    mainLine: number;
    nestedInclude?: boolean;
  }>;
  summaries: {
    materials: Array<{
      number: number;
      group?: string;
      temperature?: number;
      nameLib?: string;
      libMaterialName?: string;
      libMaterialRange?: SourceRange;
      dbm?: {
        library: string;
        material: string;
        uri?: string;
        fsPath?: string;
        exists: boolean;
        range: SourceRange;
      };
      nuclideCount: number;
      usedNuclideCount?: number;
      sumIsotopeCount?: number;
      sumIsotopeUsedCount?: number;
      sumIsotopeMissingAwLibCount?: number;
      nuclidesPreview: string;
      massDensityGcm3: number | null;
      volumeCm3: number | null;
      massG: number | null;
      activityBqPerG?: number | null;
      nuclides: Array<{
        name: string;
        concentration: string;
        range: SourceRange;
        uri?: string;
        sumIsotope?: { reasons: string[]; inAwLib?: boolean };
      }>;
      range: SourceRange;
      uri?: string;
      /** CPM…CPMEND: размноженные номера и range карты CPM (клик в sidebar). */
      cpm?: {
        repetitions: number;
        expandedNumbers: number[];
        range: SourceRange;
        uri?: string;
      };
    }>;
    zones: Array<{
      name: string;
      expression: string;
      materialNum?: number;
      regNum?: number;
      objNum?: number;
      regPointerIndex?: number;
      objPointerIndex?: number;
      matPointerIndex?: number;
      hasConditionalPointers?: boolean;
      range: SourceRange;
      uri?: string;
    }>;
    objects: Array<{
      objectNum: number;
      zoneNames: string[];
      materialNums: number[];
    }>;
    constants: Array<{
      name: string;
      expression: string;
      value: number | null;
      mutable: boolean;
      scope?: string;
      range: SourceRange;
      /** Файл определения, если константа из `#include` (иначе URI текущего документа). */
      uri?: string;
    }>;
    bodies: Array<{
      name: string;
      bodyType: string;
      paramsPreview: string;
      volumeCm3?: number | null;
      scope?: string;
      transf?: boolean;
      protoName?: string;
      range: SourceRange;
      uri?: string;
    }>;
    nets: Array<{
      name: string;
      root: string;
      cols: number;
      rows: number;
      layers?: number;
      typeMapRowCount: number;
      cartogram: Array<{ row: number; label: string; prototypes: string[] }>;
      regCartogram?: Array<{
        pointerIndex: number;
        label: string;
        rowIndex?: number;
        layer?: number;
        all?: boolean;
        valuesPreview: string;
      }>;
      objCartogram?: Array<{
        pointerIndex: number;
        label: string;
        rowIndex?: number;
        layer?: number;
        all?: boolean;
        valuesPreview: string;
      }>;
      matCartogram?: Array<{
        pointerIndex: number;
        label: string;
        rowIndex?: number;
        layer?: number;
        all?: boolean;
        valuesPreview: string;
      }>;
      carrierZones: Array<{ name: string; range: SourceRange; uri?: string }>;
      prototypes: Array<{ name: string; range?: SourceRange; uri?: string }>;
      range: SourceRange;
      uri?: string;
    }>;
    lattices: Array<{
      latticeType: string;
      zoneNames: string[];
      elements: Array<{ name: string; range?: SourceRange; uri?: string }>;
      positionsPreview: string;
      range: SourceRange;
      uri?: string;
    }>;
  };
  /** Компактные метки суммарного изотопа для серых decorations (всегда, даже при slim). */
  sumIsotopeMarks?: Array<{
    name: string;
    range: Pick<SourceRange, "start" | "end">;
    uri?: string;
    /** @deprecated не шлём в getIndex — причины в summaries / hover */
    concentration?: string;
    reasons?: string[];
    inAwLib?: boolean;
  }>;
  stableIsotopeMarks?: Array<{
    name: string;
    range: Pick<SourceRange, "start" | "end">;
    uri?: string;
    concentration?: string;
  }>;
  hash?: string;
  editorContext?: {
    line: number;
    character: number;
    scope: string;
  };
}

export type NavViewId =
  | "fragments"
  | "materials"
  | "constants"
  | "bodies"
  | "nets"
  | "lattices"
  | "zones"
  | "objects";

const FRAGMENT_META = {
  physical: { label: "PIN", title: "Физический модуль" },
  geometry: { label: "HEAD", title: "Геометрия" },
  source: { label: "SRC", title: "Источник" },
  registration: { label: "REG", title: "Регистрация" },
  burnupRegistration: { label: "BRG", title: "Регистрация выгорания" },
  trajectory: { label: "TRJ", title: "Траектории" },
  calculationControl: { label: "CAL", title: "Управление расчётом" },
  burnup: { label: "BURN", title: "Выгорание" },
} as const;

const MATR_BLOCK_STOP_LABELS = new Set(["MATR", "END", "FINISH", "DEF", "TEMPR", "PIN", "CPM", "CPMEND"]);

/** Диапазон/список номеров CPM для label в sidebar (зеркало mcu-language/cpmBlocks). */
export function formatCpmNumberRange(numbers: readonly number[]): string {
  if (numbers.length === 0) return "";
  if (numbers.length === 1) return String(numbers[0]);
  const sorted = [...numbers].sort((a, b) => a - b);
  let contiguous = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! !== sorted[i - 1]! + 1) {
      contiguous = false;
      break;
    }
  }
  if (contiguous) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  const step = sorted[1]! - sorted[0]!;
  let arithmetic = step > 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - sorted[i - 1]! !== step) {
      arithmetic = false;
      break;
    }
  }
  if (arithmetic && sorted.length > 3) {
    return `${sorted[0]},${sorted[1]},…,${sorted[sorted.length - 1]}`;
  }
  return sorted.join(",");
}

function formatBodyScope(scope?: string): string {
  if (!scope || scope === "global") return "Общие";
  if (scope.startsWith("lcell:")) return `LCELL ${scope.slice(6)}`;
  if (scope.startsWith("cell:")) return `CELL ${scope.slice(5)}`;
  return scope;
}

function formatBodyVolume(vol: number | null | undefined): string {
  if (vol == null || !Number.isFinite(vol) || vol <= 0) return "";
  if (vol >= 0.01 && vol < 1e9) return `V≈${vol.toPrecision(4)} см³`;
  return `V≈${vol.toExponential(3)} см³`;
}

function formatMaterialDensity(rho: number | null): string {
  if (rho == null || !Number.isFinite(rho) || rho <= 0) return "";
  if (rho >= 0.01 && rho < 10_000) return `ρ≈${rho.toPrecision(4)} г/см³`;
  return `ρ≈${rho.toExponential(3)} г/см³`;
}

function formatMaterialMass(massG: number | null | undefined): string {
  if (massG == null || massG <= 0) return "";
  if (massG >= 1000) return `m≈${(massG / 1000).toPrecision(3)} кг`;
  return `m≈${massG.toPrecision(3)} г`;
}

/** Счётчики состава для CodeLens / sidebar: всего, в SI, нет в AW. */
export function formatMaterialNuclideCounts(m: {
  nuclideCount: number;
  sumIsotopeCount?: number;
  sumIsotopeUsedCount?: number;
  sumIsotopeMissingAwLibCount?: number;
}): string[] {
  const parts = [m.nuclideCount === 1 ? "1 нукл." : `${m.nuclideCount} нукл.`];
  const siFromSplit = (m.sumIsotopeUsedCount ?? 0) + (m.sumIsotopeMissingAwLibCount ?? 0);
  const siTotal = (m.sumIsotopeCount ?? 0) > 0 ? m.sumIsotopeCount! : siFromSplit;
  if (siTotal > 0) parts.push(`в SI: ${siTotal}`);
  const missingAw = m.sumIsotopeMissingAwLibCount ?? 0;
  if (missingAw > 0) parts.push(`нет в AW: ${missingAw}`);
  return parts;
}

function normalizeNavFileUri(uri: string): string {
  try {
    return decodeURIComponent(uri).replace(/\\/g, "/").toLowerCase();
  } catch {
    return uri.replace(/\\/g, "/").toLowerCase();
  }
}

export function sameNavFileUri(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return normalizeNavFileUri(a) === normalizeNavFileUri(b);
}

/**
 * Клик в сайдбаре: символ в текущем файле → его строка;
 * спрятан в `#include` → директива include в варианте (не начало файла и не expanded-строка).
 */
export function sidebarClickTarget(
  index: IndexPayload,
  mainUri: string,
  itemUri: string | undefined,
  itemRange: SourceRange | undefined
): { uri: string; range?: SourceRange } {
  if (itemUri && !sameNavFileUri(itemUri, mainUri)) {
    const inc = (index.includes ?? []).find((i) => i.uri && sameNavFileUri(i.uri, itemUri));
    if (inc?.range) return { uri: mainUri, range: inc.range };
    const g = (index.includeGraph ?? []).find((n) => n.uri && sameNavFileUri(n.uri, itemUri));
    if (g) {
      return {
        uri: mainUri,
        range: {
          start: { line: g.mainLine, character: 0 },
          end: { line: g.mainLine, character: 0 },
        },
      };
    }
  }
  return { uri: itemUri ?? mainUri, range: itemRange };
}

function formatActivitySidebar(bqPerG: number): string {
  const abs = Math.abs(bqPerG);
  if (abs >= 1e6) return `${(bqPerG / 1e6).toPrecision(3)} МБк/г`;
  if (abs >= 1e3) return `${(bqPerG / 1e3).toPrecision(3)} кБк/г`;
  return `${bqPerG.toPrecision(3)} Бк/г`;
}

function formatBodyDescription(b: IndexPayload["summaries"]["bodies"][number]): string {
  const vol = formatBodyVolume(b.volumeCm3);
  let s = b.bodyType;
  if (vol) s += ` · ${vol}`;
  if (b.transf) s += " · TR";
  if (b.protoName) s += ` · ← ${b.protoName}`;
  return s;
}

function scopeSortKey(scope: string): number {
  if (scope === "global") return 0;
  if (scope.startsWith("lcell:")) return 1;
  if (scope.startsWith("cell:")) return 2;
  return 3;
}

function formatConstValue(value: number | null): string {
  if (value === null) return "ошибка";
  if (Math.abs(value) >= 1e6 || (Math.abs(value) > 0 && Math.abs(value) < 1e-4)) {
    return value.toExponential(4);
  }
  const s = value.toPrecision(8).replace(/\.?0+$/, "");
  return s;
}

function formatNetGrid(net: IndexPayload["summaries"]["nets"][number]): string {
  const dims = net.layers ? `${net.cols}×${net.rows}×${net.layers}` : `${net.cols}×${net.rows}`;
  return `${dims} · root ${net.root}`;
}

function trimPreview(text: string, maxLen = 72): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

function isDataRowLabel(label: string): boolean {
  return (
    /^T\d+/i.test(label) ||
    /^P\d+/i.test(label) ||
    /^O\d+/i.test(label) ||
    /^M\d+/i.test(label) ||
    /^E-?\d+/i.test(label) ||
    /^I-?\d+/i.test(label) ||
    /^F-?\d+/i.test(label)
  );
}

const GEO_BODY_LABELS_FALLBACK = new Set([
  "SPH", "RCC", "ELL", "BOX", "WED", "RPP", "HEX", "HEXX", "HEXY", "RCZ",
  "UCX", "UCY", "UCZ", "PLG", "PLX", "PLY", "PLZ", "SLA", "SLB", "REC",
  "TRC", "ARB", "SBOX", "SHEX", "HEXG", "QUAD", "TRANSF", "UPOLY",
]);

function isBodyLabel(label: string): boolean {
  const upper = label.toUpperCase();
  if (GEO_BODY_LABELS_FALLBACK.has(upper)) return true;
  try {
    return isGeoBodyLabel(label);
  } catch {
    return false;
  }
}

/** Зона по совпадению имени и строки — не путаем с картой-омонимом (NET/MATR/…). */
function isZoneStatement(
  stmt: NonNullable<IndexPayload["statements"]>[number],
  index: IndexPayload
): boolean {
  const label = stmt.label.toUpperCase();
  const line = stmt.range.start.line;
  return (index.summaries?.zones ?? []).some(
    (z) => z.name.toUpperCase() === label && z.range.start.line === line
  );
}

function isFragmentChildStatement(
  stmt: NonNullable<IndexPayload["statements"]>[number],
  inMatrBlock: boolean,
  index: IndexPayload
): boolean {
  const label = stmt.label.toUpperCase();
  if (!label) return false;
  if (label === "FINISH") return false;
  if (label === "CONT") return false;
  if (label === "EQU" || label === "SET") return false;
  if (isBodyLabel(label)) return false;
  if (isZoneStatement(stmt, index)) return false;
  if (!/^[A-Za-z]/.test(label)) return false;
  if (inMatrBlock && !MATR_BLOCK_STOP_LABELS.has(label)) return false;
  if (isDataRowLabel(label)) return false;
  return true;
}

function basenameIncludePath(incPath: string): string {
  const norm = incPath.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

/** Секция графа `#include` вверху «Навигации» — клик открывает файл include. */
export function buildIncludeGraphSection(index: IndexPayload, mainUri: string): NavTreeNode | null {
  const graph = index.includeGraph ?? [];
  if (graph.length === 0) return null;

  return {
    id: "include-graph",
    label: "#include",
    description: `${graph.length} файл(ов)`,
    children: graph.map((n, i) => {
      const name = basenameIncludePath(n.path);
      const parts: string[] = [];
      if (!n.exists) parts.push("не найден");
      if (n.nestedInclude) parts.push("вложенный #include");
      if (n.encoding) parts.push(n.encoding);
      if (n.diagCount != null && n.diagCount > 0) parts.push(`${n.diagCount} диаг.`);
      parts.push(`← стр. ${n.mainLine + 1}`);

      const badges: string[] = [];
      if (!n.exists) badges.push("missing");
      if (n.nestedInclude) badges.push("nested");
      if (n.diagCount != null && n.diagCount > 0) badges.push(String(n.diagCount));

      const openInclude = Boolean(n.exists && n.uri);
      return {
        id: `incgraph-${i}`,
        label: name,
        description: parts.join(" · "),
        badges: badges.length ? badges : undefined,
        muted: !n.exists || Boolean(n.nestedInclude),
        tooltip: n.fsPath || n.path,
        uri: openInclude ? n.uri : mainUri,
        range: openInclude
          ? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
          : {
              start: { line: n.mainLine, character: 0 },
              end: { line: n.mainLine, character: 0 },
            },
      };
    }),
  };
}

export function buildFragmentsTree(index: IndexPayload, uri: string): NavTreeNode[] {
  const fragments = (index.fragments ?? []).map((fragment, i) => {
    const meta = FRAGMENT_META[fragment.id];
    const startLine = fragment.startLine + 1;
    const endLine = fragment.endLine + 1;
    let inMatrBlock = false;

    type FragChild = { sortLine: number; node: NavTreeNode };

    const children: FragChild[] = [];

    for (const [ii, inc] of (index.includes ?? []).entries()) {
      if (inc.fragment !== fragment.id) continue;
      const lineNum = inc.range.start.line + 1;
      const name = basenameIncludePath(inc.path);
      const missing = inc.exists === false;
      children.push({
        sortLine: inc.range.start.line,
        node: {
          id: `include-${fragment.id}-${i}-${ii}`,
          label: `#include ${name}`,
          description: missing ? `файл не найден · строка ${lineNum}` : `строка ${lineNum}`,
          badges: missing ? ["missing"] : undefined,
          muted: missing,
          tooltip: missing
            ? `Файл не найден: ${inc.path}`
            : inc.path !== name
              ? inc.path
              : undefined,
          uri,
          range: inc.range,
        },
      });
    }

    for (const [si, stmt] of (index.statements ?? []).entries()) {
      if (stmt.fragment !== fragment.id) continue;
      const label = stmt.label.toUpperCase();
      const keep = isFragmentChildStatement(stmt, inMatrBlock, index);
      if (label === "MATR") {
        inMatrBlock = true;
      } else if (MATR_BLOCK_STOP_LABELS.has(label)) {
        inMatrBlock = false;
      }
      if (!keep) continue;
      const text = stmt.text.trim();
      const rest = text.slice(stmt.label.length).trim();
      const lineNum = stmt.range.start.line + 1;
      const description = rest
        ? `${trimPreview(rest)} · строка ${lineNum}`
        : `строка ${lineNum}`;
      children.push({
        sortLine: stmt.range.start.line,
        node: {
          id: `fragstmt-${fragment.id}-${i}-${si}`,
          label: stmt.label,
          description,
          uri,
          range: stmt.range,
        },
      });
    }

    children.sort((a, b) => a.sortLine - b.sortLine);

    return {
      id: `frag-${fragment.id}-${i}`,
      label: meta?.label ?? fragment.id,
      description: `${meta?.title ?? fragment.id} · строки ${startLine}-${endLine}`,
      uri,
      range: {
        start: { line: fragment.startLine, character: 0 },
        end: { line: fragment.endLine, character: 0 },
      },
      children: children.map((c) => c.node),
    };
  });

  const includeSection = buildIncludeGraphSection(index, uri);
  return includeSection ? [includeSection, ...fragments] : fragments;
}

export function buildMaterialsTree(
  index: IndexPayload,
  uri: string,
  suggestSumIsotope?: ReadonlySet<string>,
  constantsLibPath?: string
): NavTreeNode[] {
  const libRoot = (constantsLibPath ?? "").trim();

  const buildMatNode = (m: IndexPayload["summaries"]["materials"][number]): NavTreeNode => {
    const rho = formatMaterialDensity(m.massDensityGcm3);
    const vol = formatBodyVolume(m.volumeCm3);
    const mass = formatMaterialMass(m.massG);
    const parts = formatMaterialNuclideCounts(m);
    if (m.cpm) parts.unshift(`CPM ×${m.cpm.repetitions}`);
    if (m.libMaterialName) parts.unshift(m.libMaterialName);
    if (m.dbm?.library) parts.push(`${m.dbm.library}.DBM`);
    else if (m.nameLib && m.libMaterialName) parts.push(`${m.nameLib}.DBM`);
    if (rho) parts.push(rho);
    if (m.volumeCm3 != null && vol) parts.push(vol);
    if (mass) parts.push(mass);
    if (m.activityBqPerG != null && m.activityBqPerG > 0) {
      parts.push(`A≈${formatActivitySidebar(m.activityBqPerG)}`);
    }
    const badges: string[] = [];
    if (rho) badges.push(rho.replace("ρ≈", "ρ "));
    if (m.libMaterialName) badges.push("DBM");
    const titleParts: string[] = [];
    if (m.group) titleParts.push(`[${m.group}]`);
    if (m.cpm?.expandedNumbers?.length) {
      titleParts.push(formatCpmNumberRange(m.cpm.expandedNumbers));
    }
    if (m.libMaterialName) {
      if (!m.cpm?.expandedNumbers?.length) titleParts.push(String(m.number));
      titleParts.push(m.libMaterialName);
    }
    if (m.temperature != null) titleParts.push(`T=${m.temperature}`);
    // CPM: клик по карточке материала → карта CPM; иначе → MATR.
    const clickTargetUri = m.cpm?.uri ?? m.uri;
    const clickTargetRange = m.cpm?.range ?? m.range;
    const click = sidebarClickTarget(index, uri, clickTargetUri, clickTargetRange);

    const dbmOpen = m.libMaterialName ? resolveDbmOpenTarget(m, libRoot) : null;
    const children: NavTreeNode[] = [];
    if (m.libMaterialName && dbmOpen) {
      children.push({
        id: `mat-${m.number}-code`,
        label: m.libMaterialName,
        description: dbmOpen.exists
          ? `библиотека ${dbmOpen.library}.DBM`
          : dbmOpen.library
            ? `${dbmOpen.library}.DBM не найден`
            : "кодовое имя .DBM",
        muted: !dbmOpen.exists,
        warning: Boolean(dbmOpen.library) && !dbmOpen.exists,
        tooltip: dbmOpen.fsPath || undefined,
        uri: dbmOpen.uri ?? (m.libMaterialRange ? click.uri : undefined),
        range: dbmOpen.uri
          ? dbmOpen.range
          : m.libMaterialRange
            ? sidebarClickTarget(index, uri, m.uri, m.libMaterialRange).range
            : click.range,
      });
    }
    for (const [i, n] of m.nuclides.entries()) {
      const suggestKey = `${n.range.start.line}:${n.name.toUpperCase()}`;
      const suggest = Boolean(suggestSumIsotope?.has(suggestKey)) && !n.sumIsotope;
      const sumMissingAw = n.sumIsotope?.inAwLib === false;
      const sumInAw = Boolean(n.sumIsotope) && n.sumIsotope?.inAwLib !== false;
      const nClick = sidebarClickTarget(index, uri, n.uri ?? m.uri, n.range);
      const openDbm = Boolean(m.libMaterialName && dbmOpen?.uri);
      const child: NavTreeNode = {
        id: `mat-${m.number}-n-${i}`,
        label: sumMissingAw ? `Σ! ${n.name}` : sumInAw ? `Σ ${n.name}` : n.name,
        description: sumMissingAw
          ? `нет в AW.LIB · ${n.concentration} яд/см³`
          : sumInAw
            ? `в суммарном изотопе · ${n.concentration} яд/см³`
            : `${n.concentration} яд/см³`,
        muted: sumInAw || Boolean(m.libMaterialName),
        warning: sumMissingAw,
        tooltip: m.libMaterialName
          ? `из ${m.nameLib ?? m.dbm?.library}.DBM`
          : sumMissingAw
            ? ["нет в AW.LIB", ...(n.sumIsotope?.reasons ?? [])].join("; ")
            : n.sumIsotope?.reasons?.join("; "),
        uri: openDbm ? dbmOpen!.uri : nClick.uri,
        range: openDbm ? dbmOpen!.range : nClick.range,
      };
      if (suggest) {
        child.action = {
          id: "add-to-si",
          label: "В SI",
          title: "Добавить в суммарный изотоп",
          command: "mcuhelper.addToSumIsotope",
          args: {
            uri: n.uri ?? m.uri ?? uri,
            line: n.range.start.line,
            nuclideName: n.name,
          },
        };
      }
      children.push(child);
    }

    return {
      id: `mat-${m.number}`,
      label: titleParts.length > 0 ? titleParts.join(" ") : `MATR ${m.number}`,
      description: parts.join(" · "),
      badges: badges.length ? badges : undefined,
      uri: click.uri,
      range: click.range,
      tooltip: m.cpm
        ? `CPM ×${m.cpm.repetitions}: номера ${formatCpmNumberRange(m.cpm.expandedNumbers)}`
        : m.libMaterialName
          ? `Кодовое имя из ${(m.nameLib ?? m.dbm?.library) || "?"}.DBM (UserGuide §8.11)`
          : undefined,
      children,
    };
  };

  const all = index.summaries.materials;
  const dbmMats = all.filter((m) => Boolean(m.libMaterialName));
  const plainMats = all.filter((m) => !m.libMaterialName);

  let roots: NavTreeNode[];
  // Отдельная группа только если есть материалы из .DBM.
  if (dbmMats.length === 0) {
    roots = all.map(buildMatNode);
  } else {
    roots = [];
    if (plainMats.length > 0) {
      roots.push({
        id: "mat-group-compose",
        label: "Состав",
        description: `${plainMats.length}`,
        children: plainMats.map(buildMatNode),
      });
    }
    roots.push({
      id: "mat-group-dbm",
      label: "Кодовые имена (.DBM)",
      description: `${dbmMats.length}`,
      children: dbmMats.map(buildMatNode),
    });
  }

  const catalog = buildDbmLibraryCatalogTree(libRoot, nextSuggestedMatrNumber(all));
  if (catalog) roots.push(catalog);
  return roots;
}

function nextSuggestedMatrNumber(
  materials: IndexPayload["summaries"]["materials"]
): number {
  let max = 0;
  for (const m of materials) {
    max = Math.max(max, m.number || 0);
    for (const n of m.cpm?.expandedNumbers ?? []) {
      max = Math.max(max, n);
    }
  }
  return max > 0 ? max + 1 : 1;
}

/** Каталог всех материалов из *.DBM в MDBNR — drag/клик вставляет `MATR N NAME=lib` + код. */
function buildDbmLibraryCatalogTree(
  libRoot: string,
  suggestedNumber: number
): NavTreeNode | null {
  const root = libRoot?.trim();
  if (!root) return null;
  const api = loadDbmCatalogApi();
  if (!api?.listDbmCatalog || !api.buildMatrDbmInsertSnippet) return null;

  let catalog;
  try {
    catalog = api.listDbmCatalog(root);
  } catch {
    return null;
  }
  if (!catalog.length) return null;

  const libNodes: NavTreeNode[] = [];
  let totalMats = 0;
  for (const lib of catalog) {
    totalMats += lib.materials.length;
    const uri = pathToFileURL(lib.fsPath).href;
    libNodes.push({
      id: `dbm-catalog-${lib.library}`,
      label: `${lib.library}.DBM`,
      description: `${lib.materials.length}`,
      tooltip: lib.fsPath,
      children: lib.materials.map((mat) => {
        const range: SourceRange = {
          start: { line: mat.headerLine, character: 0 },
          end: { line: mat.headerLine, character: Math.max(mat.code.length, 1) },
        };
        const densLabel = mat.densType === 1 ? "A" : "W";
        return {
          id: `dbm-catalog-${lib.library}-${mat.code}`,
          label: mat.code,
          description: `${mat.nuclideCount} нукл. · dens ${densLabel}`,
          tooltip: [
            `Перетащите или кликните — вставить:`,
            `MATR N NAME=${lib.library}`,
            mat.code,
            mat.nuclidesPreview ? `нуклиды: ${mat.nuclidesPreview}` : "",
            lib.fsPath,
          ]
            .filter(Boolean)
            .join("\n"),
          insertText: api.buildMatrDbmInsertSnippet(lib.library, mat.code, suggestedNumber),
          insertFormat: "snippet" as const,
          action: {
            id: "open-dbm",
            label: "↗",
            title: `Открыть ${lib.library}.DBM`,
            command: "mcuhelper.revealEditorRange",
            args: [uri, range],
          },
        };
      }),
    });
  }

  return {
    id: "mat-group-dbm-catalog",
    label: "Библиотека MDBNR (.DBM)",
    description: `${totalMats}`,
    tooltip: "Материалы из *.DBM в корне MDBNR — перетащите в редактор",
    children: libNodes,
  };
}

function resolveDbmOpenTarget(
  m: IndexPayload["summaries"]["materials"][number],
  libRoot: string
): {
  library: string;
  fsPath?: string;
  uri?: string;
  exists: boolean;
  range: SourceRange;
} {
  const library = m.dbm?.library ?? m.nameLib ?? "";
  const range = m.dbm?.range ?? {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };
  if (m.dbm?.uri && m.dbm.exists) {
    return { library, fsPath: m.dbm.fsPath, uri: m.dbm.uri, exists: true, range };
  }
  let fsPath = m.dbm?.fsPath;
  let exists = Boolean(m.dbm?.exists);
  if (libRoot && library) {
    const preferred = path.join(libRoot, `${library}.DBM`);
    if (fs.existsSync(preferred)) {
      fsPath = preferred;
      exists = true;
    } else {
      const lower = path.join(libRoot, `${library}.dbm`);
      if (fs.existsSync(lower)) {
        fsPath = lower;
        exists = true;
      } else if (!fsPath) {
        fsPath = preferred;
        exists = false;
      }
    }
  }
  const uri = fsPath && exists ? pathToFileURL(fsPath).href : undefined;
  return { library, fsPath, uri, exists, range };
}

/** Хвост фигуры зоны: рег./объектный указатель и номер материала (UserGuide §9.1.4). */
function formatRegZonePointers(
  regNum: number | undefined,
  objNum: number | undefined,
  materialNum: number | undefined,
  opts?: {
    regPointerIndex?: number;
    objPointerIndex?: number;
    matPointerIndex?: number;
  }
): string {
  const regPart =
    opts?.regPointerIndex != null
      ? `УРУ−${opts.regPointerIndex}`
      : `рег.${regNum ?? "?"}`;
  const objPart =
    opts?.objPointerIndex != null
      ? `УОУ−${opts.objPointerIndex}`
      : `об.${objNum ?? "?"}`;
  const matPart =
    opts?.matPointerIndex != null
      ? `УМУ−${opts.matPointerIndex}`
      : `M${materialNum ?? "?"}`;
  return `${regPart}/${objPart} · ${matPart}`;
}

function zonePointerOpts(z: {
  regPointerIndex?: number;
  objPointerIndex?: number;
  matPointerIndex?: number;
}) {
  return {
    regPointerIndex: z.regPointerIndex,
    objPointerIndex: z.objPointerIndex,
    matPointerIndex: z.matPointerIndex,
  };
}

export function buildZonesTree(index: IndexPayload, uri: string): NavTreeNode[] {
  // Имя зоны (z.name) — имя геометрической фигуры; regNum — регистрационный номер (не связан с именем).
  // Корень = рег. зона №regNum; потомки = фигуры с этим regNum.
  // Условные (УРУ) без абсолютного reg группируются под «Условные указатели».
  type ZoneRow = IndexPayload["summaries"]["zones"][number];
  const absolute: ZoneRow[] = [];
  const conditional: ZoneRow[] = [];
  for (const z of index.summaries.zones) {
    if (z.hasConditionalPointers && z.regNum == null) conditional.push(z);
    else absolute.push(z);
  }

  const zonesByRegNum = new Map<string, ZoneRow[]>();
  for (const z of absolute) {
    const key = z.regNum != null ? String(z.regNum) : "?";
    const list = zonesByRegNum.get(key);
    if (list) list.push(z);
    else zonesByRegNum.set(key, [z]);
  }

  const allObjects = index.summaries.objects ?? [];
  const roots: NavTreeNode[] = [];

  if (conditional.length > 0) {
    roots.push({
      id: "zone-conditional",
      label: "Условные указатели",
      description: `${conditional.length} фигур(ы) с УРУ/УОУ/УМУ`,
      uri,
      children: conditional.map((z, i) => {
        const click = sidebarClickTarget(index, uri, z.uri, z.range);
        return {
          id: `zone-cond-${i}`,
          label: z.name,
          description: formatRegZonePointers(z.regNum, z.objNum, z.materialNum, zonePointerOpts(z)),
          uri: click.uri,
          range: click.range,
        };
      }),
    });
  }

  for (const [regKey, list] of zonesByRegNum.entries()) {
    const regNumLabel = regKey === "?" ? "?" : regKey;
    const children: NavTreeNode[] = [];
    const objNumsForDesc: string[] = [];
    const placed = new Set<ZoneRow>();

    for (const obj of allObjects) {
      const matches = list.filter((z) => z.objNum === obj.objectNum);
      if (!matches.length) continue;

      objNumsForDesc.push(String(obj.objectNum));
      for (const [i, z] of matches.entries()) {
        placed.add(z);
        const click = sidebarClickTarget(index, uri, z.uri, z.range);
        children.push({
          id: `zone-${regKey}-obj-${obj.objectNum}-z-${i}`,
          label: z.name,
          description: formatRegZonePointers(z.regNum, obj.objectNum, z.materialNum, zonePointerOpts(z)),
          uri: click.uri,
          range: click.range,
        });
      }
    }

    // УОУ / без objNum: не терять фигуры, если в группе уже есть зоны с обычным obj.
    for (const [i, z] of list.entries()) {
      if (placed.has(z)) continue;
      const click = sidebarClickTarget(index, uri, z.uri, z.range);
      children.push({
        id: `zone-${regKey}-rest-${i}`,
        label: z.name,
        description: formatRegZonePointers(z.regNum, z.objNum, z.materialNum, zonePointerOpts(z)),
        uri: click.uri,
        range: click.range,
      });
      objNumsForDesc.push(
        z.objPointerIndex != null ? `УОУ−${z.objPointerIndex}` : z.objNum != null ? String(z.objNum) : "?"
      );
    }

    if (!children.length) {
      for (const [i, z] of list.entries()) {
        const click = sidebarClickTarget(index, uri, z.uri, z.range);
        children.push({
          id: `zone-${regKey}-z-${i}`,
          label: z.name,
          description: formatRegZonePointers(z.regNum, z.objNum, z.materialNum, zonePointerOpts(z)),
          uri: click.uri,
          range: click.range,
        });
        objNumsForDesc.push(z.objNum != null ? String(z.objNum) : "?");
      }
    }

    const firstClickable = children.find((c) => c.uri && c.range);
    const figureNames = [...new Set(list.map((z) => z.name))];

    roots.push({
      id: `zone-${regKey}`,
      label: `Рег. зона ${regNumLabel}`,
      description: `рег. №${regNumLabel} · объекты: ${[...new Set(objNumsForDesc)].join(", ")} · фигуры: ${figureNames.join(", ")}`,
      uri: firstClickable?.uri ?? uri,
      range: firstClickable?.range,
      children,
    });
  }

  return roots;
}

export function buildObjectsTree(index: IndexPayload, uri: string): NavTreeNode[] {
  // "Объект" в индексе не содержит прямого range/position,
  // поэтому кликабельность делаем через зоны, на которые он ссылается.
  const zonesByName = new Map<string, typeof index.summaries.zones>();
  for (const z of index.summaries.zones) {
    const list = zonesByName.get(z.name);
    if (list) list.push(z);
    else zonesByName.set(z.name, [z]);
  }

  const zoneForObject = (zoneName: string, objectNum: number) => {
    const matches = zonesByName.get(zoneName);
    if (!matches?.length) return undefined;
    return matches.find((z) => z.objNum === objectNum) ?? matches[0];
  };

  return index.summaries.objects.map((o) => {
    const children = o.zoneNames.map((zn, i) => {
      const zone = zoneForObject(zn, o.objectNum);
      const click = zone ? sidebarClickTarget(index, uri, zone.uri, zone.range) : { uri: undefined, range: undefined };
      return {
        id: `obj-${o.objectNum}-z-${i}`,
        label: zn,
        description: formatRegZonePointers(zone?.regNum, o.objectNum, zone?.materialNum ?? o.materialNums[i], zone ? zonePointerOpts(zone) : undefined),
        uri: click.uri,
        range: click.range,
      };
    });

    const firstClickable = children.find((c) => c.uri && c.range);

    return {
      id: `obj-${o.objectNum}`,
      label: `Объект ${o.objectNum}`,
      description: `Фигуры: ${o.zoneNames.join(", ")}`,
      uri: firstClickable?.uri ?? uri,
      range: firstClickable?.range,
      children,
    };
  });
}

export function buildConstantsTree(
  index: IndexPayload,
  uri: string,
  editorContext?: IndexPayload["editorContext"]
): NavTreeNode[] {
  const formatScopeLabel = (scope: string) => formatBodyScope(scope);

  const items = index.summaries.constants.map((c) => {
    const scopeNote =
      c.scope && c.scope !== "global" ? ` · ${formatScopeLabel(c.scope)}` : "";
    return {
      id: `const-${c.name}`,
      label: c.name,
      description: `${c.mutable ? "SET" : "EQU"} = ${formatConstValue(c.value)}  ← ${c.expression}${scopeNote}`,
      uri: c.uri ?? uri,
      range: c.range,
    };
  });

  if (!editorContext) return items;

  const header: NavTreeNode = {
    id: "const-ctx",
    label: formatScopeLabel(editorContext.scope),
    description: `строка ${editorContext.line + 1} · ${items.length} имён`,
    children: items,
  };
  return items.length > 0 ? [header] : [header];
}

export function buildBodiesTree(index: IndexPayload, uri: string): NavTreeNode[] {
  const byScope = new Map<string, IndexPayload["summaries"]["bodies"]>();
  for (const body of index.summaries.bodies ?? []) {
    const scope = body.scope ?? "global";
    const list = byScope.get(scope) ?? [];
    list.push(body);
    byScope.set(scope, list);
  }
  return Array.from(byScope.entries())
    .sort((a, b) => scopeSortKey(a[0]) - scopeSortKey(b[0]) || a[0].localeCompare(b[0]))
    .map(([scope, bodies]) => ({
      id: `scope-${scope}`,
      label: formatBodyScope(scope),
      description: `${bodies.length} тел`,
      children: bodies.map((b) => {
        const click = sidebarClickTarget(index, uri, b.uri, b.range);
        return {
          id: `body-${b.name}-${scope}`,
          label: b.name,
          description: formatBodyDescription(b),
          uri: click.uri,
          range: click.range,
        };
      }),
    }));
}

export function buildNetsTree(index: IndexPayload, uri: string): NavTreeNode[] {
  const pointerCartChildren = (
    netName: string,
    kind: "reg" | "obj" | "mat",
    rows: NonNullable<IndexPayload["summaries"]["nets"][number]["regCartogram"]> | undefined,
    title: string
  ): NavTreeNode[] => {
    if (!rows?.length) return [];
    return [
      {
        id: `net-${netName}-${kind}`,
        label: title,
        description: `${rows.length} строк`,
        children: rows.map((row, i) => ({
          id: `net-${netName}-${kind}-${i}`,
          label: row.label,
          description: row.all
            ? `Указ.${row.pointerIndex} ALL · ${row.valuesPreview}`
            : `Указ.${row.pointerIndex} стр.${row.rowIndex ?? "?"} · ${row.valuesPreview}`,
        })),
      },
    ];
  };

  return (index.summaries.nets ?? []).map((net) => {
    const click = sidebarClickTarget(index, uri, net.uri, net.range);
    return {
      id: `net-${net.name}`,
      label: net.name,
      description: formatNetGrid(net),
      uri: click.uri,
      range: click.range,
      children: [
        ...(net.cartogram.length > 0
          ? [
              {
                id: `net-${net.name}-cart`,
                label: "Картограмма T**",
                description: `${net.typeMapRowCount} строк`,
                children: net.cartogram.map((row, i) => ({
                  id: `net-${net.name}-cart-${i}`,
                  label: row.label,
                  description: row.prototypes.join(" "),
                })),
              },
            ]
          : []),
        ...pointerCartChildren(net.name, "reg", net.regCartogram, "Картограмма P** (рег.)"),
        ...pointerCartChildren(net.name, "obj", net.objCartogram, "Картограмма O** (объекты)"),
        ...pointerCartChildren(net.name, "mat", net.matCartogram, "Картограмма M** (материалы)"),
        ...(net.prototypes.length > 0
          ? [
              {
                id: `net-${net.name}-proto`,
                label: "Прототипы CELL",
                description: `${net.prototypes.length} шт.`,
                children: net.prototypes.map((p, i) => {
                  const pClick = p.range
                    ? sidebarClickTarget(index, uri, p.uri, p.range)
                    : { uri: undefined as string | undefined, range: undefined };
                  return {
                    id: `net-${net.name}-proto-${i}`,
                    label: p.name,
                    description: "CELL",
                    uri: pClick.uri,
                    range: pClick.range,
                  };
                }),
              },
            ]
          : []),
        ...(net.carrierZones.length > 0
          ? [
              {
                id: `net-${net.name}-cz`,
                label: "Зоны-носители",
                description: net.carrierZones.map((z) => z.name).join(", "),
                children: net.carrierZones.map((z, i) => {
                  const zClick = sidebarClickTarget(index, uri, z.uri, z.range);
                  return {
                    id: `net-${net.name}-cz-${i}`,
                    label: z.name,
                    description: "(NET)",
                    uri: zClick.uri,
                    range: zClick.range,
                  };
                }),
              },
            ]
          : []),
      ].filter((g) => g.children && g.children.length > 0),
    };
  });
}

export function buildLatticesTree(index: IndexPayload, uri: string): NavTreeNode[] {
  return (index.summaries.lattices ?? []).map((lat, li) => {
    const click = sidebarClickTarget(index, uri, lat.uri, lat.range);
    return {
      id: `latt-${li}`,
      label: `LATT ${lat.latticeType}`,
      description: `→ ${lat.zoneNames.join(", ") || "?"}`,
      uri: click.uri,
      range: click.range,
      children: [
        ...(lat.zoneNames.length > 0
          ? [
              {
                id: `latt-${li}-zones`,
                label: "Зоны-носители",
                description: lat.zoneNames.join(", "),
                children: lat.zoneNames.map((zn, i) => {
                  const zone = index.summaries.zones.find((z) => z.name === zn);
                  const zClick = zone
                    ? sidebarClickTarget(index, uri, zone.uri, zone.range)
                    : { uri: undefined as string | undefined, range: undefined };
                  return {
                    id: `latt-${li}-zn-${i}`,
                    label: zn,
                    description: zone?.expression ?? "",
                    uri: zClick.uri,
                    range: zClick.range,
                  };
                }),
              },
            ]
          : []),
        ...(lat.elements.length > 0
          ? [
              {
                id: `latt-${li}-listel`,
                label: "LISTEL",
                description: lat.positionsPreview || `${lat.elements.length} эл.`,
                children: lat.elements.map((el, i) => {
                  const elClick = el.range
                    ? sidebarClickTarget(index, uri, el.uri, el.range)
                    : { uri: undefined as string | undefined, range: undefined };
                  return {
                    id: `latt-${li}-el-${i}`,
                    label: `${i + 1}. ${el.name}`,
                    description: "LCELL",
                    uri: elClick.uri,
                    range: elClick.range,
                  };
                }),
              },
            ]
          : []),
      ].filter((g) => g.children && g.children.length > 0),
    };
  });
}

export function buildNavTree(
  viewId: NavViewId,
  index: IndexPayload,
  uri: string,
  suggestSumIsotope?: ReadonlySet<string>,
  constantsLibPath?: string
): NavTreeNode[] {
  switch (viewId) {
    case "fragments":
      return buildFragmentsTree(index, uri);
    case "materials":
      return buildMaterialsTree(index, uri, suggestSumIsotope, constantsLibPath);
    case "zones":
      return buildZonesTree(index, uri);
    case "objects":
      return buildObjectsTree(index, uri);
    case "constants":
      return buildConstantsTree(index, uri, index.editorContext);
    case "bodies":
      return buildBodiesTree(index, uri);
    case "nets":
      return buildNetsTree(index, uri);
    case "lattices":
      return buildLatticesTree(index, uri);
    default:
      return [];
  }
}
