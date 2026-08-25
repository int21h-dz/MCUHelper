import { describe, it } from "node:test";
import assert from "node:assert";
import { parseCardArgContext, getCardArgSpec } from "./cardArgEnums";

describe("cardArgEnums", () => {
  it("parses SUMZON argument context", () => {
    const ctx = parseCardArgContext("SUMZON   ");
    assert.ok(ctx);
    assert.strictEqual(ctx!.card, "SUMZON");
    assert.strictEqual(ctx!.spec.kind, "enum");
    assert.strictEqual(ctx!.partial, "");
    assert.strictEqual(ctx!.usedValues.size, 0);
  });

  it("filters used SUMZON tokens", () => {
    const ctx = parseCardArgContext("SUMZON ZONB ");
    assert.ok(ctx);
    assert.ok(ctx!.usedValues.has("ZONB"));
    const values =
      ctx!.spec.kind === "enum" ? ctx!.spec.values.map((v) => v.value) : [];
    const remaining = values.filter((v) => !ctx!.usedValues.has(v));
    assert.ok(remaining.includes("SUMB"));
    assert.ok(!remaining.includes("ZONB"));
  });

  it("matches partial enum token", () => {
    const ctx = parseCardArgContext("SUMZON ZO");
    assert.ok(ctx);
    assert.strictEqual(ctx!.partial, "ZO");
  });

  it("returns null when CODE already has option", () => {
    assert.strictEqual(parseCardArgContext("CODE RSTP "), null);
  });

  it("resolves CONTEN spec", () => {
    const spec = getCardArgSpec("CONTEN");
    assert.ok(spec && spec.kind === "enum");
    if (spec.kind === "enum") {
      assert.ok(spec.values.some((v) => v.value === "DENS"));
      assert.ok(spec.values.some((v) => v.value === "SPNU"));
    }
  });

  it("resolves CNTAND 0|1 spec", () => {
    const spec = getCardArgSpec("CNTAND");
    assert.ok(spec && spec.kind === "enum");
    if (spec.kind === "enum") {
      assert.ok(spec.values.some((v) => v.value === "0"));
      assert.ok(spec.values.some((v) => v.value === "1"));
    }
  });
});
