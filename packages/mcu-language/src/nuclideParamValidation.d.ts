import type { DiagnosticMessage, DocumentAst, SourceRange } from "./ast";
declare const OPTIONAL_PARAM_KEYS: readonly ["ACE", "MODS", "DTEM", "PHT"];
export declare function isNuclideCompositionLinePrefix(prefix: string): boolean;
export declare function findNuclideLineExtraTokens(text: string): string[];
export declare function validateNuclideLineExtras(text: string, range: SourceRange, matNumber: number): DiagnosticMessage | null;
export declare function analyzeDuplicateNuclides(ast: DocumentAst): DiagnosticMessage[];
export declare function analyzeNuclideParameterCounts(ast: DocumentAst): DiagnosticMessage[];
export { OPTIONAL_PARAM_KEYS };
