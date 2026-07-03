import type { DiagnosticMessage, DocumentAst } from "./ast";
export interface PositiveQtyIssue {
    code: "positive-qty" | "positive-step-count";
    message: string;
}
/** Значение ≥ 0 (0 допустим). */
export declare function checkNonNegativeToken(token: string, vars: Map<string, number>, fieldLabel: string): PositiveQtyIssue | null;
export declare function analyzePositiveQuantities(ast: DocumentAst): DiagnosticMessage[];
/** Для тестов: все числа после метки карты. */
export declare function parseCardNumbers(text: string, vars: Map<string, number>): number[];
