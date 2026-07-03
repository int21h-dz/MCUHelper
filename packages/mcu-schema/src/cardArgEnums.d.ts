export interface CardArgEnumValue {
    value: string;
    title: string;
}
export type CardArgSpec = {
    kind: "enum";
    multi: boolean;
    values: CardArgEnumValue[];
} | {
    kind: "materialNumbers";
    title: string;
};
/** Допустимые токены аргументов карт (UserGuide §12, выгорание). */
export declare const CARD_ARG_SPECS: Record<string, CardArgSpec>;
export declare function getCardArgSpec(cardLabel: string): CardArgSpec | undefined;
export interface CardArgContext {
    card: string;
    spec: CardArgSpec;
    usedValues: Set<string>;
    partial: string;
}
/** Курсор в аргументах карты (после «CARD …»). */
export declare function parseCardArgContext(linePrefix: string): CardArgContext | null;
