import type { DiagnosticMessage, StatementNode, SourceRange } from "./ast";
/** Бесформатный ввод модуля выгорания (разд. 7.2, 15): имя в кол. 1-6, данные 7-72 */
export interface BurnupCard {
    name: string;
    words: string[];
    line: number;
    range: SourceRange;
}
export declare function parseBurnupLines(lines: string[], startLine: number): {
    cards: BurnupCard[];
    diagnostics: DiagnosticMessage[];
};
export declare function isModuleCardLabel(label: string): boolean;
export declare function classifyOtherModule(stmt: StatementNode): string | null;
