"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCU_NUCLEAR_DENSITY_SCALE = void 0;
exports.mcuNuclideAtomicWeight = mcuNuclideAtomicWeight;
exports.formatMassDensityGcm3 = formatMassDensityGcm3;
exports.computeMaterialMassDensityGcm3 = computeMaterialMassDensityGcm3;
const nuclideIaea_1 = require("./nuclideIaea");
/** MCU-NR: значение dens — ядер/см³ без явного множителя 10²⁴ (UserGuide §8.2). */
exports.MCU_NUCLEAR_DENSITY_SCALE = 1e24;
/** Атомная единица массы, г. */
const ATOMIC_MASS_G = 1.6605390666e-24;
/** Природные средние атомные массы (г/моль), NIST — для элементов без массового числа. */
const NATURAL_ATOMIC_WEIGHT = {
    H: 1.008, D: 2.014, T: 3.016, HE: 4.003, LI: 6.94, BE: 9.012, B: 10.81, C: 12.011, N: 14.007, O: 15.999,
    F: 18.998, NE: 20.18, NA: 22.99, MG: 24.305, AL: 26.982, SI: 28.085, P: 30.974, S: 32.06, CL: 35.45, AR: 39.95,
    K: 39.098, CA: 40.078, SC: 44.956, TI: 47.867, V: 50.942, CR: 51.996, MN: 54.938, FE: 55.845, CO: 58.933,
    NI: 58.693, CU: 63.546, ZN: 65.38, GA: 69.723, GE: 72.63, AS: 74.922, SE: 78.97, BR: 79.904, KR: 83.798,
    RB: 85.468, SR: 87.62, Y: 88.906, ZR: 91.224, NB: 92.906, MO: 95.95, TC: 98, RU: 101.07, RH: 102.91, PD: 106.42,
    AG: 107.87, CD: 112.41, IN: 114.82, SN: 118.71, SB: 121.76, TE: 127.6, I: 126.9, XE: 131.29, CS: 132.91,
    BA: 137.33, LA: 138.91, CE: 140.12, HF: 178.49, TA: 180.95, W: 183.84, RE: 186.21, OS: 190.23, IR: 192.22,
    PT: 195.08, AU: 196.97, PB: 207.2, TH: 232.04, U: 238.029, NP: 237, PU: 244, AM: 243, CM: 247,
};
/** Атомная масса нуклида MCU (г/моль) для расчёта ρ. */
function mcuNuclideAtomicWeight(name) {
    const target = (0, nuclideIaea_1.mcuNuclideToIaeaTarget)(name);
    if (target) {
        const mass = target.match(/-(\d+)$/);
        if (mass)
            return parseInt(mass[1], 10);
    }
    const element = (0, nuclideIaea_1.mcuNuclideToIaeaElement)(name);
    if (element) {
        const key = element.length === 1 ? element : element[0] + element.slice(1).toUpperCase();
        const sym = element.toUpperCase();
        return NATURAL_ATOMIC_WEIGHT[sym] ?? NATURAL_ATOMIC_WEIGHT[key] ?? null;
    }
    const sym = name.trim().toUpperCase().match(/^([A-Z]{1,2})/)?.[1];
    return sym ? NATURAL_ATOMIC_WEIGHT[sym] ?? null : null;
}
function formatMassDensityGcm3(rho) {
    if (!Number.isFinite(rho) || rho <= 0)
        return "—";
    if (rho >= 0.01 && rho < 10000)
        return `${rho.toPrecision(4)} г/см³`;
    return `${rho.toExponential(4)} г/см³`;
}
/**
 * Массовая плотность материала (г/см³) по ядерным концентрациям нуклидов.
 * Без DENSxx: dens — ядерная концентрация; с DENSAA/DENSWA — атомные доли.
 */
function computeMaterialMassDensityGcm3(material) {
    const { nuclides, densParam, densValue } = material;
    if (!nuclides.length)
        return null;
    const conc = nuclides.map((n) => parseFloat(n.density));
    if (conc.some((v) => !Number.isFinite(v)))
        return null;
    const weights = nuclides.map((n) => mcuNuclideAtomicWeight(n.name));
    if (weights.some((w) => w === null))
        return null;
    const param = densParam?.toUpperCase();
    if (!param) {
        let weighted = 0;
        for (let i = 0; i < conc.length; i++) {
            weighted += conc[i] * weights[i];
        }
        return weighted * exports.MCU_NUCLEAR_DENSITY_SCALE * ATOMIC_MASS_G;
    }
    if (param === "DENSAA" || param === "DENSWA") {
        if (densValue == null || !Number.isFinite(densValue))
            return null;
        const sum = conc.reduce((a, b) => a + b, 0);
        if (sum <= 0)
            return null;
        let avgA = 0;
        for (let i = 0; i < conc.length; i++) {
            avgA += (conc[i] / sum) * weights[i];
        }
        return densValue * exports.MCU_NUCLEAR_DENSITY_SCALE * ATOMIC_MASS_G * avgA;
    }
    if (param === "DENSAW" || param === "DENSWW") {
        if (densValue == null || !Number.isFinite(densValue))
            return null;
        const sum = conc.reduce((a, b) => a + b, 0);
        if (sum <= 0)
            return null;
        let denom = 0;
        for (let i = 0; i < conc.length; i++) {
            denom += conc[i] / weights[i];
        }
        if (denom <= 0)
            return null;
        return (densValue * exports.MCU_NUCLEAR_DENSITY_SCALE * ATOMIC_MASS_G * sum) / denom;
    }
    return null;
}
//# sourceMappingURL=materialDensity.js.map