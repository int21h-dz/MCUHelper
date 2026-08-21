import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isInsideMatrBlock } from "./codeActions";

function docFrom(lines: string[]) {
  return {
    lineCount: lines.length,
    lineAt: (i: number) => ({ text: lines[i] ?? "" }),
  };
}

describe("isInsideMatrBlock", () => {
  it("true on MATR header and silicon SI dens", () => {
    const doc = docFrom(["PIN", "MATR 1", "U235 1e-3", "SI 1.1E-2", "END"]);
    assert.equal(isInsideMatrBlock(doc as never, 1), true);
    assert.equal(isInsideMatrBlock(doc as never, 3), true);
  });

  it("false on SI list / ICE after composition", () => {
    const doc = docFrom(["PIN", "MATR 1", "Fe 1e-2", "SI FP1", "ICE Fe", "FINISH"]);
    assert.equal(isInsideMatrBlock(doc as never, 3), false);
    assert.equal(isInsideMatrBlock(doc as never, 4), false);
  });

  it("false outside any MATR", () => {
    const doc = docFrom(["PIN", "SI FP1", "FINISH"]);
    assert.equal(isInsideMatrBlock(doc as never, 1), false);
  });
});
