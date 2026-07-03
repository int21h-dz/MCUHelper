import { describe, it } from "node:test";
import assert from "node:assert";
import {
  hexFlatToFlat,
  hexKeyAngle,
  pointInRegularHexXY,
  hexBboxXY,
} from "./hex2d";

describe("hex2d", () => {
  it("hexFlatToFlat computes vector length", () => {
    assert.strictEqual(hexFlatToFlat(3, 4), 5);
    assert.strictEqual(hexFlatToFlat(0, 0), 0);
  });

  it("hexKeyAngle for axis-aligned vector", () => {
    assert.ok(Math.abs(hexKeyAngle(1, 0)) < 1e-9);
    assert.ok(Math.abs(hexKeyAngle(0, 1) - Math.PI / 2) < 1e-9);
  });

  it("pointInRegularHexXY center inside", () => {
    assert.ok(pointInRegularHexXY(0, 0, 0, 0, 2, 0));
    assert.ok(!pointInRegularHexXY(10, 0, 0, 0, 2, 0));
  });

  it("pointInRegularHexXY rejects D<=0", () => {
    assert.ok(!pointInRegularHexXY(0, 0, 0, 0, 0, 0));
  });

  it("hexBboxXY encloses hex vertices", () => {
    const bb = hexBboxXY(0, 0, 2, 0);
    assert.ok(bb.minX < 0);
    assert.ok(bb.maxX > 0);
    assert.ok(bb.maxY > 0);
    assert.ok(bb.minY < 0);
  });
});
