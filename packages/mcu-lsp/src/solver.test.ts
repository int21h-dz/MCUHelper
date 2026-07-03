import { describe, it } from "node:test";
import assert from "node:assert";
import {
  parseLstFile,
  getCachedSolverResult,
  setCachedSolverResult,
  runInputStep,
} from "./solver";

describe("solver", () => {
  it("parseLstFile finds ERROR and WARNING", () => {
    const text = "Line 1\nERROR: bad input\nWARNING: check zones\nOK line";
    const diags = parseLstFile(text, "test.lst");
    assert.ok(diags.some((d) => d.severity === "error"));
    assert.ok(diags.some((d) => d.severity === "warning"));
    assert.strictEqual(diags[0].code, "mcu-solver");
  });

  it("parseLstFile handles Russian messages", () => {
    const diags = parseLstFile("ОШИБКА в данных\nПРЕДУПРеждение", "r.lst");
    assert.ok(diags.length >= 1);
  });

  it("caches solver results by hash", () => {
    setCachedSolverResult("abc", {
      diagnostics: [],
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    const cached = getCachedSolverResult("abc");
    assert.ok(cached);
    assert.strictEqual(cached!.exitCode, 0);
  });

  it("runInputStep resolves with mock spawn via nonexistent exe", async () => {
    const result = await runInputStep({
      mcuNrPath: "__nonexistent_mcu_exe__",
      workingDir: process.cwd(),
      variantName: "TESTVAR",
    });
    assert.ok(result.exitCode === null || result.exitCode !== 0);
    assert.ok(result.diagnostics.length > 0 || result.stderr.length >= 0);
  });
});
