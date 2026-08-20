import type { BodyNode, DocumentAst, ZoneNode } from "@mcuhelper/mcu-language";

import {
  buildZoneRegistrationMap,
  computeNpmNom,
  getResolvedZoneNumbers,
  maxConditionalIndices,
  parseNumbers,
  resolveZoneNumbersInContext,
} from "@mcuhelper/mcu-language";

import { colorForMaterial, colorForZone } from "./colors";

import { latticeHostZones, parseGltlPlacements, translatePoint } from "./gltl";

import { cellPitchFromContainer, findNetForZone, netPrototypeAt, resolveNetCell } from "./netQuery";

import { pointInBodyNode } from "./pointInBody";

import { bboxUnion, buildPrimitive, buildVars, emptyBbox, isGlobalScope } from "./primitives";

import type { PointQueryResult, SliceAxis, SliceGrid, SliceZoneMeta, Vec3 } from "./types";

import { isBodyRefInHits } from "./bodyRefs";

import { collectBodyRefs, evalZoneExpr, parseZoneExpression } from "./zoneExpression";

import type { ResolvedZoneNumbers } from "@mcuhelper/mcu-language";



export interface GeometryContext {

  ast: DocumentAst;

  vars: Map<string, number>;

  bodies: Map<string, BodyNode>;

  bodyParams: Map<string, number[]>;

  bodyOrder: string[];

  zones: ZoneNode[];

  zoneReg: ReturnType<typeof buildZoneRegistrationMap>;

  scope?: string;

}



export function buildGeometryContext(ast: DocumentAst, scopeFilter?: (scope?: string) => boolean): GeometryContext {

  const vars = buildVars(ast);

  const filter = scopeFilter ?? isGlobalScope;

  const bodies = new Map<string, BodyNode>();

  const bodyParams = new Map<string, number[]>();

  const bodyOrder: string[] = [];

  let scope: string | undefined;



  for (const b of ast.bodies) {

    if (!filter(b.scope)) continue;

    if (b.scope && b.scope !== "global") scope = b.scope;

    bodyOrder.push(b.name);

    bodies.set(b.name, b);

    bodyParams.set(b.name, parseNumbers(b.params, vars));

  }



  const zones = ast.zones.filter((z) => filter(z.scope));

  const zoneReg = buildZoneRegistrationMap(ast.zones);



  return { ast, vars, bodies, bodyParams, bodyOrder, zones, zoneReg, scope };

}



function scopeFilterFor(scope: string): (s?: string) => boolean {

  return (s) => s === scope;

}



function zoneMeta(
  z: ZoneNode,
  zoneReg: ReturnType<typeof buildZoneRegistrationMap>,
  displayName?: string,
  override?: ResolvedZoneNumbers | null
) {
  const r = override ?? getResolvedZoneNumbers(zoneReg, z);
  return {
    materialNum: r?.materialNum,
    regNum: r?.regNum,
    objNum: r?.objNum,
    color: colorForMaterial(r?.materialNum),
    displayName: displayName ?? z.name,
  };
}

/** Npm/Nom перед элементом LISTEL с индексом elementIndex (0-based). */
function latticeNpmNomBeforeElement(ast: DocumentAst, lattice: DocumentAst["lattices"][number], elementIndex: number): {
  npm: number;
  nom: number;
} {
  const globalZones = ast.zones.filter((z) => !z.scope || z.scope === "global");
  let { npm, nom } = computeNpmNom(globalZones);
  for (let ei = 0; ei < elementIndex; ei++) {
    const elName = lattice.elements[ei];
    if (!elName) continue;
    const scope = `lcell:${elName}`;
    const elZones = ast.zones.filter((z) => z.scope === scope);
    const abs = computeNpmNom(elZones);
    if (abs.npm > npm) npm = abs.npm;
    if (abs.nom > nom) nom = abs.nom;
    const { maxUru, maxUou } = maxConditionalIndices(elZones);
    npm += maxUru;
    nom += maxUou;
  }
  return { npm, nom };
}



export function findBodiesAtPoint(ctx: GeometryContext, p: Vec3): string[] {

  const hits: string[] = [];

  for (const [name, body] of ctx.bodies) {

    const params = ctx.bodyParams.get(name);

    if (params && pointInBodyNode(body, params, p)) hits.push(name);

  }

  return hits;

}



function queryZonesInContext(
  ctx: GeometryContext,
  p: Vec3,
  bodyHits: string[],
  namePrefix = "",
  resolveOverride?: (z: ZoneNode) => ResolvedZoneNumbers | null | undefined
): PointQueryResult | null {
  const isInBody = (ref: string) => isBodyRefInHits(ref, bodyHits, ctx);

  for (const z of ctx.zones) {
    const expr = parseZoneExpression(z.expression);
    if (!expr) continue;
    if (!evalZoneExpr(expr, isInBody)) continue;

    const displayName = namePrefix ? `${namePrefix}${z.name}` : z.name;
    const override = resolveOverride?.(z);
    const meta = zoneMeta(z, ctx.zoneReg, displayName, override);
    const material = meta.materialNum
      ? ctx.ast.materials.find((m) => m.number === meta.materialNum)
      : undefined;

    return {
      point: p,
      zone: {
        name: displayName,
        materialNum: meta.materialNum,
        regNum: meta.regNum,
        objNum: meta.objNum,
        expression: z.expression,
        color: meta.color,
      },
      material: material
        ? {
            number: material.number,
            nuclides: material.nuclides.map((n) => ({ name: n.name, density: n.density })),
            temperature: material.temperature,
          }
        : undefined,
      objectNum: meta.objNum,
      bodyHits,
    };
  }
  return null;
}



function isInGlobalZone(ctx: GeometryContext, p: Vec3, zoneName: string): boolean {

  const z = ctx.zones.find((zn) => zn.name === zoneName);

  if (!z) return false;

  const bodyHits = findBodiesAtPoint(ctx, p);

  const isInBody = (ref: string) => isBodyRefInHits(ref, bodyHits, ctx);

  const expr = parseZoneExpression(z.expression);

  if (!expr) return false;

  return evalZoneExpr(expr, isInBody);

}



function queryLatticeAtPoint(ast: DocumentAst, globalCtx: GeometryContext, p: Vec3): PointQueryResult | null {
  for (const lat of ast.lattices) {
    if (lat.latticeType.toUpperCase() !== "GLTL") continue;
    const hosts = latticeHostZones(lat);
    if (!hosts.some((h) => isInGlobalZone(globalCtx, p, h))) continue;

    const placements = parseGltlPlacements(lat, globalCtx.vars);
    for (const pl of placements) {
      const elName = lat.elements[pl.protoIndex - 1];
      if (!elName) continue;

      const scope = `lcell:${elName}`;
      const lctx = buildGeometryContext(ast, scopeFilterFor(scope));
      if (lctx.bodies.size === 0) continue;

      const localP = translatePoint(p, pl.offset.x, pl.offset.y, pl.offset.z);
      const bodyHits = findBodiesAtPoint(lctx, localP);
      if (bodyHits.length === 0) continue;

      const elementIndex = pl.protoIndex - 1;
      const { npm, nom } = latticeNpmNomBeforeElement(ast, lat, elementIndex);
      const cache = new Map<number, number>();
      const hit = queryZonesInContext(lctx, p, bodyHits, `${elName}.`, (z) =>
        resolveZoneNumbersInContext(z, cache, { kind: "lattice", npm, nom })
      );
      if (hit) return hit;
    }
  }
  return null;
}

function queryNetAtPoint(ast: DocumentAst, globalCtx: GeometryContext, p: Vec3): PointQueryResult | null {
  const bodyHits = findBodiesAtPoint(globalCtx, p);
  const isInBody = (ref: string) => isBodyRefInHits(ref, bodyHits, globalCtx);

  for (const carrier of globalCtx.zones) {
    if (!carrier.netCarrier) continue;
    const expr = parseZoneExpression(carrier.expression);
    if (!expr || !evalZoneExpr(expr, isInBody)) continue;

    const net = findNetForZone(ast, carrier.netCarrier);
    if (!net) continue;

    const cellHit = resolveNetCell(ast, net, p);
    if (!cellHit) continue;

    const scope = `cell:${cellHit.prototype}`;
    const cctx = buildGeometryContext(ast, scopeFilterFor(scope));
    if (cctx.bodies.size === 0) continue;

    const localHits = findBodiesAtPoint(cctx, cellHit.localPoint);
    if (localHits.length === 0) continue;

    const [i, j, k] = cellHit.cellIndex;
    const prefix = `${net.name}[${i},${j}${k > 1 ? `,${k}` : ""}].`;
    const cache = new Map<number, number>();
    const hit = queryZonesInContext(cctx, p, localHits, prefix, (z) =>
      resolveZoneNumbersInContext(z, cache, { kind: "net", net, cellIndex: [i, j, k] })
    );
    if (hit) return hit;
  }
  return null;
}



function queryGlobalZoneAtPoint(ctx: GeometryContext, p: Vec3): PointQueryResult | null {

  const bodyHits = findBodiesAtPoint(ctx, p);

  const isInBody = (ref: string) => isBodyRefInHits(ref, bodyHits, ctx);



  for (const z of ctx.zones) {

    if (z.netCarrier) continue;

    const expr = parseZoneExpression(z.expression);

    if (!expr) continue;

    if (!evalZoneExpr(expr, isInBody)) continue;



    const meta = zoneMeta(z, ctx.zoneReg);

    const material = meta.materialNum

      ? ctx.ast.materials.find((m) => m.number === meta.materialNum)

      : undefined;



    return {

      point: p,

      zone: {

        name: z.name,

        materialNum: meta.materialNum,

        regNum: meta.regNum,

        objNum: meta.objNum,

        expression: z.expression,

        color: meta.color,

      },

      material: material

        ? {

            number: material.number,

            nuclides: material.nuclides.map((n) => ({ name: n.name, density: n.density })),

            temperature: material.temperature,

          }

        : undefined,

      objectNum: meta.objNum,

      bodyHits,

    };

  }

  return null;

}



export function queryPoint(ast: DocumentAst, p: Vec3): PointQueryResult {

  const globalCtx = buildGeometryContext(ast);



  const latticeHit = queryLatticeAtPoint(ast, globalCtx, p);

  if (latticeHit) return latticeHit;



  const netHit = queryNetAtPoint(ast, globalCtx, p);

  if (netHit) return netHit;



  const globalHit = queryGlobalZoneAtPoint(globalCtx, p);

  if (globalHit) return globalHit;



  return { point: p, bodyHits: findBodiesAtPoint(globalCtx, p) };

}



function axisBounds(

  axis: SliceAxis,

  bbox: { min: Vec3; max: Vec3 }

): { uMin: number; uMax: number; vMin: number; vMax: number } {

  if (axis === "z") {

    return { uMin: bbox.min.x, uMax: bbox.max.x, vMin: bbox.min.y, vMax: bbox.max.y };

  }

  if (axis === "y") {

    return { uMin: bbox.min.x, uMax: bbox.max.x, vMin: bbox.min.z, vMax: bbox.max.z };

  }

  return { uMin: bbox.min.y, uMax: bbox.max.y, vMin: bbox.min.z, vMax: bbox.max.z };

}



function gridToPoint(axis: SliceAxis, position: number, u: number, v: number): Vec3 {

  if (axis === "z") return { x: u, y: v, z: position };

  if (axis === "y") return { x: u, y: position, z: v };

  return { x: position, y: u, z: v };

}



export function buildSliceGrid(

  ast: DocumentAst,

  axis: SliceAxis,

  position: number,

  resolution = 256,

  bbox?: { min: Vec3; max: Vec3 }

): SliceGrid {

  const sceneBbox = bbox ?? computeSceneBbox(ast);

  const bounds = axisBounds(axis, sceneBbox);

  const zoneIndex: SliceZoneMeta[] = [{ index: 0, name: "(вне зон)", color: "#1e1e2e" }];

  const zoneMap = new Map<string, number>();



  const ensureZoneIndex = (name: string, materialNum?: number) => {

    if (zoneMap.has(name)) return zoneMap.get(name)!;

    const idx = zoneIndex.length;

    zoneMap.set(name, idx);

    zoneIndex.push({

      index: idx,

      name,

      color: colorForZone(idx - 1),

      materialNum,

    });

    return idx;

  };



  const grid: number[][] = [];

  const du = (bounds.uMax - bounds.uMin) / resolution;

  const dv = (bounds.vMax - bounds.vMin) / resolution;



  for (let row = 0; row < resolution; row++) {

    const line: number[] = [];

    const v = bounds.vMax - (row + 0.5) * dv;

    for (let col = 0; col < resolution; col++) {

      const u = bounds.uMin + (col + 0.5) * du;

      const p = gridToPoint(axis, position, u, v);

      const result = queryPoint(ast, p);

      const idx = result.zone ? ensureZoneIndex(result.zone.name, result.zone.materialNum) : 0;

      line.push(idx);

    }

    grid.push(line);

  }



  return { axis, position, resolution, bounds, grid, zoneIndex };

}



function translateBbox(bbox: { min: Vec3; max: Vec3 }, dx: number, dy: number, dz: number) {

  return {

    min: { x: bbox.min.x + dx, y: bbox.min.y + dy, z: bbox.min.z + dz },

    max: { x: bbox.max.x + dx, y: bbox.max.y + dy, z: bbox.max.z + dz },

  };

}



function scopedBbox(ast: DocumentAst, scope: string): { min: Vec3; max: Vec3 } | null {

  const vars = buildVars(ast);

  let bb = emptyBbox();

  let first = true;

  for (const b of ast.bodies) {

    if (b.scope !== scope) continue;

    const p = buildPrimitive(b.bodyType, b.name, b.params, vars, b.scope);

    if (!p) continue;

    bb = first ? p.bbox : bboxUnion(bb, p.bbox);

    first = false;

  }

  return first ? null : bb;

}



export function computeSceneBbox(ast: DocumentAst): { min: Vec3; max: Vec3 } {

  const vars = buildVars(ast);

  let sceneBbox = emptyBbox();

  let first = true;



  for (const b of ast.bodies) {

    if (!isGlobalScope(b.scope)) continue;

    const p = buildPrimitive(b.bodyType, b.name, b.params, vars, b.scope);

    if (p) {

      sceneBbox = first ? p.bbox : bboxUnion(sceneBbox, p.bbox);

      first = false;

    }

  }



  for (const lat of ast.lattices) {

    if (lat.latticeType.toUpperCase() !== "GLTL") continue;

    const placements = parseGltlPlacements(lat, vars);

    for (const pl of placements) {

      const elName = lat.elements[pl.protoIndex - 1];

      if (!elName) continue;

      const bb = scopedBbox(ast, `lcell:${elName}`);

      if (!bb) continue;

      const shifted = translateBbox(bb, pl.offset.x, pl.offset.y, pl.offset.z);

      sceneBbox = first ? shifted : bboxUnion(sceneBbox, shifted);

      first = false;

    }

  }



  for (const net of ast.nets) {
    let refProto: string | null = null;
    let refBb: { min: Vec3; max: Vec3 } | null = null;
    for (let j = 1; j <= net.rows && !refProto; j++) {
      for (let i = 1; i <= net.cols && !refProto; i++) {
        const proto = netPrototypeAt(net, i, j, 1);
        if (proto) {
          refProto = proto;
          refBb = scopedBbox(ast, `cell:${proto}`);
        }
      }
    }
    if (!refProto || !refBb) continue;

    const container = ast.bodies.find((b) => b.scope === `cell:${refProto}`);
    const pitch = container ? cellPitchFromContainer(container, vars) : null;
    if (!pitch) continue;

    const rootParts = parseNumbers([net.root], vars);
    const root = { x: rootParts[0] ?? 0, y: rootParts[1] ?? 0, z: rootParts[2] ?? 0 };
    const layers = net.layers ?? 1;

    for (let k = 1; k <= layers; k++) {
      for (let j = 1; j <= net.rows; j++) {
        for (let i = 1; i <= net.cols; i++) {
          const origin = {
            x: root.x + (i - 1) * pitch.e1.x + (j - 1) * pitch.e2.x + (k - 1) * pitch.e3.x,
            y: root.y + (i - 1) * pitch.e1.y + (j - 1) * pitch.e2.y + (k - 1) * pitch.e3.y,
            z: root.z + (i - 1) * pitch.e1.z + (j - 1) * pitch.e2.z + (k - 1) * pitch.e3.z,
          };
          const shifted = translateBbox(refBb, origin.x, origin.y, origin.z);
          sceneBbox = first ? shifted : bboxUnion(sceneBbox, shifted);
          first = false;
        }
      }
    }
  }



  if (first) {

    return { min: { x: -10, y: -10, z: -10 }, max: { x: 10, y: 10, z: 10 } };

  }

  return sceneBbox;

}


