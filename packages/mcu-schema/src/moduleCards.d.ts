type FragmentId = "physical" | "geometry" | "source" | "registration" | "burnupRegistration" | "trajectory" | "calculationControl" | "burnup";
interface ModuleCardSchema {
    label: string;
    title: string;
    syntax: string;
    description: string;
    defaults?: string;
    example?: string;
    fragment?: FragmentId;
}
/** Карты модуля источников (UserGuide §10.2). */
export declare const SOURCE_CARDS: ModuleCardSchema[];
/** Дополнительные карты регистрации (энергетические группы по зонам). */
export declare const REGISTRATION_EXTRA_CARDS: ModuleCardSchema[];
/** Карты физического модуля (дополнение к PIN_CARDS). */
export declare const PHYSICAL_EXTRA_CARDS: ModuleCardSchema[];
export {};
