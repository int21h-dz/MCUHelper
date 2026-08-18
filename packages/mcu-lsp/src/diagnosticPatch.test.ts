import { describe, it } from "node:test";
import assert from "node:assert";
import { patchDiagnosticsForChanges } from "./diagnosticPatch";

function diag(line: number, message = `L${line}`) {
  return {
    message,
    range: {
      start: { line, character: 0 },
      end: { line, character: 8 },
    },
  };
}

describe("patchDiagnosticsForChanges", () => {
  it("drops diag on edited line and keeps the other", () => {
    const prev = [diag(10), diag(40)];
    const next = patchDiagnosticsForChanges(prev, [
      {
        range: { start: { line: 10, character: 2 }, end: { line: 10, character: 3 } },
        text: "x",
      },
    ]);
    assert.ok(next);
    assert.deepStrictEqual(
      next.map((d) => d.range.start.line),
      [40]
    );
  });

  it("shifts later diags when a line is inserted", () => {
    const prev = [diag(10), diag(40)];
    const next = patchDiagnosticsForChanges(prev, [
      {
        range: { start: { line: 12, character: 0 }, end: { line: 12, character: 0 } },
        text: "NEW\n",
      },
    ]);
    assert.ok(next);
    assert.deepStrictEqual(
      next.map((d) => d.range.start.line),
      [10, 41]
    );
  });

  it("returns null on full-document sync", () => {
    const next = patchDiagnosticsForChanges([diag(1)], [{ text: "whole file" }]);
    assert.strictEqual(next, null);
  });
});
