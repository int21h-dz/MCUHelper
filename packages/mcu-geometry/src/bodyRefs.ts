import type { GeometryContext } from "./query";

/**
 * MCU-NR: если тело названо N&lt;n&gt;, в зонах можно ссылаться числом n (UserGuide 9.1.4).
 */
export function resolveBodyRef(ref: string, ctx: GeometryContext): string {
  if (/^\d+$/.test(ref)) {
    const nName = `N${ref}`;
    if (ctx.bodies.has(nName)) return nName;
    const idx = parseInt(ref, 10) - 1;
    if (idx >= 0 && idx < ctx.bodyOrder.length) return ctx.bodyOrder[idx];
  }
  return ref;
}

/** UserGuide §9.1.4: ссылка 0 в зоне — всё пространство, не тело N0. */
export function isAllSpaceBodyRef(ref: string): boolean {
  return ref === "0";
}

export function isBodyRefInHits(ref: string, hits: string[], ctx: GeometryContext): boolean {
  if (isAllSpaceBodyRef(ref)) return true;
  return hits.includes(resolveBodyRef(ref, ctx));
}
