import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import iconv from "iconv-lite";
import { expandIncludes, expandRepeats } from "./preprocessor";
import { mapExpandedLineToMain } from "./includeLineMap";
import { normalizeIncludeFsKey } from "./includeResolve";

describe("preprocessor", () => {
  it("expandRepeats expands bracket syntax", () => {
    assert.strictEqual(expandRepeats("[3|10.,]"), "10.,10.,10.,");
    assert.strictEqual(expandRepeats("[0|x]"), "");
    assert.strictEqual(expandRepeats("no repeats"), "no repeats");
  });

  it("expandIncludes inlines file content", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-"));
    const incPath = path.join(dir, "frag.mcu");
    fs.writeFileSync(incPath, "MATR 1\nU235 1.E-3", "utf8");
    const main = `#include <frag.mcu>\nFINISH`;
    const result = expandIncludes(main, dir);
    assert.ok(result.text.includes("U235"));
    assert.ok(result.text.includes("included from frag.mcu"));
    assert.deepStrictEqual(result.includes, ["frag.mcu"]);
    assert.strictEqual(result.errors.length, 0);
    assert.equal(result.lineMap[0]?.source, "marker");
    assert.equal(result.lineMap[1]?.source, "include");
    assert.equal(result.lineMap[1]?.includePath, "frag.mcu");
    assert.equal(result.lineMap[1]?.includeLine, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("expandIncludes inlines bare filename without extension", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-"));
    fs.writeFileSync(path.join(dir, "confpd"), "MATR 1\nU235 1.E-3", "utf8");
    const result = expandIncludes("#include confpd", dir);
    assert.ok(result.text.includes("U235"));
    assert.deepStrictEqual(result.includes, ["confpd"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("expandIncludes reports missing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-"));
    const result = expandIncludes("#include <missing.mcu>", dir);
    assert.ok(result.errors.some((e) => e.message.includes("не найден")));
    assert.equal(result.errors[0]?.mainLine, 0);
    assert.ok(result.text.includes("#include"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("expandIncludes rejects nested include", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-"));
    fs.writeFileSync(path.join(dir, "inner.mcu"), "#include <other.mcu>", "utf8");
    const result = expandIncludes("#include <inner.mcu>", dir);
    assert.ok(result.errors.some((e) => e.message.includes("Вложенный")));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("expandIncludes keeps non-include lines", () => {
    const result = expandIncludes("PIN 1 0\nFINISH", "/tmp");
    assert.strictEqual(result.text, "PIN 1 0\nFINISH");
    assert.strictEqual(result.includes.length, 0);
  });

  it("expandIncludes reads cp1251 include with Cyrillic comments", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-"));
    const incPath = path.join(dir, "frag.mcu");
    fs.writeFileSync(incPath, iconv.encode("MATR 1\n** материал\nU235 1.E-3", "win1251"));
    const result = expandIncludes("#include <frag.mcu>", dir);
    assert.ok(result.text.includes("материал"));
    assert.strictEqual(result.errors.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("expandIncludes builds line map for main and include lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-"));
    fs.writeFileSync(path.join(dir, "frag.mcu"), "MATR 1\nU235 1.E-3", "utf8");
    const result = expandIncludes("PIN 1 0\n#include <frag.mcu>\nFINISH", dir);
    assert.equal(result.lineMap.length, 6);
    assert.deepStrictEqual(
      result.lineMap.map((x) => ({
        source: x.source,
        mainLine: x.mainLine,
        includeLine: x.includeLine ?? null,
      })),
      [
        { source: "main", mainLine: 0, includeLine: null },
        { source: "marker", mainLine: 1, includeLine: null },
        { source: "include", mainLine: 1, includeLine: 0 },
        { source: "include", mainLine: 1, includeLine: 1 },
        { source: "marker", mainLine: 1, includeLine: null },
        { source: "main", mainLine: 2, includeLine: null },
      ]
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("expandIncludes maps several #include and main lines between them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-multi-"));
    try {
      fs.writeFileSync(path.join(dir, "a.inc"), "*1\n*2\n*3\nEQU INA = 1\n", "utf8");
      fs.writeFileSync(path.join(dir, "b.inc"), "EQU INB = 2\n", "utf8");
      const result = expandIncludes(
        ["EQU BEFORE = 0", "#include a.inc", "EQU MID = 1", "#include b.inc", "EQU AFTER = 2"].join("\n"),
        dir
      );
      const mainOf = (n: number) => result.lineMap.findIndex((e) => e.source === "main" && e.mainLine === n);
      const before = mainOf(0);
      const mid = mainOf(2);
      const after = mainOf(4);
      assert.strictEqual(before, 0);
      assert.ok(mid > before);
      assert.ok(after > mid);
      assert.strictEqual(mapExpandedLineToMain(result.lineMap, before), 0);
      assert.strictEqual(mapExpandedLineToMain(result.lineMap, mid), 2);
      assert.strictEqual(mapExpandedLineToMain(result.lineMap, after), 4);
      const ina = result.lineMap.find((e) => e.source === "include" && e.includePath === "a.inc" && e.includeLine === 3);
      const inb = result.lineMap.find((e) => e.source === "include" && e.includePath === "b.inc" && e.includeLine === 0);
      assert.ok(ina);
      assert.ok(inb);
      assert.ok(ina!.mainIncludeLine === 1);
      assert.ok(inb!.mainIncludeLine === 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("expandIncludes prefers open-buffer overrides over disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-ovr-"));
    fs.writeFileSync(path.join(dir, "frag.mcu"), "SI OLD\n", "utf8");
    const fsPath = path.join(dir, "frag.mcu");
    const overrides = new Map([[normalizeIncludeFsKey(fsPath), "SI NEW\n"]]);
    const result = expandIncludes("#include <frag.mcu>", dir, overrides);
    assert.ok(result.text.includes("SI NEW"), result.text);
    assert.ok(!result.text.includes("SI OLD"), result.text);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
