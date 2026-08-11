import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analyzeDocument, getDocumentIndex, clearDocument, rebuildCachedSummaries, resetDocumentParseCount, getDocumentParseCount } from "./document";
import {
  clearParameteThrTable,
  parseParameteThr,
  setParameteThrTable,
} from "./parameteThr";
import { clearAwLibTable, parseAwLib, setAwLibTable } from "./awLib";

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

  it("returns cached index when only LSP version changes", () => {
    clearDocument(uri);
    resetDocumentParseCount();
    const text = "PIN 1 0\nFINISH";
    const first = analyzeDocument(uri, text, 10);
    const second = analyzeDocument(uri, text, 11);
    assert.strictEqual(first, second);
    assert.strictEqual(second.version, 11);
    assert.strictEqual(getDocumentParseCount(), 1);
  });

  it("same text and version reuses cache after hash check", () => {
    clearDocument(uri);
    resetDocumentParseCount();
    const text = "PIN 1 0\nFINISH";
    const first = analyzeDocument(uri, text, 1, { expandInclude: false });
    const second = analyzeDocument(uri, text, 1, { expandInclude: false });
    assert.strictEqual(first, second);
    assert.strictEqual(getDocumentParseCount(), 1);
  });

  it("rebuildCachedSummaries refreshes activity after THR without reparse", () => {
    clearDocument(uri);
    clearParameteThrTable();
    clearAwLibTable();
    resetDocumentParseCount();
    setAwLibTable(
      parseAwLib(`
CS37  55137 136.907089
`)
    );
    const text = "PIN 1 0\nMATR 1\nCS37 1.0E-6\nFINISH";
    const before = analyzeDocument(uri, text, 1);
    assert.strictEqual(before.summaries.materials[0]!.activityBqPerG, null);
    assert.strictEqual(getDocumentParseCount(), 1);

    setParameteThrTable(
      parseParameteThr(`
LONGLIFE ISOTOPES
LIST
Cs-137  551370   137.      3.000E+00 y
stop
`)
    );
    const n = rebuildCachedSummaries();
    assert.ok(n >= 1);
    assert.strictEqual(getDocumentParseCount(), 1);
    const after = getDocumentIndex(uri)!;
    assert.ok(after.summaries.materials[0]!.activityBqPerG != null);
    assert.ok(after.summaries.materials[0]!.activityBqPerG! > 0);
    clearParameteThrTable();
    clearAwLibTable();
    clearDocument(uri);
  });

  it("rebuildCachedSummaries(uris) only touches listed documents", () => {
    const uriA = "file:///test/doc-a.mcu";
    const uriB = "file:///test/doc-b.mcu";
    clearDocument(uriA);
    clearDocument(uriB);
    clearParameteThrTable();
    clearAwLibTable();
    setAwLibTable(parseAwLib(`CS37  55137 136.907089\n`));
    const text = "PIN 1 0\nMATR 1\nCS37 1.0E-6\nFINISH";
    analyzeDocument(uriA, text, 1);
    analyzeDocument(uriB, text, 1);
    setParameteThrTable(
      parseParameteThr(`
LONGLIFE ISOTOPES
LIST
Cs-137  551370   137.      3.000E+00 y
stop
`)
    );
    const n = rebuildCachedSummaries([uriA]);
    assert.strictEqual(n, 1);
    assert.ok(getDocumentIndex(uriA)!.summaries.materials[0]!.activityBqPerG! > 0);
    assert.strictEqual(getDocumentIndex(uriB)!.summaries.materials[0]!.activityBqPerG, null);
    clearParameteThrTable();
    clearAwLibTable();
    clearDocument(uriA);
    clearDocument(uriB);
  });

  it("re-parses when text changes even if version stays the same", () => {
    clearDocument(uri);
    resetDocumentParseCount();
    analyzeDocument(uri, "PIN 1 0\nFINISH", 1);
    const second = analyzeDocument(uri, "PIN 1 0\nMATR 1\nU235 1\nFINISH", 1);
    assert.strictEqual(getDocumentParseCount(), 2);
    assert.strictEqual(second.ast.materials.length, 1);
  });

  it("caches expanded and source parses separately", () => {
    clearDocument(uri);
    resetDocumentParseCount();
    const text = "PIN 1 0\nFINISH";
    analyzeDocument(uri, text, 1, { expandInclude: false });
    analyzeDocument(uri, text, 1, { expandInclude: true });
    assert.strictEqual(getDocumentParseCount(), 2);
    assert.ok(getDocumentIndex(uri, false));
    assert.ok(getDocumentIndex(uri, true));
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

  it("re-parses when include file changes even if main text/version unchanged", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-doc-stale-"));
    try {
      const incPath = path.join(dir, "confpd.mcu");
      fs.writeFileSync(incPath, "SI N\n", "utf8");
      const mainPath = path.join(dir, "main.mcu");
      const mainText = ["PIN", "#include confpd", "MATR 1", "N 1.0E-5", "FINISH"].join("\n");
      fs.writeFileSync(mainPath, mainText, "utf8");
      const fileUri = `file:///${mainPath.replace(/\\/g, "/")}`;
      clearDocument(fileUri);
      const first = analyzeDocument(fileUri, mainText, 1, { baseDir: dir, expandInclude: true });
      const hasSi = first.ast.statements.some((s) => s.label.toUpperCase() === "SI");
      assert.ok(hasSi);

      // Windows mtime resolution — небольшая пауза не нужна если меняем size
      fs.writeFileSync(incPath, "SI N, O\nSIDEN 1.0E-4\n", "utf8");
      const second = analyzeDocument(fileUri, mainText, 1, { baseDir: dir, expandInclude: true });
      assert.notStrictEqual(first.hash, second.hash);
      assert.notStrictEqual(first, second);
      const siText = second.ast.statements.find((s) => s.label.toUpperCase() === "SI")?.text ?? "";
      assert.ok(/O/i.test(siText), siText);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
