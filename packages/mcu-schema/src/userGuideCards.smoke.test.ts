import { describe, it } from "node:test";
import assert from "node:assert";
import { USER_GUIDE_CARDS } from "./userGuideCards.generated";

describe("userGuideCards.generated smoke", () => {
  it("has more than 100 cards", () => {
    assert.ok(USER_GUIDE_CARDS.length > 100);
  });

  it("each card has label and description", () => {
    for (const card of USER_GUIDE_CARDS.slice(0, 50)) {
      assert.ok(card.label.length > 0);
      assert.ok(card.description.length > 0);
    }
  });
});
