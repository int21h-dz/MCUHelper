import { describe, it, after } from "node:test";
import assert from "node:assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeDocument, parseParameteThr, setParameteThrTable, clearParameteThrTable } from "@mcuhelper/mcu-language";
import {
  collectHalfLifeMismatchDiagnostics,
  setHalfLifeMismatchesForTest,
  clearHalfLifeMismatchesForTest,
  HL_MISMATCH_REL_EPS,
} from "./parameteThrVerify";
import { collectDiagnostics } from "./serverHandlers";

describe("parameteThrVerify diagnostics", () => {
  after(() => {
    clearHalfLifeMismatchesForTest();
    clearParameteThrTable();
  });

  it("warns on T1/2 mismatch for MCU nuclide", () => {
    setParameteThrTable(
      parseParameteThr(`
LONGLIFE ISOTOPES
LIST
Cs-137  551370   137.      3.000E+00 y
stop
`)
    );
    setHalfLifeMismatchesForTest([
      {
        mcuName: "CS37",
        parameteName: "Cs-137",
        iname: 551370,
        thrSec: 3 * 31_557_600,
        iaeaSec: 30.08 * 31_557_600,
        deltaSec: (3 - 30.08) * 31_557_600,
        relDelta: Math.abs(3 - 30.08) / 30.08,
        iaeaTarget: "Cs-137",
      },
    ]);
    // wait - 3 vs 30.08 would be huge; for test we just inject mismatch
    const text = ["PIN 1 0", "MATR 1", "CS37 1e-8", "FINISH"].join("\n");
    const uri = "file:///thr-diag.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    const diags = collectHalfLifeMismatchDiagnostics(doc, index.ast.materials);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0]!.code, "thr-halflife-mismatch");
    assert.ok(diags[0]!.message.includes("CS37"));
    assert.ok(collectDiagnostics(doc).some((d) => d.code === "thr-halflife-mismatch"));
    assert.ok(HL_MISMATCH_REL_EPS > 0);
  });

  it("emits one T1/2 warning per isotope even if repeated", () => {
    setHalfLifeMismatchesForTest([
      {
        mcuName: "CS37",
        parameteName: "Cs-137",
        iname: 551370,
        thrSec: 3 * 31_557_600,
        iaeaSec: 30.08 * 31_557_600,
        deltaSec: (3 - 30.08) * 31_557_600,
        relDelta: Math.abs(3 - 30.08) / 30.08,
        iaeaTarget: "Cs-137",
      },
    ]);
    const text = [
      "PIN 1 0",
      "MATR 1",
      "CS37 1e-8",
      "MATR 2",
      "CS37 2e-8",
      "FINISH",
    ].join("\n");
    const uri = "file:///thr-diag-dup.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    const diags = collectHalfLifeMismatchDiagnostics(doc, index.ast.materials);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0]!.range.start.line, 2);
  });
});
