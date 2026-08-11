import { describe, it } from "node:test";
import assert from "node:assert";
import { buildIncludeGraph, includeTextHasNestedInclude } from "./includeGraph";

describe("includeGraph", () => {
  it("includeTextHasNestedInclude detects nested directive", () => {
    assert.strictEqual(includeTextHasNestedInclude("SI FP1\n"), false);
    assert.strictEqual(includeTextHasNestedInclude("#include other\n"), true);
    assert.strictEqual(includeTextHasNestedInclude("  #include <x>\n"), true);
    assert.strictEqual(includeTextHasNestedInclude("** #include fake\n"), false);
  });

  it("buildIncludeGraph normalizes exists and preserves order", () => {
    const nodes = buildIncludeGraph([
      { path: "a.inc", mainLine: 1, exists: true, uri: "file:///a.inc" },
      { path: "missing", mainLine: 3 },
      { path: "b.inc", mainLine: 5, exists: false, fsPath: "/tmp/b.inc" },
    ]);
    assert.strictEqual(nodes.length, 3);
    assert.strictEqual(nodes[0]!.path, "a.inc");
    assert.strictEqual(nodes[0]!.exists, true);
    assert.strictEqual(nodes[0]!.uri, "file:///a.inc");
    assert.strictEqual(nodes[1]!.exists, false);
    assert.strictEqual(nodes[1]!.mainLine, 3);
    assert.strictEqual(nodes[2]!.exists, false);
    assert.strictEqual(nodes[2]!.fsPath, "/tmp/b.inc");
  });

  it("buildIncludeGraph attaches encoding and diagCount", () => {
    const [node] = buildIncludeGraph([
      {
        path: "si.inc",
        mainLine: 2,
        exists: true,
        encoding: "win1251",
        diagCount: 4,
      },
    ]);
    assert.ok(node);
    assert.strictEqual(node!.encoding, "win1251");
    assert.strictEqual(node!.diagCount, 4);
    assert.strictEqual(node!.nestedInclude, undefined);
  });

  it("buildIncludeGraph marks nested include from text or flag", () => {
    const fromText = buildIncludeGraph([
      { path: "bad.inc", mainLine: 0, exists: true, text: "PIN 0\n#include nested\n" },
    ]);
    assert.strictEqual(fromText[0]!.nestedInclude, true);

    const fromFlag = buildIncludeGraph([
      { path: "bad2.inc", mainLine: 1, exists: true, nestedInclude: true },
    ]);
    assert.strictEqual(fromFlag[0]!.nestedInclude, true);

    const ok = buildIncludeGraph([{ path: "ok.inc", mainLine: 0, exists: true, text: "SI FP1\n" }]);
    assert.strictEqual(ok[0]!.nestedInclude, undefined);
  });

  it("buildIncludeGraph is flat main→includes only", () => {
    const nodes = buildIncludeGraph([
      { path: "confpd", mainLine: 10, exists: true },
      { path: "si.inc", mainLine: 11, exists: true, nestedInclude: true },
    ]);
    assert.deepStrictEqual(
      nodes.map((n) => n.path),
      ["confpd", "si.inc"]
    );
    assert.ok(!nodes.some((n) => n.path === "nested"));
  });
});
