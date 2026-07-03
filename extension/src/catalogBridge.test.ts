import { describe, it } from "node:test";
import assert from "node:assert";
import { buildCatalogPayload } from "./catalogBridge";

describe("catalogBridge", () => {
  it("buildCatalogPayload returns 8 modules", () => {
    const modules = buildCatalogPayload();
    assert.strictEqual(modules.length, 8);
    for (const mod of modules) {
      assert.ok(mod.title.length > 0);
      assert.ok(mod.cardGroups.length > 0);
    }
  });
});
