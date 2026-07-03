import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expandIncludes, expandRepeats } from "./preprocessor";

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
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("expandIncludes reports missing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-"));
    const result = expandIncludes("#include <missing.mcu>", dir);
    assert.ok(result.errors.some((e) => e.includes("не найден")));
    assert.ok(result.text.includes("#include"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("expandIncludes rejects nested include", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-"));
    fs.writeFileSync(path.join(dir, "inner.mcu"), "#include <other.mcu>", "utf8");
    const result = expandIncludes("#include <inner.mcu>", dir);
    assert.ok(result.errors.some((e) => e.includes("Вложенный")));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("expandIncludes keeps non-include lines", () => {
    const result = expandIncludes("PIN 1 0\nFINISH", "/tmp");
    assert.strictEqual(result.text, "PIN 1 0\nFINISH");
    assert.strictEqual(result.includes.length, 0);
  });
});
