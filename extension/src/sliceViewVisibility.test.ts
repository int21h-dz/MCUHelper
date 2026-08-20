const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SLICE_VISIBILITY,
  parseSliceVisibilityMessage,
} = require("./sliceViewVisibility");

describe("sliceViewVisibility", () => {
  it("defaults all visible", () => {
    assert.deepEqual(DEFAULT_SLICE_VISIBILITY, { xy: true, xz: true, yz: true });
  });

  it("parseSliceVisibilityMessage normalizes false flags", () => {
    assert.deepEqual(parseSliceVisibilityMessage({ visibility: { xy: false, xz: true } }), {
      xy: false,
      xz: true,
      yz: true,
    });
  });

  it("parseSliceVisibilityMessage returns null without visibility", () => {
    assert.equal(parseSliceVisibilityMessage({}), null);
    assert.equal(parseSliceVisibilityMessage(null), null);
  });
});
