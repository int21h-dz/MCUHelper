import { describe, it } from "node:test";
import assert from "node:assert";
import { pointInBody } from "./pointInBody";

describe("pointInBody extended", () => {
  it("SPH inside and outside", () => {
    assert.ok(pointInBody("SPH", [0, 0, 0, 1], { x: 0, y: 0, z: 0 }));
    assert.ok(!pointInBody("SPH", [0, 0, 0, 1], { x: 2, y: 0, z: 0 }));
  });

  it("RCC along Z axis", () => {
    assert.ok(pointInBody("RCC", [0, 0, 0, 0, 0, 10, 0.5], { x: 0, y: 0, z: 5 }));
    assert.ok(!pointInBody("RCC", [0, 0, 0, 0, 0, 10, 0.5], { x: 1, y: 0, z: 5 }));
  });

  it("BOX unit cube", () => {
    const params = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    assert.ok(pointInBody("BOX", params, { x: 0.5, y: 0.5, z: 0.5 }));
    assert.ok(!pointInBody("BOX", params, { x: 1.5, y: 0.5, z: 0.5 }));
  });

  it("PLX half-space", () => {
    assert.ok(pointInBody("PLX", [0], { x: 1, y: 0, z: 0 }));
    assert.ok(!pointInBody("PLX", [0], { x: -1, y: 0, z: 0 }));
  });

  it("PLG plane", () => {
    assert.ok(pointInBody("PLG", [1, 0, 0, 0], { x: 1, y: 0, z: 0 }));
    assert.ok(!pointInBody("PLG", [1, 0, 0, 0], { x: -1, y: 0, z: 0 }));
  });

  it("HEXX and HEXY prisms", () => {
    const hexx = [0, 0, 0, 10, 1, 0];
    assert.ok(pointInBody("HEXX", hexx, { x: 0, y: 0, z: 5 }));
    const hexy = [0, 0, 0, 10, 1, 90];
    assert.ok(pointInBody("HEXY", hexy, { x: 0, y: 0, z: 5 }));
  });

  it("unknown body type returns false", () => {
    assert.ok(!pointInBody("UNKNOWN", [0], { x: 0, y: 0, z: 0 }));
  });
});
