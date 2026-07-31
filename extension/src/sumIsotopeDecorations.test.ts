import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isSumIsotopeCardLine,
  nuclideCompositionEditorRange,
  nuclideNameEditorRange,
} from "./sumIsotopeDecorations";

describe("sumIsotopeDecorations", () => {
  it("finds nuclide name on composition line", () => {
    const doc = {
      lineCount: 1,
      lineAt: () => ({ text: "  U235 1.0E-2 MODS=G" }),
    };
    const r = nuclideNameEditorRange(doc as never, "U235", {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 20 },
    });
    assert.ok(r);
    assert.strictEqual(r!.start.character, 2);
    assert.strictEqual(r!.end.character, 6);
  });

  it("covers name and concentration for gray decoration", () => {
    const doc = {
      lineCount: 1,
      lineAt: () => ({ text: "GE72 5.953967e-12" }),
    };
    const r = nuclideCompositionEditorRange(doc as never, "GE72", {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 17 },
    });
    assert.ok(r);
    assert.strictEqual(r!.start.character, 0);
    assert.strictEqual(r!.end.character, "GE72 5.953967e-12".length);
  });

  it("does not gray SI/SINOT/SIDEN card lines (SI must stay a card keyword)", () => {
    assert.strictEqual(isSumIsotopeCardLine("SI PB05 PB07"), true);
    assert.strictEqual(isSumIsotopeCardLine("SINOT U235"), true);
    assert.strictEqual(isSumIsotopeCardLine("SIDEN 1.0E-8"), true);
    assert.strictEqual(isSumIsotopeCardLine("SI 1.1E-2"), false);

    const siCard = {
      lineCount: 1,
      lineAt: () => ({ text: "SI PB05 PB07" }),
    };
    assert.strictEqual(
      nuclideCompositionEditorRange(siCard as never, "SI", {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 12 },
      }),
      null
    );

    const siNuclide = {
      lineCount: 1,
      lineAt: () => ({ text: "SI 1.1E-2" }),
    };
    const r = nuclideCompositionEditorRange(siNuclide as never, "SI", {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 9 },
    });
    assert.ok(r);
    assert.strictEqual(r!.start.character, 0);
  });
});
