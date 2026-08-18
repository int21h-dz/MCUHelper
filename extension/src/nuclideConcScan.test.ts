import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanNuclideConcentrationLine } from "./nuclideConcScan";

describe("scanNuclideConcentrationLine", () => {
  const equ = new Set(["CZR", "DENSU"]);

  it("accepts numeric dens and known EQU name", () => {
    assert.equal(scanNuclideConcentrationLine("U235 1.10E-03", 10, equ).length, 0);
    assert.equal(scanNuclideConcentrationLine("ZR CZR", 11, equ).length, 0);
  });

  it("flags multiplication by uninitialized constant immediately", () => {
    const issues = scanNuclideConcentrationLine("U235 1.2E-2*FOO", 12, equ);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.code, "matr-nuclide-conc");
    assert.match(issues[0]!.message, /1\.2E-2\*FOO/i);
  });

  it("flags unknown EQU name when catalog is loaded", () => {
    const issues = scanNuclideConcentrationLine("U235 DENSUX", 12, equ);
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.message, /неинициализирован/i);
  });
});
