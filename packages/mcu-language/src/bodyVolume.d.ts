import type { BodyNode, DocumentAst } from "./ast";
export declare function formatBodyVolumeCm3(volume: number): string;
/**
 * Объём тела (см³) по аналитическим формулам UserGuide §9.1.3.
 * Полупространства (PLX/PLY/PLZ/PLG), бесконечные цилиндры (UC*) — null.
 */
export declare function computeBodyVolumeCm3(body: BodyNode, vars: Map<string, number>, siblings?: BodyNode[]): number | null;
export declare function computeBodyVolumeCm3FromAst(body: BodyNode, ast: DocumentAst): number | null;
