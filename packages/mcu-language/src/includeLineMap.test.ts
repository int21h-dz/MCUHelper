import { describe, it } from "node:test";
import assert from "node:assert";
import {
  mapExpandedLineToMain,
  mapMainLineToExpanded,
  remapRangeToMainDocument,
  rangeCoversEditorLine,
  formatExpandedLineRef,
} from "./includeLineMap";
import type { IncludeLineMapEntry } from "./ast";

describe("includeLineMap", () => {
  const lineMap: IncludeLineMapEntry[] = [
    { source: "main", mainLine: 0 },
    { source: "marker", mainLine: 1, mainIncludeLine: 1, includePath: "x" },
    { source: "include", mainLine: 1, mainIncludeLine: 1, includePath: "x", includeLine: 0 },
    { source: "include", mainLine: 1, mainIncludeLine: 1, includePath: "x", includeLine: 1 },
    { source: "marker", mainLine: 1, mainIncludeLine: 1, includePath: "x" },
    { source: "main", mainLine: 2 },
    { source: "main", mainLine: 3 },
  ];

  it("mapExpandedLineToMain keeps main lines and drops include-only", () => {
    assert.strictEqual(mapExpandedLineToMain(undefined, 5), 5);
    assert.strictEqual(mapExpandedLineToMain(lineMap, 0), 0);
    assert.strictEqual(mapExpandedLineToMain(lineMap, 2), null);
    assert.strictEqual(mapExpandedLineToMain(lineMap, 5), 2);
    assert.strictEqual(mapExpandedLineToMain(lineMap, 1), 1);
  });

  it("mapMainLineToExpanded maps editor lines back into expanded coords", () => {
    assert.strictEqual(mapMainLineToExpanded(undefined, 4), 4);
    assert.strictEqual(mapMainLineToExpanded(lineMap, 0), 0);
    assert.strictEqual(mapMainLineToExpanded(lineMap, 1), 1);
    assert.strictEqual(mapMainLineToExpanded(lineMap, 2), 5);
    assert.strictEqual(mapMainLineToExpanded(lineMap, 3), 6);
  });

  it("rangeCoversEditorLine remaps expanded nuclide ranges", () => {
    const range = { start: { line: 6, character: 0 }, end: { line: 6, character: 10 } };
    assert.ok(rangeCoversEditorLine(range, 3, lineMap));
    assert.ok(!rangeCoversEditorLine(range, 6, lineMap));
    const includeOnly = { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } };
    assert.ok(!rangeCoversEditorLine(includeOnly, 1, lineMap));
    const mapped = remapRangeToMainDocument(range, lineMap);
    assert.deepStrictEqual(mapped?.start.line, 3);
  });

  it("formatExpandedLineRef uses editor line or include path:line", () => {
    assert.strictEqual(formatExpandedLineRef(undefined, 4), "строке 5");
    assert.strictEqual(formatExpandedLineRef(lineMap, 0), "строке 1");
    assert.strictEqual(formatExpandedLineRef(lineMap, 5), "строке 3");
    assert.strictEqual(formatExpandedLineRef(lineMap, 2), "x:1");
    assert.strictEqual(formatExpandedLineRef(lineMap, 1), "строке 2");
  });
});
