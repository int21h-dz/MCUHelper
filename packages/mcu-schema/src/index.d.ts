export interface CardSchema {
    label: string;
    title: string;
    syntax: string;
    description: string;
    defaults?: string;
    example?: string;
    fragment?: string;
}
export interface BodyTypeSchema {
    key: string;
    letter: string;
    title: string;
    paramCount: number | "var";
    paramNames: string[];
    description: string;
    snippet: string;
}
export declare const FRAGMENT_ORDER: readonly ["physical", "geometry", "source", "registration", "burnupRegistration", "trajectory", "calculationControl", "burnup"];
export type FragmentId = (typeof FRAGMENT_ORDER)[number];
export declare const FRAGMENT_MARKERS: Record<FragmentId, string[]>;
export declare const PIN_CARDS: CardSchema[];
export declare const GEO_CARDS: CardSchema[];
export declare const BODY_TYPES: BodyTypeSchema[];
export declare const EXTENDED_CARDS: CardSchema[];
export declare const MODS_VALUES: string[];
export declare const BOUNDARY_CODES: {
    code: string;
    title: string;
}[];
export declare const ALL_CARDS: CardSchema[];
export declare function formatCardHover(card: CardSchema): string;
export declare function getCardByLabel(label: string): CardSchema | undefined;
export declare function getBodyByKey(key: string): BodyTypeSchema | undefined;
export { ALL_MCU_LABELS, MCU_LABEL_ALIASES, MCU_LABELS_BY_FRAGMENT, detectFragmentFromLabel, isKnownMcuLabel, listAllMcuLabels, normalizeMcuLabel, } from "./keywords";
export { CARD_ARG_SPECS, getCardArgSpec, parseCardArgContext, type CardArgContext, type CardArgEnumValue, type CardArgSpec, } from "./cardArgEnums";
export { BODY_PARAM_GROUPS, getBodyParamGroups, type BodyParamGroup } from "./bodyParamGroups";
export { CARD_LINE_PARAM_GROUPS, getCardLineParamGroups, parseSyntaxRequiredPart, } from "./cardLineParamGroups";
export { NUCLIDE_LINE_PARAM_GROUPS, getNuclideLineParamGroups, type NuclideLineParamHint, } from "./nuclideLineParamGroups";
export { buildCatalogPayload, CARD_SNIPPETS, FRAGMENT_DISPLAY, getCardInsertText, MODULE_TEMPLATES, padBurnupLabel, type CatalogCardGroup, type CatalogCardItem, type CatalogModulePayload, type InsertFormat, } from "./catalog";
