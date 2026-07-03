import type { DiagnosticMessage, DocumentAst } from "./ast";
export type EnergyGroupIssueCode = "energy-empty" | "energy-non-finite" | "energy-negative" | "energy-order" | "energy-missing-zero";
export interface EnergyGroupValidationIssue {
    code: EnergyGroupIssueCode;
    message: string;
}
/** Нижние границы ENERGY: ≥ 0, строго убывают; по UserGuide последняя граница — 0. */
export declare function validateEnergyGroupValues(values: number[]): EnergyGroupValidationIssue[];
export declare function analyzeEnergyGroupStatements(ast: DocumentAst): DiagnosticMessage[];
