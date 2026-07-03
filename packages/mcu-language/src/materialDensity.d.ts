import type { MaterialNode } from "./ast";
/** MCU-NR: значение dens — ядер/см³ без явного множителя 10²⁴ (UserGuide §8.2). */
export declare const MCU_NUCLEAR_DENSITY_SCALE = 1e+24;
/** Атомная масса нуклида MCU (г/моль) для расчёта ρ. */
export declare function mcuNuclideAtomicWeight(name: string): number | null;
export declare function formatMassDensityGcm3(rho: number): string;
/**
 * Массовая плотность материала (г/см³) по ядерным концентрациям нуклидов.
 * Без DENSxx: dens — ядерная концентрация; с DENSAA/DENSWA — атомные доли.
 */
export declare function computeMaterialMassDensityGcm3(material: Pick<MaterialNode, "nuclides" | "densParam" | "densValue">): number | null;
