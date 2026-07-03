/** Дерево навигации для Webview sidebar (данные из LSP getIndex). */

export interface SourceRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface NavTreeNode {
  id: string;
  label: string;
  description?: string;
  badges?: string[];
  uri?: string;
  range?: SourceRange;
  children?: NavTreeNode[];
}

export interface IndexPayload {
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
      nuclides: Array<{ name: string; concentration: string; range: SourceRange }>;
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
  editorContext?: {
    line: number;
    character: number;
    scope: string;
  };
}

export type NavViewId =
  | "materials"
  | "constants"
  | "bodies"
  | "nets"
  | "lattices"
  | "zones"
  | "objects";

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

export function buildObjectsTree(index: IndexPayload): NavTreeNode[] {
  return index.summaries.objects.map((o) => ({
    id: `obj-${o.objectNum}`,
    label: `Object ${o.objectNum}`,
    description: `Зоны: ${o.zoneNames.join(", ")}`,
    children: o.zoneNames.map((zn, i) => ({
      id: `obj-${o.objectNum}-z-${i}`,
      label: zn,
      description: `мат. ${o.materialNums.join(",")}`,
    })),
  }));
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
    case "materials":
      return buildMaterialsTree(index, uri);
    case "zones":
      return buildZonesTree(index, uri);
    case "objects":
      return buildObjectsTree(index);
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
