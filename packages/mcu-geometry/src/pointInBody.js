"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pointInBody = pointInBody;
exports.pointInBodyNode = pointInBodyNode;
const hex2d_1 = require("./hex2d");
const EPS = 1e-9;
function le(a, b) {
    return a <= b + EPS;
}
function ge(a, b) {
    return a >= b - EPS;
}
function distSq(ax, ay, az, bx, by, bz) {
    const dx = ax - bx;
    const dy = ay - by;
    const dz = az - bz;
    return dx * dx + dy * dy + dz * dz;
}
function pointInRpp(nums, p) {
    const [x1, xs, y1, ys, z1, zs] = nums;
    return ge(p.x, x1) && le(p.x, xs) && ge(p.y, y1) && le(p.y, ys) && ge(p.z, z1) && le(p.z, zs);
}
function pointInRcz(nums, p) {
    const [cx, cy, cz, h, r] = nums;
    const dx = p.x - cx;
    const dy = p.y - cy;
    if (dx * dx + dy * dy > r * r + EPS)
        return false;
    return ge(p.z, cz) && le(p.z, cz + h);
}
function pointInSph(nums, p) {
    const [cx, cy, cz, r] = nums;
    return distSq(p.x, p.y, p.z, cx, cy, cz) <= r * r + EPS;
}
function pointInHexPrism(nums, p) {
    const cx = nums[0] ?? 0;
    const cy = nums[1] ?? 0;
    const cz = nums[2] ?? 0;
    const vx = nums[3] ?? 1;
    const vy = nums[4] ?? 0;
    const vz = nums[5] ?? 1;
    const zMax = cz + Math.abs(vz);
    if (!ge(p.z, cz) || !le(p.z, zMax))
        return false;
    const D = (0, hex2d_1.hexFlatToFlat)(vx, vy);
    const phi = (0, hex2d_1.hexKeyAngle)(vx, vy);
    return (0, hex2d_1.pointInRegularHexXY)(p.x, p.y, cx, cy, D, phi);
}
function pointInHexxy(nums, p, variant) {
    const cx = nums[0] ?? 0;
    const cy = nums[1] ?? 0;
    const cz = nums[2] ?? 0;
    const h = nums[3] ?? 1;
    const d = nums[4] ?? 1;
    const fDeg = nums[5] ?? 0;
    const f = (fDeg * Math.PI) / 180;
    if (!ge(p.z, cz) || !le(p.z, cz + Math.abs(h)))
        return false;
    let vx;
    let vy;
    if (variant === "x") {
        vx = d * Math.cos(f);
        vy = d * Math.sin(f);
    }
    else {
        vx = -d * Math.sin(f);
        vy = d * Math.cos(f);
    }
    return (0, hex2d_1.pointInRegularHexXY)(p.x, p.y, cx, cy, d, (0, hex2d_1.hexKeyAngle)(vx, vy));
}
function pointInRcc(nums, p) {
    const [x, y, z, dx, dy, dz, r] = nums;
    const lenSq = dx * dx + dy * dy + dz * dz;
    if (lenSq < EPS)
        return distSq(p.x, p.y, p.z, x, y, z) <= r * r + EPS;
    const len = Math.sqrt(lenSq);
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;
    const t = (p.x - x) * ux + (p.y - y) * uy + (p.z - z) * uz;
    if (!ge(t, 0) || !le(t, len))
        return false;
    const px = x + t * ux;
    const py = y + t * uy;
    const pz = z + t * uz;
    return distSq(p.x, p.y, p.z, px, py, pz) <= r * r + EPS;
}
function pointInBox(nums, p) {
    const [x, y, z, e1x, e1y, e1z, e2x, e2y, e2z, e3x, e3y, e3z] = nums;
    const dx = p.x - x;
    const dy = p.y - y;
    const dz = p.z - z;
    const det = e1x * (e2y * e3z - e2z * e3y) -
        e1y * (e2x * e3z - e2z * e3x) +
        e1z * (e2x * e3y - e2y * e3x);
    if (Math.abs(det) < EPS)
        return false;
    const invDet = 1 / det;
    const u = (dx * (e2y * e3z - e2z * e3y) - dy * (e2x * e3z - e2z * e3x) + dz * (e2x * e3y - e2y * e3x)) * invDet;
    const v = (e1x * (dy * e3z - dz * e3y) - e1y * (dx * e3z - dz * e3x) + e1z * (dx * e3y - dy * e3x)) * invDet;
    const w = (e1x * (e2y * dz - e2z * dy) - e1y * (e2x * dz - e2z * dx) + e1z * (e2x * dy - e2y * dx)) * invDet;
    return ge(u, 0) && le(u, 1) && ge(v, 0) && le(v, 1) && ge(w, 0) && le(w, 1);
}
function pointInPlx(nums, p) {
    return ge(p.x, nums[0] ?? 0);
}
function pointInPly(nums, p) {
    return ge(p.y, nums[0] ?? 0);
}
function pointInPlz(nums, p) {
    return ge(p.z, nums[0] ?? 0);
}
function pointInPlg(nums, p) {
    const [nx, ny, nz, q] = nums;
    return nx * p.x + ny * p.y + nz * p.z >= q - EPS;
}
function pointInBody(bodyType, params, p) {
    const t = bodyType.toUpperCase();
    if (t === "RPP" && params.length >= 6)
        return pointInRpp(params, p);
    if (t === "RCZ" && params.length >= 5)
        return pointInRcz(params, p);
    if (t === "SPH" && params.length >= 4)
        return pointInSph(params, p);
    if ((t === "HEX" || t === "HEXX" || t === "HEXY") && params.length >= 3) {
        if (t === "HEXX")
            return pointInHexxy(params, p, "x");
        if (t === "HEXY")
            return pointInHexxy(params, p, "y");
        return pointInHexPrism(params, p);
    }
    if (t === "HEXX" && params.length >= 5)
        return pointInHexxy(params, p, "x");
    if (t === "HEXY" && params.length >= 5)
        return pointInHexxy(params, p, "y");
    if (t === "RCC" && params.length >= 7)
        return pointInRcc(params, p);
    if (t === "BOX" && params.length >= 12)
        return pointInBox(params, p);
    if (t === "PLX" && params.length >= 1)
        return pointInPlx(params, p);
    if (t === "PLY" && params.length >= 1)
        return pointInPly(params, p);
    if (t === "PLZ" && params.length >= 1)
        return pointInPlz(params, p);
    if (t === "PLG" && params.length >= 4)
        return pointInPlg(params, p);
    return false;
}
function pointInBodyNode(body, params, p) {
    return pointInBody(body.bodyType, params, p);
}
//# sourceMappingURL=pointInBody.js.map