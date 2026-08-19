/** Дерево навигации для Webview sidebar (данные из LSP getIndex). */

import { isGeoBodyLabel } from "./catalogBridge";

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
    }>;
    zones: Array<{
      name: string;
      expression: string;
      materialNum?: number;
      regNum?: number;
      objNum?: number;
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

const MATR_BLOCK_STOP_LABELS = new Set(["MATR", "END", "FINISH", "DEF", "TEMPR", "PIN"]);

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
  suggestSumIsotope?: ReadonlySet<string>
): NavTreeNode[] {
  return index.summaries.materials.map((m) => {
    const rho = formatMaterialDensity(m.massDensityGcm3);
    const vol = formatBodyVolume(m.volumeCm3);
    const mass = formatMaterialMass(m.massG);
    const parts = formatMaterialNuclideCounts(m);
    if (rho) parts.push(rho);
    if (m.volumeCm3 != null && vol) parts.push(vol);
    if (mass) parts.push(mass);
    if (m.activityBqPerG != null && m.activityBqPerG > 0) {
      parts.push(`A≈${formatActivitySidebar(m.activityBqPerG)}`);
    }
    const badges: string[] = [];
    if (rho) badges.push(rho.replace("ρ≈", "ρ "));
    const titleParts: string[] = [];
    if (m.group) titleParts.push(`[${m.group}]`);
    if (m.temperature != null) titleParts.push(`T=${m.temperature}`);
    const click = sidebarClickTarget(index, uri, m.uri, m.range);
    return {
      id: `mat-${m.number}`,
      label: titleParts.length > 0 ? titleParts.join(" ") : `MATR ${m.number}`,
      description: parts.join(" · "),
      badges: badges.length ? badges : undefined,
      uri: click.uri,
      range: click.range,
      children: m.nuclides.map((n, i) => {
        const suggestKey = `${n.range.start.line}:${n.name.toUpperCase()}`;
        const suggest = Boolean(suggestSumIsotope?.has(suggestKey)) && !n.sumIsotope;
        const sumMissingAw = n.sumIsotope?.inAwLib === false;
        const sumInAw = Boolean(n.sumIsotope) && n.sumIsotope?.inAwLib !== false;
        const nClick = sidebarClickTarget(index, uri, n.uri ?? m.uri, n.range);
        const child: NavTreeNode = {
          id: `mat-${m.number}-n-${i}`,
          label: sumMissingAw ? `Σ! ${n.name}` : sumInAw ? `Σ ${n.name}` : n.name,
          description: sumMissingAw
            ? `нет в AW.LIB · ${n.concentration} яд/см³`
            : sumInAw
              ? `в суммарном изотопе · ${n.concentration} яд/см³`
              : `${n.concentration} яд/см³`,
          muted: sumInAw,
          warning: sumMissingAw,
          tooltip: sumMissingAw
            ? ["нет в AW.LIB", ...(n.sumIsotope?.reasons ?? [])].join("; ")
            : n.sumIsotope?.reasons?.join("; "),
          uri: nClick.uri,
          range: nClick.range,
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
        return child;
      }),
    };
  });
}

export function buildZonesTree(index: IndexPayload, uri: string): NavTreeNode[] {
  return index.summaries.zones.map((z) => {
    const click = sidebarClickTarget(index, uri, z.uri, z.range);
    return {
      id: `zone-${z.name}`,
      label: z.name,
      description: `M${z.materialNum ?? "?"} Z${z.regNum ?? "?"} O${z.objNum ?? "?"} — ${z.expression}`,
      uri: click.uri,
      range: click.range,
    };
  });
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
        description: `мат. ${o.materialNums.join(",")}`,
        uri: click.uri,
        range: click.range,
      };
    });

    const firstClickable = children.find((c) => c.uri && c.range);

    return {
      id: `obj-${o.objectNum}`,
      label: `Object ${o.objectNum}`,
      description: `Зоны: ${o.zoneNames.join(", ")}`,
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
                label: "Картограмма",
                description: `${net.typeMapRowCount} строк`,
                children: net.cartogram.map((row, i) => ({
                  id: `net-${net.name}-cart-${i}`,
                  label: row.label,
                  description: row.prototypes.join(" "),
                })),
              },
            ]
          : []),
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
  suggestSumIsotope?: ReadonlySet<string>
): NavTreeNode[] {
  switch (viewId) {
    case "fragments":
      return buildFragmentsTree(index, uri);
    case "materials":
      return buildMaterialsTree(index, uri, suggestSumIsotope);
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
