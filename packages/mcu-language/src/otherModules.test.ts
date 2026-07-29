import { describe, it } from "node:test";
import assert from "node:assert";
import { parseBurnupLines, isModuleCardLabel, classifyOtherModule } from "./otherModules";
import type { StatementNode } from "./ast";

describe("otherModules", () => {
  it("parseBurnupLines parses burnup card", () => {
    const lines = ["CODE     RSTP", "POWER    0.146"];
    const { cards, diagnostics } = parseBurnupLines(lines, 0);
    assert.strictEqual(diagnostics.length, 0);
    assert.strictEqual(cards.length, 2);
    assert.strictEqual(cards[0].name, "CODE");
    assert.ok(cards[0].words.includes("RSTP"));
    assert.strictEqual(cards[1].name, "POWER");
  });

  it("parseBurnupLines skips comments and blank lines", () => {
    const lines = ["", "C= comment", "* star", "FINISH"];
    const { cards } = parseBurnupLines(lines, 0);
    assert.strictEqual(cards.length, 1);
    assert.strictEqual(cards[0].name, "FINISH");
  });

  it("parseBurnupLines continues wrapped lines", () => {
    const lines = ["FISZON   1 1", " 5 7"];
    const { cards } = parseBurnupLines(lines, 0);
    assert.strictEqual(cards.length, 1);
    assert.ok(cards[0].words.includes("7"));
  });

  it("isModuleCardLabel recognizes PIN", () => {
    assert.ok(isModuleCardLabel("PIN"));
    assert.ok(!isModuleCardLabel("NOTREAL"));
  });

  it("classifyOtherModule maps modules", () => {
    const mk = (label: string): StatementNode =>
      ({ label, text: label, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, offset: 0, endOffset: 0 } } as StatementNode);
    assert.strictEqual(classifyOtherModule(mk("SPNT")), "source");
    assert.strictEqual(classifyOtherModule(mk("RGS")), "registration");
    assert.strictEqual(classifyOtherModule(mk("NTOT")), "trajectory");
    assert.strictEqual(classifyOtherModule(mk("NAMVAR")), "calculationControl");
    assert.strictEqual(classifyOtherModule(mk("XYZ0")), "calculationControl");
    assert.strictEqual(classifyOtherModule(mk("INPO")), "calculationControl");
    assert.strictEqual(classifyOtherModule(mk("SETT")), "calculationControl");
    assert.strictEqual(classifyOtherModule(mk("CODE")), "burnup");
    assert.strictEqual(classifyOtherModule(mk("FUEL")), null);
  });
});
