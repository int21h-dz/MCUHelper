import type { DocumentAst, ZoneNode } from "@mcuhelper/mcu-language";
import { getResolvedZoneNumbers } from "@mcuhelper/mcu-language";
import type { BoundingBox, PrimitiveSolid, SliceAxis, SliceGrid, SliceZoneMeta, Vec3 } from "./types";
import { buildGeometryContext } from "./query";
import { pointInBodyNode } from "./pointInBody";
import { bboxUnion, buildPrimitive, emptyBbox } from "./primitives";
import { collectBodyRefs, evalZoneExpr, parseZoneExpression } from "./zoneExpression";
import { isBodyRefInHits, resolveBodyRef } from "./bodyRefs";
import { colorForZone } from "./colors";
import { buildBodySlices, bodyToMeshDescriptor, neighborColorByGap, neighborFadeDistance, selectNearbyBodiesWithGap } from "./meshPreview";

export interface LiveZonePreviewSlice extends SliceGrid {
  title: string;
  uLabel: string;
  vLabel: string;
  zonePreview?: boolean;
  polylines?: Array<{
    name: string;
    color: string;
    closed: boolean;
    points: Array<{ u: number; v: number }>;
    highlight?: boolean;
  }>;
  segments?: Array<{ a: { u: number; v: number }; b: { u: number; v: number } }>;
  debugGrid?: {
    rows: number;
    cols: number;
    step: number;
    capped: boolean;
    primitiveCount: number;
    minFeature: number | null;
    refsFound: number;
    matchedInCtx: number;
  };
}

export interface LiveZonePreviewResult {
  zoneName: string;
  expression: string;
  scope: string;
  quality?: "rough" | "draft" | "full";
  warnings: string[];
  bbox: BoundingBox;
  slices: LiveZonePreviewSlice[];
}

type ZonePrimitiveInfo = {
  bbox: BoundingBox;
  solid: PrimitiveSolid;
};

function inScopeFilter(scope?: string): (s?: string) => boolean {
  const want = scope ?? "global";
  if (want === "global") return (s) => !s || s === "global";
  return (s) => (s ?? "global") === want;
}

function axisBounds(
  axis: SliceAxis,
  bbox: BoundingBox
): { uMin: number; uMax: number; vMin: number; vMax: number } {
  if (axis === "z") return { uMin: bbox.min.x, uMax: bbox.max.x, vMin: bbox.min.y, vMax: bbox.max.y };
  if (axis === "y") return { uMin: bbox.min.x, uMax: bbox.max.x, vMin: bbox.min.z, vMax: bbox.max.z };
  return { uMin: bbox.min.y, uMax: bbox.max.y, vMin: bbox.min.z, vMax: bbox.max.z };
}

function padSliceBounds(
  bounds: { uMin: number; uMax: number; vMin: number; vMax: number },
  targetStep: number
): { uMin: number; uMax: number; vMin: number; vMax: number } {
  const uSpan = Math.max(1e-9, bounds.uMax - bounds.uMin);
  const vSpan = Math.max(1e-9, bounds.vMax - bounds.vMin);
  const uPad = Math.max(targetStep * 2, uSpan * 0.01, 1e-6);
  const vPad = Math.max(targetStep * 2, vSpan * 0.01, 1e-6);
  return {
    uMin: bounds.uMin - uPad,
    uMax: bounds.uMax + uPad,
    vMin: bounds.vMin - vPad,
    vMax: bounds.vMax + vPad,
  };
}

function gridToPoint(axis: SliceAxis, position: number, u: number, v: number): Vec3 {
  if (axis === "z") return { x: u, y: v, z: position };
  if (axis === "y") return { x: u, y: position, z: v };
  return { x: position, y: u, z: v };
}

function findBodiesAtPoint(ctx: ReturnType<typeof buildGeometryContext>, p: Vec3): string[] {
  const hits: string[] = [];
  for (const [name, body] of ctx.bodies) {
    const params = ctx.bodyParams.get(name);
    if (params && pointInBodyNode(body, params, p)) hits.push(name);
  }
  return hits;
}

function inflateDegenerateBbox(bbox: BoundingBox): BoundingBox {
  const padAxis = (min: number, max: number) => {
    if (Number.isFinite(min) && Number.isFinite(max) && Math.abs(max - min) > 1e-9) return [min, max] as const;
    const c = Number.isFinite(min) && Number.isFinite(max) ? (min + max) / 2 : 0;
    return [c - 0.5, c + 0.5] as const;
  };
  const [x1, x2] = padAxis(bbox.min.x, bbox.max.x);
  const [y1, y2] = padAxis(bbox.min.y, bbox.max.y);
  const [z1, z2] = padAxis(bbox.min.z, bbox.max.z);
  return { min: { x: x1, y: y1, z: z1 }, max: { x: x2, y: y2, z: z2 } };
}

function computeScopeBbox(ctx: ReturnType<typeof buildGeometryContext>): BoundingBox | null {
  let bbox = emptyBbox();
  let first = true;
  for (const [name, body] of ctx.bodies) {
    if (!ctx.bodyParams.has(name)) continue;
    const primitive = buildPrimitive(body.bodyType, body.name, body.params, ctx.vars, body.scope);
    if (!primitive) continue;
    bbox = first ? primitive.bbox : bboxUnion(bbox, primitive.bbox);
    first = false;
  }
  return first ? null : inflateDegenerateBbox(bbox);
}

function computeZoneBbox(
  ctx: ReturnType<typeof buildGeometryContext>,
  zone: ZoneNode
): {
  bbox: BoundingBox | null;
  usedFallback: boolean;
  primitives: ZonePrimitiveInfo[];
  refsFound: number;
  matchedInCtx: number;
} {
  const extractBodyRefsFromText = (text: string): string[] => {
    const re = /-?([A-Za-z][A-Za-z0-9]{0,5}|\d+)/g;
    const out = new Set<string>();
    for (const m of text.matchAll(re)) {
      const token = String(m[1] ?? "");
      if (!token) continue;
      if (token.toUpperCase() === "U") continue; // MCU-NR оператор union
      if (token === "0") continue;
      out.add(token);
    }
    return [...out];
  };

  const expr = parseZoneExpression(zone.expression);
  let refs = expr ? collectBodyRefs(expr).filter((ref) => ref !== "0") : [];
  if (refs.length === 0) {
    // Fallback: parseZoneExpression сейчас может "терять" тела из-за скобок/нестандартных форм.
    refs = extractBodyRefsFromText(zone.expression);
  }
  const refsFound = refs.length;
  let bbox = emptyBbox();
  let first = true;
  const primitives: ZonePrimitiveInfo[] = [];
  let matchedInCtx = 0;
  let bodyExists = 0;
  let primitiveBuilt = 0;
  let numericRefs = 0;
  let mappedByOrder0 = 0; // try bodyOrder[n]
  let mappedByOrder1 = 0; // try bodyOrder[n-1]
  let bodyExistsWithNPrefix = 0; // try body name "N${ref}"
  let order0MatchesNPrefix = 0;
  let order1MatchesNPrefix = 0;
  for (const ref of refs) {
    // Подсчитываем ещё до попытки найти тело, чтобы видеть семантику zone-expression
    // даже в ситуациях, когда ctx.bodies/ctx.bodyParams ничего не мапят.
    if (/^\d+$/.test(ref)) {
      const n = parseInt(ref, 10);
      const nName = `N${ref}`;
      numericRefs++;
      if (ctx.bodyOrder[n]) mappedByOrder0++;
      if (ctx.bodyOrder[n - 1]) mappedByOrder1++;
      if (ctx.bodies.has(nName)) bodyExistsWithNPrefix++;
      if (ctx.bodyOrder[n] === nName) order0MatchesNPrefix++;
      if (ctx.bodyOrder[n - 1] === nName) order1MatchesNPrefix++;
    }

    const resolvedRef = resolveBodyRef(ref, ctx);
    const body = ctx.bodies.get(resolvedRef);
    const hasBody = !!body;
    const hasParams = ctx.bodyParams.has(resolvedRef);
    if (hasBody) bodyExists++;
    if (!body || !hasParams) continue;
    matchedInCtx++;
    const primitive = buildPrimitive(body.bodyType, body.name, body.params, ctx.vars, body.scope);
    if (!primitive) continue;
    primitiveBuilt++;
    primitives.push({ bbox: primitive.bbox, solid: primitive });
    bbox = first ? primitive.bbox : bboxUnion(bbox, primitive.bbox);
    first = false;
  }
  const result = !first
    ? {
        bbox: inflateDegenerateBbox(bbox),
        usedFallback: false,
        primitives,
        refsFound,
        matchedInCtx,
      }
    : {
        bbox: computeScopeBbox(ctx),
        usedFallback: true,
        primitives: [],
        refsFound,
        matchedInCtx,
      };
  return result;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function minBodyLinearSize(primitives: ZonePrimitiveInfo[]): number | null {
  const values: number[] = [];
  for (const p of primitives) {
    const dx = Math.abs(p.bbox.max.x - p.bbox.min.x);
    const dy = Math.abs(p.bbox.max.y - p.bbox.min.y);
    const dz = Math.abs(p.bbox.max.z - p.bbox.min.z);
    const minDim = Math.min(dx, dy, dz);
    if (Number.isFinite(minDim) && minDim > 1e-9) values.push(minDim);
  }
  if (!values.length) return null;
  return Math.min(...values);
}

function computeAdaptiveGridSize(
  axis: SliceAxis,
  bbox: BoundingBox,
  primitives: ZonePrimitiveInfo[],
  requestedBaseResolution: number,
  quality: "rough" | "draft" | "full"
): { rows: number; cols: number; capped: boolean; targetStep: number; primitiveCount: number; minFeature: number | null } {
  const bounds = axisBounds(axis, bbox);
  const uSpan = Math.max(1e-9, bounds.uMax - bounds.uMin);
  const vSpan = Math.max(1e-9, bounds.vMax - bounds.vMin);
  const baseResolution = clampInt(requestedBaseResolution || 512, 96, 1024);
  const baseStep = Math.max(uSpan, vSpan) / baseResolution;
  const minFeature = minBodyLinearSize(primitives);
  // Шаг сетки по твоему правилу: minLinearSize(body) / 150
  const stepDivisor = quality === "rough" ? 120 : 150;
  const targetStep = minFeature ? Math.max(minFeature / stepDivisor, 1e-9) : baseStep;
  // Чем сложнее зона, тем агрессивнее режем лимит сетки:
  // по логам именно крупные зоны (12-62 тел) давали секунды и десятки секунд на один preview.
  const primitiveCount = primitives.length;
  const cap =
    quality === "rough"
      ? primitiveCount >= 40
        ? 120
        : primitiveCount >= 12
          ? 160
          : 220
      : quality === "draft"
        ? primitiveCount >= 40
          ? 160
          : primitiveCount >= 12
            ? 192
            : 256
        : primitiveCount >= 40
          ? 320
          : primitiveCount >= 12
            ? 384
            : 512;
  const cols = clampInt(Math.ceil(uSpan / targetStep), 24, cap);
  const rows = clampInt(Math.ceil(vSpan / targetStep), 24, cap);
  const capped = cols >= cap || rows >= cap;
  return { rows, cols, capped, targetStep, primitiveCount, minFeature };
}

function sampleZoneAt(
  ctx: ReturnType<typeof buildGeometryContext>,
  expr: ReturnType<typeof parseZoneExpression>,
  axis: SliceAxis,
  position: number,
  u: number,
  v: number
): boolean {
  if (!expr) return false;
  const p = gridToPoint(axis, position, u, v);
  const bodyHits = findBodiesAtPoint(ctx, p);
  return evalZoneExpr(expr, (ref) => isBodyRefInHits(ref, bodyHits, ctx));
}

function buildVertexField(
  ctx: ReturnType<typeof buildGeometryContext>,
  expr: ReturnType<typeof parseZoneExpression>,
  axis: SliceAxis,
  position: number,
  bounds: { uMin: number; uMax: number; vMin: number; vMax: number },
  rows: number,
  cols: number
): boolean[][] {
  const field: boolean[][] = [];
  const du = (bounds.uMax - bounds.uMin) / cols;
  const dv = (bounds.vMax - bounds.vMin) / rows;
  for (let row = 0; row <= rows; row++) {
    const line: boolean[] = [];
    const v = bounds.vMax - row * dv;
    for (let col = 0; col <= cols; col++) {
      const u = bounds.uMin + col * du;
      line.push(sampleZoneAt(ctx, expr, axis, position, u, v));
    }
    field.push(line);
  }
  return field;
}

/**
 * Occupancy-сетка из уже посчитанного vertexField (без повторного сэмплинга геометрии).
 * Ячейка = 1, если хотя бы один из 4 углов внутри зоны.
 */
function occupancyGridFromVertexField(field: boolean[][]): number[][] {
  const rows = field.length - 1;
  const cols = (field[0]?.length ?? 1) - 1;
  if (rows <= 0 || cols <= 0) return [];
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: number[] = [];
    const top = field[r]!;
    const bot = field[r + 1]!;
    for (let c = 0; c < cols; c++) {
      const inside = top[c]! || top[c + 1]! || bot[c]! || bot[c + 1]!;
      line.push(inside ? 1 : 0);
    }
    grid.push(line);
  }
  return grid;
}

function buildMarchingPolylines(
  field: boolean[][],
  bounds: { uMin: number; uMax: number; vMin: number; vMax: number },
  name: string,
  color: string
): {
  polylines: Array<{ name: string; color: string; closed: boolean; points: Array<{ u: number; v: number }> }>;
  segments: Array<{ a: { u: number; v: number }; b: { u: number; v: number } }>;
} {
  const rows = field.length - 1;
  const cols = (field[0]?.length ?? 1) - 1;
  if (rows <= 0 || cols <= 0) return { polylines: [], segments: [] };
  const du = (bounds.uMax - bounds.uMin) / cols;
  const dv = (bounds.vMax - bounds.vMin) / rows;
  const stitchTol = Math.max(Math.abs(du), Math.abs(dv)) * 1.25;
  const snap = (n: number) => Number(n.toFixed(8));
  const dist2 = (a: { u: number; v: number }, b: { u: number; v: number }) => {
    const du2 = a.u - b.u;
    const dv2 = a.v - b.v;
    return du2 * du2 + dv2 * dv2;
  };
  const pointAt = (edge: 0 | 1 | 2 | 3, row: number, col: number) => {
    if (edge === 0) return { u: snap(bounds.uMin + (col + 0.5) * du), v: snap(bounds.vMax - row * dv) };
    if (edge === 1)
      return { u: snap(bounds.uMin + (col + 1) * du), v: snap(bounds.vMax - (row + 0.5) * dv) };
    if (edge === 2)
      return { u: snap(bounds.uMin + (col + 0.5) * du), v: snap(bounds.vMax - (row + 1) * dv) };
    return { u: snap(bounds.uMin + col * du), v: snap(bounds.vMax - (row + 0.5) * dv) };
  };
  const table: Record<number, Array<[0 | 1 | 2 | 3, 0 | 1 | 2 | 3]>> = {
    0: [],
    1: [[2, 3]],
    2: [[1, 2]],
    3: [[1, 3]],
    4: [[0, 1]],
    5: [[0, 3], [1, 2]],
    6: [[0, 2]],
    7: [[0, 3]],
    8: [[0, 3]],
    9: [[0, 2]],
    10: [[0, 1], [2, 3]],
    11: [[0, 1]],
    12: [[1, 3]],
    13: [[1, 2]],
    14: [[2, 3]],
    15: [],
  };
  const segments: Array<[{ u: number; v: number }, { u: number; v: number }]> = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tl = field[row]?.[col] ? 1 : 0;
      const tr = field[row]?.[col + 1] ? 1 : 0;
      const br = field[row + 1]?.[col + 1] ? 1 : 0;
      const bl = field[row + 1]?.[col] ? 1 : 0;
      const mask = (tl << 3) | (tr << 2) | (br << 1) | bl;
      for (const [e1, e2] of table[mask] ?? []) {
        segments.push([pointAt(e1, row, col), pointAt(e2, row, col)]);
      }
    }
  }
  const segmentPairs: Array<{ a: { u: number; v: number }; b: { u: number; v: number } }> = segments.map(([a, b]) => ({
    a,
    b,
  }));
  const keyOf = (p: { u: number; v: number }) => `${snap(p.u)},${snap(p.v)}`;
  const adjacency = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    for (const p of segments[i]!) {
      const key = keyOf(p);
      const arr = adjacency.get(key);
      if (arr) arr.push(i);
      else adjacency.set(key, [i]);
    }
  }
  const used = new Array(segments.length).fill(false);
  const rawPolylines: Array<{ name: string; color: string; closed: boolean; points: Array<{ u: number; v: number }> }> = [];
  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const pts = [segments[i]![0], segments[i]![1]];
    let extended = true;
    while (extended) {
      extended = false;
      const tryExtend = (atStart: boolean) => {
        const anchor = atStart ? pts[0] : pts[pts.length - 1];
        const key = keyOf(anchor);
        for (const segIdx of adjacency.get(key) ?? []) {
          if (used[segIdx]) continue;
          const seg = segments[segIdx]!;
          const aKey = keyOf(seg[0]);
          const bKey = keyOf(seg[1]);
          if (aKey !== key && bKey !== key) continue;
          used[segIdx] = true;
          const next = aKey === key ? seg[1] : seg[0];
          if (atStart) pts.unshift(next);
          else pts.push(next);
          extended = true;
          return;
        }
      };
      tryExtend(false);
      if (!extended) tryExtend(true);
    }
    const first = pts[0];
    const last = pts[pts.length - 1];
    const closed = keyOf(first) === keyOf(last);
    const clean = closed ? pts.slice(0, -1) : pts;
    if (clean.length >= 2) rawPolylines.push({ name, color, closed, points: clean });
  }
  const open = rawPolylines.filter((pl) => !pl.closed).map((pl) => ({ ...pl, points: [...pl.points] }));
  const closedPolys = rawPolylines.filter((pl) => pl.closed);
  const tol2 = stitchTol * stitchTol;
  let progress = true;
  while (progress && open.length > 1) {
    progress = false;
    outer: for (let i = 0; i < open.length; i++) {
      for (let j = i + 1; j < open.length; j++) {
        const a = open[i]!;
        const b = open[j]!;
        const a0 = a.points[0]!;
        const a1 = a.points[a.points.length - 1]!;
        const b0 = b.points[0]!;
        const b1 = b.points[b.points.length - 1]!;
        let merged: Array<{ u: number; v: number }> | null = null;
        if (dist2(a1, b0) <= tol2) merged = [...a.points, ...b.points.slice(1)];
        else if (dist2(a1, b1) <= tol2) merged = [...a.points, ...[...b.points].reverse().slice(1)];
        else if (dist2(a0, b1) <= tol2) merged = [...b.points, ...a.points.slice(1)];
        else if (dist2(a0, b0) <= tol2) merged = [...[...b.points].reverse(), ...a.points.slice(1)];
        if (!merged) continue;
        const first = merged[0]!;
        const last = merged[merged.length - 1]!;
        const isClosed = dist2(first, last) <= tol2;
        const normalized = isClosed ? merged.slice(0, -1) : merged;
        open.splice(j, 1);
        open.splice(i, 1, { name, color, closed: isClosed, points: normalized });
        progress = true;
        break outer;
      }
    }
  }
  const polylines = [...closedPolys, ...open];
  return { polylines, segments: segmentPairs };
}

function buildContextPrimitives(ctx: ReturnType<typeof buildGeometryContext>): PrimitiveSolid[] {
  const out: PrimitiveSolid[] = [];
  for (const [name, body] of ctx.bodies) {
    if (!ctx.bodyParams.has(name)) continue;
    const primitive = buildPrimitive(body.bodyType, body.name, body.params, ctx.vars, body.scope);
    if (primitive) out.push(primitive);
  }
  return out;
}

function buildNeighborZonePolylines(
  ctx: ReturnType<typeof buildGeometryContext>,
  axis: SliceAxis,
  position: number,
  zoneBbox: BoundingBox,
  zoneBodyNames: Set<string>,
  _quality: "rough" | "draft" | "full"
): Array<{
  name: string;
  color: string;
  closed: boolean;
  points: Array<{ u: number; v: number }>;
  highlight?: boolean;
  frame?: boolean;
}> {
  const scenePrimitives = buildContextPrimitives(ctx).filter((p) => !zoneBodyNames.has(p.name));
  if (!scenePrimitives.length) return [];
  // Без лимита count/gap: все тела scope, кроме тел самой зоны; альфа по дистанции.
  const neighbors = selectNearbyBodiesWithGap(zoneBbox, scenePrimitives, {});
  if (!neighbors.length) return [];
  let fadeScale = 0;
  for (const { body: n } of neighbors) fadeScale = Math.max(fadeScale, neighborFadeDistance(zoneBbox, n));
  fadeScale = Math.max(fadeScale, 1e-6);
  const meshes = neighbors
    .map(({ body: n }) => {
      const color = neighborColorByGap(neighborFadeDistance(zoneBbox, n), fadeScale);
      const m = bodyToMeshDescriptor({ ...n, color }, zoneBbox);
      return m ? { ...m, color, frame: false as const } : null;
    })
    .filter((m): m is NonNullable<typeof m> => !!m);
  if (!meshes.length) return [];
  const focusPoint =
    axis === "z"
      ? { min: { x: 0, y: 0, z: position }, max: { x: 0, y: 0, z: position } }
      : axis === "y"
        ? { min: { x: 0, y: position, z: 0 }, max: { x: 0, y: position, z: 0 } }
        : { min: { x: position, y: 0, z: 0 }, max: { x: position, y: 0, z: 0 } };
  const slices = buildBodySlices(meshes, "__zone_neighbors__", focusPoint, zoneBbox);
  const picked = slices.find((s) => s.axis === axis);
  return (picked?.polylines ?? []).map((pl) => ({ ...pl, highlight: false, frame: false }));
}

function buildZoneSlice(
  ctx: ReturnType<typeof buildGeometryContext>,
  zone: ZoneNode,
  axis: SliceAxis,
  position: number,
  bbox: BoundingBox,
  resolution: number,
  zoneMeta: SliceZoneMeta,
  primitives: ZonePrimitiveInfo[],
  warnings: string[],
  zoneBodyNames: Set<string>,
  quality: "rough" | "draft" | "full"
): LiveZonePreviewSlice {
  const rawBounds = axisBounds(axis, bbox);
  const gridSize = computeAdaptiveGridSize(axis, bbox, primitives, resolution, quality);
  const bounds = padSliceBounds(rawBounds, gridSize.targetStep);
  const expr = parseZoneExpression(zone.expression);
  if (gridSize.capped) {
    warnings.push(
      `Сечение ${axis.toUpperCase()}: adaptive grid упёрлась в лимит ${Math.max(gridSize.cols, gridSize.rows)} ячеек по оси.`
    );
  }
  const vertexField = buildVertexField(ctx, expr, axis, position, bounds, gridSize.rows, gridSize.cols);
  // Occupancy без повторного point-in-body: углы уже в vertexField.
  // Webview рисует polylines; grid нужен тестам, debug и fallback-заливке.
  const grid = occupancyGridFromVertexField(vertexField);
  const { polylines } = buildMarchingPolylines(vertexField, bounds, zone.name, zoneMeta.color);
  const neighborPolylines = buildNeighborZonePolylines(ctx, axis, position, bbox, zoneBodyNames, quality);
  const labels =
    axis === "z"
      ? { title: `XY · z=${position.toFixed(3)}`, uLabel: "X", vLabel: "Y" }
      : axis === "y"
        ? { title: `XZ · y=${position.toFixed(3)}`, uLabel: "X", vLabel: "Z" }
        : { title: `YZ · x=${position.toFixed(3)}`, uLabel: "Y", vLabel: "Z" };
  return {
    axis,
    position,
    resolution: Math.max(gridSize.rows, gridSize.cols),
    bounds,
    grid,
    zonePreview: true,
    polylines: [...neighborPolylines, ...polylines],
    zoneIndex: [
      { index: 0, name: "(вне зоны)", color: "#1e1e2e" },
      zoneMeta,
    ],
    debugGrid: {
      rows: gridSize.rows,
      cols: gridSize.cols,
      step: gridSize.targetStep,
      capped: gridSize.capped,
      primitiveCount: gridSize.primitiveCount,
      minFeature: gridSize.minFeature,
      refsFound: (zoneMeta as any)._refsFound ?? 0,
      matchedInCtx: (zoneMeta as any)._matchedInCtx ?? 0,
    },
    ...labels,
  };
}

export function buildLiveZonePreview(
  ast: DocumentAst,
  options: {
    zoneName: string;
    scope?: string;
    resolution?: number;
    quality?: "rough" | "draft" | "full";
    slicePositions?: Partial<{ x: number; y: number; z: number }>;
  }
): LiveZonePreviewResult | null {
  const quality = options.quality ?? "full";
  const scope = options.scope ?? "global";
  let ctx = buildGeometryContext(ast, inScopeFilter(scope));
  let zone = ctx.zones.find((z) => z.name.toUpperCase() === options.zoneName.toUpperCase());
  if (!zone) return null;
  const warnings: string[] = [];
  let resolved = computeZoneBbox(ctx, zone);
  let bbox = resolved.bbox;
  if (!bbox) return null;
  // Если тела из zone.expression не находятся в текущем scope-фильтре — расширяем контекст
  // тел, но зону оставляем ту же (имя+scope), иначе дубли GROU/CLAD схватят чужой LCELL.
  if (resolved.matchedInCtx === 0 && scope !== "global") {
    const ctxAll = buildGeometryContext(ast, () => true);
    const zoneScope = zone.scope ?? "global";
    const zoneAll = ctxAll.zones.find(
      (z) =>
        z.name.toUpperCase() === options.zoneName.toUpperCase() &&
        (z.scope ?? "global") === zoneScope
    );
    if (zoneAll) {
      ctx = ctxAll;
      zone = zoneAll;
      const resolvedAll = computeZoneBbox(ctx, zone);
      if (resolvedAll.bbox) {
        resolved = resolvedAll;
        bbox = resolvedAll.bbox;
        warnings.push(
          "Для построения live preview пришлось расширить scope контекста: тела из zone.expression не найдены в текущем scope."
        );
      }
    }
  }
  if (resolved.usedFallback) {
    warnings.push("Рамка зоны взята по всему текущему scope, потому что не удалось вывести её только из ссылок выражения.");
  }
  const zoneBodyNames = new Set<string>(resolved.primitives.map((p) => p.solid.name));
  const reg = getResolvedZoneNumbers(ctx.zoneReg, zone);
  const zoneMeta: SliceZoneMeta = {
    index: 1,
    name: zone.name,
    color: colorForZone(0),
    materialNum: reg?.materialNum,
    regNum: reg?.regNum,
    objNum: reg?.objNum,
  };
  (zoneMeta as any)._refsFound = resolved.refsFound;
  (zoneMeta as any)._matchedInCtx = resolved.matchedInCtx;
  const center = {
    x: (bbox.min.x + bbox.max.x) / 2,
    y: (bbox.min.y + bbox.max.y) / 2,
    z: (bbox.min.z + bbox.max.z) / 2,
  };
  const plane = {
    x: Math.max(bbox.min.x, Math.min(bbox.max.x, options.slicePositions?.x ?? center.x)),
    y: Math.max(bbox.min.y, Math.min(bbox.max.y, options.slicePositions?.y ?? center.y)),
    z: Math.max(bbox.min.z, Math.min(bbox.max.z, options.slicePositions?.z ?? center.z)),
  };
  const resolution = Math.max(24, Math.min(192, Math.round(options.resolution ?? 96)));
  return {
    zoneName: zone.name,
    expression: zone.expression,
    scope,
    quality,
    warnings,
    bbox,
    slices: [
      buildZoneSlice(ctx, zone, "z", plane.z, bbox, resolution, zoneMeta, resolved.primitives, warnings, zoneBodyNames, quality),
      buildZoneSlice(ctx, zone, "y", plane.y, bbox, resolution, zoneMeta, resolved.primitives, warnings, zoneBodyNames, quality),
      buildZoneSlice(ctx, zone, "x", plane.x, bbox, resolution, zoneMeta, resolved.primitives, warnings, zoneBodyNames, quality),
    ],
  };
}
