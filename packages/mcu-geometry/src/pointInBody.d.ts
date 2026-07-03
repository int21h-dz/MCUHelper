import type { BodyNode } from "@mcuhelper/mcu-language";
import type { Vec3 } from "./types";
export declare function pointInBody(bodyType: string, params: number[], p: Vec3): boolean;
export declare function pointInBodyNode(body: BodyNode, params: number[], p: Vec3): boolean;
