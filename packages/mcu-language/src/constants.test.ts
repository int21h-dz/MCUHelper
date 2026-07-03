import { describe, it } from "node:test";
import assert from "node:assert";
import { FRAGMENT_ORDER, getBodyParamCount } from "./constants";

describe("constants", () => {
  it("FRAGMENT_ORDER has 8 entries", () => {
    assert.strictEqual(FRAGMENT_ORDER.length, 8);
    assert.strictEqual(FRAGMENT_ORDER[0], "physical");
    assert.strictEqual(FRAGMENT_ORDER[1], "geometry");
  });

  it("getBodyParamCount for known bodies", () => {
    assert.strictEqual(getBodyParamCount("RCZ"), 5);
    assert.strictEqual(getBodyParamCount("RPP"), 6);
    assert.strictEqual(getBodyParamCount("ARB"), "var");
    assert.strictEqual(getBodyParamCount("UNKNOWN"), undefined);
  });

  it("getBodyParamCount is case-insensitive", () => {
    assert.strictEqual(getBodyParamCount("rcz"), 5);
  });
});
