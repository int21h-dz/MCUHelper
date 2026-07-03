export interface CardLineParamHint {
    label: string;
    documentation: string;
}
/** Параметры на одной строке карты (без хвостов в [скобках] и без FINISH). */
export declare const CARD_LINE_PARAM_GROUPS: Record<string, CardLineParamHint[]>;
export declare function getCardLineParamGroups(cardLabel: string): CardLineParamHint[] | undefined;
/** Обязательная часть syntax до первой `[…]`. */
export declare function parseSyntaxRequiredPart(syntax: string): string[];
