import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeDocument } from "./document";
import { findInlineDbmBlocks, filterDiagnosticsOutsideInlineDbm } from "./inlineDbmExpand";

const pin = "PIN 1 0\n";

describe("inline DBM expand diagnostics", () => {
  it("finds DBM expand blocks", () => {
    const text = [
      "MATR 1 NAME=GRAPHI",
      "** [mcuhelper] ▼ DBM GRAPHI/CARB17",
      "CARB17 1 1",
      "C 0.085236 A",
      "** [mcuhelper] ▲ DBM GRAPHI/CARB17",
      "END",
    ].join("\n");
    const blocks = findInlineDbmBlocks(text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.code, "CARB17");
    assert.equal(blocks[0]!.beginLine, 1);
    assert.equal(blocks[0]!.endLine, 4);
  });

  it("does not emit matr-dbm-code / nuclide extras while DBM is expanded inline", () => {
    const text = [
      pin.trim(),
      "MATR 35 NAME=GRAPHI",
      "** [mcuhelper] ▼ DBM GRAPHI/CARB17",
      "CARB17 1 1",
      "C 0.085236 A",
      "** [mcuhelper] ▲ DBM GRAPHI/CARB17",
      "END",
      "FINISH",
    ].join("\n");
    const index = analyzeDocument("file:///t.mcu", text, 1, { expandInclude: false });
    const codes = index.ast.diagnostics.map((d) => d.code);
    assert.ok(!codes.includes("matr-dbm-code"), codes.join(","));
    assert.ok(!codes.includes("matr-dbm-mixed"), codes.join(","));
    assert.ok(!codes.includes("matr-nuclide-extra"), codes.join(","));
    const mat = index.ast.materials.find((m) => m.number === 35);
    assert.ok(mat);
    assert.equal(mat!.libMaterialName?.toUpperCase(), "CARB17");
    assert.equal(mat!.nuclides.length, 0);
  });

  it("filterDiagnosticsOutsideInlineDbm drops diags on expand lines", () => {
    const text = [
      "MATR 1 NAME=GRAPHI",
      "** [mcuhelper] ▼ DBM GRAPHI/X",
      "X 1 1",
      "** [mcuhelper] ▲ DBM GRAPHI/X",
      "END",
    ].join("\n");
    const kept = filterDiagnosticsOutsideInlineDbm(text, [
      {
        code: "x",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      },
      {
        code: "y",
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
      },
    ]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.code, "x");
  });
});
