import { describe, it } from "node:test";
import assert from "node:assert";
import { applyGeometryScopeTransition, initialGeometryScopeState } from "./geometryScope";

function stmts(lines: string[]): { label: string; text: string }[] {
  return lines.map((text) => ({
    text,
    label: text.trim().split(/\s+/)[0]?.toUpperCase() ?? "",
  }));
}

function scopeAt(lines: string[], lineIndex: number): string {
  const state = initialGeometryScopeState();
  const ordered = stmts(lines);
  for (let i = 0; i <= lineIndex; i++) {
    applyGeometryScopeTransition(state, ordered[i].label, ordered[i].text);
  }
  return state.scope;
}

describe("geometryScope", () => {
  it("CELL: first END keeps scope for zone section", () => {
    const lines = [
      "CELL NC",
      "SBOX S 0,0,0 1,0,0 0,1,0",
      "END",
      "ZN1 S -H /4:2/5",
      "END",
    ];
    assert.strictEqual(scopeAt(lines, 2), "cell:NC");
    assert.strictEqual(scopeAt(lines, 3), "cell:NC");
    assert.strictEqual(scopeAt(lines, 4), "global");
  });

  it("CELL EXTEND: stays in scope through LATT until ENDXCL", () => {
    const lines = [
      "CELL A EXTEND",
      "RPP CC 0 1 0 1 0 1",
      "END",
      "NZ CC /-1:6",
      "END",
      "LATT GLTL NZ",
      "LISTEL B0",
      "PARM 0,0,0",
      "ENDXCL",
    ];
    assert.strictEqual(scopeAt(lines, 2), "cell:A");
    assert.strictEqual(scopeAt(lines, 4), "cell:A");
    assert.strictEqual(scopeAt(lines, 7), "cell:A");
    assert.strictEqual(scopeAt(lines, 8), "global");
  });
});
