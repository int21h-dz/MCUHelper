export declare function evaluateExpression(expr: string, vars: Map<string, number>): number | null;
/** Имена пользовательских констант/переменных, на которые ссылается выражение (без встроенных функций). */
export declare function collectVariableReferences(expr: string): string[];
export declare function findUndefinedVariables(expr: string, vars: Map<string, number>): string[];
export declare function parseNumbers(params: string[], vars: Map<string, number>): number[];
