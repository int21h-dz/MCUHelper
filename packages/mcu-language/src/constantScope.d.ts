import type { ConstantNode, DocumentAst, SourceRange, StatementNode } from "./ast";
/** Ключ имени константы в пределах scope (global | cell:NAME | lcell:NAME). */
export declare function constScopeKey(scope: string | undefined, name: string): string;
export declare function isConstantDefinedBefore(c: ConstantNode, line: number, character?: number): boolean;
/**
 * Scope геометрии на строке line (0-based): global | lcell:NAME | cell:NAME.
 * CELL: первый END — конец тел; второй END — конец зон (EXTEND: затем LATT, закрытие ENDXCL).
 */
export declare function resolveScopeAtLine(statements: StatementNode[], line: number): string;
export declare function resolveScopeAtPosition(ast: DocumentAst, line: number, character?: number): string;
export interface VisibleConstant {
    name: string;
    expression: string;
    value: number | null;
    mutable: boolean;
    /** scope определения (global или прототип) */
    scope: string;
    range: SourceRange;
}
/**
 * Эффективный набор констант/переменных в позиции курсора: global + локальные прототипа,
 * локальные перекрывают global с тем же именем.
 */
export declare function listVisibleConstants(constants: ConstantNode[], contextScope: string, line: number, character?: number): VisibleConstant[];
/**
 * Константы/переменные, видимые в точке beforeOffset внутри contextScope.
 * Глобальные EQU/SET + локальные прототипа (перекрывают глобальные с тем же именем).
 * См. UserGuide: CELL §9.2.2, LCELL §9.2.5 (txt ~3264, ~3541).
 */
export declare function buildScopedVars(constants: ConstantNode[], beforeOffset: number, contextScope?: string): Map<string, number>;
