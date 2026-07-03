"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGeometryContext = buildGeometryContext;
exports.findBodiesAtPoint = findBodiesAtPoint;
exports.queryPoint = queryPoint;
exports.buildSliceGrid = buildSliceGrid;
exports.computeSceneBbox = computeSceneBbox;
const mcu_language_1 = require("@mcuhelper/mcu-language");
const colors_1 = require("./colors");
const gltl_1 = require("./gltl");
const netQuery_1 = require("./netQuery");
const pointInBody_1 = require("./pointInBody");
const primitives_1 = require("./primitives");
const bodyRefs_1 = require("./bodyRefs");
const zoneExpression_1 = require("./zoneExpression");
function buildGeometryContext(ast, scopeFilter) {
    const vars = (0, primitives_1.buildVars)(ast);
    const filter = scopeFilter ?? primitives_1.isGlobalScope;
    const bodies = new Map();
    const bodyParams = new Map();
    const bodyOrder = [];
    let scope;
    for (const b of ast.bodies) {
        if (!filter(b.scope))
            continue;
        if (b.scope && b.scope !== "global")
            scope = b.scope;
        bodyOrder.push(b.name);
        bodies.set(b.name, b);
        bodyParams.set(b.name, (0, mcu_language_1.parseNumbers)(b.params, vars));
    }
    const zones = ast.zones.filter((z) => filter(z.scope));
    const zoneReg = (0, mcu_language_1.buildZoneRegistrationMap)(ast.zones);
    return { ast, vars, bodies, bodyParams, bodyOrder, zones, zoneReg, scope };
}
function scopeFilterFor(scope) {
    return (s) => s === scope;
}
function zoneMeta(z, zoneReg, displayName) {
    const r = zoneReg.get(z.name);
    return {
        materialNum: r?.materialNum,
        regNum: r?.regNum,
        objNum: r?.objNum,
        color: (0, colors_1.colorForMaterial)(r?.materialNum),
        displayName: displayName ?? z.name,
    };
}
function findBodiesAtPoint(ctx, p) {
    const hits = [];
    for (const [name, body] of ctx.bodies) {
        const params = ctx.bodyParams.get(name);
        if (params && (0, pointInBody_1.pointInBodyNode)(body, params, p))
            hits.push(name);
    }
    return hits;
}
function queryZonesInContext(ctx, p, bodyHits, namePrefix = "") {
    const isInBody = (ref) => (0, bodyRefs_1.isBodyRefInHits)(ref, bodyHits, ctx);
    for (const z of ctx.zones) {
        const expr = (0, zoneExpression_1.parseZoneExpression)(z.expression);
        if (!expr)
            continue;
        if (!(0, zoneExpression_1.evalZoneExpr)(expr, isInBody))
            continue;
        const displayName = namePrefix ? `${namePrefix}${z.name}` : z.name;
        const meta = zoneMeta(z, ctx.zoneReg, displayName);
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
function isInGlobalZone(ctx, p, zoneName) {
    const z = ctx.zones.find((zn) => zn.name === zoneName);
    if (!z)
        return false;
    const bodyHits = findBodiesAtPoint(ctx, p);
    const isInBody = (ref) => (0, bodyRefs_1.isBodyRefInHits)(ref, bodyHits, ctx);
    const expr = (0, zoneExpression_1.parseZoneExpression)(z.expression);
    if (!expr)
        return false;
    return (0, zoneExpression_1.evalZoneExpr)(expr, isInBody);
}
function queryLatticeAtPoint(ast, globalCtx, p) {
    for (const lat of ast.lattices) {
        if (lat.latticeType.toUpperCase() !== "GLTL")
            continue;
        const hosts = (0, gltl_1.latticeHostZones)(lat);
        if (!hosts.some((h) => isInGlobalZone(globalCtx, p, h)))
            continue;
        const placements = (0, gltl_1.parseGltlPlacements)(lat, globalCtx.vars);
        for (const pl of placements) {
            const elName = lat.elements[pl.protoIndex - 1];
            if (!elName)
                continue;
            const scope = `lcell:${elName}`;
            const lctx = buildGeometryContext(ast, scopeFilterFor(scope));
            if (lctx.bodies.size === 0)
                continue;
            const localP = (0, gltl_1.translatePoint)(p, pl.offset.x, pl.offset.y, pl.offset.z);
            const bodyHits = findBodiesAtPoint(lctx, localP);
            if (bodyHits.length === 0)
                continue;
            const hit = queryZonesInContext(lctx, p, bodyHits, `${elName}.`);
            if (hit)
                return hit;
        }
    }
    return null;
}
function queryNetAtPoint(ast, globalCtx, p) {
    const bodyHits = findBodiesAtPoint(globalCtx, p);
    const isInBody = (ref) => (0, bodyRefs_1.isBodyRefInHits)(ref, bodyHits, globalCtx);
    for (const carrier of globalCtx.zones) {
        if (!carrier.netCarrier)
            continue;
        const expr = (0, zoneExpression_1.parseZoneExpression)(carrier.expression);
        if (!expr || !(0, zoneExpression_1.evalZoneExpr)(expr, isInBody))
            continue;
        const net = (0, netQuery_1.findNetForZone)(ast, carrier.netCarrier);
        if (!net)
            continue;
        const cellHit = (0, netQuery_1.resolveNetCell)(ast, net, p);
        if (!cellHit)
            continue;
        const scope = `cell:${cellHit.prototype}`;
        const cctx = buildGeometryContext(ast, scopeFilterFor(scope));
        if (cctx.bodies.size === 0)
            continue;
        const localHits = findBodiesAtPoint(cctx, cellHit.localPoint);
        if (localHits.length === 0)
            continue;
        const [i, j, k] = cellHit.cellIndex;
        const prefix = `${net.name}[${i},${j}${k > 1 ? `,${k}` : ""}].`;
        const hit = queryZonesInContext(cctx, p, localHits, prefix);
        if (hit)
            return hit;
    }
    return null;
}
function queryGlobalZoneAtPoint(ctx, p) {
    const bodyHits = findBodiesAtPoint(ctx, p);
    const isInBody = (ref) => (0, bodyRefs_1.isBodyRefInHits)(ref, bodyHits, ctx);
    for (const z of ctx.zones) {
        if (z.netCarrier)
            continue;
        const expr = (0, zoneExpression_1.parseZoneExpression)(z.expression);
        if (!expr)
            continue;
        if (!(0, zoneExpression_1.evalZoneExpr)(expr, isInBody))
            continue;
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
function queryPoint(ast, p) {
    const globalCtx = buildGeometryContext(ast);
    const latticeHit = queryLatticeAtPoint(ast, globalCtx, p);
    if (latticeHit)
        return latticeHit;
    const netHit = queryNetAtPoint(ast, globalCtx, p);
    if (netHit)
        return netHit;
    const globalHit = queryGlobalZoneAtPoint(globalCtx, p);
    if (globalHit)
        return globalHit;
    return { point: p, bodyHits: findBodiesAtPoint(globalCtx, p) };
}
function axisBounds(axis, bbox) {
    if (axis === "z") {
        return { uMin: bbox.min.x, uMax: bbox.max.x, vMin: bbox.min.y, vMax: bbox.max.y };
    }
    if (axis === "y") {
        return { uMin: bbox.min.x, uMax: bbox.max.x, vMin: bbox.min.z, vMax: bbox.max.z };
    }
    return { uMin: bbox.min.y, uMax: bbox.max.y, vMin: bbox.min.z, vMax: bbox.max.z };
}
function gridToPoint(axis, position, u, v) {
    if (axis === "z")
        return { x: u, y: v, z: position };
    if (axis === "y")
        return { x: u, y: position, z: v };
    return { x: position, y: u, z: v };
}
function buildSliceGrid(ast, axis, position, resolution = 256, bbox) {
    const sceneBbox = bbox ?? computeSceneBbox(ast);
    const bounds = axisBounds(axis, sceneBbox);
    const zoneIndex = [{ index: 0, name: "(вне зон)", color: "#1e1e2e" }];
    const zoneMap = new Map();
    const ensureZoneIndex = (name, materialNum) => {
        if (zoneMap.has(name))
            return zoneMap.get(name);
        const idx = zoneIndex.length;
        zoneMap.set(name, idx);
        zoneIndex.push({
            index: idx,
            name,
            color: (0, colors_1.colorForZone)(idx - 1),
            materialNum,
        });
        return idx;
    };
    const grid = [];
    const du = (bounds.uMax - bounds.uMin) / resolution;
    const dv = (bounds.vMax - bounds.vMin) / resolution;
    for (let row = 0; row < resolution; row++) {
        const line = [];
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
function translateBbox(bbox, dx, dy, dz) {
    return {
        min: { x: bbox.min.x + dx, y: bbox.min.y + dy, z: bbox.min.z + dz },
        max: { x: bbox.max.x + dx, y: bbox.max.y + dy, z: bbox.max.z + dz },
    };
}
function scopedBbox(ast, scope) {
    const vars = (0, primitives_1.buildVars)(ast);
    let bb = (0, primitives_1.emptyBbox)();
    let first = true;
    for (const b of ast.bodies) {
        if (b.scope !== scope)
            continue;
        const p = (0, primitives_1.buildPrimitive)(b.bodyType, b.name, b.params, vars, b.scope);
        if (!p)
            continue;
        bb = first ? p.bbox : (0, primitives_1.bboxUnion)(bb, p.bbox);
        first = false;
    }
    return first ? null : bb;
}
function computeSceneBbox(ast) {
    const vars = (0, primitives_1.buildVars)(ast);
    let sceneBbox = (0, primitives_1.emptyBbox)();
    let first = true;
    for (const b of ast.bodies) {
        if (!(0, primitives_1.isGlobalScope)(b.scope))
            continue;
        const p = (0, primitives_1.buildPrimitive)(b.bodyType, b.name, b.params, vars, b.scope);
        if (p) {
            sceneBbox = first ? p.bbox : (0, primitives_1.bboxUnion)(sceneBbox, p.bbox);
            first = false;
        }
    }
    for (const lat of ast.lattices) {
        if (lat.latticeType.toUpperCase() !== "GLTL")
            continue;
        const placements = (0, gltl_1.parseGltlPlacements)(lat, vars);
        for (const pl of placements) {
            const elName = lat.elements[pl.protoIndex - 1];
            if (!elName)
                continue;
            const bb = scopedBbox(ast, `lcell:${elName}`);
            if (!bb)
                continue;
            const shifted = translateBbox(bb, pl.offset.x, pl.offset.y, pl.offset.z);
            sceneBbox = first ? shifted : (0, primitives_1.bboxUnion)(sceneBbox, shifted);
            first = false;
        }
    }
    for (const net of ast.nets) {
        let refProto = null;
        let refBb = null;
        for (let j = 1; j <= net.rows && !refProto; j++) {
            for (let i = 1; i <= net.cols && !refProto; i++) {
                const proto = (0, netQuery_1.netPrototypeAt)(net, i, j, 1);
                if (proto) {
                    refProto = proto;
                    refBb = scopedBbox(ast, `cell:${proto}`);
                }
            }
        }
        if (!refProto || !refBb)
            continue;
        const container = ast.bodies.find((b) => b.scope === `cell:${refProto}`);
        const pitch = container ? (0, netQuery_1.cellPitchFromContainer)(container, vars) : null;
        if (!pitch)
            continue;
        const rootParts = (0, mcu_language_1.parseNumbers)([net.root], vars);
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
                    sceneBbox = first ? shifted : (0, primitives_1.bboxUnion)(sceneBbox, shifted);
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
//# sourceMappingURL=query.js.map