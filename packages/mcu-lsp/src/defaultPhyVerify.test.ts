import { describe, it } from "node:test";
import assert from "node:assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  analyzeDocument,
  clearDefaultPhyTable,
  parseDefaultPhy,
  buildDefaultPhyTable,
  setDefaultPhyTable,
} from "@mcuhelper/mcu-language";
import { collectDefaultPhyMissingDiagnostics } from "./defaultPhyVerify";
import { collectDiagnostics } from "./serverHandlers";

function setPhyFromText(text: string): void {
  setDefaultPhyTable(buildDefaultPhyTable(parseDefaultPhy(text)));
}

describe("collectDefaultPhyMissingDiagnostics", () => {
  it("reports error when nuclide is absent in loaded DEFAULT.PHY", () => {
    setPhyFromText("U235 E70 T 0 .0 1.0 SVC TVC .0 .0 -1. -1. 1\n#\n");
    try {
      const text = ["PIN 1 0", "MATR 1", "SI44 1.0e-6", "U235 0.01", "FINISH"].join("\n");
      const uri = "file:///phy-missing.mcu";
      const doc = TextDocument.create(uri, "mcunr", 1, text);
      const index = analyzeDocument(uri, text, 1);
      const diags = collectDefaultPhyMissingDiagnostics(doc, index.ast);
      assert.strictEqual(diags.length, 1);
      assert.strictEqual(diags[0]!.severity, 1);
      assert.strictEqual(diags[0]!.code, "phy-missing");
      assert.ok(diags[0]!.message.includes("SI44"));
      assert.ok(diags[0]!.message.includes("DEFAULT.PHY"));
      const all = collectDiagnostics(doc);
      assert.ok(all.some((d) => d.code === "phy-missing"));
    } finally {
      clearDefaultPhyTable();
    }
  });

  it("ignores DEFAULT.PHY-missing nuclide when listed in SI", () => {
    setPhyFromText("U235 E70 T 0 .0 1.0 SVC TVC .0 .0 -1. -1. 1\n#\n");
    try {
      const text = ["PIN 1 0", "SI SI44", "MATR 1", "SI44 1.0e-6", "U235 0.01", "FINISH"].join("\n");
      const uri = "file:///phy-missing-si.mcu";
      const doc = TextDocument.create(uri, "mcunr", 1, text);
      const index = analyzeDocument(uri, text, 1);
      const diags = collectDefaultPhyMissingDiagnostics(doc, index.ast);
      assert.strictEqual(diags.length, 0);
    } finally {
      clearDefaultPhyTable();
    }
  });

  it("warns when DEFAULT.PHY-missing nuclide enters sum isotope only via SIDEN", () => {
    setPhyFromText("U235 E70 T 0 .0 1.0 SVC TVC .0 .0 -1. -1. 1\n#\n");
    try {
      const text = ["PIN 1 0", "SIDEN 1.0E-5", "MATR 1", "SI44 1.0e-8", "U235 0.01", "FINISH"].join(
        "\n"
      );
      const uri = "file:///phy-missing-siden.mcu";
      const doc = TextDocument.create(uri, "mcunr", 1, text);
      const index = analyzeDocument(uri, text, 1);
      const diags = collectDefaultPhyMissingDiagnostics(doc, index.ast);
      assert.strictEqual(diags.length, 1);
      assert.strictEqual(diags[0]!.severity, 2);
      assert.strictEqual(diags[0]!.code, "phy-missing-siden");
      assert.ok(diags[0]!.message.includes("SIDEN"));
      assert.ok(diags[0]!.message.includes("SI"));
    } finally {
      clearDefaultPhyTable();
    }
  });

  it("returns empty when DEFAULT.PHY table is not loaded", () => {
    clearDefaultPhyTable();
    const text = ["PIN 1 0", "MATR 1", "SI44 1.0e-6", "FINISH"].join("\n");
    const uri = "file:///phy-empty.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    assert.strictEqual(collectDefaultPhyMissingDiagnostics(doc, index.ast).length, 0);
  });
});
