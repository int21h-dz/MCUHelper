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

  it("buildScene({scope}) returns LCELL bodies, not the global container", () => {
    const ast = parseDocument(fs.readFileSync(path.join(fixtures, "latt_example.mcu"), "utf8"), {
      uri: "latt-scope",
    });
    const global = buildScene(ast);
    assert.ok(global.primitives.some((p) => p.name === "CNT"));
    assert.ok(!global.primitives.some((p) => p.name === "K" && p.type === "RCZ"));

    const cell = buildScene(ast, { scope: "lcell:A" });
    const names = cell.primitives.map((p) => p.name);
    assert.ok(names.includes("K"));
    assert.ok(names.includes("L"));
    assert.ok(!names.includes("CNT"));
    assert.strictEqual(cell.activeScope, "lcell:A");
  });

  it("materializes TRANSF as transformed prototype (UserGuide §9.1.3.22)", () => {
    const ast = parseDocument(
      `HEAD 3 0
RCZ CYLRG 0,0,0 10 1
TRANSF CYLFT CYLRG M 10.5, 0 90
FINISH`,
      { uri: "transf-a37" }
    );
    const scene = buildScene(ast);
    const proto = scene.primitives.find((p) => p.name === "CYLRG");
    const made = scene.primitives.find((p) => p.name === "CYLFT");
    assert.ok(proto);
    assert.ok(made);
    assert.equal(made!.type, "RCZ");
    assert.ok(Math.abs(made!.params[0] - 21) < 1e-6);
    assert.ok(Math.abs(made!.params[1]) < 1e-6);
    assert.equal(made!.params[3], 10);
  });

  it("evaluates CELL bodies with local EQU, not last global overwrite", () => {
    // Глобальный X1=0; в PIN X1=5; в OTHER X1=99. Старый общий buildVars
    // подставлял last-wins (99) и в PIN — live-превью (scoped) расходилось с соседями.
    const src = `HEAD 3 0
EQU X1 = 0
EQU LG2 = 0
EQU HALL = 10
EQU RCO = 1
EQU RVC = 0.5
RPP CNT -20 20 -20 20 0 10
CELL PIN
EQU X1 = 5
RCZ R01 X1 LG2 0 HALL RCO
RCZ G01 X1 LG2 0 HALL RVC
END
END
CELL OTHER
EQU X1 = 99
RCZ Z99 X1 LG2 0 HALL RCO
END
END
ENDXCL
FINISH`;
    const ast = parseDocument(src, { uri: "scoped-x1" });
    const pin = buildScene(ast, { scope: "cell:PIN" });
    const r01 = pin.primitives.find((p) => p.name === "R01");
    const g01 = pin.primitives.find((p) => p.name === "G01");
    assert.ok(r01 && g01, `PIN got ${pin.primitives.map((p) => `${p.name}@${p.params[0]}`).join(",")}`);
    assert.ok(Math.abs(r01!.params[0] - 5) < 1e-9, `R01.x=${r01!.params[0]}`);
    assert.ok(Math.abs(g01!.params[0] - 5) < 1e-9, `G01.x=${g01!.params[0]}`);
    assert.ok(Math.abs(r01!.params[0] - g01!.params[0]) < 1e-12);

    const other = buildScene(ast, { scope: "cell:OTHER" });
    const z99 = other.primitives.find((p) => p.name === "Z99");
    assert.ok(z99, `OTHER got ${other.primitives.map((p) => p.name).join(",")}`);
    assert.ok(Math.abs(z99!.params[0] - 99) < 1e-9, `Z99.x=${z99!.params[0]}`);
  });
});
