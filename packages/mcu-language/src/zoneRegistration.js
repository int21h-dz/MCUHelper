"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveZoneTail = resolveZoneTail;
exports.buildZoneRegistrationMap = buildZoneRegistrationMap;
exports.resolveZoneNumbers = resolveZoneNumbers;
/** Разрешение хвоста зоны с учётом кэша reg → mat (формы /reg:mat и /reg[/obj]). */
function resolveZoneTail(tail, regMatCache) {
    if (!tail)
        return null;
    if (tail.kind === "hash") {
        const regNum = tail.z ?? 1;
        const objNum = tail.o ?? 1;
        const materialNum = tail.m;
        if (materialNum != null)
            regMatCache.set(regNum, materialNum);
        return { materialNum, regNum, objNum };
    }
    if (tail.bcType)
        return null;
    if (tail.inheritMat) {
        const regNum = tail.reg;
        const objNum = tail.obj ?? 1;
        const materialNum = regMatCache.get(regNum);
        return { materialNum, regNum, objNum };
    }
    if (tail.defaultRegObj || (tail.mat != null && tail.reg == null)) {
        const materialNum = tail.mat;
        const regNum = 1;
        const objNum = tail.obj ?? 1;
        regMatCache.set(regNum, materialNum);
        return { materialNum, regNum, objNum };
    }
    if (tail.reg != null && tail.mat != null) {
        const regNum = tail.reg;
        const materialNum = tail.mat;
        const objNum = tail.obj ?? 1;
        regMatCache.set(regNum, materialNum);
        return { materialNum, regNum, objNum };
    }
    return null;
}
/** По порядку объявления зон в документе. */
function buildZoneRegistrationMap(zones) {
    const cache = new Map();
    const out = new Map();
    for (const z of zones) {
        const resolved = resolveZoneTail(z.tail, cache);
        if (resolved)
            out.set(z.name, resolved);
    }
    return out;
}
function resolveZoneNumbers(zone, regMatCache) {
    return resolveZoneTail(zone.tail, regMatCache);
}
//# sourceMappingURL=zoneRegistration.js.map