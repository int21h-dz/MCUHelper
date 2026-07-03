import { describe, it } from "node:test";
import assert from "node:assert";
import { EXTRA_CARD_DESCRIPTIONS } from "./cardDescriptionsExtra";

describe("cardDescriptionsExtra", () => {
  it("includes SPNT related cards", () => {
    const labels = EXTRA_CARD_DESCRIPTIONS.map((c) => c.label);
    assert.ok(labels.includes("SPEC") || labels.some((l) => l.includes("SPEC")));
    assert.ok(labels.includes("ENSO") || labels.some((l) => l.includes("ENSO")));
  });

  it("each extra card has label and description", () => {
    assert.ok(EXTRA_CARD_DESCRIPTIONS.length > 0);
    for (const card of EXTRA_CARD_DESCRIPTIONS) {
      assert.ok(card.label.length > 0);
      assert.ok(card.description.length > 10);
    }
  });
});
