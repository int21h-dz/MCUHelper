"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cellPitchFromContainer = cellPitchFromContainer;
exports.resolveNetCell = resolveNetCell;
exports.findNetCellAtPoint = findNetCellAtPoint;
exports.netPrototypeAt = netPrototypeAt;
exports.findNetForZone = findNetForZone;
exports.netCarrierZones = netCarrierZones;
const mcu_language_1 = require("@mcuhelper/mcu-language");
const primitives_1 = require("./primitives");
/** Векторы шага ячейки сети из контейнера SBOX/RPP первого тела прототипа CELL. */
function cellPitchFromContainer(body, vars) {
    const t = body.bodyType.toUpperCase();
    const nums = (0, mcu_language_1.parseNumbers)(body.params, vars);
    if (t === "SBOX" && nums.length >= 9) {
        return {
            e1: { x: nums[0] ?? 0, y: nums[1] ?? 0, z: nums[2] ?? 0 },
            e2: { x: nums[3] ?? 0, y: nums[4] ?? 0, z: nums[5] ?? 0 },
            e3: { x: nums[6] ?? 0, y: nums[7] ?? 0, z: nums[8] ?? 0 },
        };
    }
    if (t === "RPP" && nums.length >= 6) {
        return {
            e1: { x: nums[1] - nums[0], y: 0, z: 0 },
            e2: { x: 0, y: nums[3] - nums[2], z: 0 },
            e3: { x: 0, y: 0, z: nums[5] - nums[4] },
        };
    }
    if ((t === "HEX" || t === "HEXX" || t === "HEXY") && nums.length >= 6) {
        const vx = nums[3] ?? 1;
        const vy = nums[4] ?? 0;
        const vz = nums[5] ?? 1;
        return {
            e1: { x: vx, y: vy, z: 0 },
            e2: { x: -vy, y: vx, z: 0 },
            e3: { x: 0, y: 0, z: Math.abs(vz) },
        };
    }
    return null;
}
function solve3x3(e1, e2, e3, lx, ly, lz) {
    const a11 = e1.x, a12 = e2.x, a13 = e3.x;
    const a21 = e1.y, a22 = e2.y, a23 = e3.y;
    const a31 = e1.z, a32 = e2.z, a33 = e3.z;
    const det = a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) + a13 * (a21 * a32 - a22 * a31);
    if (Math.abs(det) < 1e-12)
        return null;
    const inv = 1 / det;
    const u = (lx * (a22 * a33 - a23 * a32) - ly * (a12 * a33 - a13 * a32) + lz * (a12 * a23 - a13 * a22)) * inv;
    const v = (a11 * (ly * a33 - lz * a23) - a21 * (lx * a33 - lz * a13) + a31 * (lx * a23 - ly * a13)) * inv;
    const w = (a11 * (a22 * lz - a23 * ly) - a21 * (a12 * lz - a13 * ly) + a31 * (a12 * a23 - a13 * a22)) * inv;
    return [u, v, w];
}
function referencePrototype(net) {
    for (let j = 1; j <= net.rows; j++) {
        for (let i = 1; i <= net.cols; i++) {
            const p = netPrototypeAt(net, i, j, 1);
            if (p)
                return p;
        }
    }
    return null;
}
/** Найти ячейку сети, содержащую точку p (глобальные координаты). */
function resolveNetCell(ast, net, p) {
    const vars = (0, primitives_1.buildVars)(ast);
    const refProto = referencePrototype(net);
    if (!refProto)
        return null;
    const scope = `cell:${refProto}`;
    const container = ast.bodies.find((b) => b.scope === scope);
    if (!container)
        return null;
    const pitch = cellPitchFromContainer(container, vars);
    if (!pitch)
        return null;
    const rootParts = (0, mcu_language_1.parseNumbers)([net.root], vars);
    const root = { x: rootParts[0] ?? 0, y: rootParts[1] ?? 0, z: rootParts[2] ?? 0 };
    const layers = net.layers ?? 1;
    const solved = solve3x3(pitch.e1, pitch.e2, pitch.e3, p.x - root.x, p.y - root.y, p.z - root.z);
    if (!solved)
        return null;
    const [u, v, w] = solved;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9)
        return null;
    if (u >= net.cols || v >= net.rows || w >= layers)
        return null;
    const i = Math.floor(u) + 1;
    const j = Math.floor(v) + 1;
    const k = Math.floor(w) + 1;
    if (i < 1 || i > net.cols || j < 1 || j > net.rows || k < 1 || k > layers)
        return null;
    const proto = netPrototypeAt(net, i, j, k);
    if (!proto)
        return null;
    const cellOrigin = {
        x: root.x + (i - 1) * pitch.e1.x + (j - 1) * pitch.e2.x + (k - 1) * pitch.e3.x,
        y: root.y + (i - 1) * pitch.e1.y + (j - 1) * pitch.e2.y + (k - 1) * pitch.e3.y,
        z: root.z + (i - 1) * pitch.e1.z + (j - 1) * pitch.e2.z + (k - 1) * pitch.e3.z,
    };
    return {
        net,
        cellIndex: [i, j, k],
        prototype: proto,
        cellOrigin,
        localPoint: { x: p.x - cellOrigin.x, y: p.y - cellOrigin.y, z: p.z - cellOrigin.z },
    };
}
/** @deprecated используйте resolveNetCell */
function findNetCellAtPoint(ast, net, p, _prototypeName) {
    return resolveNetCell(ast, net, p);
}
/** Имя прототипа из картограммы T** (строка j, столбец i — 1-based). */
function netPrototypeAt(net, i, j, k = 1) {
    const row = net.typeMap[j - 1];
    if (!row)
        return null;
    let raw = row[i - 1] ?? row[0];
    if (!raw)
        return null;
    raw = raw.replace(/^\d+\*/, "");
    if (raw.startsWith("-"))
        raw = raw.slice(1);
    if (raw === "0")
        return null;
    return raw;
}
function findNetForZone(ast, netName) {
    return ast.nets.find((n) => n.name === netName);
}
function netCarrierZones(ast) {
    return ast.zones.filter((z) => isGlobalScope(z.scope) && z.netCarrier);
}
function isGlobalScope(scope) {
    return !scope || scope === "global";
}
//# sourceMappingURL=netQuery.js.map