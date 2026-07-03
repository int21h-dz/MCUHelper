import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildCatalogPayload,
  FRAGMENT_DISPLAY,
  MODULE_TEMPLATES,
  getCardInsertText,
  padBurnupLabel,
} from "./catalog";
import { FRAGMENT_ORDER } from "./index";

describe("catalog", () => {
  it("buildCatalogPayload returns 8 modules", () => {
    const payload = buildCatalogPayload();
    assert.strictEqual(payload.length, FRAGMENT_ORDER.length);
    for (const mod of payload) {
      assert.ok(FRAGMENT_DISPLAY[mod.id as keyof typeof FRAGMENT_DISPLAY]);
      assert.ok(mod.template.length > 0);
      assert.ok(mod.cardGroups.length > 0);
      for (const group of mod.cardGroups) {
        assert.ok(group.title.length > 0);
        for (const item of group.items) {
          assert.ok(item.label.length > 0);
          assert.ok(item.insertText.length > 0);
          assert.ok(item.insertFormat === "snippet" || item.insertFormat === "plain");
        }
      }
    }
  });

  it("MODULE_TEMPLATES cover all fragments", () => {
    for (const id of FRAGMENT_ORDER) {
      assert.ok(MODULE_TEMPLATES[id].includes("FINISH") || MODULE_TEMPLATES[id].includes("END"));
    }
  });

  it("getCardInsertText uses snippet for PIN", () => {
    const pin = { label: "PIN", title: "PIN", syntax: "", description: "" };
    const r = getCardInsertText(pin, "physical");
    assert.strictEqual(r.format, "snippet");
    assert.ok(r.text.includes("PIN"));
  });

  it("padBurnupLabel pads to 6 chars", () => {
    assert.strictEqual(padBurnupLabel("CODE"), "CODE  ");
    assert.strictEqual(padBurnupLabel("POWER"), "POWER ");
  });
});
