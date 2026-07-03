import type { DocumentAst } from "./ast";
/** Первое числовое поле карты (после метки). */
export declare function parseStatementFirstNumber(text: string, vars: Map<string, number>): number | null;
export interface TotalHistoriesEstimate {
    ntot: number;
    maxser: number;
    total: number;
    nski?: number;
}
/** Суммарное число моделируемых историй: NTOT × MAXSER (последние значения в варианте). */
export declare function getTotalHistoriesEstimate(ast: DocumentAst): TotalHistoriesEstimate | null;
export declare function formatTotalHistoriesEstimate(estimate: TotalHistoriesEstimate): string;
