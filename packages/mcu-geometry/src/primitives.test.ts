import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { parseDocument, analyzeSemantics } from "@mcuhelper/mcu-language";
import { emptyBbox, bboxUnion, buildPrimitive, buildVars, isGlobalScope } from "./primitives";

describe("primitives", () => {
  it("emptyBbox returns zero box", () => {
    const b = emptyBbox();
    assert.strictEqual(b.min.x, 0);
    assert.strictEqual(b.max.z, 0);
  });

  it("bboxUnion expands bounds", () => {
    const a = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    const b = { min: { x: -1, y: 2, z: 0 }, max: { x: 2, y: 3, z: 5 } };
    const u = bboxUnion(a, b);
    assert.strictEqual(u.min.x, -1);
    assert.strictEqual(u.max.y, 3);
    assert.strictEqual(u.max.z, 5);
  });

  it("buildPrimitive for RPP", () => {
    const p = buildPrimitive("RPP", "B", ["0", "1", "0", "2", "0", "3"], new Map());
    assert.ok(p);
    assert.strictEqual(p!.type, "RPP");
    assert.strictEqual(p!.bbox.min.x, 0);
    assert.strictEqual(p!.bbox.max.z, 3);
  });

  it("buildPrimitive for RCZ and SPH", () => {
    const rcz = buildPrimitive("RCZ", "C", ["0", "0", "0", "10", "0.5"], new Map());
    assert.ok(rcz);
    const sph = buildPrimitive("SPH", "S", ["0", "0", "0", "1"], new Map());
    assert.ok(sph);
    assert.strictEqual(sph!.bbox.max.x, 1);
  });

  it("buildPrimitive for HEX", () => {
    const hex = buildPrimitive("HEX", "H", ["0", "0", "0", "1", "0", "10"], new Map());
    assert.ok(hex);
    assert.ok(hex!.bbox.max.z > hex!.bbox.min.z);
  });

  it("buildPrimitive returns null for insufficient params", () => {
    assert.strictEqual(buildPrimitive("RPP", "B", ["0"], new Map()), null);
  });

  it("buildVars evaluates constants from inline EQU", () => {
    const ast = parseDocument(
      `HEAD 1 0
EQU R = 10
SET A = R*2
FINISH`,
      { uri: "v.mcu" }
    );
    ast.diagnostics = analyzeSemantics(ast);
    const vars = buildVars(ast);
    assert.strictEqual(vars.get("R"), 10);
    assert.strictEqual(vars.get("A"), 20);
  });

  it("isGlobalScope", () => {
    assert.ok(isGlobalScope());
    assert.ok(isGlobalScope("global"));
    assert.ok(!isGlobalScope("cell:A"));
  });
});
