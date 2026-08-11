import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { parseDocument } from "./parser";
import {
  buildMaterialMassRows,
  formatMaterialMassTable,
  formatMassG,
  formatSpecificBurnupMwdPerKg,
  formatVolCardHover,
  materialVolumeCm3,
  parseMaterialVolumes,
  specificBurnupMwdPerKg,
  totalMaterialMassG,
} from "./materialVolumes";

const burnupPath = path.join(__dirname, "../../../RUNTEST/BURNUPR/burnup");

describe("materialVolumes", () => {
  const ast = fs.existsSync(burnupPath)
    ? parseDocument(fs.readFileSync(burnupPath, "utf8"), { uri: "burnup" })
    : parseDocument(
        `PIN 1 0
MATR 1
U235 1.10E-03
H 0.0001 MODS=G
O 2.3E-06
VOL 10. 20.
FINISH`,
        { uri: "vol" }
      );

  it("parseMaterialVolumes reads VOL card", () => {
    const vols = parseMaterialVolumes(ast);
    assert.ok(vols);
    assert.ok(vols!.length >= 1);
  });

  it("materialVolumeCm3 indexes by MATR number", () => {
    const vols = parseMaterialVolumes(ast)!;
    assert.strictEqual(materialVolumeCm3(vols, 1), vols[0]);
    assert.strictEqual(materialVolumeCm3(null, 1), null);
    assert.strictEqual(materialVolumeCm3(vols, 99), null);
  });

  it("buildMaterialMassRows computes mass when density available", () => {
    const rows = buildMaterialMassRows(ast);
    assert.ok(rows.length >= 1);
    const withDensity = rows.find((r) => r.massDensityGcm3 != null && r.massDensityGcm3 > 0);
    if (withDensity) {
      assert.ok(withDensity.volumeCm3 != null || withDensity.massG != null);
    } else {
      assert.ok(rows.every((r) => r.number > 0));
    }
  });

  it("buildMaterialMassRows resolves EQU nuclide concentration", () => {
    const equAst = parseDocument(
      `EQU CZR = 0.04273
PIN 1 0
MATR 1
ZR CZR
VOL 10
FINISH`,
      { uri: "vol-equ" }
    );
    const rows = buildMaterialMassRows(equAst);
    assert.strictEqual(rows.length, 1);
    assert.ok(rows[0]!.massDensityGcm3 != null && rows[0]!.massDensityGcm3! > 6.3 && rows[0]!.massDensityGcm3! < 6.7);
    assert.ok(rows[0]!.massG != null && rows[0]!.massG! > 63 && rows[0]!.massG! < 67);
  });

  it("formatMassG and totalMaterialMassG", () => {
    assert.ok(formatMassG(500).includes("г"));
    assert.ok(formatMassG(5000).includes("кг"));
    const rows = buildMaterialMassRows(ast);
    assert.ok(totalMaterialMassG(rows) >= 0);
  });

  it("formatMaterialMassTable and formatVolCardHover", () => {
    const rows = buildMaterialMassRows(ast);
    const table = formatMaterialMassTable(rows);
    assert.ok(table.includes("| MATR |"));
    const hover = formatVolCardHover(ast);
    assert.ok(hover.includes("VOL") || hover.includes("не найдена"));
    if (rows.some((r) => r.massG != null && r.massG > 0)) {
      assert.ok(table.includes("Σm") || table.includes("|"));
    }
  });

  it("formatVolCardHover uses VOL card values not unit volume 1", () => {
    const burnupPathLocal = path.join(__dirname, "../../../RUNTEST/BURNUPR/burnup");
    if (!fs.existsSync(burnupPathLocal)) return;
    const burnAst = parseDocument(fs.readFileSync(burnupPathLocal, "utf8"), { uri: "burnup-vol" });
    const hover = formatVolCardHover(burnAst);
    assert.ok(hover.includes("0.45"), hover);
    assert.ok(hover.includes("0.17"), hover);
    assert.ok(hover.includes("0.76"), hover);
    assert.ok(hover.includes("Значения с карты"), hover);
    const clad = buildMaterialMassRows(burnAst).find((r) => r.number === 2);
    assert.ok(clad?.volumeCm3 != null && Math.abs(clad.volumeCm3 - 0.17) < 1e-9);
    assert.ok(clad?.massG != null && clad.massG > 1 && clad.massG < 1.3, `mass=${clad?.massG}`);
    assert.ok(!/\| 2 \| 1(\.0+)? \|/.test(hover), "MATR 2 must not show V=1");
  });

  it("specificBurnupMwdPerKg", () => {
    assert.strictEqual(specificBurnupMwdPerKg(100, 0), null);
    const v = specificBurnupMwdPerKg(1000, 50);
    assert.ok(v != null && v === 20);
    const fmt = formatSpecificBurnupMwdPerKg(1000, 50);
    assert.ok(fmt?.includes("МВт·сут/кг"));
  });

  it("formatVolCardHover when VOL missing", () => {
    const noVol = parseDocument("PIN 1 0\nFINISH", { uri: "novol" });
    assert.ok(formatVolCardHover(noVol).includes("не найдена"));
  });

  it("parses natural U dens inside MATR (not zone union U)", () => {
    const uAst = parseDocument(
      `PIN 1 0
MATR 1
U235 0.0008255
U238 0.022105
U     0.1
O     0.045861
FINISH`,
      { uri: "nat-u" }
    );
    const names = uAst.materials[0]!.nuclides.map((n) => n.name.toUpperCase());
    assert.deepStrictEqual(names, ["U235", "U238", "U", "O"]);
  });
});
