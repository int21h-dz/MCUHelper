import { describe, it } from "node:test";
import assert from "node:assert";
import { detectMcunrContent, scoreMcunrContent } from "./contentDetect";

function mockDoc(text: string, languageId = "plaintext") {
  return {
    languageId,
    uri: { scheme: "file", fsPath: "/test.mcu", toString: () => "file:///test.mcu" },
    getText: () => text,
  };
}

describe("contentDetect", () => {
  it("detectMcunrContent recognizes PIN/MATR", () => {
    const text = "PIN 1 0\nMATR 1\nU235 1.E-3\nFINISH";
    assert.ok(detectMcunrContent(text));
    const score = scoreMcunrContent(text);
    assert.ok(score.isMcunr);
    assert.ok(score.score > 0);
  });

  it("detectMcunrContent rejects plain text", () => {
    assert.ok(!detectMcunrContent("hello world\nfoo bar"));
  });
});
