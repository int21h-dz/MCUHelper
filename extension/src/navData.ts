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
  /** Серый/приглушённый вид (суммарный изотоп и т.п.). */
  muted?: boolean;
  /** Подсказка при наведении (причина muted и др.). */
  tooltip?: string;
  uri?: string;
  range?: SourceRange;
  children?: NavTreeNode[];
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
  summaries: {
    materials: Array<{
      number: number;
      group?: string;
      temperature?: number;
      nuclideCount: number;
      nuclidesPreview: string;
      massDensityGcm3: number | null;
      volumeCm3: number | null;
      massG: number | null;
      nuclides: Array<{
        name: string;
        concentration: string;
        range: SourceRange;
        sumIsotope?: { reasons: string[] };
      }>;
      range: SourceRange;
    }>;
    zones: Array<{
      name: string;
      expression: string;
      materialNum?: number;
      regNum?: number;
      objNum?: number;
      range: SourceRange;
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
    }>;
    nets: Array<{
      name: string;
      root: string;
      cols: number;
      rows: number;
      layers?: number;
      typeMapRowCount: number;
      cartogram: Array<{ row: number; label: string; prototypes: string[] }>;
      carrierZones: Array<{ name: string; range: SourceRange }>;
      prototypes: Array<{ name: string; range?: SourceRange }>;
      range: SourceRange;
    }>;
    lattices: Array<{
      latticeType: string;
      zoneNames: string[];
      elements: Array<{ name: string; range?: SourceRange }>;
      positionsPreview: string;
      range: SourceRange;
    }>;
  };
  /** Компактные метки суммарного изотопа для серых decorations (всегда, даже при slim). */
  sumIsotopeMarks?: Array<{
    name: string;
    concentration: string;
    range: SourceRange;
    reasons: string[];
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

export function buildFragmentsTree(index: IndexPayload, uri: string): NavTreeNode[] {
  return (index.fragments ?? []).map((fragment, i) => {
    const meta = FRAGMENT_META[fragment.id];
    const startLine = fragment.startLine + 1;
    const endLine = fragment.endLine + 1;
    let inMatrBlock = false;
    const children = (index.statements ?? [])
      .filter((stmt) => stmt.fragment === fragment.id)
      .flatMap((stmt, si) => {
        const label = stmt.label.toUpperCase();
        const keep = isFragmentChildStatement(stmt, inMatrBlock, index);
        if (label === "MATR") {
          inMatrBlock = true;
        } else if (MATR_BLOCK_STOP_LABELS.has(label)) {
          inMatrBlock = false;
        }
        if (!keep) return [];
        const text = stmt.text.trim();
        const rest = text.slice(stmt.label.length).trim();
        const lineNum = stmt.range.start.line + 1;
        const description = rest
          ? `${trimPreview(rest)} · строка ${lineNum}`
          : `строка ${lineNum}`;
        return [{
          id: `fragstmt-${fragment.id}-${i}-${si}`,
          label: stmt.label,
          description,
          uri,
          range: stmt.range,
        }];
      });
    return {
      id: `frag-${fragment.id}-${i}`,
      label: meta?.label ?? fragment.id,
      description: `${meta?.title ?? fragment.id} · строки ${startLine}-${endLine}`,
      uri,
      range: {
        start: { line: fragment.startLine, character: 0 },
        end: { line: fragment.endLine, character: 0 },
      },
      children,
    };
  });
}

export function buildMaterialsTree(index: IndexPayload, uri: string): NavTreeNode[] {
  return index.summaries.materials.map((m) => {
    const rho = formatMaterialDensity(m.massDensityGcm3);
    const vol = formatBodyVolume(m.volumeCm3);
    const mass = formatMaterialMass(m.massG);
    const parts = [`${m.nuclideCount} нукл.`];
    if (rho) parts.push(rho);
    if (m.volumeCm3 != null && vol) parts.push(vol);
    if (mass) parts.push(mass);
    const badges: string[] = [];
    if (rho) badges.push(rho.replace("ρ≈", "ρ "));
    const titleParts: string[] = [];
    if (m.group) titleParts.push(`[${m.group}]`);
    if (m.temperature != null) titleParts.push(`T=${m.temperature}`);
    return {
      id: `mat-${m.number}`,
      label: titleParts.length > 0 ? titleParts.join(" ") : `MATR ${m.number}`,
      description: parts.join(" · "),
      badges: badges.length ? badges : undefined,
      uri,
      range: m.range,
      children: m.nuclides.map((n, i) => ({
        id: `mat-${m.number}-n-${i}`,
        label: n.name,
        description: `${n.concentration} яд/см³`,
        muted: Boolean(n.sumIsotope),
        tooltip: n.sumIsotope?.reasons?.join("; "),
        uri,
        range: n.range,
      })),
    };
  });
}

export function buildZonesTree(index: IndexPayload, uri: string): NavTreeNode[] {
  return index.summaries.zones.map((z) => ({
    id: `zone-${z.name}`,
    label: z.name,
    description: `M${z.materialNum ?? "?"} Z${z.regNum ?? "?"} O${z.objNum ?? "?"} — ${z.expression}`,
    uri,
    range: z.range,
  }));
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
      return {
        id: `obj-${o.objectNum}-z-${i}`,
        label: zn,
        description: `мат. ${o.materialNums.join(",")}`,
        uri: zone ? uri : undefined,
        range: zone?.range,
      };
    });

    const firstClickableRange = children.find((c) => c.uri && c.range)?.range;

    return {
      id: `obj-${o.objectNum}`,
      label: `Object ${o.objectNum}`,
      description: `Зоны: ${o.zoneNames.join(", ")}`,
      uri,
      range: firstClickableRange,
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
      uri,
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
      children: bodies.map((b) => ({
        id: `body-${b.name}-${scope}`,
        label: b.name,
        description: formatBodyDescription(b),
        uri,
        range: b.range,
      })),
    }));
}

export function buildNetsTree(index: IndexPayload, uri: string): NavTreeNode[] {
  return (index.summaries.nets ?? []).map((net) => ({
    id: `net-${net.name}`,
    label: net.name,
    description: formatNetGrid(net),
    uri,
    range: net.range,
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
              children: net.prototypes.map((p, i) => ({
                id: `net-${net.name}-proto-${i}`,
                label: p.name,
                description: "CELL",
                uri: p.range ? uri : undefined,
                range: p.range,
              })),
            },
          ]
        : []),
      ...(net.carrierZones.length > 0
        ? [
            {
              id: `net-${net.name}-cz`,
              label: "Зоны-носители",
              description: net.carrierZones.map((z) => z.name).join(", "),
              children: net.carrierZones.map((z, i) => ({
                id: `net-${net.name}-cz-${i}`,
                label: z.name,
                description: "(NET)",
                uri,
                range: z.range,
              })),
            },
          ]
        : []),
    ].filter((g) => g.children && g.children.length > 0),
  }));
}

export function buildLatticesTree(index: IndexPayload, uri: string): NavTreeNode[] {
  return (index.summaries.lattices ?? []).map((lat, li) => ({
    id: `latt-${li}`,
    label: `LATT ${lat.latticeType}`,
    description: `→ ${lat.zoneNames.join(", ") || "?"}`,
    uri,
    range: lat.range,
    children: [
      ...(lat.zoneNames.length > 0
        ? [
            {
              id: `latt-${li}-zones`,
              label: "Зоны-носители",
              description: lat.zoneNames.join(", "),
              children: lat.zoneNames.map((zn, i) => {
                const zone = index.summaries.zones.find((z) => z.name === zn);
                return {
                  id: `latt-${li}-zn-${i}`,
                  label: zn,
                  description: zone?.expression ?? "",
                  uri: zone ? uri : undefined,
                  range: zone?.range,
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
              children: lat.elements.map((el, i) => ({
                id: `latt-${li}-el-${i}`,
                label: `${i + 1}. ${el.name}`,
                description: "LCELL",
                uri: el.range ? uri : undefined,
                range: el.range,
              })),
            },
          ]
        : []),
    ].filter((g) => g.children && g.children.length > 0),
  }));
}

export function buildNavTree(viewId: NavViewId, index: IndexPayload, uri: string): NavTreeNode[] {
  switch (viewId) {
    case "fragments":
      return buildFragmentsTree(index, uri);
    case "materials":
      return buildMaterialsTree(index, uri);
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
