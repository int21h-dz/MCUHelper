import { describe, it } from "node:test";
import assert from "node:assert";
import { SOURCE_CARDS, REGISTRATION_EXTRA_CARDS, PHYSICAL_EXTRA_CARDS } from "./moduleCards";

describe("moduleCards", () => {
  it("SOURCE_CARDS have fragment source", () => {
    assert.ok(SOURCE_CARDS.length > 5);
    for (const card of SOURCE_CARDS) {
      assert.strictEqual(card.fragment, "source");
      assert.ok(card.label.length > 0);
      assert.ok(card.syntax.length > 0);
    }
  });

  it("REGISTRATION_EXTRA_CARDS have registration fragment", () => {
    assert.ok(REGISTRATION_EXTRA_CARDS.length > 0);
    for (const card of REGISTRATION_EXTRA_CARDS) {
      assert.strictEqual(card.fragment, "registration");
    }
  });

  it("PHYSICAL_EXTRA_CARDS have physical fragment", () => {
    assert.ok(PHYSICAL_EXTRA_CARDS.length > 0);
    for (const card of PHYSICAL_EXTRA_CARDS) {
      assert.strictEqual(card.fragment, "physical");
    }
  });

  it("includes NPS and PROB in source module", () => {
    const labels = SOURCE_CARDS.map((c) => c.label);
    assert.ok(labels.includes("NPS"));
    assert.ok(labels.includes("PROB"));
  });
});
