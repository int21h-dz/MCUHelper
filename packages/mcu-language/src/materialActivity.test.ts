import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type { MaterialNode } from "./ast";
import {
  activityBqPerCm3,
  analyzeMaterialActivity,
  computeNuclideActivityBqPerCm3,
  formatActivityBqPerCm3,
  resolveAbsoluteNuclearDensityMcu,
} from "./materialActivity";
import { MCU_NUCLEAR_DENSITY_SCALE } from "./materialDensity";
import { parseParameteThr, setParameteThrTable, clearParameteThrTable, halfLifeToSeconds } from "./parameteThr";
import { parseAwLib, setAwLibTable, clearAwLibTable } from "./awLib";

const SAMPLE_THR = `
LONGLIFE ISOTOPES
LIST
U -235  922350   235.      7.040E+08 y
Cs-137  551370   137.      3.000E+00 y
Cs-133  551330   133.
stop
`;

type MatPick = Pick<MaterialNode, "nuclides" | "densParam" | "densValue">;

describe("activityBqPerCm3", () => {
  it("matches λ·n for known T½", () => {
    const tHalf = halfLifeToSeconds(3, "y");
    const densMcu = 1e-6;
    const expected = (Math.LN2 / tHalf) * densMcu * MCU_NUCLEAR_DENSITY_SCALE;
    const a = activityBqPerCm3(densMcu, tHalf)!;
    assert.ok(Math.abs(a - expected) / expected < 1e-12);
  });

  it("rejects non-positive half-life", () => {
    assert.strictEqual(activityBqPerCm3(1, 0), null);
    assert.strictEqual(activityBqPerCm3(1, -1), null);
    assert.strictEqual(activityBqPerCm3(-1, 100), null);
  });
});

describe("formatActivityBqPerCm3", () => {
  it("picks SI prefix", () => {
    assert.ok(formatActivityBqPerCm3(500).includes("Бк/см³"));
    assert.ok(formatActivityBqPerCm3(5e3).includes("кБк"));
    assert.ok(formatActivityBqPerCm3(5e6).includes("МБк"));
    assert.strictEqual(formatActivityBqPerCm3(-1), "—");
  });
});

describe("material activity with PARAMETE.THR", () => {
  before(() => {
    setAwLibTable(
      parseAwLib(`
CS37  55137 136.907089
CS33  55133 132.905452
U235  92235 235.043929
`)
    );
    setParameteThrTable(parseParameteThr(SAMPLE_THR));
  });
  after(() => {
    clearParameteThrTable();
    clearAwLibTable();
  });

  it("computes CS37 activity from absolute dens", () => {
    const mat = {
      nuclides: [
        { name: "CS37", density: "1.0E-6" },
        { name: "CS33", density: "1.0E-4" },
      ],
    } as MatPick;
    const row = computeNuclideActivityBqPerCm3(mat, "CS37")!;
    assert.ok(row);
    const tHalf = halfLifeToSeconds(3, "y");
    const expected = activityBqPerCm3(1e-6, tHalf)!;
    assert.ok(Math.abs(row.activityBqPerCm3 - expected) / expected < 1e-9);
  });

  it("skips stable CS33; sums material over radioactive only", () => {
    const mat = {
      nuclides: [
        { name: "CS37", density: "1.0E-6" },
        { name: "CS33", density: "1.0E-4" },
      ],
    } as MatPick;
    const an = analyzeMaterialActivity(mat);
    assert.strictEqual(an.usedCount, 1);
    assert.ok(an.skipped.some((s) => s.name === "CS33" && s.reason === "stable"));
    assert.ok(an.totalBqPerCm3 != null && an.totalBqPerCm3 > 0);
  });

  it("resolves DENSAA absolute dens for activity", () => {
    const mat = {
      nuclides: [
        { name: "CS37", density: "0.1" },
        { name: "CS33", density: "0.9" },
      ],
      densParam: "DENSAA",
      densValue: 1e-5,
    } as MatPick;
    const abs = resolveAbsoluteNuclearDensityMcu(mat, "CS37");
    assert.ok(abs.densityMcu != null);
    assert.ok(Math.abs(abs.densityMcu! - 1e-6) / 1e-6 < 1e-12);
    const row = computeNuclideActivityBqPerCm3(mat, "CS37")!;
    assert.ok(row.activityBqPerCm3 > 0);
  });
});
