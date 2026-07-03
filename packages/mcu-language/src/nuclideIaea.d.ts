/**
 * MCU-NR (4-символьное имя) → IAEA Target (U-235, Th-230, He-3).
 * Без массового числа возвращает null.
 */
export declare function mcuNuclideToIaeaTarget(name: string): string | null;
/** MCU-NR: только символ элемента (HF, ZR, U) → IAEA element (Hf, Zr, U). */
export declare function mcuNuclideToIaeaElement(name: string): string | null;
