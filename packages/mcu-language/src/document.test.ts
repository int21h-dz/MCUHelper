import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analyzeDocument, getDocumentIndex, clearDocument, resetDocumentParseCount, getDocumentParseCount } from "./document";

describe("document", () => {
  const uri = "file:///test/doc.mcu";

  it("analyzeDocument builds index with hash", () => {
    clearDocument(uri);
    const text = "PIN 1 0\nMATR 1\nU235 1.E-3\nFINISH";
    const index = analyzeDocument(uri, text, 1);
    assert.strictEqual(index.uri, uri);
    assert.strictEqual(index.version, 1);
    assert.ok(index.hash.length === 64);
    assert.ok(index.summaries.materials.length >= 1);
  });

  it("getDocumentIndex returns cached index", () => {
    const text = "PIN 1 0\nFINISH";
    analyzeDocument(uri, text, 2);
    const cached = getDocumentIndex(uri);
    assert.ok(cached);
    assert.strictEqual(cached!.version, 2);
  });

  it("clearDocument removes cache entry", () => {
    analyzeDocument(uri, "PIN 1 0", 3);
    clearDocument(uri);
    assert.strictEqual(getDocumentIndex(uri), undefined);
  });

  it("re-analyze updates hash when text changes", () => {
    clearDocument(uri);
    const a = analyzeDocument(uri, "PIN 1 0", 1);
    const b = analyzeDocument(uri, "PIN 2 0", 2);
    assert.notStrictEqual(a.hash, b.hash);
  });

  it("returns cached index for same version without re-parsing", () => {
    clearDocument(uri);
    resetDocumentParseCount();
    const text = "PIN 1 0\nFINISH";
    const first = analyzeDocument(uri, text, 10);
    const second = analyzeDocument(uri, text, 10);
    assert.strictEqual(first, second);
    assert.strictEqual(getDocumentParseCount(), 1);
  });

  it("analyzeDocument preserves includes when expandInclude inlines file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-doc-inc-"));
    const incPath = path.join(dir, "confpd.mcu");
    fs.writeFileSync(incPath, "U235 1.E-3", "utf8");
    const mainPath = path.join(dir, "main.mcu");
    const mainText = "#include confpd\nFINISH";
    fs.writeFileSync(mainPath, mainText, "utf8");
    const fileUri = `file:///${mainPath.replace(/\\/g, "/")}`;
    clearDocument(fileUri);
    const index = analyzeDocument(fileUri, mainText, 1, { baseDir: dir, expandInclude: true });
    assert.strictEqual(index.ast.includes.length, 1);
    assert.strictEqual(index.ast.includes[0]!.path, "confpd");
    assert.strictEqual(index.ast.includes[0]!.range.start.line, 0);
    assert.strictEqual(index.ast.includes[0]!.range.start.character, 9);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
