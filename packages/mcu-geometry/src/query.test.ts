import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { parseDocument } from "@mcuhelper/mcu-language";
import { parseZoneExpression, collectBodyRefs } from "./zoneExpression";
import { buildSliceGrid, computeSceneBbox, queryPoint } from "./query";

const fixtures = path.join(__dirname, "../../../test/fixtures");

describe("zoneExpression extended", () => {
  it("collectBodyRefs from intersection", () => {
    const ast = parseZoneExpression("ZA -FU")!;
    const refs = collectBodyRefs(ast);
    assert.ok(refs.includes("ZA"));
    assert.ok(refs.includes("FU"));
  });

  it("returns null for empty expression", () => {
    assert.strictEqual(parseZoneExpression(""), null);
    assert.strictEqual(parseZoneExpression("   "), null);
  });

  it("parses nested parentheses", () => {
    const ast = parseZoneExpression("(A U B) -C");
    assert.ok(ast);
  });
});

describe("query computeSceneBbox", () => {
  it("bbox spans trx geometry bodies", () => {
    const text = fs.readFileSync(path.join(fixtures, "trx_geometry.mcu"), "utf8");
    const ast = parseDocument(text, { uri: "trx" });
    const bb = computeSceneBbox(ast);
    assert.ok(bb.max.x > bb.min.x);
    assert.ok(bb.max.z > bb.min.z);
  });
});

describe("queryPoint and buildSliceGrid", () => {
  it("queryPoint finds zone in trx fuel channel", () => {
    const text = fs.readFileSync(path.join(fixtures, "trx_geometry.mcu"), "utf8");
    const ast = parseDocument(text, { uri: "trx" });
    const hit = queryPoint(ast, { x: 0, y: 0, z: 50 });
    assert.ok(hit.zone?.name || hit.bodyHits.length > 0);
  });

  it("buildSliceGrid works on y and x axes", () => {
    const text = fs.readFileSync(path.join(fixtures, "trx_geometry.mcu"), "utf8");
    const ast = parseDocument(text, { uri: "trx" });
    const sliceY = buildSliceGrid(ast, "y", 0, 32);
    const sliceX = buildSliceGrid(ast, "x", 0, 32);
    assert.strictEqual(sliceY.axis, "y");
    assert.strictEqual(sliceX.axis, "x");
    assert.ok(sliceY.grid.length > 0);
    assert.ok(sliceX.grid.length > 0);
  });

  it("queryPoint on latt_example resolves lattice host", () => {
    const text = fs.readFileSync(path.join(fixtures, "latt_example.mcu"), "utf8");
    const ast = parseDocument(text, { uri: "latt" });
    const hit = queryPoint(ast, { x: 0, y: 0, z: 0 });
    assert.ok(hit.zone?.name || hit.bodyHits.length > 0);
  });
});
