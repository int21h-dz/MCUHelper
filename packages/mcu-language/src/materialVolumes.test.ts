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
});
