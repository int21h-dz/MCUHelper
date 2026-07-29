import { describe, it } from "node:test";
import assert from "node:assert";
import { BODY_PARAM_GROUPS, getBodyParamGroups } from "./bodyParamGroups";

describe("bodyParamGroups", () => {
  const cases = ["RCC", "RCZ", "RPP", "HEX", "SPH", "BOX"] as const;

  for (const key of cases) {
    it(`defines groups for ${key}`, () => {
      const groups = getBodyParamGroups(key);
      assert.ok(groups);
      assert.ok(groups!.length >= 3);
      assert.strictEqual(groups![0].label, "name");
      assert.ok(groups![0].documentation.length > 0);
    });
  }

  it("getBodyParamGroups is case-insensitive", () => {
    assert.deepStrictEqual(getBodyParamGroups("rcz"), getBodyParamGroups("RCZ"));
  });

  it("returns undefined for unknown body", () => {
    assert.strictEqual(getBodyParamGroups("UNKNOWN"), undefined);
  });

  it("BODY_PARAM_GROUPS has PLG and QUAD", () => {
    assert.ok(BODY_PARAM_GROUPS.PLG);
    assert.ok(BODY_PARAM_GROUPS.QUAD);
  });

  it("BOX uses four coordinate triplets B, P1, P2, P3", () => {
    const groups = getBodyParamGroups("BOX")!;
    assert.strictEqual(groups.length, 5);
    assert.ok(groups[1].label.includes("B"));
    assert.ok(groups[2].label.includes("P1"));
    assert.ok(groups[3].label.includes("P2"));
    assert.ok(groups[4].label.includes("P3"));
  });
});
