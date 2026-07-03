"use strict";
/** Правильная шестиугольная призма MCU-NR (HEX): плоскость OXY, ось OZ. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hexFlatToFlat = hexFlatToFlat;
exports.hexKeyAngle = hexKeyAngle;
exports.pointInRegularHexXY = pointInRegularHexXY;
exports.hexBboxXY = hexBboxXY;
function hexFlatToFlat(vx, vy) {
    return Math.sqrt(vx * vx + vy * vy) || 0;
}
function hexKeyAngle(vx, vy) {
    if (Math.abs(vx) < 1e-12 && Math.abs(vy) < 1e-12)
        return 0;
    return Math.atan2(vy, vx);
}
/**
 * Точка в правильном шестиугольнике: D — размер «под ключ» (|V_xy|),
 * φ — направление вектора ключа в плоскости OXY.
 */
function pointInRegularHexXY(px, py, cx, cy, D, phi) {
    if (D <= 0)
        return false;
    const lx = px - cx;
    const ly = py - cy;
    const cos = Math.cos(-phi);
    const sin = Math.sin(-phi);
    const u = lx * cos - ly * sin;
    const v = lx * sin + ly * cos;
    const half = D / 2;
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 6 + i * (Math.PI / 3);
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        if (u * nx + v * ny > half + 1e-9)
            return false;
    }
    return true;
}
function hexBboxXY(cx, cy, D, phi) {
    const R = D / Math.sqrt(3);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 6; i++) {
        const a = phi + i * (Math.PI / 3);
        const x = cx + R * Math.cos(a);
        const y = cy + R * Math.sin(a);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }
    return { minX, maxX, minY, maxY };
}
//# sourceMappingURL=hex2d.js.map