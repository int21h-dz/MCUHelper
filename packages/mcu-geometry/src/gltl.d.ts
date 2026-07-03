import type { LatticeNode } from "@mcuhelper/mcu-language";
import type { Vec3 } from "./types";
export interface GltlPlacement {
    protoIndex: number;
    offset: Vec3;
}
/** Парсинг PARM для генератора GLTL: [/n] x,y,z с пропуском /RZG, /2 и т.п. */
export declare function parseGltlPlacements(lattice: LatticeNode, vars: Map<string, number>): GltlPlacement[];
export declare function translatePoint(p: Vec3, dx: number, dy: number, dz: number): Vec3;
export declare function latticeHostZones(lat: LatticeNode): string[];
