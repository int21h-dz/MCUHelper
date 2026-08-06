import { awLibNameFromIaeaLabel } from "./awLib";

/** IAEA LiveChart label (U-235 / Cs-133) → имя MCU-NR (U235 / CS33 при AW.LIB). */
export function iaeaLabelToMcuNuclide(label: string): string {
  const fromLib = awLibNameFromIaeaLabel(label);
  if (fromLib) return fromLib;
  const m = label.trim().match(/^([A-Za-z]{1,2})-(\d+)$/);
  if (!m) return label.replace(/-/g, "").toUpperCase();
  return m[1].toUpperCase() + m[2];
}

export interface NaturalIsotopeFraction {
  mcuName: string;
  abundancePercent: number;
}

export interface McuIsotopeLine {
  mcuName: string;
  concentration: string;
}

export function formatNuclearDensity(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1e-4 && n < 1e4) {
    return n
      .toPrecision(6)
      .replace(/\.?0+$/, "")
      .replace(/(\.\d*?)0+$/, "$1")
      .replace(/\.$/, "");
  }
  return n.toExponential(4);
}

/** Разбивка ядерной концентрации природного элемента по мольным долям (%). */
export function computeMcuIsotopeLines(
  totalConcentration: number,
  isotopes: NaturalIsotopeFraction[]
): McuIsotopeLine[] {
  if (!Number.isFinite(totalConcentration) || totalConcentration <= 0 || !isotopes.length) return [];

  const sum = isotopes.reduce((s, i) => s + i.abundancePercent, 0);
  const norm = sum > 0 ? sum : 100;

  return isotopes
    .filter((i) => i.abundancePercent > 0)
    .map((i) => ({
      mcuName: i.mcuName,
      concentration: formatNuclearDensity((totalConcentration * i.abundancePercent) / norm),
    }));
}
