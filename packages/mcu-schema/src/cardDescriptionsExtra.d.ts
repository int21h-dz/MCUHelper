type FragmentId = "physical" | "geometry" | "source" | "registration" | "burnupRegistration" | "trajectory" | "calculationControl" | "burnup";
interface ExtraCard {
    label: string;
    title: string;
    syntax: string;
    description: string;
    defaults?: string;
    example?: string;
    fragment?: FragmentId;
}
/** Ручные описания карт, которые плохо извлекаются из TXT (§10–15 UserGuide). */
export declare const EXTRA_CARD_DESCRIPTIONS: ExtraCard[];
export {};
