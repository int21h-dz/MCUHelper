import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDocument } from "./parser";
import {
  collectSumIsotopeMarks,
  evaluateSumIsotopeMembership,
  resolveSumIsotopeStateAt,
  sumIsotopeForNuclide,
} from "./sumIsotope";
import { buildSummaries } from "./semantic";

describe("sumIsotope", () => {
  it("SI list marks only listed nuclides", () => {
    const text = ["PIN", "SI FP1 AM241", "MATR 1 T=300.", "U235 1.0E-2", "FP1 1.0E-6", "AM241 2.0E-7", "FINISH"].join(
      "\n"
    );
    const ast = parseDocument(text, { uri: "si.mcu" });
    const marks = collectSumIsotopeMarks(ast);
    assert.deepStrictEqual(
      marks.map((m) => m.name.toUpperCase()).sort(),
      ["AM241", "FP1"]
    );
    assert.ok(marks.every((m) => m.kinds.includes("si")));
  });

  it("SINOT marks all except listed", () => {
    const text = ["PIN", "SINOT U235 U238", "MATR 1", "U235 1e-2", "U238 1e-2", "FP99 1e-8", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "sinot.mcu" });
    const mat = ast.materials[0]!;
    const fp = sumIsotopeForNuclide(ast, mat, { name: "FP99", density: "1e-8" });
    const u235 = sumIsotopeForNuclide(ast, mat, { name: "U235", density: "1e-2" });
    assert.strictEqual(fp.inSum, true);
    assert.ok(fp.kinds.includes("sinot"));
    assert.strictEqual(u235.inSum, false);
  });

  it("SIDEN marks low density independently of SI", () => {
    const text = ["PIN", "SI U235", "SIDEN 1.0E-5", "MATR 1", "U235 1e-2", "XE135 1e-8", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "siden.mcu" });
    const marks = collectSumIsotopeMarks(ast);
    const byName = new Map(marks.map((m) => [m.name.toUpperCase(), m]));
    assert.ok(byName.get("U235")?.kinds.includes("si"));
    assert.ok(byName.get("XE135")?.kinds.includes("siden"));
  });

  it("last SI/SINOT wins; empty SI clears list mode", () => {
    const text = [
      "PIN",
      "SI FP1",
      "SINOT U235",
      "MATR 1",
      "U235 1",
      "FP1 1",
      "O16 1",
      "SI",
      "MATR 2",
      "FP1 1",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "last.mcu" });
    const m1 = ast.materials.find((m) => m.number === 1)!;
    const m2 = ast.materials.find((m) => m.number === 2)!;
    assert.strictEqual(sumIsotopeForNuclide(ast, m1, { name: "O16", density: "1" }).inSum, true);
    assert.strictEqual(sumIsotopeForNuclide(ast, m1, { name: "U235", density: "1" }).inSum, false);
    assert.strictEqual(sumIsotopeForNuclide(ast, m2, { name: "FP1", density: "1" }).inSum, false);
  });

  it("empty state has no members", () => {
    const m = evaluateSumIsotopeMembership(
      { name: "U235", density: "1e-2" },
      { listMode: "none", list: new Set(), siden: null }
    );
    assert.strictEqual(m.inSum, false);
  });

  it("resolveSumIsotopeStateAt reads SIDEN with EQU", () => {
    const text = ["PIN", "EQU THR = 1.0E-6", "SIDEN THR", "MATR 1", "XE 1e-8", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "equ.mcu" });
    const state = resolveSumIsotopeStateAt(ast.statements, ast.materials[0]!.range.offset, ast.constants);
    assert.strictEqual(state.siden, 1e-6);
    const sum = buildSummaries(ast);
    assert.ok(sum.materials[0]!.nuclides.find((n) => n.name.toUpperCase() === "XE")?.sumIsotope);
  });

  it("SIDEN reason avoids markdown-breaking less-than", () => {
    const m = evaluateSumIsotopeMembership(
      { name: "XE", density: "1e-12" },
      { listMode: "none", list: new Set(), siden: 1e-10 }
    );
    assert.ok(m.inSum);
    assert.ok(m.reasons[0]!.includes("меньше"));
    assert.ok(!m.reasons[0]!.includes("<"), m.reasons[0]);
  });
});
