/** Природный состав частых элементов (IAEA LiveChart, fallback без сети). */
export interface BundledIsotopeAbundance {
  mass: number;
  abundance: number;
  label: string;
}

export const BUNDLED_NATURAL_ABUNDANCE: Record<string, BundledIsotopeAbundance[]> = {
  H: [
    { mass: 1, abundance: 99.9885, label: "H-1" },
    { mass: 2, abundance: 0.0115, label: "H-2" },
  ],
  B: [
    { mass: 10, abundance: 19.9, label: "B-10" },
    { mass: 11, abundance: 80.1, label: "B-11" },
  ],
  C: [
    { mass: 12, abundance: 98.93, label: "C-12" },
    { mass: 13, abundance: 1.07, label: "C-13" },
  ],
  N: [
    { mass: 14, abundance: 99.632, label: "N-14" },
    { mass: 15, abundance: 0.368, label: "N-15" },
  ],
  O: [
    { mass: 16, abundance: 99.757, label: "O-16" },
    { mass: 17, abundance: 0.038, label: "O-17" },
    { mass: 18, abundance: 0.205, label: "O-18" },
  ],
  Si: [
    { mass: 28, abundance: 92.223, label: "Si-28" },
    { mass: 29, abundance: 4.685, label: "Si-29" },
    { mass: 30, abundance: 3.092, label: "Si-30" },
  ],
  S: [
    { mass: 32, abundance: 94.99, label: "S-32" },
    { mass: 33, abundance: 0.75, label: "S-33" },
    { mass: 34, abundance: 4.25, label: "S-34" },
    { mass: 36, abundance: 0.01, label: "S-36" },
  ],
  Cl: [
    { mass: 35, abundance: 75.76, label: "Cl-35" },
    { mass: 37, abundance: 24.24, label: "Cl-37" },
  ],
  Ca: [
    { mass: 40, abundance: 96.941, label: "Ca-40" },
    { mass: 42, abundance: 0.647, label: "Ca-42" },
    { mass: 43, abundance: 0.135, label: "Ca-43" },
    { mass: 44, abundance: 2.086, label: "Ca-44" },
    { mass: 46, abundance: 0.004, label: "Ca-46" },
    { mass: 48, abundance: 0.187, label: "Ca-48" },
  ],
  Cr: [
    { mass: 50, abundance: 4.345, label: "Cr-50" },
    { mass: 52, abundance: 83.789, label: "Cr-52" },
    { mass: 53, abundance: 9.501, label: "Cr-53" },
    { mass: 54, abundance: 2.365, label: "Cr-54" },
  ],
  Mn: [
    { mass: 55, abundance: 100, label: "Mn-55" },
  ],
  Fe: [
    { mass: 54, abundance: 5.845, label: "Fe-54" },
    { mass: 56, abundance: 91.754, label: "Fe-56" },
    { mass: 57, abundance: 2.119, label: "Fe-57" },
    { mass: 58, abundance: 0.282, label: "Fe-58" },
  ],
  Ni: [
    { mass: 58, abundance: 68.077, label: "Ni-58" },
    { mass: 60, abundance: 26.223, label: "Ni-60" },
    { mass: 61, abundance: 1.14, label: "Ni-61" },
    { mass: 62, abundance: 3.634, label: "Ni-62" },
    { mass: 64, abundance: 0.926, label: "Ni-64" },
  ],
  Cu: [
    { mass: 63, abundance: 69.17, label: "Cu-63" },
    { mass: 65, abundance: 30.83, label: "Cu-65" },
  ],
  Zn: [
    { mass: 64, abundance: 48.63, label: "Zn-64" },
    { mass: 66, abundance: 27.9, label: "Zn-66" },
    { mass: 67, abundance: 4.1, label: "Zn-67" },
    { mass: 68, abundance: 18.75, label: "Zn-68" },
    { mass: 70, abundance: 0.62, label: "Zn-70" },
  ],
  Al: [
    { mass: 27, abundance: 100, label: "Al-27" },
  ],
  Pb: [
    { mass: 204, abundance: 1.4, label: "Pb-204" },
    { mass: 206, abundance: 24.1, label: "Pb-206" },
    { mass: 207, abundance: 22.1, label: "Pb-207" },
    { mass: 208, abundance: 52.4, label: "Pb-208" },
  ],
  Th: [
    { mass: 232, abundance: 100, label: "Th-232" },
  ],
  U: [
    { mass: 234, abundance: 0.0055, label: "U-234" },
    { mass: 235, abundance: 0.72, label: "U-235" },
    { mass: 238, abundance: 99.2745, label: "U-238" },
  ],
  Mg: [{ mass: 24, abundance: 78.99, label: "Mg-24" }, { mass: 25, abundance: 10.0, label: "Mg-25" }, { mass: 26, abundance: 11.01, label: "Mg-26" }],
  K: [{ mass: 39, abundance: 93.2581, label: "K-39" }, { mass: 40, abundance: 0.0117, label: "K-40" }, { mass: 41, abundance: 6.7302, label: "K-41" }],
  Ti: [
    { mass: 46, abundance: 8.25, label: "Ti-46" },
    { mass: 47, abundance: 7.44, label: "Ti-47" },
    { mass: 48, abundance: 73.72, label: "Ti-48" },
    { mass: 49, abundance: 5.41, label: "Ti-49" },
    { mass: 50, abundance: 5.18, label: "Ti-50" },
  ],
  Co: [{ mass: 59, abundance: 100, label: "Co-59" }],
  Zr: [
    { mass: 90, abundance: 51.45, label: "Zr-90" },
    { mass: 91, abundance: 11.22, label: "Zr-91" },
    { mass: 92, abundance: 17.15, label: "Zr-92" },
    { mass: 94, abundance: 17.38, label: "Zr-94" },
    { mass: 96, abundance: 2.8, label: "Zr-96" },
  ],
  Hf: [
    { mass: 174, abundance: 0.16, label: "Hf-174" },
    { mass: 176, abundance: 5.26, label: "Hf-176" },
    { mass: 177, abundance: 18.6, label: "Hf-177" },
    { mass: 178, abundance: 27.28, label: "Hf-178" },
    { mass: 179, abundance: 13.62, label: "Hf-179" },
    { mass: 180, abundance: 35.08, label: "Hf-180" },
  ],
  W: [
    { mass: 180, abundance: 0.12, label: "W-180" },
    { mass: 182, abundance: 26.5, label: "W-182" },
    { mass: 183, abundance: 14.31, label: "W-183" },
    { mass: 184, abundance: 30.64, label: "W-184" },
    { mass: 186, abundance: 28.43, label: "W-186" },
  ],
  Pu: [
    { mass: 239, abundance: 100, label: "Pu-239" },
  ],
};

export function bundledNaturalAbundanceMap(): Map<string, BundledIsotopeAbundance[]> {
  const map = new Map<string, BundledIsotopeAbundance[]>();
  for (const [key, list] of Object.entries(BUNDLED_NATURAL_ABUNDANCE)) {
    map.set(key.toUpperCase(), list.map((iso) => ({ ...iso })));
  }
  return map;
}
