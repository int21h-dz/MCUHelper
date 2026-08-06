import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isSiCardListPrefix,
  isSiSumIsotopeCardLine,
  isSumIsotopeCardLine,
  looksLikeNuclideDensToken,
} from "./siCardVsNuclide";
import { analyzeDocument } from "./document";
import { resolveSumIsotopeStateAt } from "./sumIsotope";

describe("siCardVsNuclide — карта SI vs кремний", () => {
  it("dens tokens look like concentrations", () => {
    assert.ok(looksLikeNuclideDensToken("1.1E-2"));
    assert.ok(looksLikeNuclideDensToken("0.04"));
    assert.ok(looksLikeNuclideDensToken("+1e-3"));
    assert.ok(!looksLikeNuclideDensToken("FP1"));
    assert.ok(!looksLikeNuclideDensToken("PB05"));
  });

  it("SI list is a sum-isotope card; SI dens is silicon", () => {
    assert.ok(isSiCardListPrefix(["SI"]));
    assert.ok(isSiCardListPrefix(["SI", "FP1"]));
    assert.ok(isSiSumIsotopeCardLine("SI PB05, PB07"));
    assert.ok(isSumIsotopeCardLine("SI FP1 AM241"));
    assert.ok(!isSiCardListPrefix(["SI", "1.1E-2"]));
    assert.ok(!isSiSumIsotopeCardLine("SI 1.1E-2"));
    assert.ok(!isSumIsotopeCardLine("SI 0.04273"));
    assert.ok(isSumIsotopeCardLine("SINOT U235"));
    assert.ok(isSumIsotopeCardLine("SIDEN 1e-8"));
  });

  it("SI dens does not activate sum-isotope SI list state", () => {
    const text = ["PIN", "MATR 1", "SI 1.1E-2", "U235 1e-2", "FINISH"].join("\n");
    const index = analyzeDocument("file:///si-silicon.mcu", text, 1);
    const mat = index.ast.materials[0]!;
    assert.ok(mat.nuclides.some((n) => n.name.toUpperCase() === "SI"));
    const state = resolveSumIsotopeStateAt(index.ast.statements, mat.range.offset + 1, index.ast.constants);
    // После строки кремния listMode не должен стать si с «1.1E-2» в списке.
    assert.strictEqual(state.listMode, "none");
  });

  it("SI list card still activates sum-isotope state", () => {
    const text = ["PIN", "SI FP1", "MATR 1", "FP1 1e-8", "FINISH"].join("\n");
    const index = analyzeDocument("file:///si-card.mcu", text, 1);
    const mat = index.ast.materials[0]!;
    const state = resolveSumIsotopeStateAt(index.ast.statements, mat.range.offset, index.ast.constants);
    assert.strictEqual(state.listMode, "si");
    assert.ok(state.list.has("FP1"));
  });
});
