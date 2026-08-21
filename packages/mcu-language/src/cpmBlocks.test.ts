import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDocument } from "./parser";
import { analyzeSemantics, buildSummaries } from "./semantic";
import {
  expandCpmMaterialNumbers,
  formatCpmNumberRange,
} from "./cpmBlocks";
import { buildSemanticTokenSpans } from "./semanticHighlight";

describe("cpmBlocks", () => {
  it("formatCpmNumberRange contiguous and arithmetic", () => {
    assert.strictEqual(formatCpmNumberRange([1, 2, 3]), "1–3");
    assert.strictEqual(formatCpmNumberRange([1, 3, 5, 7]), "1,3,…,7");
    assert.strictEqual(formatCpmNumberRange([1, 4]), "1,4");
  });

  it("expandCpmMaterialNumbers for single and multi MATR", () => {
    assert.deepStrictEqual(expandCpmMaterialNumbers(1, [1], 3), [1, 2, 3]);
    assert.deepStrictEqual(expandCpmMaterialNumbers(1, [1, 2], 3), [1, 3, 5]);
    assert.deepStrictEqual(expandCpmMaterialNumbers(2, [1, 2], 3), [2, 4, 6]);
  });

  it("parses CPM block from UserGuide example", () => {
    const text = [
      "PIN 1 0",
      "CPM 3",
      "MATR 1 NAME=MYMAT",
      "UO2 1.0",
      "END",
      "CPMEND",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "cpm.mcu" });
    assert.strictEqual(ast.cpmBlocks.length, 1);
    const block = ast.cpmBlocks[0]!;
    assert.strictEqual(block.repetitions, 3);
    assert.deepStrictEqual(block.materialIndexes, [0]);
    assert.deepStrictEqual(block.expandedNumbers, [1, 2, 3]);
    assert.ok(block.endRange);
    assert.ok(!ast.diagnostics.some((d) => d.code?.startsWith("cpm")));
  });

  it("does not treat CPM as material nuclide", () => {
    const text = ["PIN 1 0", "MATR 1", "U235 1e-2", "CPM 2", "MATR 2", "U238 1e-2", "CPMEND", "FINISH"].join(
      "\n"
    );
    const ast = parseDocument(text, { uri: "cpm2.mcu" });
    assert.strictEqual(ast.materials[0]!.nuclides.length, 1);
    assert.strictEqual(ast.materials[0]!.nuclides[0]!.name.toUpperCase(), "U235");
    assert.strictEqual(ast.cpmBlocks.length, 1);
    assert.deepStrictEqual(ast.cpmBlocks[0]!.materialIndexes, [1]);
  });

  it("buildSummaries attaches expanded numbers", () => {
    const text = ["PIN 1 0", "CPM 3", "MATR 1", "U235 1e-2", "CPMEND", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "cpm-sum.mcu" });
    const sum = buildSummaries(ast);
    assert.ok(sum.materials[0]!.cpm);
    assert.strictEqual(sum.materials[0]!.cpm!.repetitions, 3);
    assert.deepStrictEqual(sum.materials[0]!.cpm!.expandedNumbers, [1, 2, 3]);
  });

  it("matr-gap accounts for CPM repetitions", () => {
    const text = [
      "PIN 1 0",
      "CPM 3",
      "MATR 1",
      "U235 1e-2",
      "CPMEND",
      "MATR 4",
      "U238 1e-2",
      "FINISH",
    ].join("\n");
    const diags = analyzeSemantics(parseDocument(text, { uri: "cpm-gap.mcu" }));
    assert.ok(!diags.some((d) => d.code === "matr-gap"), diags.map((d) => d.message).join("; "));
  });

  it("CPM is highlighted as card, not pin-isotope list", () => {
    const text = ["PIN 1 0", "CPM 3", "MATR 1", "U235 1e-2", "CPMEND", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "cpm-hl.mcu" });
    const spans = buildSemanticTokenSpans(ast, text);
    const cpmSpan = spans.find((s) => s.line === 1 && s.kind === "card");
    assert.ok(cpmSpan, "CPM line should be card");
    const isotopeLike = spans.filter((s) => s.line === 1 && s.kind === "nuclide");
    assert.strictEqual(isotopeLike.length, 0);
  });
});
