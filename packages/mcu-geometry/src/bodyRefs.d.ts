import type { GeometryContext } from "./query";
/**
 * MCU-NR: если тело названо N&lt;n&gt;, в зонах можно ссылаться числом n (UserGuide 9.1.4).
 */
export declare function resolveBodyRef(ref: string, ctx: GeometryContext): string;
export declare function isBodyRefInHits(ref: string, hits: string[], ctx: GeometryContext): boolean;
