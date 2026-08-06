import { describe, it } from "node:test";
import assert from "node:assert";
import { stableIsotopeDecorationOptions } from "./stableIsotopeDecorations";

describe("stableIsotopeDecorations", () => {
  it("highlights concentration in blue, not wavy underline", () => {
    const opts = stableIsotopeDecorationOptions();
    assert.ok((opts.light as { color?: string }).color);
    assert.ok((opts.dark as { color?: string }).color);
    assert.strictEqual((opts.light as { textDecoration?: string }).textDecoration, undefined);
    assert.strictEqual((opts.dark as { textDecoration?: string }).textDecoration, undefined);
  });
});
