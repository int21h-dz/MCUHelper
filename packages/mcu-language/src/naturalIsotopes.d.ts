/** IAEA LiveChart label (U-235) → имя MCU-NR (U235). */
export declare function iaeaLabelToMcuNuclide(label: string): string;
export interface NaturalIsotopeFraction {
    mcuName: string;
    abundancePercent: number;
}
export interface McuIsotopeLine {
    mcuName: string;
    concentration: string;
}
export declare function formatNuclearDensity(n: number): string;
/** Разбивка ядерной концентрации природного элемента по мольным долям (%). */
export declare function computeMcuIsotopeLines(totalConcentration: number, isotopes: NaturalIsotopeFraction[]): McuIsotopeLine[];
