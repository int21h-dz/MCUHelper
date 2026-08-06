import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildDefInsertText,
  findPinLine,
  isInsidePhysicalModule,
  physicalModuleRange,
  resolveDefInsertPosition,
} from "./defInsertPosition";

describe("defInsertPosition", () => {
  const sample = [
    "PIN 1 0",
    "MATR 1 T=300",
    "U235 1e-3",
    "END",
    "FINISH",
    "HEAD 3 0",
    "CONT B B B",
  ];

  it("findPinLine and physical range stop before HEAD", () => {
    assert.strictEqual(findPinLine(sample), 0);
    assert.deepStrictEqual(physicalModuleRange(sample), { startLine: 0, endLine: 4 });
    assert.ok(isInsidePhysicalModule(sample, 2));
    assert.ok(!isInsidePhysicalModule(sample, 5));
  });

  it("outside physical inserts after PIN", () => {
    const plan = resolveDefInsertPosition(sample, 6, 0);
    assert.notStrictEqual(plan.reason, "no-pin");
    if (plan.reason === "no-pin") return;
    assert.strictEqual(plan.reason, "after-pin");
    assert.strictEqual(plan.line, 1);
    assert.strictEqual(plan.character, 0);
    assert.strictEqual(buildDefInsertText(plan, "DEF H ACE=E70"), "DEF H ACE=E70\n");
  });

  it("inside physical on empty line inserts at cursor", () => {
    const lines = ["PIN 1 0", "", "MATR 1", "FINISH", "HEAD 3 0"];
    const plan = resolveDefInsertPosition(lines, 1, 0);
    assert.notStrictEqual(plan.reason, "no-pin");
    if (plan.reason === "no-pin") return;
    assert.strictEqual(plan.reason, "at-cursor");
    assert.strictEqual(plan.line, 1);
    assert.strictEqual(plan.character, 0);
  });

  it("inside physical on non-empty line goes EOL then newline", () => {
    const plan = resolveDefInsertPosition(sample, 1, 3);
    assert.notStrictEqual(plan.reason, "no-pin");
    if (plan.reason === "no-pin") return;
    assert.strictEqual(plan.reason, "after-eol");
    assert.strictEqual(plan.line, 1);
    assert.strictEqual(plan.character, sample[1].length);
    assert.strictEqual(plan.prefix, "\n");
    assert.strictEqual(buildDefInsertText(plan, "DEF H"), "\nDEF H\n");
  });

  it("PIN alone at EOF appends after PIN line", () => {
    const lines = ["PIN 1 0"];
    const plan = resolveDefInsertPosition(lines, 0, 0);
    // cursor on PIN → inside physical, non-empty → after-eol
    assert.notStrictEqual(plan.reason, "no-pin");
    if (plan.reason === "no-pin") return;
    assert.strictEqual(plan.reason, "after-eol");

    const outside = resolveDefInsertPosition(["** c", "PIN 1 0"], 0, 0);
    assert.notStrictEqual(outside.reason, "no-pin");
    if (outside.reason === "no-pin") return;
    assert.strictEqual(outside.reason, "after-pin");
    assert.strictEqual(outside.line, 1);
    assert.strictEqual(outside.character, "PIN 1 0".length);
    assert.strictEqual(outside.prefix, "\n");
  });

  it("no PIN returns no-pin", () => {
    const plan = resolveDefInsertPosition(["HEAD 3 0", "CONT B"], 0, 0);
    assert.strictEqual(plan.reason, "no-pin");
  });
});
