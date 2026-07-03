import { describe, it } from "node:test";
import assert from "node:assert";
import { NUCLIDE_LINE_PARAM_GROUPS, getNuclideLineParamGroups } from "./nuclideLineParamGroups";

describe("nuclideLineParamGroups", () => {
  it("defines name, dens, MODS, DTEM, ACE, PHT", () => {
    const groups = getNuclideLineParamGroups();
    const labels = groups.map((g) => g.label);
    assert.ok(labels.includes("name"));
    assert.ok(labels.includes("dens"));
    assert.ok(labels.some((l) => l.startsWith("MODS=")));
    assert.ok(labels.some((l) => l.startsWith("DTEM=")));
    assert.ok(labels.some((l) => l.startsWith("ACE=")));
    assert.ok(labels.some((l) => l.startsWith("PHT=")));
  });

  it("returns same array as constant", () => {
    assert.strictEqual(getNuclideLineParamGroups(), NUCLIDE_LINE_PARAM_GROUPS);
  });

  it("each group has documentation", () => {
    for (const g of NUCLIDE_LINE_PARAM_GROUPS) {
      assert.ok(g.documentation.length > 5);
    }
  });
});
