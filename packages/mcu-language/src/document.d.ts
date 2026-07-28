import type { DocumentAst } from "./ast";
import { type ParseOptions } from "./parser";
import { buildSummaries } from "./semantic";
export interface DocumentIndex {
    uri: string;
    version: number;
    ast: DocumentAst;
    hash: string;
    summaries: ReturnType<typeof buildSummaries>;
}
export declare function analyzeDocument(uri: string, text: string, version: number, options?: Partial<ParseOptions>): DocumentIndex;
export declare function getDocumentIndex(uri: string, expanded?: boolean): DocumentIndex | undefined;
export declare function clearDocument(uri: string): void;
