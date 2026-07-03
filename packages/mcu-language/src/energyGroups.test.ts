import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDocument } from "./parser";
import { analyzeSemantics } from "./semantic";
import { analyzeEnergyGroupStatements, validateEnergyGroupValues } from "./energyGroups";

describe("validateEnergyGroupValues", () => {
  it("reports empty list", () => {
    const issues = validateEnergyGroupValues([]);
    assert.ok(issues.some((i) => i.code === "energy-empty"));
  });

  it("reports non-finite values", () => {
    const issues = validateEnergyGroupValues([100, Number.NaN, 0]);
    assert.ok(issues.some((i) => i.code === "energy-non-finite"));
  });

  it("accepts ascending list from 0 (RUNTEST style)", () => {
    const issues = validateEnergyGroupValues([0, 0.1, 0.4, 5000]);
    assert.strictEqual(issues.length, 0);
  });

  it("accepts descending list ending with 0 (pr2 style)", () => {
    const issues = validateEnergyGroupValues([1e6, 1e5, 10, 0]);
    assert.strictEqual(issues.length, 0);
  });

  it("accepts single explicit zero", () => {
    const issues = validateEnergyGroupValues([0]);
    assert.strictEqual(issues.length, 0);
  });

  it("requires 0 at start for ascending list", () => {
    const issues = validateEnergyGroupValues([0.1, 0.4, 5000]);
    assert.ok(issues.some((i) => i.code === "energy-missing-zero"));
  });

  it("requires 0 at end for descending list", () => {
    const issues = validateEnergyGroupValues([100, 10, 1]);
    assert.ok(issues.some((i) => i.code === "energy-missing-zero"));
  });

  it("rejects non-monotonic sequence", () => {
    const issues = validateEnergyGroupValues([100, 50, 50, 0]);
    assert.ok(issues.some((i) => i.code === "energy-order"));
    const issues2 = validateEnergyGroupValues([10, 20, 0]);
    assert.ok(issues2.some((i) => i.code === "energy-order"));
  });
});

describe("analyzeEnergyGroupStatements", () => {
  it("validates ENERG alias label (descending)", () => {
    const text = `REGISTRATION
ENERG 100 10 0
FINISH`;
    const ast = parseDocument(text, { uri: "energ.mcu" });
    const diags = analyzeEnergyGroupStatements(ast);
    assert.strictEqual(diags.length, 0);
  });

  it("accepts registration block with ascending ENERGY", () => {
    const text = `PTYPE 1
TTYPE 1
ENERGY 0.0 0.1 0.4 5000
SPECTR 1
OFLU 1-29
RCT 3,18,918
END
FINISH`;
    const ast = parseDocument(text, { uri: "reg-asc.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code?.startsWith("energy"));
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });

  it("integrates with analyzeSemantics for invalid ENERGY", () => {
    const text = `REGISTRATION
ENERGY
FINISH`;
    const ast = parseDocument(text, { uri: "energy-empty.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "energy-empty");
    assert.ok(diags.length >= 1);
  });
});
