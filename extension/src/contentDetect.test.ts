import { describe, it } from "node:test";
import assert from "node:assert";
import * as vscode from "vscode";
import {
  detectMcunrContent,
  isLanguageDetectCandidate,
  scoreMcunrContent,
} from "./contentDetect";

function mockDoc(
  text: string,
  languageId = "plaintext",
  scheme: "file" | "untitled" = "file"
): vscode.TextDocument {
  const uri =
    scheme === "untitled"
      ? { scheme: "untitled", fsPath: "", toString: () => "untitled:Untitled-1" }
      : { scheme: "file", fsPath: "/test.mcu", toString: () => "file:///test.mcu" };
  return {
    languageId,
    uri,
    getText: () => text,
  } as unknown as vscode.TextDocument;
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

  it("isLanguageDetectCandidate accepts plaintext and ini", () => {
    assert.ok(isLanguageDetectCandidate(mockDoc("", "plaintext")));
    assert.ok(isLanguageDetectCandidate(mockDoc("", "ini")));
    assert.ok(isLanguageDetectCandidate(mockDoc("", "plaintext", "untitled")));
  });

  it("isLanguageDetectCandidate rejects mcunr and unrelated languages", () => {
    assert.ok(!isLanguageDetectCandidate(mockDoc("", "mcunr")));
    assert.ok(!isLanguageDetectCandidate(mockDoc("", "javascript")));
  });
});
