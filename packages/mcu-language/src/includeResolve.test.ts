import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseIncludeLine, resolveIncludeFilePath, collectIncludesFromSource } from "./includeResolve";

describe("includeResolve", () => {
  it("parseIncludeLine supports angle brackets and bare name", () => {
    const a = parseIncludeLine("#include <confpd>");
    assert.ok(a);
    assert.strictEqual(a!.path, "confpd");
    assert.strictEqual(a!.pathStart, 10);

    const b = parseIncludeLine("  #include confpd");
    assert.ok(b);
    assert.strictEqual(b!.path, "confpd");
    assert.ok(b!.pathStart > 0);
  });

  it("resolveIncludeFilePath tries .mcu extension", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-"));
    const file = path.join(dir, "confpd.mcu");
    fs.writeFileSync(file, "PIN 1 0\nFINISH", "utf8");
    const resolved = resolveIncludeFilePath(dir, "confpd");
    assert.strictEqual(resolved.exists, true);
    assert.strictEqual(resolved.fsPath, file);
  });

  it("collectIncludesFromSource preserves line numbers", () => {
    const spans = collectIncludesFromSource("PIN 1 0\n#include confpd\nFINISH");
    assert.strictEqual(spans.length, 1);
    assert.strictEqual(spans[0]!.line, 1);
    assert.strictEqual(spans[0]!.path, "confpd");
    assert.strictEqual(spans[0]!.pathStart, 9);
  });
});
