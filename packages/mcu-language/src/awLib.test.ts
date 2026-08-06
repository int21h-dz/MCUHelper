import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import {
  parseAwLib,
  setAwLibTable,
  clearAwLibTable,
  getAwLibEntry,
  getAwLibAtomicWeight,
  awLibToIaeaTarget,
  awLibNameFromIaeaLabel,
  formatAtomicWeightAmu,
} from "./awLib";
import { mcuNuclideAtomicWeight } from "./materialDensity";
import { mcuNuclideToIaeaTarget } from "./nuclideIaea";
import { iaeaLabelToMcuNuclide } from "./naturalIsotopes";

const SAMPLE = `
* Atomic Weights
H    1000   1.00794
CS   55000  132.9054519
CS33  55133 132.905451
U235  92235 235.043929
PU39  94239 239.052163
XE30  54130 129.903508
`;

describe("parseAwLib", () => {
  it("parses natural and isotope rows with ZAID", () => {
    const table = parseAwLib(SAMPLE);
    assert.ok(table.entryCount >= 6);
    const cs33 = table.byName.get("CS33")!;
    assert.strictEqual(cs33.zaid, 55133);
    assert.strictEqual(cs33.z, 55);
    assert.strictEqual(cs33.a, 133);
    assert.strictEqual(cs33.isNatural, false);
    assert.ok(Math.abs(cs33.atomicWeight - 132.905451) < 1e-9);
    const cs = table.byName.get("CS")!;
    assert.strictEqual(cs.isNatural, true);
    assert.strictEqual(cs.a, null);
  });
});

describe("AW.LIB registry", () => {
  before(() => {
    setAwLibTable(parseAwLib(SAMPLE));
  });
  after(() => {
    clearAwLibTable();
  });

  it("resolves CS33 mass and IAEA target from ZAID", () => {
    assert.ok(Math.abs(getAwLibAtomicWeight("CS33")! - 132.905451) < 1e-9);
    assert.strictEqual(awLibToIaeaTarget("CS33"), "Cs-133");
    assert.strictEqual(mcuNuclideToIaeaTarget("CS33"), "Cs-133");
    assert.ok(Math.abs(mcuNuclideAtomicWeight("CS33")! - 132.905451) < 1e-9);
  });

  it("maps IAEA label back to truncated MCU name", () => {
    assert.strictEqual(awLibNameFromIaeaLabel("Cs-133"), "CS33");
    assert.strictEqual(iaeaLabelToMcuNuclide("Cs-133"), "CS33");
    assert.strictEqual(iaeaLabelToMcuNuclide("U-235"), "U235");
  });

  it("keeps actinide PU39 → Pu-239", () => {
    assert.strictEqual(mcuNuclideToIaeaTarget("PU39"), "Pu-239");
    assert.ok(getAwLibEntry("PU39")!.a === 239);
  });
});

describe("AW.LIB fallback without table", () => {
  it("CS33 without AW.LIB uses truncated mass heuristic", () => {
    clearAwLibTable();
    assert.strictEqual(mcuNuclideToIaeaTarget("CS33"), "Cs-33");
    assert.strictEqual(mcuNuclideAtomicWeight("CS33"), 33);
  });
});

describe("formatAtomicWeightAmu", () => {
  it("formats integers and decimals", () => {
    assert.strictEqual(formatAtomicWeightAmu(235), "235");
    assert.ok(formatAtomicWeightAmu(132.905451).startsWith("132.905451"));
  });
});

describe("AW.LIB RUNTEST fixture", () => {
  it("loads RUNTEST/AW.LIB when present", () => {
    const p = path.join(__dirname, "../../../RUNTEST/AW.LIB");
    if (!fs.existsSync(p)) return;
    const table = parseAwLib(fs.readFileSync(p, "utf8"), p);
    assert.ok(table.entryCount > 1000);
    const cs33 = table.byName.get("CS33");
    assert.ok(cs33);
    assert.strictEqual(cs33!.a, 133);
    assert.ok(cs33!.atomicWeight > 132.9 && cs33!.atomicWeight < 133);
  });
});
