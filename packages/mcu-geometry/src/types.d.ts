import type { DocumentAst } from "@mcuhelper/mcu-language";
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}
export interface BoundingBox {
    min: Vec3;
    max: Vec3;
}
export interface PrimitiveSolid {
    type: string;
    name: string;
    params: number[];
    bbox: BoundingBox;
    scope?: string;
    color?: string;
    zoneHint?: string;
}
export interface ZoneExprBodyRef {
    kind: "body";
    name: string;
}
export interface ZoneExprComplement {
    kind: "complement";
    operand: ZoneExpr;
}
export interface ZoneExprIntersect {
    kind: "intersect";
    operands: ZoneExpr[];
}
export interface ZoneExprUnion {
    kind: "union";
    operands: ZoneExpr[];
}
export type ZoneExpr = ZoneExprBodyRef | ZoneExprComplement | ZoneExprIntersect | ZoneExprUnion;
export interface ZoneSolid {
    name: string;
    expression: string;
    materialNum?: number;
    regNum?: number;
    objNum?: number;
    bodyRefs: string[];
    color: string;
    scope?: string;
    parsedExpression?: ZoneExpr;
}
export interface MaterialInfo {
    number: number;
    nuclides: {
        name: string;
        density: string;
    }[];
    temperature?: number;
}
export interface NetInstance {
    netName: string;
    cellIndex: [number, number, number];
    prototype: string;
    origin: Vec3;
    zones: ZoneSolid[];
}
export interface LatticeInstance {
    latticeName: string;
    elementName: string;
    transform: number[];
    zones: ZoneSolid[];
}
export interface GeometryScene {
    primitives: PrimitiveSolid[];
    zones: ZoneSolid[];
    nets: NetInstance[];
    lattices: LatticeInstance[];
    bbox: BoundingBox;
    cameraPresets: DocumentAst["cameraPresets"];
    materials: MaterialInfo[];
    activeScope: string;
}
export interface PointQueryResult {
    point: Vec3;
    zone?: {
        name: string;
        materialNum?: number;
        regNum?: number;
        objNum?: number;
        expression: string;
        color: string;
    };
    material?: MaterialInfo;
    objectNum?: number;
    bodyHits: string[];
}
export type SliceAxis = "x" | "y" | "z";
export interface SliceZoneMeta {
    index: number;
    name: string;
    color: string;
    materialNum?: number;
}
export interface SliceGrid {
    axis: SliceAxis;
    position: number;
    resolution: number;
    bounds: {
        uMin: number;
        uMax: number;
        vMin: number;
        vMax: number;
    };
    grid: number[][];
    zoneIndex: SliceZoneMeta[];
}
