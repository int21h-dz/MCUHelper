import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import {
  parseParameteThr,
  setParameteThrTable,
  clearParameteThrTable,
  halfLifeToSeconds,
  formatHalfLifeValue,
  getParameteThrEntryByName,
  getParameteThrForMcuNuclide,
} from "./parameteThr";
import { parseAwLib, setAwLibTable, clearAwLibTable } from "./awLib";

const SAMPLE = `
* header
LONGLIFE ISOTOPES
LIST
* NAME   INAME   AW          T1/2
actinide
U -235  922350   235.      7.040E+08 y
Cs-137  551370   137.      3.000E+00 y
Cs-133  551330   133.
Am-242m 952421   242.      1.410E+02 y
stop
SHORTLIFE ISOTOPES
LIST
I -135  531350   135.      6.569E+00 h
Xe-135  541350   135.      9.139E+00 h
stop
DECAY
`;

describe("parseParameteThr", () => {
  it("parses T1/2 with units and INAME ZZAAAI", () => {
    const table = parseParameteThr(SAMPLE);
    assert.ok(table.withHalfLifeCount >= 4);
    const cs137 = table.byName.get("CS-137")!;
    assert.ok(cs137);
    assert.strictEqual(cs137.z, 55);
    assert.strictEqual(cs137.a, 137);
    assert.strictEqual(cs137.isomer, 0);
    assert.ok(cs137.hasHalfLife);
    assert.ok(Math.abs(cs137.halfLifeSec! - halfLifeToSeconds(3, "y")) < 1);
    const cs133 = table.byName.get("CS-133")!;
    assert.strictEqual(cs133.hasHalfLife, false);
    const am = table.byName.get("AM-242M")!;
    assert.strictEqual(am.isomer, 1);
    assert.strictEqual(am.iname, 952421);
  });
});

describe("PARAMETE.THR + AW.LIB MCU lookup", () => {
  before(() => {
    setAwLibTable(
      parseAwLib(`
CS37  55137 136.907089
U235  92235 235.043929
I135  53135 134.910048
`)
    );
    setParameteThrTable(parseParameteThr(SAMPLE));
  });
  after(() => {
    clearParameteThrTable();
    clearAwLibTable();
  });

  it("resolves CS37 / U235 half-lives", () => {
    const cs = getParameteThrForMcuNuclide("CS37")!;
    assert.ok(cs.hasHalfLife);
    assert.ok(formatHalfLifeValue(cs.halfLifeValue!, cs.halfLifeUnit!).includes("лет"));
    assert.ok(getParameteThrForMcuNuclide("U235")!.halfLifeSec! > 1e15);
    assert.ok(getParameteThrForMcuNuclide("I135")!.halfLifeUnit === "h");
  });

  it("resolves AM2M metastable", () => {
    const e = getParameteThrForMcuNuclide("AM2M");
    assert.ok(e);
    assert.strictEqual(e!.name, "Am-242m");
  });
});

describe("PARAMETE.THR RUNTEST fixture", () => {
  it("loads RUNTEST/PARAMETE.THR when present", () => {
    const p = path.join(__dirname, "../../../RUNTEST/PARAMETE.THR");
    if (!fs.existsSync(p)) return;
    const table = parseParameteThr(fs.readFileSync(p, "utf8"), p);
    setParameteThrTable(table);
    try {
      assert.ok(table.entryCount > 500);
      assert.ok(table.withHalfLifeCount > 200);
      const u = getParameteThrEntryByName("U-235")!;
      assert.ok(u.hasHalfLife);
      assert.strictEqual(u.halfLifeUnit, "y");
    } finally {
      clearParameteThrTable();
    }
  });
});
