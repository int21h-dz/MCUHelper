import type { DiagnosticMessage, DocumentAst, SourceRange } from "./ast";
export declare function validateMatrLineParams(text: string, range: SourceRange, matNumber: number): DiagnosticMessage[];
export declare function analyzeMatrCardParams(ast: DocumentAst): DiagnosticMessage[];
