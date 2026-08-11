import { describe, it } from "node:test";
import assert from "node:assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeDocument } from "@mcuhelper/mcu-language";
import {
  findReferences,
  isValidMcuId,
  prepareRename,
  renameSymbol,
  resolveSymbolAtPosition,
} from "./symbolRefs";

function openText(text: string, uri = "file:///inline.mcu") {
  const doc = TextDocument.create(uri, "mcunr", 1, text);
  const index = analyzeDocument(uri, text, 1);
  return { doc, index, uri };
}

describe("symbolRefs", () => {
  it("isValidMcuId accepts ≤6 letter-start ids", () => {
    assert.ok(isValidMcuId("N1"));
    assert.ok(isValidMcuId("ABCDEF"));
    assert.ok(!isValidMcuId("1ABC"));
    assert.ok(!isValidMcuId("ABCDEFG"));
    assert.ok(!isValidMcuId(""));
  });

  it("same-scope rename of body updates definition and zone refs", () => {
    const text = [
      "HEAD 3 0",
      "CONT B B B",
      "END",
      "SHEX BOX 0,0,0 1,1,0 0,0,1",
      "RCZ PIN 0,0,0 1 0.5",
      "Z1 BOX -PIN /1:1",
      "FINISH",
    ].join("\n");
    const { doc, index } = openText(text);
    const pin = index.ast.bodies.find((b) => b.name === "PIN")!;
    const pos = { line: pin.range.start.line, character: 4 };
    const sym = resolveSymbolAtPosition(doc, pos, index);
    assert.ok(sym);
    assert.strictEqual(sym!.kind, "body");
    assert.strictEqual(sym!.name, "PIN");

    const refs = findReferences(doc, pos, index);
    assert.ok(refs.length >= 2, `expected def+zone ref, got ${refs.length}`);

    const edit = renameSymbol(doc, pos, index, "CORE");
    assert.ok(edit);
    const changes = edit!.changes[doc.uri] ?? [];
    assert.ok(changes.length >= 2);
    assert.ok(changes.every((e) => e.newText === "CORE"));

    const refused = renameSymbol(doc, pos, index, "123BAD");
    assert.strictEqual(refused, null);
    const tooLong = renameSymbol(doc, pos, index, "TOOLONG");
    assert.strictEqual(tooLong, null);
  });

  it("EQU rename updates definition and expression use", () => {
    const text = ["HEAD 3 0", "EQU RAD = 5", "EQU DIAM = 2*RAD", "FINISH"].join("\n");
    const { doc, index } = openText(text);
    const rad = index.ast.constants.find((c) => c.name === "RAD")!;
    const pos = { line: rad.range.start.line, character: 4 };
    const prep = prepareRename(doc, pos, index);
    assert.ok(prep);
    assert.strictEqual(prep!.placeholder, "RAD");

    const edit = renameSymbol(doc, pos, index, "R");
    assert.ok(edit);
    const changes = edit!.changes[doc.uri] ?? [];
    assert.ok(changes.length >= 2, `expected EQU def + RHS use, got ${JSON.stringify(changes)}`);
    const lines = changes.map((c) => c.range.start.line).sort((a, b) => a - b);
    assert.ok(lines.includes(rad.range.start.line));
    const diam = index.ast.constants.find((c) => c.name === "DIAM")!;
    assert.ok(lines.includes(diam.range.start.line));
  });

  it("no cross-scope collision between two CELL prototypes with same body name", () => {
    const text = [
      "HEAD 3 0",
      "CONT B B B",
      "END",
      "CELL A24",
      "SHEX N1 0,0,0 1,1,0 0,0,1",
      "RCZ N2 0,0,0 1 0.5",
      "END",
      "Z001 N1 -N2 /1:1",
      "END",
      "CELL R24",
      "SHEX N1 0,0,0 1,1,0 0,0,1",
      "RCZ N2 0,0,0 1 0.5",
      "END",
      "Z001 N1 -N2 /1:1",
      "END",
      "FINISH",
    ].join("\n");
    const { doc, index } = openText(text);
    const n1A = index.ast.bodies.filter((b) => b.name === "N1");
    assert.strictEqual(n1A.length, 2);
    assert.notStrictEqual(n1A[0]!.scope, n1A[1]!.scope);

    const posA = { line: n1A[0]!.range.start.line, character: 5 };
    const symA = resolveSymbolAtPosition(doc, posA, index);
    assert.ok(symA);
    assert.strictEqual(symA!.scope, n1A[0]!.scope);

    const refsA = findReferences(doc, posA, index);
    const linesA = new Set(refsA.map((r) => r.range.start.line));
    // Только CELL A24: def N1 + zone Z001 ref, без CELL R24.
    assert.ok(linesA.has(n1A[0]!.range.start.line));
    assert.ok(!linesA.has(n1A[1]!.range.start.line), "must not include N1 from other CELL");

    const edit = renameSymbol(doc, posA, index, "NA");
    assert.ok(edit);
    const changes = edit!.changes[doc.uri] ?? [];
    const editedLines = new Set(changes.map((c) => c.range.start.line));
    assert.ok(editedLines.has(n1A[0]!.range.start.line));
    assert.ok(!editedLines.has(n1A[1]!.range.start.line));

    // Исходный текст CELL R24 не должен попасть в edits.
    for (const c of changes) {
      const lineText = doc.getText({
        start: { line: c.range.start.line, character: 0 },
        end: { line: c.range.start.line, character: 200 },
      });
      if (c.range.start.line === n1A[1]!.range.start.line) {
        assert.fail(`cross-scope edit on: ${lineText}`);
      }
    }
  });
});
