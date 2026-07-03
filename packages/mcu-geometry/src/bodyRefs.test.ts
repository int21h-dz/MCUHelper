import { describe, it } from "node:test";
import assert from "node:assert";
import { resolveBodyRef, isBodyRefInHits } from "./bodyRefs";
import type { GeometryContext } from "./query";

function makeCtx(bodyNames: string[]): GeometryContext {
  const bodies = new Map<string, unknown>();
  for (const n of bodyNames) bodies.set(n, {});
  return {
    bodies,
    bodyOrder: bodyNames,
    zones: [],
    materials: new Map(),
    vars: new Map(),
    lattices: [],
    nets: [],
  } as unknown as GeometryContext;
}

describe("bodyRefs", () => {
  it("resolveBodyRef maps numeric ref to N-name", () => {
    const ctx = makeCtx(["N1", "N2", "FU"]);
    assert.strictEqual(resolveBodyRef("1", ctx), "N1");
    assert.strictEqual(resolveBodyRef("FU", ctx), "FU");
  });

  it("resolveBodyRef maps index when no N-name", () => {
    const ctx = makeCtx(["A", "B", "C"]);
    assert.strictEqual(resolveBodyRef("2", ctx), "B");
  });

  it("isBodyRefInHits treats 0 as all space", () => {
    const ctx = makeCtx(["N1"]);
    assert.ok(isBodyRefInHits("0", [], ctx));
    assert.ok(!isBodyRefInHits("1", [], ctx));
  });

  it("isBodyRefInHits checks resolved name", () => {
    const ctx = makeCtx(["N1", "ZA"]);
    assert.ok(isBodyRefInHits("1", ["N1"], ctx));
    assert.ok(!isBodyRefInHits("1", ["ZA"], ctx));
  });
});
