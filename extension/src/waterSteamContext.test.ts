import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findMaterialAtEditorLine, materialSectionEndLine } from "./waterSteamContext";
import type { IndexPayload } from "./navData";

type Mat = IndexPayload["summaries"]["materials"][number];

function mat(
  number: number,
  headerLine: number,
  nuclideLines: number[]
): Mat {
  return {
    number,
    nuclideCount: nuclideLines.length,
    nuclidesPreview: "",
    massDensityGcm3: 1,
    volumeCm3: null,
    massG: null,
    temperature: 293,
    nuclides: nuclideLines.map((line, i) => ({
      name: i % 2 === 0 ? "H" : "O",
      concentration: "0.1",
      range: {
        start: { line, character: 0 },
        end: { line, character: 10 },
      },
    })),
    range: {
      start: { line: headerLine, character: 0 },
      end: { line: headerLine, character: 20 },
    },
  };
}

describe("findMaterialAtEditorLine", () => {
  it("matches nuclide line inside MATR, not only header", () => {
    // Как на скрине: MATR 2 @16, MATR 3 @20, O на строке 34 (0-based)
    const materials = [mat(2, 16, [17, 18]), mat(3, 20, [21, 22, 34, 35])];
    assert.equal(findMaterialAtEditorLine(materials, 16)?.number, 2);
    assert.equal(findMaterialAtEditorLine(materials, 34)?.number, 3);
    assert.equal(findMaterialAtEditorLine(materials, 20)?.number, 3);
  });

  it("treats comment lines between nuclides as inside section", () => {
    const materials = [mat(3, 20, [21, 34])];
    // строка 25 между нуклидами — до следующего MATR нет → внутри 3
    assert.equal(findMaterialAtEditorLine(materials, 25)?.number, 3);
  });

  it("stops before next MATR header", () => {
    const materials = [mat(2, 16, [17]), mat(3, 20, [21])];
    assert.equal(findMaterialAtEditorLine(materials, 19)?.number, 2);
    assert.equal(findMaterialAtEditorLine(materials, 20)?.number, 3);
  });

  it("materialSectionEndLine extends to next header - 1", () => {
    const materials = [mat(2, 16, [17]), mat(3, 20, [34])];
    const sorted = [...materials].sort((a, b) => a.range.start.line - b.range.start.line);
    assert.equal(materialSectionEndLine(sorted[0]!, sorted), 19);
    assert.equal(materialSectionEndLine(sorted[1]!, sorted), 34);
  });
});
