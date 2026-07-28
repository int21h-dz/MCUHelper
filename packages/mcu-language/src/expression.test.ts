import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluateExpression, findUndefinedVariables, mergeTrailingMultiplyOperands } from "./expression";

describe("expression edge cases", () => {
  it("evaluates nested SQRT and LN", () => {
    const vars = new Map([["A", 4], ["B", 2]]);
    const v = evaluateExpression("SQRT(A)+LN(B)", vars);
    assert.ok(v !== null && Math.abs(v - (2 + Math.log(2))) < 1e-9);
  });

  it("returns null for unknown function", () => {
    const vars = new Map([["A", 1]]);
    assert.strictEqual(evaluateExpression("FOO(A)", vars), null);
  });

  it("returns null for division by zero", () => {
    const vars = new Map([["A", 0]]);
    const v = evaluateExpression("1/A", vars);
    assert.ok(v === null || !Number.isFinite(v!));
  });

  it("findUndefinedVariables on complex expression", () => {
    const vars = new Map([["X", 1]]);
    const undef = findUndefinedVariables("X+Y*SQRT(Z)", vars);
    assert.ok(undef.includes("Y"));
    assert.ok(undef.includes("Z"));
  });

  it("evaluates scientific notation literal", () => {
    assert.strictEqual(evaluateExpression("1.5E2", new Map()), 150);
  });

  it("merges split multiply operands in body params", () => {
    assert.deepStrictEqual(mergeTrailingMultiplyOperands(["LG2", "LG2", "DF-1*", "DELT"]), [
      "LG2",
      "LG2",
      "DF-1*DELT",
    ]);
    const vars = new Map([
      ["DF", 5],
      ["DELT", 2],
    ]);
    assert.strictEqual(evaluateExpression("DF-1*DELT", vars), 3);
  });

  it("treats PI as ordinary user variable", () => {
    assert.strictEqual(evaluateExpression("PI/4", new Map()), null);
    assert.deepStrictEqual(findUndefinedVariables("COS(PI/4)", new Map()), ["PI"]);

    const vars = new Map([["PI", 3.1415926]]);
    const v = evaluateExpression("SIN(SQRT(17.5*COS(PI/4)))", vars);
    assert.ok(v !== null && Number.isFinite(v));
  });
});
