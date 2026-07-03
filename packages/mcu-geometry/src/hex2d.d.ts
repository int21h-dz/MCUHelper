/** Правильная шестиугольная призма MCU-NR (HEX): плоскость OXY, ось OZ. */
export declare function hexFlatToFlat(vx: number, vy: number): number;
export declare function hexKeyAngle(vx: number, vy: number): number;
/**
 * Точка в правильном шестиугольнике: D — размер «под ключ» (|V_xy|),
 * φ — направление вектора ключа в плоскости OXY.
 */
export declare function pointInRegularHexXY(px: number, py: number, cx: number, cy: number, D: number, phi: number): boolean;
export declare function hexBboxXY(cx: number, cy: number, D: number, phi: number): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
};
