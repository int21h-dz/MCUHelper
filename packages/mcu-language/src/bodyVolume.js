"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatBodyVolumeCm3 = formatBodyVolumeCm3;
exports.computeBodyVolumeCm3 = computeBodyVolumeCm3;
exports.computeBodyVolumeCm3FromAst = computeBodyVolumeCm3FromAst;
const expression_1 = require("./expression");
/** Площадь правильного шестиугольника по размеру «под ключ» D (расстояние между противоположными гранями), см². */
const HEX_AREA_FROM_KEY = Math.sqrt(3) / 2;
function buildVars(ast) {
    const vars = new Map();
    for (const c of ast.constants) {
        const v = (0, expression_1.evaluateExpression)(c.expression, vars);
        if (v !== null)
            vars.set(c.name, v);
    }
    return vars;
}
function parallelepipedVolume(e1x, e1y, e1z, e2x, e2y, e2z, e3x, e3y, e3z) {
    const det = e1x * (e2y * e3z - e2z * e3y) -
        e1y * (e2x * e3z - e2z * e3x) +
        e1z * (e2x * e3y - e2y * e3x);
    return Math.abs(det);
}
function formatBodyVolumeCm3(volume) {
    if (!Number.isFinite(volume) || volume <= 0)
        return "—";
    if (volume >= 0.01 && volume < 1e9)
        return `${volume.toPrecision(4)} см³`;
    return `${volume.toExponential(4)} см³`;
}
/**
 * Объём тела (см³) по аналитическим формулам UserGuide §9.1.3.
 * Полупространства (PLX/PLY/PLZ/PLG), бесконечные цилиндры (UC*) — null.
 */
function computeBodyVolumeCm3(body, vars, siblings) {
    const t = body.bodyType.toUpperCase();
    if (t === "TRANSF") {
        if (!body.protoName || !siblings?.length)
            return null;
        const proto = siblings.find((b) => b.name.toUpperCase() === body.protoName.toUpperCase() &&
            b.scope === body.scope &&
            b.bodyType.toUpperCase() !== "TRANSF");
        return proto ? computeBodyVolumeCm3(proto, vars, siblings) : null;
    }
    const nums = (0, expression_1.parseNumbers)(body.params, vars);
    switch (t) {
        case "RPP":
            if (nums.length < 6)
                return null;
            return (Math.abs(nums[1] - nums[0]) * Math.abs(nums[3] - nums[2]) * Math.abs(nums[5] - nums[4]));
        case "RCZ":
            if (nums.length < 5)
                return null;
            return Math.PI * nums[4] * nums[4] * Math.abs(nums[3]);
        case "SPH":
            if (nums.length < 4)
                return null;
            return (4 / 3) * Math.PI * Math.abs(nums[3]) ** 3;
        case "RCC": {
            if (nums.length < 7)
                return null;
            const h = Math.hypot(nums[3], nums[4], nums[5]);
            return Math.PI * nums[6] * nums[6] * h;
        }
        case "HEX": {
            if (nums.length < 6)
                return null;
            const dKey = Math.hypot(nums[3], nums[4]);
            return HEX_AREA_FROM_KEY * dKey * dKey * Math.abs(nums[5]);
        }
        case "HEXX":
        case "HEXY":
            if (nums.length < 5)
                return null;
            return HEX_AREA_FROM_KEY * nums[4] * nums[4] * Math.abs(nums[3]);
        case "SHEX":
            if (nums.length < 2)
                return null;
            return HEX_AREA_FROM_KEY * nums[0] * nums[0] * Math.abs(nums[1]);
        case "BOX":
            if (nums.length < 12)
                return null;
            return parallelepipedVolume(nums[3], nums[4], nums[5], nums[6], nums[7], nums[8], nums[9], nums[10], nums[11]);
        case "SBOX":
            if (nums.length < 9)
                return null;
            return parallelepipedVolume(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5], nums[6], nums[7], nums[8]);
        case "TRC": {
            if (nums.length < 8)
                return null;
            const h = Math.hypot(nums[3], nums[4], nums[5]);
            const r1 = Math.abs(nums[6]);
            const r2 = Math.abs(nums[7]);
            return (Math.PI / 3) * h * (r1 * r1 + r1 * r2 + r2 * r2);
        }
        case "REC": {
            if (nums.length < 12)
                return null;
            const h = Math.hypot(nums[3], nums[4], nums[5]);
            const a1 = Math.hypot(nums[6], nums[7], nums[8]);
            const a2 = Math.hypot(nums[9], nums[10], nums[11]);
            return Math.PI * a1 * a2 * h;
        }
        default:
            return null;
    }
}
function computeBodyVolumeCm3FromAst(body, ast) {
    const vars = buildVars(ast);
    return computeBodyVolumeCm3(body, vars, ast.bodies);
}
//# sourceMappingURL=bodyVolume.js.map