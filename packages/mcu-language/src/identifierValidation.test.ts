import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDocument } from "./parser";
import { analyzeSemantics } from "./semantic";

describe("identifierValidation", () => {
  it("warns on body name longer than 6 characters", () => {
    const ast = parseDocument("HEAD 3 0\nRPP TOOLONG 0 1 0 1 0 1\nFINISH", { uri: "test.mcu" });
    const diags = analyzeSemantics(ast);
    assert.ok(diags.some((d) => d.code === "name-too-long" && d.message.includes("TOOLONG")));
  });

  it("warns on zone name longer than 6 characters", () => {
    const ast = parseDocument("HEAD 3 0\nCONT T T M M M M M M\nRPP A 0 1 0 1 0 1\nEND\nVERYLONG FU\nEND\nFINISH", {
      uri: "test.mcu",
    });
    const diags = analyzeSemantics(ast);
    assert.ok(diags.some((d) => d.code === "name-too-long" && d.message.includes("VERYLONG")));
  });

  it("warns on EQU name longer than 6 characters", () => {
    const ast = parseDocument("HEAD 3 0\nEQU LONGNAME = 10\nFINISH", { uri: "test.mcu" });
    const diags = analyzeSemantics(ast);
    assert.ok(diags.some((d) => d.code === "name-too-long" && d.message.includes("LONGNAME")));
  });

  it("accepts valid 6-char names", () => {
    const ast = parseDocument("HEAD 3 0\nRPP FUEL12 0 1 0 1 0 1\nFINISH", { uri: "test.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "name-too-long" || d.code === "name-invalid");
    assert.strictEqual(diags.length, 0);
  });
});
