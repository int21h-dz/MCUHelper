import { describe, it, after } from "node:test";
import assert from "node:assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeDocument, clearAwLibTable, parseAwLib, setAwLibTable } from "@mcuhelper/mcu-language";
import {
  atomicMassFromEndfAwr,
  atomicMassFromLiveChartMicroU,
  collectAwLibMissingDiagnostics,
  formatMassDelta,
  parseLiveChartAtomicMasses,
  collectAwLibMassDiagnostics,
  setAwMassMismatchesForTest,
  clearAwMassMismatchesForTest,
  NEUTRON_MASS_AMU,
  AW_MISMATCH_ABS_EPS,
} from "./awLibVerify";
import { collectDiagnostics } from "./serverHandlers";

describe("awLibVerify helpers", () => {
  it("converts ENDF AWR to atomic mass (Cs-133)", () => {
    const awr = 131.7637;
    const mass = atomicMassFromEndfAwr(awr);
    assert.ok(Math.abs(mass - 132.90545) < 1e-4);
    assert.ok(NEUTRON_MASS_AMU > 1.008);
  });

  it("converts LiveChart micro-u atomic_mass", () => {
    assert.ok(Math.abs(atomicMassFromLiveChartMicroU(132905451.958) - 132.905451958) < 1e-12);
  });

  it("parses LiveChart CSV atomic masses", () => {
    const csv = [
      "z,n,symbol,abundance,atomic_mass",
      "55,78,Cs,100,132905451.958",
      "92,143,U,0,235043929.9",
    ].join("\n");
    const map = parseLiveChartAtomicMasses(csv);
    const cs = map.get("55:133")!;
    assert.ok(cs);
    assert.ok(Math.abs(cs.mass - 132.905451958) < 1e-9);
    const u = map.get("92:235")!;
    assert.ok(u.mass > 235.04 && u.mass < 235.05);
  });

  it("formats deltas", () => {
    assert.strictEqual(formatMassDelta(0), "0");
    assert.ok(formatMassDelta(1e-6).includes("e"));
    assert.ok(AW_MISMATCH_ABS_EPS > 0);
  });
});

describe("collectAwLibMassDiagnostics", () => {
  after(() => clearAwMassMismatchesForTest());

  it("warns on mismatched nuclide name token in MATR", () => {
    setAwMassMismatchesForTest([
      {
        name: "SI44",
        zaid: 14044,
        awLib: 44.03526,
        iaea: 44.031466,
        delta: 0.003794,
        relDelta: 8.6e-5,
        source: "livechart",
        iaeaTarget: "Si-44",
      },
    ]);
    const text = ["PIN 1 0", "MATR 1", "SI44 1.0e-6", "U235 0.01", "FINISH"].join("\n");
    const uri = "file:///aw-diag.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    const diags = collectAwLibMassDiagnostics(doc, index.ast.materials);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0]!.code, "aw-mass-mismatch");
    assert.ok(diags[0]!.message.includes("SI44"));
    assert.ok(diags[0]!.message.includes("Δ"));
    assert.strictEqual(diags[0]!.range.start.line, 2);
    assert.strictEqual(diags[0]!.range.start.character, 0);
    assert.strictEqual(diags[0]!.range.end.character, 4);

    const all = collectDiagnostics(doc);
    assert.ok(all.some((d) => d.code === "aw-mass-mismatch"));
  });

  it("emits one warning per isotope even if repeated in MATR", () => {
    setAwMassMismatchesForTest([
      {
        name: "SI44",
        zaid: 14044,
        awLib: 44.03526,
        iaea: 44.031466,
        delta: 0.003794,
        relDelta: 8.6e-5,
        source: "livechart",
        iaeaTarget: "Si-44",
      },
    ]);
    const text = [
      "PIN 1 0",
      "MATR 1",
      "SI44 1.0e-6",
      "MATR 2",
      "SI44 2.0e-6",
      "FINISH",
    ].join("\n");
    const uri = "file:///aw-diag-dup.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    const diags = collectAwLibMassDiagnostics(doc, index.ast.materials);
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0]!.range.start.line, 2);
  });

  it("returns empty when no mismatches cached", () => {
    clearAwMassMismatchesForTest();
    const text = ["PIN 1 0", "MATR 1", "SI44 1.0e-6", "FINISH"].join("\n");
    const uri = "file:///aw-diag2.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    assert.strictEqual(collectAwLibMassDiagnostics(doc, index.ast.materials).length, 0);
  });

  it("reports error when nuclide is absent in loaded AW.LIB", () => {
    setAwLibTable(
      parseAwLib(`
U235  92235 235.0439299
`)
    );
    try {
      const text = ["PIN 1 0", "MATR 1", "SI44 1.0e-6", "U235 0.01", "FINISH"].join("\n");
      const uri = "file:///aw-missing.mcu";
      const doc = TextDocument.create(uri, "mcunr", 1, text);
      const index = analyzeDocument(uri, text, 1);
      const diags = collectAwLibMissingDiagnostics(doc, index.ast);
      assert.strictEqual(diags.length, 1);
      assert.strictEqual(diags[0]!.severity, 1);
      assert.strictEqual(diags[0]!.code, "aw-mass-missing");
      assert.ok(diags[0]!.message.includes("SI44"));
      assert.ok(diags[0]!.message.includes("SI"));
      const all = collectDiagnostics(doc);
      assert.ok(all.some((d) => d.code === "aw-mass-missing"));
    } finally {
      clearAwLibTable();
    }
  });

  it("ignores AW.LIB-missing nuclide when listed in SI", () => {
    setAwLibTable(
      parseAwLib(`
U235  92235 235.0439299
`)
    );
    try {
      const text = ["PIN 1 0", "SI SI44", "MATR 1", "SI44 1.0e-6", "U235 0.01", "FINISH"].join("\n");
      const uri = "file:///aw-missing-si.mcu";
      const doc = TextDocument.create(uri, "mcunr", 1, text);
      const index = analyzeDocument(uri, text, 1);
      const diags = collectAwLibMissingDiagnostics(doc, index.ast);
      assert.strictEqual(diags.length, 0);
    } finally {
      clearAwLibTable();
    }
  });

  it("warns when AW.LIB-missing nuclide enters sum isotope only via SIDEN", () => {
    setAwLibTable(
      parseAwLib(`
U235  92235 235.0439299
`)
    );
    try {
      const text = ["PIN 1 0", "SIDEN 1.0E-5", "MATR 1", "SI44 1.0e-8", "U235 0.01", "FINISH"].join("\n");
      const uri = "file:///aw-missing-siden.mcu";
      const doc = TextDocument.create(uri, "mcunr", 1, text);
      const index = analyzeDocument(uri, text, 1);
      const diags = collectAwLibMissingDiagnostics(doc, index.ast);
      assert.strictEqual(diags.length, 1);
      assert.strictEqual(diags[0]!.severity, 2);
      assert.strictEqual(diags[0]!.code, "aw-mass-missing-siden");
      assert.ok(diags[0]!.message.includes("SIDEN"));
      assert.ok(diags[0]!.message.includes("SI"));
    } finally {
      clearAwLibTable();
    }
  });
});
