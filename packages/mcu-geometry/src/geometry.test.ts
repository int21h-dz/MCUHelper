import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { parseDocument } from "@mcuhelper/mcu-language";
import {
  parseZoneExpression,
  evalZoneExpr,
  pointInBody,
  queryPoint,
  buildSliceGrid,
  buildScene,
} from "./index";

const fixtures = path.join(__dirname, "../../../test/fixtures");

function loadFixture(name: string) {
  const text = fs.readFileSync(path.join(fixtures, name), "utf8");
  return parseDocument(text, { uri: name });
}

describe("zoneExpression", () => {
  it("parses intersection with complement", () => {
    const ast = parseZoneExpression("ZA -FU");
    assert.ok(ast);
    assert.strictEqual(ast!.kind, "intersect");
    if (ast!.kind === "intersect") {
      assert.strictEqual(ast.operands.length, 2);
      assert.strictEqual(ast.operands[0].kind, "body");
      assert.strictEqual(ast.operands[1].kind, "complement");
    }
  });

  it("parses union", () => {
    const ast = parseZoneExpression("A U B");
    assert.ok(ast);
    assert.strictEqual(ast!.kind, "union");
  });

  it("evaluates complement", () => {
    const ast = parseZoneExpression("ZA -FU")!;
    const inZaOnly = (n: string) => n === "ZA";
    assert.strictEqual(evalZoneExpr(ast, inZaOnly), true);
    const inBoth = (n: string) => n === "ZA" || n === "FU";
    assert.strictEqual(evalZoneExpr(ast, inBoth), false);
  });
});

describe("pointInBody", () => {
  it("RCZ center", () => {
    assert.ok(pointInBody("RCZ", [0, 0, 0, 100, 0.5], { x: 0, y: 0, z: 50 }));
    assert.ok(!pointInBody("RCZ", [0, 0, 0, 100, 0.5], { x: 1, y: 0, z: 50 }));
  });

  it("RPP inside", () => {
    assert.ok(pointInBody("RPP", [-1, 1, -1, 1, -1, 1], { x: 0, y: 0, z: 0 }));
    assert.ok(!pointInBody("RPP", [-1, 1, -1, 1, -1, 1], { x: 2, y: 0, z: 0 }));
  });
});

describe("queryPoint trx", () => {
  const ast = loadFixture("trx_geometry.mcu");

  it("fuel at center", () => {
    const r = queryPoint(ast, { x: 0, y: 0, z: 50 });
    assert.strictEqual(r.zone?.name, "FUEL");
    assert.strictEqual(r.zone?.materialNum, 1);
    assert.strictEqual(r.zone?.regNum, 1);
    assert.ok(r.bodyHits.includes("FU"));
  });

  it("space between fuel and clad", () => {
    const r = queryPoint(ast, { x: 0.5, y: 0, z: 50 });
    assert.strictEqual(r.zone?.name, "SPACE");
    assert.strictEqual(r.zone?.materialNum, 4);
    assert.strictEqual(r.zone?.regNum, 2);
    assert.strictEqual(r.zone?.objNum, 1);
  });

  it("water outside clad", () => {
    const r = queryPoint(ast, { x: 0.9, y: 0, z: 50 });
    assert.strictEqual(r.zone?.name, "WATR");
    assert.strictEqual(r.zone?.materialNum, 2);
    assert.strictEqual(r.zone?.regNum, 4);
  });
});

describe("queryPoint full_variant", () => {
  const ast = loadFixture("full_variant.mcu");

  it("fuel at center with material", () => {
    const r = queryPoint(ast, { x: 0, y: 0, z: 50 });
    assert.strictEqual(r.zone?.name, "FUEL");
    assert.strictEqual(r.material?.number, 1);
    assert.ok(r.material?.nuclides.some((n) => n.name === "U235"));
  });
});

describe("gor_sp numeric zone refs", () => {
  it("parses GRBL 1 -2", () => {
    const ast = parseZoneExpression("1 -2");
    assert.ok(ast);
    assert.strictEqual(ast!.kind, "intersect");
  });

  it("queryPoint graphite annulus", () => {
    const text = fs.readFileSync(path.join(__dirname, "../../../RUNTEST/N_PH/gor_sp"), "utf8");
    const ast = parseDocument(text, { uri: "gor_sp" });
    const r = queryPoint(ast, { x: 10, y: 0, z: 350 });
    assert.strictEqual(r.zone?.name, "GRBL");
    const rHole = queryPoint(ast, { x: 0, y: 0, z: 350 });
    assert.notStrictEqual(rHole.zone?.name, "GRBL");
  });

  it("ring rod offset from center", () => {
    const text = fs.readFileSync(path.join(__dirname, "../../../RUNTEST/N_PH/gor_sp"), "utf8");
    const ast = parseDocument(text, { uri: "gor_sp" });
    const scene = buildScene(ast);
    const n6 = scene.primitives.find((p) => p.name === "N6");
    assert.ok(n6);
    assert.ok(Math.abs(n6!.params[0]) > 0.5);
    assert.ok(Math.abs(n6!.params[1]) > 0.5);
  });
});

describe("burnup hex container", () => {
  const burnupPath = path.join(__dirname, "../../../RUNTEST/burnup");

  it("hex cross-section is not circular", () => {
    const ast = parseDocument(fs.readFileSync(burnupPath, "utf8"), { uri: "burnup" });
    const D = Math.sqrt(1.099852 ** 2 + 0.635 ** 2);
    const inside = pointInBody("HEX", [0, 0, 0, 1.099852, 0.635, 1.0], { x: 0.55, y: 0, z: 0.5 });
    const outside = pointInBody("HEX", [0, 0, 0, 1.099852, 0.635, 1.0], { x: D * 0.55, y: 0, z: 0.5 });
    assert.ok(inside);
    assert.ok(!outside);
  });

  it("slice at z=0.3 has hex outer boundary", () => {
    const ast = parseDocument(fs.readFileSync(burnupPath, "utf8"), { uri: "burnup" });
    const slice = buildSliceGrid(ast, "z", 0.3, 64);
    const center = slice.grid[32][32];
    assert.ok(center > 0);
    const cornerIdx = slice.grid[4][4];
    const edgeIdx = slice.grid[32][4];
    assert.strictEqual(cornerIdx, 0);
    assert.ok(edgeIdx > 0);
  });
});

describe("buildSliceGrid", () => {
  it("produces zone indices for trx", () => {
    const ast = loadFixture("trx_geometry.mcu");
    const slice = buildSliceGrid(ast, "z", 50, 32);
    assert.strictEqual(slice.grid.length, 32);
    assert.ok(slice.zoneIndex.length >= 4);
    const centerIdx = slice.grid[16][16];
    assert.ok(centerIdx > 0);
  });
});

describe("latt_example geometry", () => {
  const ast = loadFixture("latt_example.mcu");

  it("lattice element C at origin — zone C.L (URU /-1:2)", () => {
    const r = queryPoint(ast, { x: 0, y: 0, z: 0 });
    assert.strictEqual(r.zone?.name, "C.L");
    assert.strictEqual(r.zone?.materialNum, 2);
  });

  it("lattice element C — zone C.K outside inner RPP", () => {
    const r = queryPoint(ast, { x: 1.5, y: 0, z: 0 });
    assert.strictEqual(r.zone?.name, "C.K");
    assert.strictEqual(r.zone?.materialNum, 1);
  });

  it("outside lattice element — host zone Z0", () => {
    const r = queryPoint(ast, { x: 5, y: 0, z: 0 });
    assert.strictEqual(r.zone?.name, "Z0");
    assert.strictEqual(r.zone?.materialNum, 8);
  });

  it("slice shows lattice and host zones", () => {
    const slice = buildSliceGrid(ast, "z", 0, 64);
    const names = new Set(slice.zoneIndex.map((z) => z.name));
    assert.ok(names.has("Z0"));
    assert.ok(names.has("C.K") || names.has("C.L"));
  });
});
