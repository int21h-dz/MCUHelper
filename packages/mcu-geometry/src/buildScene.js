"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScene = buildScene;
exports.sliceAtZ = sliceAtZ;
const mcu_language_1 = require("@mcuhelper/mcu-language");
const colors_1 = require("./colors");
const primitives_1 = require("./primitives");
const zoneExpression_1 = require("./zoneExpression");
function bodyZoneHint(bodyName, zones) {
    const matches = zones.filter((z) => z.bodyRefs.includes(bodyName));
    if (matches.length === 1)
        return matches[0].name;
    return undefined;
}
function buildScene(ast) {
    const vars = (0, primitives_1.buildVars)(ast);
    const primitives = [];
    let sceneBbox = (0, primitives_1.emptyBbox)();
    let first = true;
    for (const b of ast.bodies) {
        if (!(0, primitives_1.isGlobalScope)(b.scope))
            continue;
        const p = (0, primitives_1.buildPrimitive)(b.bodyType, b.name, b.params, vars, b.scope);
        if (p) {
            primitives.push(p);
            sceneBbox = first ? p.bbox : (0, primitives_1.bboxUnion)(sceneBbox, p.bbox);
            first = false;
        }
    }
    const zoneReg = (0, mcu_language_1.buildZoneRegistrationMap)(ast.zones);
    const zones = ast.zones
        .filter((z) => (0, primitives_1.isGlobalScope)(z.scope))
        .map((z, idx) => {
        const r = zoneReg.get(z.name);
        const parsedExpression = (0, zoneExpression_1.parseZoneExpression)(z.expression) ?? undefined;
        const bodyRefs = parsedExpression ? (0, zoneExpression_1.collectBodyRefs)(parsedExpression) : [];
        return {
            name: z.name,
            expression: z.expression,
            materialNum: r?.materialNum,
            regNum: r?.regNum,
            objNum: r?.objNum,
            bodyRefs,
            color: (0, colors_1.colorForZone)(idx),
            scope: z.scope,
            parsedExpression,
        };
    });
    for (const p of primitives) {
        const hint = bodyZoneHint(p.name, zones);
        p.zoneHint = hint;
        p.color = hint
            ? zones.find((z) => z.name === hint)?.color ?? (0, colors_1.colorForBody)(p.name)
            : (0, colors_1.colorForBody)(p.name);
    }
    const materials = ast.materials.map((m) => ({
        number: m.number,
        nuclides: m.nuclides.map((n) => ({ name: n.name, density: n.density })),
        temperature: m.temperature,
    }));
    const nets = [];
    for (const net of ast.nets) {
        const rootParts = (0, mcu_language_1.parseNumbers)([net.root], vars);
        const origin = { x: rootParts[0] ?? 0, y: rootParts[1] ?? 0, z: rootParts[2] ?? 0 };
        for (let j = 0; j < net.rows; j++) {
            for (let i = 0; i < net.cols; i++) {
                const proto = net.typeMap[j]?.[i] ?? net.typeMap[0]?.[0] ?? "A";
                nets.push({
                    netName: net.name,
                    cellIndex: [i + 1, j + 1, 1],
                    prototype: proto,
                    origin: { x: origin.x + i * 2, y: origin.y + j * 2, z: origin.z },
                    zones: zones.filter((zn) => zn.name.includes(proto)),
                });
            }
        }
    }
    const lattices = ast.lattices.map((lat) => ({
        latticeName: lat.latticeType,
        elementName: lat.elements[0] ?? "",
        transform: [],
        zones: zones.filter((zn) => (lat.zoneNames?.length ? lat.zoneNames : [lat.zoneName]).includes(zn.name)),
    }));
    if (first) {
        sceneBbox = { min: { x: -10, y: -10, z: -10 }, max: { x: 10, y: 10, z: 10 } };
    }
    return {
        primitives,
        zones,
        nets,
        lattices,
        bbox: sceneBbox,
        cameraPresets: ast.cameraPresets,
        materials,
        activeScope: "global",
    };
}
/** @deprecated Используйте buildSliceGrid из query.ts */
function sliceAtZ(scene, z) {
    const shapes = [];
    for (const p of scene.primitives) {
        if (z < p.bbox.min.z || z > p.bbox.max.z)
            continue;
        const col = p.color ?? "#6699cc";
        if (p.type === "RCZ" || p.type === "SPH") {
            const [cx, cy] = p.params;
            const rr = p.type === "RCZ" ? (p.params[4] ?? 1) : p.params[3];
            shapes.push({ type: "circle", name: p.name, x: cx, y: cy, r: rr, color: col });
        }
        else if (p.type === "RPP") {
            const [x1, xs, y1, ys] = p.params;
            shapes.push({ type: "rect", name: p.name, x: (x1 + xs) / 2, y: (y1 + ys) / 2, color: col });
        }
    }
    return shapes;
}
//# sourceMappingURL=buildScene.js.map