import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { parseDocument } from "@mcuhelper/mcu-language";
import { buildScene, sliceAtZ } from "./buildScene";

const fixtures = path.join(__dirname, "../../../test/fixtures");

describe("buildScene", () => {
  it("builds scene from trx fixture", () => {
    const ast = parseDocument(fs.readFileSync(path.join(fixtures, "trx_geometry.mcu"), "utf8"), { uri: "trx" });
    const scene = buildScene(ast);
    assert.ok(scene.primitives.length > 0);
    assert.ok(scene.zones.length > 0);
    assert.ok(scene.materials.length >= 0);
    assert.ok(scene.bbox.max.x > scene.bbox.min.x);
  });

  it("sliceAtZ returns circles for RCZ bodies", () => {
    const ast = parseDocument(fs.readFileSync(path.join(fixtures, "trx_geometry.mcu"), "utf8"), { uri: "trx2" });
    const scene = buildScene(ast);
    const shapes = sliceAtZ(scene, 50);
    assert.ok(shapes.length > 0);
    assert.ok(shapes.some((s) => s.type === "circle"));
  });

  it("includes nets and lattices when present", () => {
    const ast = parseDocument(fs.readFileSync(path.join(fixtures, "latt_example.mcu"), "utf8"), { uri: "latt" });
    const scene = buildScene(ast);
    assert.ok(scene.lattices.length > 0);
  });

  it("uses default bbox when no global bodies", () => {
    const ast = parseDocument("PIN 1 0\nFINISH", { uri: "empty" });
    const scene = buildScene(ast);
    assert.strictEqual(scene.primitives.length, 0);
    assert.ok(scene.bbox.max.x === 10);
  });
});
