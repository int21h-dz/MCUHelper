"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGltlPlacements = parseGltlPlacements;
exports.translatePoint = translatePoint;
exports.latticeHostZones = latticeHostZones;
const mcu_language_1 = require("@mcuhelper/mcu-language");
/** Парсинг PARM для генератора GLTL: [/n] x,y,z с пропуском /RZG, /2 и т.п. */
function parseGltlPlacements(lattice, vars) {
    const text = lattice.positions.join(" ");
    if (!text.trim())
        return [];
    const placements = [];
    let pendingProto = 1;
    const tokens = text.replace(/,/g, " ").trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length) {
        const tok = tokens[i];
        if (/^\/\d+$/.test(tok)) {
            pendingProto = parseInt(tok.slice(1), 10) || 1;
            i++;
            continue;
        }
        if (/^\/[A-Za-z]/.test(tok) || tok === "/2" || tok === "/3") {
            i++;
            while (i < tokens.length && !/^\/\d+$/.test(tokens[i]) && !looksLikeNumber(tokens[i])) {
                i++;
            }
            continue;
        }
        const nums = readNumericTriple(tokens, i, vars);
        if (!nums) {
            i++;
            continue;
        }
        placements.push({
            protoIndex: pendingProto,
            offset: { x: nums[0], y: nums[1], z: nums[2] },
        });
        pendingProto = 1;
        i = nums.next;
    }
    return placements;
}
function looksLikeNumber(s) {
    return /^[-+]?(\d+|\d*\.\d+)([eE][-+]?\d+)?$/.test(s) || /^[A-Za-z]/.test(s);
}
function readNumericTriple(tokens, start, vars) {
    const chunk = [];
    let i = start;
    while (i < tokens.length && chunk.length < 3) {
        if (/^\/\d+$/.test(tokens[i]) || /^\/[A-Za-z]/.test(tokens[i]))
            break;
        chunk.push(tokens[i]);
        i++;
    }
    if (chunk.length === 0)
        return null;
    const nums = (0, mcu_language_1.parseNumbers)(chunk, vars);
    if (nums.length >= 3) {
        return { 0: nums[0], 1: nums[1], 2: nums[2], next: i };
    }
    return null;
}
function translatePoint(p, dx, dy, dz) {
    return { x: p.x - dx, y: p.y - dy, z: p.z - dz };
}
function latticeHostZones(lat) {
    if (lat.zoneNames?.length)
        return lat.zoneNames;
    return lat.zoneName ? [lat.zoneName] : [];
}
//# sourceMappingURL=gltl.js.map