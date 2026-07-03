import type { DocumentAst } from "./ast";
export declare function parseStatementNumbers(text: string, vars: Map<string, number>): number[];
export interface PowerPlateau {
    qKw: number;
    tEndDays: number;
}
export interface StepPlateau {
    tEndDays: number;
    stepCount: number;
    dtDays: number;
}
export interface BurnupLoadAnalysis {
    powerPlateaus: PowerPlateau[];
    stepPlateaus: StepPlateau[];
    /** true — длины отрезков (DSTP), false — накопленное время (STEP). */
    stepIncremental: boolean;
    totalTimeDays: number;
    totalSteps: number;
    totalEnergyKwd: number;
}
/** POWE/POWER: пары q (кВт), t (сут) — верхняя граница интервала; одно q — постоянная мощность. */
export declare function parsePowePlateaus(values: number[]): PowerPlateau[];
/** STEP: пары t (сут, накопленное T), n — число шагов на отрезке Ti−1…Ti (T0=0). */
export declare function parseStepPlateausCumulative(values: number[]): StepPlateau[];
/** DSTP: пары t — длина отрезка (сут), n — число шагов на нём. */
export declare function parseDstpPlateaus(values: number[]): StepPlateau[];
/**
 * Если границы t убывают (20, 3, 10, 2) — это длины отрезков, как DSTP, а не накопленное STEP.
 */
export declare function isIncrementalStepTimeValues(values: number[]): boolean;
export declare function parseStepPlateaus(values: number[], incremental?: boolean): StepPlateau[];
export declare function powerAtTime(plateaus: PowerPlateau[], tDays: number): number;
export declare function integrateEnergyKwd(plateaus: PowerPlateau[], tMaxDays: number): number;
/** Узлы времени: границы мощности, шагов и подшагов. */
export declare function collectBurnupTimeKnots(analysis: BurnupLoadAnalysis): number[];
export declare function getBurnupLoadAnalysis(ast: DocumentAst): BurnupLoadAnalysis | null;
export declare function formatEnergyOutput(kwd: number): string;
