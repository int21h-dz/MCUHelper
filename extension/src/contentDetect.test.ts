import { describe, it } from "node:test";
import assert from "node:assert";
import * as vscode from "vscode";
import {
  detectMcunrContent,
  isLanguageDetectCandidate,
  isMcuOutputArtifactPath,
  scoreMcunrContent,
} from "./contentDetect";

function mockDoc(
  text: string,
  languageId = "plaintext",
  scheme: "file" | "untitled" = "file",
  fsPath = "/test.mcu"
): vscode.TextDocument {
  const uri =
    scheme === "untitled"
      ? { scheme: "untitled", fsPath: "", toString: () => "untitled:Untitled-1" }
      : { scheme: "file", fsPath, toString: () => `file://${fsPath}` };
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

  it("isMcuOutputArtifactPath matches LST/FIN and run-dir MCU", () => {
    assert.ok(isMcuOutputArtifactPath("Z:/runs/958.LST"));
    assert.ok(isMcuOutputArtifactPath("Z:/runs/958.fin"));
    assert.ok(isMcuOutputArtifactPath("Z:/proj/.mcuhelper-runs/958/958.MCU"));
    assert.ok(!isMcuOutputArtifactPath("Z:/proj/958.mcu"));
    assert.ok(!isMcuOutputArtifactPath("Z:/proj/RUNTEST/958"));
  });

  it("isLanguageDetectCandidate rejects LST/FIN artifacts", () => {
    assert.ok(
      !isLanguageDetectCandidate(
        mockDoc("PIN 1\nFINISH", "plaintext", "file", "Z:/proj/.mcuhelper-runs/958/958.LST")
      )
    );
  });
});