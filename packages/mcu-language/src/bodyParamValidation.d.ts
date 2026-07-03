import type { BodyNode, DiagnosticMessage, DocumentAst } from "./ast";
export declare function validateBodyArgCount(body: BodyNode, stmtText: string): DiagnosticMessage | null;
export declare function analyzeBodyParameterCounts(ast: DocumentAst): DiagnosticMessage[];
