import { describe, it } from "node:test";
import assert from "node:assert";
import {
  FRAGMENT_ORDER,
  ALL_CARDS,
  getCardByLabel,
  getBodyByKey,
  formatCardHover,
  BODY_TYPES,
  MODS_VALUES,
  BOUNDARY_CODES,
  isGeoBodyLabel,
  GEO_BODY_KEYS,
} from "./index";

describe("index smoke", () => {
  it("FRAGMENT_ORDER has 8 modules", () => {
    assert.strictEqual(FRAGMENT_ORDER.length, 8);
  });

  it("ALL_CARDS has hundreds of entries", () => {
    assert.ok(ALL_CARDS.length > 200);
    for (const card of ALL_CARDS.slice(0, 20)) {
      assert.ok(card.label.length > 0);
      assert.ok(card.description.length > 0);
    }
  });

  it("getCardByLabel finds PIN and aliases", () => {
    assert.ok(getCardByLabel("PIN"));
    assert.ok(getCardByLabel("powe") || getCardByLabel("POWER"));
  });

  it("getBodyByKey finds RCZ and RCC", () => {
    assert.ok(getBodyByKey("RCZ"));
    assert.ok(getBodyByKey("RCC"));
    assert.ok(BODY_TYPES.length > 10);
  });

  it("isGeoBodyLabel covers BODY_TYPES and TRANSF", () => {
    assert.ok(isGeoBodyLabel("RCZ"));
    assert.ok(isGeoBodyLabel("TRANSF"));
    assert.ok(GEO_BODY_KEYS.has("UPOLY"));
    assert.ok(!isGeoBodyLabel("MATR"));
  });

  it("formatCardHover includes title and syntax", () => {
    const pin = getCardByLabel("PIN")!;
    const hover = formatCardHover(pin);
    assert.ok(hover.includes("PIN"));
    assert.ok(hover.includes(pin.syntax));
  });

  it("MODS_VALUES and BOUNDARY_CODES are non-empty", () => {
    assert.ok(MODS_VALUES.includes("G"));
    assert.ok(BOUNDARY_CODES.length > 0);
  });
});
