import { describe, it } from "node:test";
import assert from "node:assert";
import { collectZoneBodyRefs, isAllSpaceZoneRef } from "./zoneBodyRefs";

describe("zoneBodyRefs", () => {
  it("collects body names from intersection", () => {
    assert.deepStrictEqual(collectZoneBodyRefs("0 -TBin -Vir1"), ["0", "TBin", "Vir1"]);
  });

  it("collects from union", () => {
    assert.deepStrictEqual(collectZoneBodyRefs("1 -5 U 6"), ["1", "5", "6"]);
  });

  it("isAllSpaceZoneRef only for first ref 0", () => {
    assert.ok(isAllSpaceZoneRef("0 -TBin", "0"));
    assert.ok(!isAllSpaceZoneRef("1 0 -2", "0"));
    assert.ok(!isAllSpaceZoneRef("0 -TBin", "TBin"));
  });
});
