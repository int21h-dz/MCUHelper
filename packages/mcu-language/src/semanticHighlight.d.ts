import type { DocumentAst } from "./ast";
export type SemanticHighlightKind = "card" | "body" | "zone" | "nuclide" | "number" | "comment";
export interface SemanticTokenSpan {
    line: number;
    char: number;
    length: number;
    kind: SemanticHighlightKind;
}
/** Контекстная подсветка: карта / зона / тело / нуклид (поверх TextMate). */
export declare function buildSemanticTokenSpans(ast: DocumentAst, text: string): SemanticTokenSpan[];
export declare const SEMANTIC_TOKEN_LEGEND: SemanticHighlightKind[];
export declare function semanticKindToIndex(kind: SemanticHighlightKind): number;
