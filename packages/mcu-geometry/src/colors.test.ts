import { describe, it } from "node:test";
import assert from "node:assert";
import { colorForMaterial, colorForZone, colorForBody, PALETTE } from "./colors";

describe("colors", () => {
  it("colorForMaterial cycles palette", () => {
    assert.strictEqual(colorForMaterial(1), PALETTE[0]);
    assert.strictEqual(colorForMaterial(2), PALETTE[1]);
    assert.strictEqual(colorForMaterial(undefined), "#888888");
  });

  it("colorForZone wraps index", () => {
    assert.strictEqual(colorForZone(0), PALETTE[0]);
    assert.strictEqual(colorForZone(PALETTE.length), PALETTE[0]);
  });

  it("colorForBody is deterministic", () => {
    assert.strictEqual(colorForBody("FU"), colorForBody("FU"));
    assert.strictEqual(colorForBody("N1"), colorForBody("N1"));
  });
});
