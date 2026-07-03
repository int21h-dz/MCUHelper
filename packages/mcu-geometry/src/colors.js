"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PALETTE = void 0;
exports.colorForMaterial = colorForMaterial;
exports.colorForZone = colorForZone;
exports.colorForBody = colorForBody;
const PALETTE = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
    "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990",
];
exports.PALETTE = PALETTE;
const BODY_PALETTE = [
    "#6699cc", "#99cc66", "#cc9966", "#9966cc", "#66cccc",
    "#cc6699", "#cccc66", "#669966", "#6666cc", "#cc6666",
];
function colorForMaterial(n) {
    if (!n)
        return "#888888";
    return PALETTE[(n - 1) % PALETTE.length];
}
function colorForZone(index) {
    return PALETTE[index % PALETTE.length];
}
function colorForBody(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++)
        h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return BODY_PALETTE[h % BODY_PALETTE.length];
}
//# sourceMappingURL=colors.js.map