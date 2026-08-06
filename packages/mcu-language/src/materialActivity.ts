/**
 * Объёмная активность по составу MATR: a = λ·n, λ = ln2 / T½.
 * T½ — из PARAMETE.THR (MDBNR); dens — ядерная концентрация MCU (§8.2).
 * Не зависит от карты VOL (инвентарная активность состава, не выгорание).
 */

import type { MaterialNode } from "./ast";
import {
  MCU_NUCLEAR_DENSITY_SCALE,
  mcuNuclideAtomicWeight,
  resolveNuclideConcentration,
} from "./materialDensity";
import { getParameteThrForMcuNuclide } from "./parameteThr";

const LN2 = Math.LN2;

export type ActivitySkipReason = "bad-conc" | "no-halflife" | "stable" | "unknown-mass" | "dens-param";

export interface NuclideActivity {
  name: string;
  /** Ядерная концентрация в единицах MCU (без ×10²⁴). */
  densityMcu: number;
  halfLifeSec: number;
  /** Бк/см³. */
  activityBqPerCm3: number;
}

export interface MaterialActivitySkip {
  name: string;
  density: string;
  reason: ActivitySkipReason;
}

export interface MaterialActivityAnalysis {
  /** Сумма a_V по нуклидам с известным T½; null если ни один не учтён. */
  totalBqPerCm3: number | null;
  nuclides: NuclideActivity[];
  usedCount: number;
  skipped: MaterialActivitySkip[];
}

/**
 * Абсолютная ядерная концентрация нуклида в единицах MCU (до ×10²⁴),
 * с учётом DENSAA/DENSWA/DENSAW/DENSWW.
 */
export function resolveAbsoluteNuclearDensityMcu(
  material: Pick<MaterialNode, "nuclides" | "densParam" | "densValue">,
  nuclideName: string,
  vars: Map<string, number> = new Map()
): { densityMcu: number | null; reason?: ActivitySkipReason } {
  const { nuclides, densParam, densValue } = material;
  const target = nuclideName.trim().toUpperCase();
  const row = nuclides.find((n) => n.name.toUpperCase() === target);
  if (!row) return { densityMcu: null, reason: "bad-conc" };

  const conc = resolveNuclideConcentration(row.density, vars);
  if (conc == null) return { densityMcu: null, reason: "bad-conc" };

  const param = densParam?.toUpperCase();
  if (!param) return { densityMcu: conc };

  if (densValue == null || !Number.isFinite(densValue)) {
    return { densityMcu: null, reason: "dens-param" };
  }

  if (param === "DENSAA" || param === "DENSWA") {
    let sum = 0;
    for (const n of nuclides) {
      const c = resolveNuclideConcentration(n.density, vars);
      if (c != null) sum += c;
    }
    if (sum <= 0) return { densityMcu: null, reason: "bad-conc" };
    return { densityMcu: densValue * (conc / sum) };
  }

  if (param === "DENSAW" || param === "DENSWW") {
    const weight = mcuNuclideAtomicWeight(row.name);
    if (weight == null || weight <= 0) return { densityMcu: null, reason: "unknown-mass" };
    let denom = 0;
    for (const n of nuclides) {
      const c = resolveNuclideConcentration(n.density, vars);
      if (c == null) continue;
      const w = mcuNuclideAtomicWeight(n.name);
      if (w == null || w <= 0) continue;
      denom += c / w;
    }
    if (denom <= 0) return { densityMcu: null, reason: "unknown-mass" };
    return { densityMcu: densValue * (conc / weight) / denom };
  }

  return { densityMcu: null, reason: "dens-param" };
}

/** a = λ·n [Бк/см³]; densMcu — концентрация MCU, halfLifeSec > 0. */
export function activityBqPerCm3(densityMcu: number, halfLifeSec: number): number | null {
  if (!Number.isFinite(densityMcu) || densityMcu < 0) return null;
  if (!Number.isFinite(halfLifeSec) || halfLifeSec <= 0) return null;
  const n = densityMcu * MCU_NUCLEAR_DENSITY_SCALE;
  return (LN2 / halfLifeSec) * n;
}

export function formatActivityBqPerCm3(bq: number): string {
  if (!Number.isFinite(bq) || bq < 0) return "—";
  if (bq === 0) return "0 Бк/см³";
  const abs = Math.abs(bq);
  const units: Array<{ div: number; suffix: string }> = [
    { div: 1e15, suffix: "ПБк/см³" },
    { div: 1e12, suffix: "ТБк/см³" },
    { div: 1e9, suffix: "ГБк/см³" },
    { div: 1e6, suffix: "МБк/см³" },
    { div: 1e3, suffix: "кБк/см³" },
    { div: 1, suffix: "Бк/см³" },
  ];
  for (const u of units) {
    if (abs >= u.div || u.div === 1) {
      const v = bq / u.div;
      const s =
        abs / u.div >= 100 || abs / u.div < 0.01
          ? v.toExponential(3)
          : v.toPrecision(4).replace(/\.?0+$/, "").replace(/(\.\d*?)0+$/, "$1");
      return `${s.endsWith(".") ? s.slice(0, -1) : s} ${u.suffix}`;
    }
  }
  return `${bq} Бк/см³`;
}

/**
 * Объёмная активность одного нуклида в материале (PARAMETE.THR).
 * Стабильные / без T½ — null.
 */
export function computeNuclideActivityBqPerCm3(
  material: Pick<MaterialNode, "nuclides" | "densParam" | "densValue">,
  nuclideName: string,
  vars: Map<string, number> = new Map()
): NuclideActivity | null {
  const dens = resolveAbsoluteNuclearDensityMcu(material, nuclideName, vars);
  if (dens.densityMcu == null) return null;

  const thr = getParameteThrForMcuNuclide(nuclideName);
  if (!thr) return null;
  if (!thr.hasHalfLife || thr.halfLifeSec == null || thr.halfLifeSec <= 0) return null;

  const a = activityBqPerCm3(dens.densityMcu, thr.halfLifeSec);
  if (a == null) return null;

  return {
    name: nuclideName,
    densityMcu: dens.densityMcu,
    halfLifeSec: thr.halfLifeSec,
    activityBqPerCm3: a,
  };
}

export function analyzeMaterialActivity(
  material: Pick<MaterialNode, "nuclides" | "densParam" | "densValue">,
  vars: Map<string, number> = new Map()
): MaterialActivityAnalysis {
  const skipped: MaterialActivitySkip[] = [];
  const nuclides: NuclideActivity[] = [];

  for (const n of material.nuclides) {
    const dens = resolveAbsoluteNuclearDensityMcu(material, n.name, vars);
    if (dens.densityMcu == null) {
      skipped.push({ name: n.name, density: n.density, reason: dens.reason ?? "bad-conc" });
      continue;
    }

    const thr = getParameteThrForMcuNuclide(n.name);
    if (!thr) {
      skipped.push({ name: n.name, density: n.density, reason: "no-halflife" });
      continue;
    }
    if (!thr.hasHalfLife || thr.halfLifeSec == null || thr.halfLifeSec <= 0) {
      skipped.push({ name: n.name, density: n.density, reason: "stable" });
      continue;
    }

    const a = activityBqPerCm3(dens.densityMcu, thr.halfLifeSec);
    if (a == null) {
      skipped.push({ name: n.name, density: n.density, reason: "no-halflife" });
      continue;
    }
    nuclides.push({
      name: n.name,
      densityMcu: dens.densityMcu,
      halfLifeSec: thr.halfLifeSec,
      activityBqPerCm3: a,
    });
  }

  if (!nuclides.length) {
    return { totalBqPerCm3: null, nuclides, usedCount: 0, skipped };
  }

  const total = nuclides.reduce((s, x) => s + x.activityBqPerCm3, 0);
  return {
    totalBqPerCm3: total,
    nuclides,
    usedCount: nuclides.length,
    skipped,
  };
}
