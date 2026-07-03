"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRAGMENT_ORDER = void 0;
exports.getBodyParamCount = getBodyParamCount;
exports.FRAGMENT_ORDER = [
    "physical",
    "geometry",
    "source",
    "registration",
    "burnupRegistration",
    "trajectory",
    "calculationControl",
    "burnup",
];
const BODY_PARAM_COUNTS = {
    SPH: 4, RCC: 7, RPP: 6, RCZ: 5,
    /** HEX: center (3) + вектор Sx,Hx,Hy (3); HEXX/HEXY: center (3) + H + D + [f] */
    HEX: 6, HEXX: 6, HEXY: 6,
    BOX: 12,
    PLG: 4, PLX: 1, PLY: 1, PLZ: 1, SBOX: 9, SHEX: 3, ARB: "var", QUAD: 10,
};
function getBodyParamCount(key) {
    return BODY_PARAM_COUNTS[key.toUpperCase()];
}
//# sourceMappingURL=constants.js.map