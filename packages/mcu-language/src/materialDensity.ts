import type { MaterialNode } from "./ast";
import { evaluateExpression } from "./expression";
import { mcuNuclideToIaeaElement, mcuNuclideToIaeaTarget } from "./nuclideIaea";

/** MCU-NR: значение dens — ядер/см³ без явного множителя 10²⁴ (UserGuide §8.2). */
export const MCU_NUCLEAR_DENSITY_SCALE = 1e24;

/** Атомная единица массы, г. */
const ATOMIC_MASS_G = 1.660_539_066_60e-24;

/** Природные средние атомные массы (г/моль), NIST — для элементов без массового числа. */
const NATURAL_ATOMIC_WEIGHT: Record<string, number> = {
  H: 1.008, D: 2.014, T: 3.016, HE: 4.003, LI: 6.94, BE: 9.012, B: 10.81, C: 12.011, N: 14.007, O: 15.999,
  F: 18.998, NE: 20.18, NA: 22.99, MG: 24.305, AL: 26.982, SI: 28.085, P: 30.974, S: 32.06, CL: 35.45, AR: 39.95,
  K: 39.098, CA: 40.078, SC: 44.956, TI: 47.867, V: 50.942, CR: 51.996, MN: 54.938, FE: 55.845, CO: 58.933,
  NI: 58.693, CU: 63.546, ZN: 65.38, GA: 69.723, GE: 72.63, AS: 74.922, SE: 78.97, BR: 79.904, KR: 83.798,
  RB: 85.468, SR: 87.62, Y: 88.906, ZR: 91.224, NB: 92.906, MO: 95.95, TC: 98, RU: 101.07, RH: 102.91, PD: 106.42,
  AG: 107.87, CD: 112.41, IN: 114.82, SN: 118.71, SB: 121.76, TE: 127.6, I: 126.9, XE: 131.29, CS: 132.91,
  BA: 137.33, LA: 138.91, CE: 140.12, PR: 140.91, ND: 144.24, PM: 145, SM: 150.36, EU: 151.96, GD: 157.25,
  TB: 158.93, DY: 162.5, HO: 164.93, ER: 167.26, TM: 168.93, YB: 173.05, LU: 174.97,
  HF: 178.49, TA: 180.95, W: 183.84, RE: 186.21, OS: 190.23, IR: 192.22,
  PT: 195.08, AU: 196.97, HG: 200.59, TL: 204.38, PB: 207.2, BI: 208.98, TH: 232.04, U: 238.029,
  NP: 237, PU: 244, AM: 243, CM: 247, BK: 247, CF: 251,
};

function isNumericLiteral(token: string): boolean {
  return /^[+-]?(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?$/.test(token);
}

/** Атомная масса нуклида MCU (г/моль) для расчёта ρ. */
export function mcuNuclideAtomicWeight(name: string): number | null {
  const target = mcuNuclideToIaeaTarget(name);
  if (target) {
    const mass = target.match(/-(\d+)$/);
    if (mass) return parseInt(mass[1], 10);
  }
  const element = mcuNuclideToIaeaElement(name);
  if (element) {
    const key = element.length === 1 ? element : element[0] + element.slice(1).toUpperCase();
    const sym = element.toUpperCase();
    return NATURAL_ATOMIC_WEIGHT[sym] ?? NATURAL_ATOMIC_WEIGHT[key] ?? null;
  }
  const sym = name.trim().toUpperCase().match(/^([A-Z]{1,2})/)?.[1];
  return sym ? NATURAL_ATOMIC_WEIGHT[sym] ?? null : null;
}

export function formatMassDensityGcm3(rho: number): string {
  if (!Number.isFinite(rho) || rho <= 0) return "—";
  if (rho >= 0.01 && rho < 10_000) return `${rho.toPrecision(4)} г/см³`;
  return `${rho.toExponential(4)} г/см³`;
}

/** Концентрация → число: литерал или выражение (EQU/SET). */
export function resolveNuclideConcentration(
  raw: string,
  vars: Map<string, number> = new Map()
): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isNumericLiteral(trimmed)) {
    const n = parseFloat(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  const v = evaluateExpression(trimmed, vars);
  return v != null && Number.isFinite(v) ? v : null;
}

export type DensitySkipReason = "bad-conc" | "unknown-mass";

export interface MaterialDensitySkip {
  name: string;
  density: string;
  reason: DensitySkipReason;
}

export interface MaterialDensityAnalysis {
  /** ρ по известным нуклидам; null если ни один не учтён. */
  rho: number | null;
  usedCount: number;
  skipped: MaterialDensitySkip[];
}

/**
 * Массовая плотность материала (г/см³) по ядерным концентрациям нуклидов.
 * Нуклиды с нераспознанной концентрацией или неизвестной атомной массой пропускаются
 * (ρ приближённая по остальным). Без DENSxx: dens — ядерная концентрация;
 * с DENSAA/DENSWA — атомные доли.
 */
export function analyzeMaterialMassDensity(
  material: Pick<MaterialNode, "nuclides" | "densParam" | "densValue">,
  vars: Map<string, number> = new Map()
): MaterialDensityAnalysis {
  const { nuclides, densParam, densValue } = material;
  if (!nuclides.length) return { rho: null, usedCount: 0, skipped: [] };

  const skipped: MaterialDensitySkip[] = [];
  const used: Array<{ name: string; conc: number; weight: number }> = [];

  for (const n of nuclides) {
    const conc = resolveNuclideConcentration(n.density, vars);
    if (conc == null) {
      skipped.push({ name: n.name, density: n.density, reason: "bad-conc" });
      continue;
    }
    const weight = mcuNuclideAtomicWeight(n.name);
    if (weight == null) {
      skipped.push({ name: n.name, density: n.density, reason: "unknown-mass" });
      continue;
    }
    used.push({ name: n.name, conc, weight });
  }

  if (!used.length) return { rho: null, usedCount: 0, skipped };

  const param = densParam?.toUpperCase();

  if (!param) {
    let weighted = 0;
    for (const u of used) weighted += u.conc * u.weight;
    return {
      rho: weighted * MCU_NUCLEAR_DENSITY_SCALE * ATOMIC_MASS_G,
      usedCount: used.length,
      skipped,
    };
  }

  if (param === "DENSAA" || param === "DENSWA") {
    if (densValue == null || !Number.isFinite(densValue)) {
      return { rho: null, usedCount: 0, skipped };
    }
    const sum = used.reduce((a, u) => a + u.conc, 0);
    if (sum <= 0) return { rho: null, usedCount: 0, skipped };
    let avgA = 0;
    for (const u of used) avgA += (u.conc / sum) * u.weight;
    return {
      rho: densValue * MCU_NUCLEAR_DENSITY_SCALE * ATOMIC_MASS_G * avgA,
      usedCount: used.length,
      skipped,
    };
  }

  if (param === "DENSAW" || param === "DENSWW") {
    if (densValue == null || !Number.isFinite(densValue)) {
      return { rho: null, usedCount: 0, skipped };
    }
    const sum = used.reduce((a, u) => a + u.conc, 0);
    if (sum <= 0) return { rho: null, usedCount: 0, skipped };
    let denom = 0;
    for (const u of used) denom += u.conc / u.weight;
    if (denom <= 0) return { rho: null, usedCount: 0, skipped };
    return {
      rho: (densValue * MCU_NUCLEAR_DENSITY_SCALE * ATOMIC_MASS_G * sum) / denom,
      usedCount: used.length,
      skipped,
    };
  }

  return { rho: null, usedCount: 0, skipped };
}

export function computeMaterialMassDensityGcm3(
  material: Pick<MaterialNode, "nuclides" | "densParam" | "densValue">,
  vars: Map<string, number> = new Map()
): number | null {
  return analyzeMaterialMassDensity(material, vars).rho;
}
