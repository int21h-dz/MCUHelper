import type { BodyNode, DocumentAst, ZoneNode } from "@mcuhelper/mcu-language";
import { buildZoneRegistrationMap } from "@mcuhelper/mcu-language";
import type { PointQueryResult, SliceAxis, SliceGrid, Vec3 } from "./types";
export interface GeometryContext {
    ast: DocumentAst;
    vars: Map<string, number>;
    bodies: Map<string, BodyNode>;
    bodyParams: Map<string, number[]>;
    bodyOrder: string[];
    zones: ZoneNode[];
    zoneReg: ReturnType<typeof buildZoneRegistrationMap>;
    scope?: string;
}
export declare function buildGeometryContext(ast: DocumentAst, scopeFilter?: (scope?: string) => boolean): GeometryContext;
export declare function findBodiesAtPoint(ctx: GeometryContext, p: Vec3): string[];
export declare function queryPoint(ast: DocumentAst, p: Vec3): PointQueryResult;
export declare function buildSliceGrid(ast: DocumentAst, axis: SliceAxis, position: number, resolution?: number, bbox?: {
    min: Vec3;
    max: Vec3;
}): SliceGrid;
export declare function computeSceneBbox(ast: DocumentAst): {
    min: Vec3;
    max: Vec3;
};
