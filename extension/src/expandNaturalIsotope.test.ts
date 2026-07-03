import { describe, it } from "node:test";
import assert from "node:assert";
import { findNuclideSpan } from "./expandNaturalIsotope";

describe("findNuclideSpan", () => {
  it("finds nuclide at cursor position", () => {
    const line = "U235 1.10E-03 MODS=G";
    const span = findNuclideSpan(line, "U235", 2);
    assert.ok(span);
    assert.strictEqual(span!.start, 0);
    assert.ok(span!.mods.includes("MODS"));
  });

  it("returns null when cursor outside nuclide", () => {
    assert.strictEqual(findNuclideSpan("U235 1.E-3", "U235", 20), null);
  });

  it("returns null for wrong nuclide name", () => {
    assert.strictEqual(findNuclideSpan("H 0.001", "U235", 1), null);
  });
});
