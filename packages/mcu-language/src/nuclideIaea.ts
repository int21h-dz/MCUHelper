import { awLibToIaeaTarget } from "./awLib";

/** Двухбуквенные символы актинидов/трансуранов — масса кодируется двумя последними цифрами с префиксом «2». */
const ACTINIDE_TWO_LETTER = new Set([
  "AC", "TH", "PA", "NP", "PU", "AM", "CM", "BK", "CF", "ES", "FM", "MD", "NO", "LR",
]);
function formatElement(sym: string): string {
  if (sym.length === 1) return sym;
  return sym[0] + sym.slice(1).toLowerCase();
}

/**
 * MCU-NR (4-символьное имя) → IAEA Target (U-235, Th-230, He-3, Cs-133).
 * При загруженном AW.LIB — A из ZAID (CS33→Cs-133); иначе эвристика имени.
 * Без массового числа возвращает null.
 */
export function mcuNuclideToIaeaTarget(name: string): string | null {
  const fromLib = awLibToIaeaTarget(name);
  if (fromLib) return fromLib;

  const raw = name.trim().toUpperCase();
  const m = raw.match(/^([A-Z]{1,2})(\d+)$/);
  if (!m) return null;

  const sym = m[1];
  const digits = m[2];

  let mass: string;
  if (digits.length >= 3) {
    mass = digits;
  } else if (sym.length === 2 && digits.length === 2 && ACTINIDE_TWO_LETTER.has(sym)) {
    mass = `2${digits}`;
  } else {
    mass = digits;
  }
  return `${formatElement(sym)}-${mass}`;
}

/** MCU-NR: только символ элемента (HF, ZR, U) → IAEA element (Hf, Zr, U). */
export function mcuNuclideToIaeaElement(name: string): string | null {
  const raw = name.trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(raw)) return null;
  return formatElement(raw);
}
