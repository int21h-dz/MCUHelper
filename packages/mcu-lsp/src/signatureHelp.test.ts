import { describe, it } from "node:test";
import assert from "node:assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getSignatureHelp } from "./signatureHelp";

describe("signatureHelp", () => {
  it("returns help for RCZ body line", () => {
    const doc = TextDocument.create(
      "file:///t.mcu",
      "mcunr",
      1,
      "HEAD 1 0\nRCZ FU 0,0,0 100 0.5\nFINISH"
    );
    const help = getSignatureHelp(doc, { line: 1, character: 10 });
    assert.ok(help);
    assert.ok(help!.signatures.length > 0);
  });

  it("returns help for MATR card", () => {
    const doc = TextDocument.create("file:///m.mcu", "mcunr", 1, "MATR 1 ");
    const help = getSignatureHelp(doc, { line: 0, character: 6 });
    assert.ok(help);
  });

  it("returns null for empty document", () => {
    const doc = TextDocument.create("file:///e.mcu", "mcunr", 1, "");
    assert.strictEqual(getSignatureHelp(doc, { line: 0, character: 0 }), null);
  });
});
