"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyBbox = emptyBbox;
exports.bboxUnion = bboxUnion;
exports.buildPrimitive = buildPrimitive;
exports.buildVars = buildVars;
exports.isGlobalScope = isGlobalScope;
const mcu_language_1 = require("@mcuhelper/mcu-language");
const hex2d_1 = require("./hex2d");
function emptyBbox() {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
}
function bboxUnion(a, b) {
    return {
        min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
        max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
    };
}
function bboxFromRpp(nums) {
    return {
        min: { x: nums[0], y: nums[2], z: nums[4] },
        max: { x: nums[1], y: nums[3], z: nums[5] },
    };
}
function bboxFromRcz(nums) {
    const [x, y, z, h, r] = nums;
    return {
        min: { x: x - r, y: y - r, z },
        max: { x: x + r, y: y + r, z: z + h },
    };
}
function bboxFromSph(nums) {
    const [x, y, z, r] = nums;
    return {
        min: { x: x - r, y: y - r, z: z - r },
        max: { x: x + r, y: y + r, z: z + r },
    };
}
function bboxFromHex(nums, bodyType) {
    const cx = nums[0] ?? 0;
    const cy = nums[1] ?? 0;
    const cz = nums[2] ?? 0;
    const t = bodyType.toUpperCase();
    let vx;
    let vy;
    let vz;
    if (t === "HEXX" && nums.length >= 5) {
        const h = nums[3] ?? 1;
        const d = nums[4] ?? 1;
        const f = ((nums[5] ?? 0) * Math.PI) / 180;
        vx = d * Math.cos(f);
        vy = d * Math.sin(f);
        vz = h;
    }
    else if (t === "HEXY" && nums.length >= 5) {
        const h = nums[3] ?? 1;
        const d = nums[4] ?? 1;
        const f = ((nums[5] ?? 0) * Math.PI) / 180;
        vx = -d * Math.sin(f);
        vy = d * Math.cos(f);
        vz = h;
    }
    else {
        vx = nums[3] ?? 1;
        vy = nums[4] ?? 0;
        vz = nums[5] ?? 1;
    }
    const D = (0, hex2d_1.hexFlatToFlat)(vx, vy) || 1;
    const phi = (0, hex2d_1.hexKeyAngle)(vx, vy);
    const xy = (0, hex2d_1.hexBboxXY)(cx, cy, D, phi);
    return {
        min: { x: xy.minX, y: xy.minY, z: cz },
        max: { x: xy.maxX, y: xy.maxY, z: cz + Math.abs(vz) },
    };
}
function buildPrimitive(bodyType, name, params, vars, scope) {
    const nums = (0, mcu_language_1.parseNumbers)(params, vars);
    let bbox = emptyBbox();
    const t = bodyType.toUpperCase();
    if (t === "RPP" && nums.length >= 6)
        bbox = bboxFromRpp(nums);
    else if (t === "RCZ" && nums.length >= 5)
        bbox = bboxFromRcz(nums);
    else if (t === "SPH" && nums.length >= 4)
        bbox = bboxFromSph(nums);
    else if ((t === "HEX" || t === "HEXX" || t === "HEXY") && nums.length >= 3)
        bbox = bboxFromHex(nums, t);
    else if (nums.length >= 2)
        bbox = {
            min: { x: nums[0] - 1, y: nums[1] - 1, z: nums[2] ?? 0 },
            max: { x: nums[0] + 1, y: nums[1] + 1, z: (nums[2] ?? 0) + (nums[3] ?? 1) },
        };
    else
        return null;
    return { type: t, name, params: nums, bbox, scope };
}
function buildVars(ast) {
    const vars = new Map();
    for (const c of ast.constants) {
        const v = (0, mcu_language_1.evaluateExpression)(c.expression, vars);
        if (v !== null)
            vars.set(c.name, v);
    }
    return vars;
}
function isGlobalScope(scope) {
    return !scope || scope === "global";
}
//# sourceMappingURL=primitives.js.map