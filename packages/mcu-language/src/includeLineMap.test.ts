import { describe, it } from "node:test";
import assert from "node:assert";
import { pathToFileURL } from "url";
import type { IncludeLineMapEntry } from "./ast";
import { rangeCoversEditorLine, mapExpandedLineToIncludeEditor } from "./includeLineMap";

describe("includeLineMap hover hit-test", () => {
  it("rangeCoversEditorLine matches include-only lines by editorUri", () => {
    const includeUri = pathToFileURL("C:/tmp/mats.mcu").href;
    const lineMap: IncludeLineMapEntry[] = [
      { source: "main", mainLine: 0 },
      {
        source: "marker",
        mainLine: 1,
        mainIncludeLine: 1,
        includePath: "mats",
        includeUri,
      },
      {
        source: "include",
        mainLine: 1,
        mainIncludeLine: 1,
        includePath: "mats",
        includeUri,
        includeLine: 0,
      },
      {
        source: "include",
        mainLine: 1,
        mainIncludeLine: 1,
        includePath: "mats",
        includeUri,
        includeLine: 1,
      },
      {
        source: "marker",
        mainLine: 1,
        mainIncludeLine: 1,
        includePath: "mats",
        includeUri,
      },
      { source: "main", mainLine: 2 },
    ];
    const nuclRange = { start: { line: 3, character: 0 }, end: { line: 3, character: 10 } };
    assert.ok(!rangeCoversEditorLine(nuclRange, 3, lineMap));
    assert.ok(rangeCoversEditorLine(nuclRange, 1, lineMap, includeUri));
    assert.ok(!rangeCoversEditorLine(nuclRange, 0, lineMap, includeUri));
    assert.strictEqual(mapExpandedLineToIncludeEditor(lineMap, 3, includeUri), 1);
  });
});
