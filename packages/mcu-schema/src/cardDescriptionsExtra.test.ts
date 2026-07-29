import { describe, it } from "node:test";
import assert from "node:assert";
import { EXTRA_CARD_DESCRIPTIONS } from "./cardDescriptionsExtra";
import { getCardByLabel } from "./index";

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

  it("DELN hover uses physical module description, not PIN optional cards list", () => {
    const deln = getCardByLabel("DELN");
    assert.ok(deln);
    assert.strictEqual(deln!.fragment, "physical");
    assert.strictEqual(deln!.syntax, "DELN valdeln");
    assert.ok(deln!.description.includes("valdeln=0"));
    assert.ok(deln!.description.includes("запаздывающ"));
    assert.ok(!deln!.description.includes("[ACEPT]"));
    assert.ok(!deln!.description.includes("[VOL"));
  });

  it("NUCOFF hover has full description from UserGuide §11.2", () => {
    const nucoff = getCardByLabel("NUCOFF");
    assert.ok(nucoff);
    assert.ok(nucoff!.description.includes("отдельности не производится"));
    assert.ok(!nucoff!.description.endsWith(" в"));
  });
});
