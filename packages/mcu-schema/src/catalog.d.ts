import type { CardSchema, FragmentId } from "./index";
export declare const FRAGMENT_DISPLAY: Record<FragmentId, string>;
export declare const MODULE_TEMPLATES: Record<FragmentId, string>;
/** Явные шаблоны вставки для частых карт (VS Code snippet syntax). */
export declare const CARD_SNIPPETS: Record<string, string>;
export type InsertFormat = "snippet" | "plain";
export interface CatalogCardItem {
    label: string;
    title: string;
    syntax: string;
    description: string;
    example?: string;
    insertText: string;
    insertFormat: InsertFormat;
}
export interface CatalogCardGroup {
    title: string;
    items: CatalogCardItem[];
}
export interface CatalogModulePayload {
    id: FragmentId;
    title: string;
    marker: string;
    template: string;
    cardGroups: CatalogCardGroup[];
}
export declare function padBurnupLabel(label: string): string;
export declare function getCardInsertText(card: CardSchema, fragmentId?: FragmentId): {
    text: string;
    format: InsertFormat;
};
export declare function buildCatalogPayload(): CatalogModulePayload[];
