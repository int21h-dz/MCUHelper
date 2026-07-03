import type { ZoneExpr } from "./types";
/** Парсер булевых выражений зон MCU-NR: `-` > ∩ > `U`. */
export declare function parseZoneExpression(expression: string): ZoneExpr | null;
export declare function collectBodyRefs(expr: ZoneExpr): string[];
export declare function evalZoneExpr(expr: ZoneExpr, isInBody: (name: string) => boolean): boolean;
