/**
 * Вода/пар (IAPWS-IF97) → плотность и ядерные концентрации H/O для MATR MCU-NR.
 * Оффлайн: зависимость `iapws-if97` (чистый TS).
 */

import { solvePT, solvePx, solveTx } from "iapws-if97";

/** MCU-NR: dens — ядер/см³ / 10²⁴ (как MCU_NUCLEAR_DENSITY_SCALE в materialDensity). */
const MCU_NUCLEAR_DENSITY_SCALE = 1e24;

/** Атомная единица массы, г (как в materialDensity). */
const ATOMIC_MASS_G = 1.660_539_066_60e-24;

/** Молярная масса H₂O, г/моль (IAPWS). */
export const WATER_MOLAR_MASS_G = 18.015_268;

/** Число Авогадро, моль⁻¹. */
export const AVOGADRO = 6.022_140_76e23;

/** Нормальное давление, МПа (101325 Па). */
export const ATM_MPA = 0.101_325;

/** Дефолт T при отсутствии MATR H+O, K. */
export const DEFAULT_WATER_T_K = 313;

const T_TRIPLE_K = 273.16;
const T_CRIT_K = 647.096;

export type WaterPhase = "liquid" | "vapor" | "unknown";

export type PressureUnit = "Pa" | "kPa" | "MPa" | "atm" | "bar";

export interface WaterSteamState {
  /** K */
  T: number;
  /** MPa (внутреннее) */
  P: number;
  /** г/см³ */
  rho: number;
  /** Ядерная dens MCU (×10²⁴ ядер/см³ неявно) */
  nH: number;
  nO: number;
  phase: WaterPhase;
  /** Качество на насыщении, иначе null */
  quality: number | null;
  /** Если IF97 не достигает заданной ρ при T (например ρ≫ρ′). */
  warning?: string;
}

export interface SaturationPoint {
  T: number;
  P: number;
  rhoF: number;
  rhoG: number;
}

/** Множитель: value_in_unit * factor = MPa */
const PRESSURE_TO_MPA: Record<PressureUnit, number> = {
  Pa: 1e-6,
  kPa: 1e-3,
  MPa: 1,
  atm: ATM_MPA,
  bar: 0.1,
};

export const PRESSURE_UNITS: ReadonlyArray<{ id: PressureUnit; label: string }> = [
  { id: "atm", label: "атм" },
  { id: "Pa", label: "Па" },
  { id: "kPa", label: "кПа" },
  { id: "MPa", label: "МПа" },
  { id: "bar", label: "бар" },
];

export function pressureToMPa(value: number, unit: PressureUnit): number {
  return value * PRESSURE_TO_MPA[unit];
}

export function pressureFromMPa(pMPa: number, unit: PressureUnit): number {
  return pMPa / PRESSURE_TO_MPA[unit];
}

export function kgm3ToGcm3(rhoKgm3: number): number {
  return rhoKgm3 / 1000;
}

/**
 * Ядерные концентрации элементарных H и O для чистой H₂O при массовой плотности ρ.
 * MCU dens: ядер/см³ / 10²⁴.
 */
export function nuclearHOFromMassDensity(rhoGcm3: number): { nH: number; nO: number } {
  if (!(rhoGcm3 > 0) || !Number.isFinite(rhoGcm3)) {
    return { nH: 0, nO: 0 };
  }
  const moleculesPerCm3 = (rhoGcm3 / WATER_MOLAR_MASS_G) * AVOGADRO;
  const nO = moleculesPerCm3 / MCU_NUCLEAR_DENSITY_SCALE;
  return { nH: 2 * nO, nO };
}

/** Семейство нуклида для воды: H (вкл. D/T) или O. */
export function waterElementFamily(name: string): "H" | "O" | null {
  const raw = name.trim().toUpperCase();
  if (raw === "H" || raw === "D" || raw === "T" || /^H\d+$/.test(raw)) return "H";
  if (raw === "O" || /^O\d+$/.test(raw)) return "O";
  return null;
}

export function materialHasHO(nuclideNames: ReadonlyArray<string>): boolean {
  let hasH = false;
  let hasO = false;
  for (const n of nuclideNames) {
    const el = waterElementFamily(n);
    if (el === "H") hasH = true;
    if (el === "O") hasO = true;
    if (hasH && hasO) return true;
  }
  return false;
}

/** Сноска для смесей: ρ(H₂O) только по H₂O; гидроксиды не моделируются. */
export const WATER_DENSITY_MIXTURE_FOOTNOTE =
  "ρ(H₂O) — только по формуле H₂O (min(ΣO, ΣH/2)); прочие нуклиды MATR не разбираются. " +
  "При гидроксидах в смеси расчёт ρ(H₂O) может быть неверен.";

export interface WaterComponentExtract {
  /** Ядерные dens H/O, отнесённые к H₂O (соотношение 2:1). */
  nH: number;
  nO: number;
  /** Массовая плотность вклада воды в смесь, г/см³. */
  rhoGcm3: number;
  /** «Молекулярность» H₂O в MCU-единицах (= nO воды). */
  nH2O: number;
  /** ΣH / ΣO в MATR (строки H/D/T и O). */
  nHTotal: number;
  nOTotal: number;
  warning?: string;
}

/**
 * Выделить компонент H₂O из MATR: n(H₂O) = min(ΣO, ΣH/2).
 * U, оксиды, C и пр. **не** участвуют — только стехиометрия воды.
 */
export function extractWaterComponentFromNuclides(
  nuclides: ReadonlyArray<{ name: string; concentration: string }>
): WaterComponentExtract | null {
  let nHTotal = 0;
  let hMassWeighted = 0;
  let nOTotal = 0;
  let oWeightGmol = 15.999;

  for (const n of nuclides) {
    const conc = parseNuclearDensLiteral(n.concentration);
    if (conc == null || !(conc > 0)) continue;

    const fam = waterElementFamily(n.name);
    if (fam === "H") {
      const w = hoAtomicWeightGmol(n.name);
      if (w == null) continue;
      nHTotal += conc;
      hMassWeighted += conc * w;
      continue;
    }
    if (fam === "O") {
      const w = hoAtomicWeightGmol(n.name);
      if (w == null) continue;
      nOTotal += conc;
      oWeightGmol = w;
    }
  }

  if (!(nHTotal > 0) || !(nOTotal > 0)) return null;

  const nH2O = Math.min(nOTotal, nHTotal / 2);
  if (!(nH2O > 0)) {
    return {
      nH: 0,
      nO: 0,
      rhoGcm3: 0,
      nH2O: 0,
      nHTotal,
      nOTotal,
      warning: "Нет согласованной пары H и O для H₂O.",
    };
  }

  const nH = 2 * nH2O;
  const nO = nH2O;
  const hAvg = hMassWeighted / nHTotal;
  const rhoGcm3 = nH2O * (2 * hAvg + oWeightGmol) * MCU_NUCLEAR_DENSITY_SCALE * ATOMIC_MASS_G;

  const warnings: string[] = [];
  const excessH = nHTotal - nH;
  const excessO = nOTotal - nO;
  if (excessH > Math.max(nH2O * 1e-6, 1e-12)) {
    warnings.push(`избыток H вне H₂O: ${excessH.toExponential(3)}`);
  }
  if (excessO > Math.max(nH2O * 1e-6, 1e-12)) {
    warnings.push(`избыток O вне H₂O: ${excessO.toExponential(3)}`);
  }

  return {
    nH,
    nO,
    rhoGcm3,
    nH2O,
    nHTotal,
    nOTotal,
    warning: warnings.length ? warnings.join("; ") : undefined,
  };
}

/**
 * Массовая плотность компонента H₂O (г/см³) по min(ΣO, ΣH/2).
 * Принимает все нуклиды MATR; учитываются только строки H/O.
 */
export function massDensityGcm3FromHONuclides(
  nuclides: ReadonlyArray<{ name: string; concentration: string }>
): number | null {
  const ex = extractWaterComponentFromNuclides(nuclides);
  if (!ex || !(ex.rhoGcm3 > 0) || !(ex.nH2O > 0)) return null;
  return ex.rhoGcm3;
}

function parseNuclearDensLiteral(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Атомные массы H/O для ρ(H+O); без зависимости от AW.LIB/materialDensity (vendor). */
function hoAtomicWeightGmol(name: string): number | null {
  const key = name.trim().toUpperCase();
  if (key === "H" || key === "H1") return 1.007_84;
  if (key === "D" || key === "H2") return 2.014;
  if (key === "T" || key === "H3") return 3.016;
  if (key === "O" || key === "O16") return 15.999;
  if (key === "O17") return 16.999;
  if (key === "O18") return 17.999;
  const hm = /^H(\d+)$/.exec(key);
  if (hm) return Number(hm[1]);
  const om = /^O(\d+)$/.exec(key);
  if (om) return Number(om[1]);
  return null;
}

function phaseFromRho(rho: number, rhoF: number, rhoG: number): WaterPhase {
  const dF = Math.abs(Math.log(Math.max(rho, 1e-30)) - Math.log(Math.max(rhoF, 1e-30)));
  const dG = Math.abs(Math.log(Math.max(rho, 1e-30)) - Math.log(Math.max(rhoG, 1e-30)));
  if (rho > rhoF && rho < rhoG * 1.05) {
    /* двухфазная зона между ρg и ρf */
  }
  if (rho >= Math.min(rhoF, rhoG) && rho <= Math.max(rhoF, rhoG)) {
    if (dF < 1e-3) return "liquid";
    if (dG < 1e-3) return "vapor";
    return rho > (rhoF + rhoG) / 2 ? "liquid" : "vapor";
  }
  return dF <= dG ? "liquid" : "vapor";
}

export function stateFromPT(pMPa: number, T: number): WaterSteamState {
  const s = solvePT(pMPa, T);
  const rho = kgm3ToGcm3(s.density);
  const { nH, nO } = nuclearHOFromMassDensity(rho);
  let phase: WaterPhase = "unknown";
  let quality: number | null = s.quality ?? null;
  if (T >= T_TRIPLE_K && T < T_CRIT_K) {
    try {
      const sat = psatAtT(T);
      if (Math.abs(pMPa - sat.P) / sat.P < 1e-4) {
        phase = phaseFromRho(rho, sat.rhoF, sat.rhoG);
        if (quality == null) quality = phase === "vapor" ? 1 : 0;
      } else if (pMPa > sat.P) {
        phase = "liquid";
        quality = null;
      } else {
        phase = "vapor";
        quality = null;
      }
    } catch {
      phase = "unknown";
    }
  }
  return {
    T: s.temperature,
    P: s.pressure,
    rho,
    nH,
    nO,
    phase,
    quality,
  };
}

export function psatAtT(T: number): SaturationPoint {
  const liq = solveTx(T, 0);
  const vap = solveTx(T, 1);
  return {
    T: liq.temperature,
    P: liq.pressure,
    rhoF: kgm3ToGcm3(liq.density),
    rhoG: kgm3ToGcm3(vap.density),
  };
}

/** Насыщение по давлению → Tsat, ρ_f / ρ_g. */
export function satAtP(pMPa: number): SaturationPoint {
  const liq = solvePx(pMPa, 0);
  const vap = solvePx(pMPa, 1);
  return {
    T: liq.temperature,
    P: liq.pressure,
    rhoF: kgm3ToGcm3(liq.density),
    rhoG: kgm3ToGcm3(vap.density),
  };
}

/**
 * Подобрать P (МПа) так, чтобы solvePT(P,T).density ≈ rhoGcm3.
 * На куполе насыщения → Psat.
 */
function solvePressureForTRho(
  T: number,
  rhoGcm3: number
): { P: number; phase: WaterPhase; quality: number | null; warning?: string } {
  const sat = psatAtT(T);
  const inDome =
    sat.rhoF > sat.rhoG && rhoGcm3 <= sat.rhoF * (1 + 1e-9) && rhoGcm3 >= sat.rhoG * (1 - 1e-9);
  if (inDome) {
    const v = 1 / rhoGcm3;
    const vf = 1 / sat.rhoF;
    const vg = 1 / sat.rhoG;
    const quality = Math.min(1, Math.max(0, (v - vf) / (vg - vf)));
    const twoPhase = quality > 1e-6 && quality < 1 - 1e-6;
    return {
      P: sat.P,
      phase: twoPhase ? "unknown" : quality <= 1e-6 ? "liquid" : "vapor",
      quality: twoPhase ? quality : quality <= 1e-6 ? 0 : 1,
    };
  }

  const target = rhoGcm3 * 1000; // kg/m³
  const liquidSide = rhoGcm3 >= sat.rhoF;
  let lo = liquidSide ? sat.P : 1e-6;
  let hi = liquidSide ? 100 : sat.P;
  let bestP = liquidSide ? Math.max(sat.P, ATM_MPA) : Math.min(sat.P, ATM_MPA);
  let bestDens = Number.NaN;

  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    try {
      const dens = solvePT(mid, T).density;
      bestP = mid;
      bestDens = dens;
      // При фиксированной T плотность растёт с P (жидкость и пар).
      if (dens > target) hi = mid;
      else lo = mid;
      if (Math.abs(dens - target) / target < 1e-7) break;
    } catch {
      if (liquidSide) hi = mid;
      else lo = mid;
    }
  }

  let warning: string | undefined;
  if (Number.isFinite(bestDens) && Math.abs(bestDens - target) / target > 0.01) {
    const rhoMax = bestDens / 1000;
    warning = liquidSide
      ? `ρ=${rhoGcm3.toPrecision(6)} г/см³ при T=${T} K недостижима в IF97 (≈${rhoMax.toPrecision(4)} г/см³ при P≈${bestP.toPrecision(4)} МПа). P — верхняя граница области.`
      : `ρ=${rhoGcm3.toPrecision(6)} г/см³ при T=${T} K недостижима в IF97. P подобрано по границе области.`;
  }

  return {
    P: bestP,
    phase: liquidSide ? "liquid" : "vapor",
    quality: null,
    warning,
  };
}

/**
 * Подобрать T (K) так, чтобы solvePT(P,T).density ≈ rhoGcm3.
 */
function solveTemperatureForPRho(pMPa: number, rhoGcm3: number): number {
  const target = rhoGcm3 * 1000;
  let lo = T_TRIPLE_K + 0.01;
  let hi = Math.min(T_CRIT_K - 0.01, 2273);
  let bestT = DEFAULT_WATER_T_K;
  try {
    const sat = satAtP(pMPa);
    if (rhoGcm3 <= sat.rhoF && rhoGcm3 >= sat.rhoG) return sat.T;
  } catch {
    /* continue search */
  }
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    try {
      const dens = solvePT(pMPa, mid).density;
      bestT = mid;
      // При фиксированном P плотность обычно падает с ростом T.
      if (dens > target) lo = mid;
      else hi = mid;
      if (Math.abs(dens - target) / target < 1e-7) break;
    } catch {
      hi = mid;
    }
  }
  return bestT;
}

/**
 * Состояние по T и ρ → P (вычисляется).
 * - В двухфазной зоне → Psat(T).
 * - Иначе → подбор P через IF97 PT.
 * - `forcePsat`: всегда Psat (режим насыщения / stateFromPsat), dens из ρ.
 */
export function stateFromTRho(
  T: number,
  rhoGcm3: number,
  _pGuessMPa: number = ATM_MPA,
  opts?: { forcePsat?: boolean }
): WaterSteamState {
  const { nH, nO } = nuclearHOFromMassDensity(rhoGcm3);
  if (T < T_TRIPLE_K || T >= T_CRIT_K) {
    return {
      T,
      P: _pGuessMPa > 0 ? _pGuessMPa : ATM_MPA,
      rho: rhoGcm3,
      nH,
      nO,
      phase: "unknown",
      quality: null,
    };
  }

  if (opts?.forcePsat) {
    const sat = psatAtT(T);
    const phase = phaseFromRho(rhoGcm3, sat.rhoF, sat.rhoG);
    return {
      T,
      P: sat.P,
      rho: rhoGcm3,
      nH,
      nO,
      phase,
      quality: null,
    };
  }

  const solved = solvePressureForTRho(T, rhoGcm3);
  return {
    T,
    P: solved.P,
    rho: rhoGcm3,
    nH,
    nO,
    phase: solved.phase,
    quality: solved.quality,
    warning: solved.warning,
  };
}

/** Состояние по P и ρ → T (вычисляется). */
export function stateFromPRho(pMPa: number, rhoGcm3: number): WaterSteamState {
  const T = solveTemperatureForPRho(pMPa, rhoGcm3);
  const { nH, nO } = nuclearHOFromMassDensity(rhoGcm3);
  let phase: WaterPhase = "unknown";
  let quality: number | null = null;
  try {
    const sat = psatAtT(T);
    if (Math.abs(pMPa - sat.P) / sat.P < 1e-3) {
      phase = phaseFromRho(rhoGcm3, sat.rhoF, sat.rhoG);
    } else {
      phase = pMPa > sat.P ? "liquid" : "vapor";
    }
  } catch {
    phase = "unknown";
  }
  return { T, P: pMPa, rho: rhoGcm3, nH, nO, phase, quality };
}

/**
 * Задать P (МПа) на насыщении: T = Tsat(P), ρ — жидкость или пар по phaseHint / текущей ρ.
 */
export function stateFromPsat(
  pMPa: number,
  opts?: { phase?: WaterPhase; rho?: number | null }
): WaterSteamState {
  const sat = satAtP(pMPa);
  let phase: WaterPhase = opts?.phase && opts.phase !== "unknown" ? opts.phase : "liquid";
  if (opts?.rho != null && opts.rho > 0) {
    phase = phaseFromRho(opts.rho, sat.rhoF, sat.rhoG);
  }
  const rho = phase === "vapor" ? sat.rhoG : sat.rhoF;
  return stateFromTRho(sat.T, rho, sat.P, { forcePsat: true });
}

/** T=313 K, P=1 атм, ρ из IF97 (не обязательно насыщение). */
export function defaultAmbientState(): WaterSteamState {
  const s = stateFromPT(ATM_MPA, DEFAULT_WATER_T_K);
  return { ...s, phase: "liquid" };
}

/**
 * Из MATR: T и ρ материала → P через IF97 (как радио «вычислять P»).
 * Без ρ — насыщенная жидкость при T (P=Psat, ρ=ρ′).
 * Если T вне тройная–критическая — P=атм, ρ из MATR или PT.
 */
export function initialStateFromMaterial(opts: {
  T?: number | null;
  rho?: number | null;
}): WaterSteamState {
  const T =
    opts.T != null && Number.isFinite(opts.T) && opts.T > 0 ? opts.T : DEFAULT_WATER_T_K;
  const rhoMat =
    opts.rho != null && Number.isFinite(opts.rho) && opts.rho > 0 ? opts.rho : null;

  if (T < T_TRIPLE_K || T >= T_CRIT_K) {
    if (rhoMat != null) {
      const { nH, nO } = nuclearHOFromMassDensity(rhoMat);
      return { T, P: ATM_MPA, rho: rhoMat, nH, nO, phase: "unknown", quality: null };
    }
    const clamped = Math.min(Math.max(T, T_TRIPLE_K), 1073.15);
    return { ...stateFromPT(ATM_MPA, clamped), phase: "unknown" };
  }

  if (rhoMat != null) {
    return stateFromTRho(T, rhoMat);
  }
  const sat = psatAtT(T);
  return stateFromTRho(T, sat.rhoF);
}

/** Точки кривой насыщения для графика ρ–T (и Psat). */
export function buildSaturationCurve(opts?: {
  tMin?: number;
  tMax?: number;
  steps?: number;
}): SaturationPoint[] {
  const tMin = opts?.tMin ?? 274;
  const tMax = opts?.tMax ?? 646;
  const steps = opts?.steps ?? 80;
  const out: SaturationPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const T = tMin + ((tMax - tMin) * i) / steps;
    try {
      out.push(psatAtT(T));
    } catch {
      /* вне области IF97 — пропуск */
    }
  }
  return out;
}

/** Формат dens для строки MATR (компактный sci / fixed). */
export function formatMcuNuclearDens(n: number): string {
  if (!(n > 0) || !Number.isFinite(n)) return "0";
  if (n >= 0.01 && n < 100) {
    const s = n.toPrecision(6).replace(/\.?0+$/, "");
    return s.endsWith(".") ? s.slice(0, -1) : s;
  }
  return n.toExponential(5).replace(/e\+?(-?)0*(\d+)/i, (_m, sign: string, d: string) => `E${sign}${d}`);
}
