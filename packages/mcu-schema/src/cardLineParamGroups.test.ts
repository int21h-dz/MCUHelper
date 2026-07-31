import { describe, it } from "node:test";
import assert from "node:assert";
import { CARD_LINE_PARAM_GROUPS, getCardLineParamGroups } from "./cardLineParamGroups";

describe("cardLineParamGroups", () => {
  it("MATR has number and density params", () => {
    const groups = getCardLineParamGroups("MATR");
    assert.ok(groups);
    assert.ok(groups!.some((g) => g.label === "number"));
    assert.ok(groups!.some((g) => g.label.startsWith("DENS")));
  });

  it("POWER and STEP defined via burnup cards", () => {
    assert.ok(CARD_LINE_PARAM_GROUPS.PIN);
    assert.ok(CARD_LINE_PARAM_GROUPS.HEAD);
  });

  it("getCardLineParamGroups is case-insensitive", () => {
    assert.deepStrictEqual(getCardLineParamGroups("matr"), getCardLineParamGroups("MATR"));
  });

  it("returns undefined for unknown card", () => {
    assert.strictEqual(getCardLineParamGroups("ZZZZZ"), undefined);
  });

  it("SPNT has x,y,z coordinate group", () => {
    const spnt = getCardLineParamGroups("SPNT");
    assert.ok(spnt?.[0].label.includes("x,y,z"));
  });

  it("SIDEN has value threshold for sum isotope", () => {
    const siden = getCardLineParamGroups("SIDEN");
    assert.ok(siden);
    assert.strictEqual(siden![0].label, "value");
    assert.ok(siden![0].documentation.includes("суммарный изотоп"));
  });

  it("SI and SINOT have list param for sum isotope", () => {
    assert.strictEqual(getCardLineParamGroups("SI")?.[0].label, "list");
    assert.strictEqual(getCardLineParamGroups("SINOT")?.[0].label, "list");
  });
});
