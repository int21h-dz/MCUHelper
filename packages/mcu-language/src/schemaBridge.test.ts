import { describe, it } from "node:test";
import assert from "node:assert";
import { isKnownMcuLabel, normalizeMcuLabel, listAllMcuLabels } from "./schemaBridge";

describe("schemaBridge", () => {
  it("isKnownMcuLabel delegates to schema", () => {
    assert.ok(isKnownMcuLabel("PIN"));
    assert.ok(isKnownMcuLabel("MATR"));
    assert.ok(!isKnownMcuLabel("NOTACARD"));
  });

  it("normalizeMcuLabel resolves aliases", () => {
    assert.strictEqual(normalizeMcuLabel("NAMVAR"), "NAMV");
  });

  it("listAllMcuLabels returns sorted labels", () => {
    const labels = listAllMcuLabels();
    assert.ok(labels.length > 50);
    assert.deepStrictEqual(labels, [...labels].sort());
  });
});
