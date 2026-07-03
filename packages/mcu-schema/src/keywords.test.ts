import { describe, it } from "node:test";
import assert from "node:assert";
import {
  normalizeMcuLabel,
  isKnownMcuLabel,
  detectFragmentFromLabel,
  listAllMcuLabels,
  MCU_LABEL_ALIASES,
  ALL_MCU_LABELS,
} from "./keywords";

describe("keywords", () => {
  it("normalizeMcuLabel resolves aliases", () => {
    assert.strictEqual(normalizeMcuLabel("power"), "POWE");
    assert.strictEqual(normalizeMcuLabel("NAMVAR"), "NAMV");
    assert.strictEqual(normalizeMcuLabel("PIN"), "PIN");
  });

  it("isKnownMcuLabel accepts canonical and alias labels", () => {
    assert.ok(isKnownMcuLabel("PIN"));
    assert.ok(isKnownMcuLabel("powe"));
    assert.ok(isKnownMcuLabel("MATR"));
    assert.ok(!isKnownMcuLabel("NOTACARD"));
  });

  it("detectFragmentFromLabel returns fragment starters", () => {
    assert.strictEqual(detectFragmentFromLabel("PIN", null), "physical");
    assert.strictEqual(detectFragmentFromLabel("HEAD", null), "geometry");
    assert.strictEqual(detectFragmentFromLabel("SPNT", null), "source");
    assert.strictEqual(detectFragmentFromLabel("RGS", null), "registration");
    assert.strictEqual(detectFragmentFromLabel("BRG", null), "burnupRegistration");
    assert.strictEqual(detectFragmentFromLabel("NTOT", null), "trajectory");
    assert.strictEqual(detectFragmentFromLabel("NAMVAR", null), "calculationControl");
    assert.strictEqual(detectFragmentFromLabel("BURN", null), "burnup");
  });

  it("detectFragmentFromLabel keeps current for unknown labels", () => {
    assert.strictEqual(detectFragmentFromLabel("FUEL", "geometry"), "geometry");
    assert.strictEqual(detectFragmentFromLabel("UNKNOWN", null), null);
  });

  it("detectFragmentFromLabel maps burn-related labels", () => {
    assert.strictEqual(detectFragmentFromLabel("BURD", null), "burnup");
    assert.strictEqual(detectFragmentFromLabel("FINAL", null), "burnup");
  });

  it("listAllMcuLabels returns sorted unique labels", () => {
    const labels = listAllMcuLabels();
    assert.ok(labels.length > 100);
    assert.deepStrictEqual(labels, [...labels].sort());
    assert.ok(labels.includes("PIN"));
  });

  it("MCU_LABEL_ALIASES entries resolve to known labels", () => {
    for (const [alias, canon] of Object.entries(MCU_LABEL_ALIASES)) {
      assert.ok(ALL_MCU_LABELS.has(canon), `${alias} -> ${canon}`);
      assert.ok(isKnownMcuLabel(alias));
    }
  });
});
