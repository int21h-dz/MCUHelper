type FragmentId = "physical" | "geometry" | "source" | "registration" | "burnupRegistration" | "trajectory" | "calculationControl" | "burnup";
/** Канонические имена карт MCU-NR (как в UserGuide 220519) + распространённые варианты из RUNTEST */
export declare const MCU_LABELS_BY_FRAGMENT: Record<FragmentId | "shared", readonly string[]>;
/** Длинные/альтернативные имена из реальных вариантов → канон из UserGuide */
export declare const MCU_LABEL_ALIASES: Record<string, string>;
/** Все известные метки карт (верхний регистр), не считаются именами геометрических зон */
export declare const ALL_MCU_LABELS: ReadonlySet<string>;
export declare function normalizeMcuLabel(label: string): string;
export declare function detectFragmentFromLabel(label: string, current: FragmentId | null): FragmentId | null;
export declare function isKnownMcuLabel(label: string): boolean;
/** Для подсветки и cSpell: отсортированный список */
export declare function listAllMcuLabels(): string[];
export {};
