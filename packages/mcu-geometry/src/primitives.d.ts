import type { DocumentAst } from "@mcuhelper/mcu-language";
import type { BoundingBox, PrimitiveSolid } from "./types";
export declare function emptyBbox(): BoundingBox;
export declare function bboxUnion(a: BoundingBox, b: BoundingBox): BoundingBox;
export declare function buildPrimitive(bodyType: string, name: string, params: string[], vars: Map<string, number>, scope?: string): PrimitiveSolid | null;
export declare function buildVars(ast: DocumentAst): Map<string, number>;
export declare function isGlobalScope(scope?: string): boolean;
