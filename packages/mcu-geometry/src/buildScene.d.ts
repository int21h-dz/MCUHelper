import type { DocumentAst } from "@mcuhelper/mcu-language";
import type { GeometryScene } from "./types";
export declare function buildScene(ast: DocumentAst): GeometryScene;
/** @deprecated Используйте buildSliceGrid из query.ts */
export declare function sliceAtZ(scene: GeometryScene, z: number): {
    type: string;
    name: string;
    x: number;
    y: number;
    r?: number;
    color: string;
}[];
