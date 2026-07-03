"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBodyRef = resolveBodyRef;
exports.isBodyRefInHits = isBodyRefInHits;
/**
 * MCU-NR: если тело названо N&lt;n&gt;, в зонах можно ссылаться числом n (UserGuide 9.1.4).
 */
function resolveBodyRef(ref, ctx) {
    if (/^\d+$/.test(ref)) {
        const nName = `N${ref}`;
        if (ctx.bodies.has(nName))
            return nName;
        const idx = parseInt(ref, 10) - 1;
        if (idx >= 0 && idx < ctx.bodyOrder.length)
            return ctx.bodyOrder[idx];
    }
    return ref;
}
function isBodyRefInHits(ref, hits, ctx) {
    return hits.includes(resolveBodyRef(ref, ctx));
}
//# sourceMappingURL=bodyRefs.js.map