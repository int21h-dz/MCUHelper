import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  isDbmLibraryName,
  isNuclideNameFormat,
  looksLikeLibMaterialCodeLine,
  parseDbmLibrary,
  remapDensParamForType,
  resolveDbmFilePath,
  setDbmLibRoot,
  clearDbmCache,
  getDbmMaterial,
  findMatrCompositionSpan,
  extractDbmEntryFromMatrSpan,
  upsertDbmMaterialInText,
  upsertDbmMaterialWithRename,
  removeDbmMaterialFromText,
  buildMatrDbmUsageBlock,
  densTypeFromMatrHeader,
  suggestDbmMaterialCode,
} from "./dbmLib";
import { parseDocument } from "./parser";
import { analyzeSemantics, buildSummaries } from "./semantic";

const SAMPLE_DBM = `UO2 3 1
U235 0.0008255 A
U238 0.022105 A
O 0.045861 A
*
H2O 2 1
H 2 H2OK
O 1 G
#
`;

describe("dbmLib", () => {
  it("distinguishes MCU/ZA from .DBM library names", () => {
    assert.equal(isNuclideNameFormat("MCU"), true);
    assert.equal(isNuclideNameFormat("za"), true);
    assert.equal(isDbmLibraryName("MCU"), false);
    assert.equal(isDbmLibraryName("MYMAT"), true);
    assert.equal(isDbmLibraryName("TOOLONG"), false);
    assert.equal(looksLikeLibMaterialCodeLine("UO2"), true);
    assert.equal(looksLikeLibMaterialCodeLine("U235 1e-3"), false);
  });

  it("parses MYMAT.DBM example", () => {
    const lib = parseDbmLibrary(SAMPLE_DBM, "MYMAT.DBM");
    assert.equal(lib.materials.size, 2);
    const uo2 = lib.materials.get("UO2")!;
    assert.ok(uo2);
    assert.equal(uo2.nuclideCount, 3);
    assert.equal(uo2.densType, 1);
    assert.equal(uo2.nuclides.length, 3);
    assert.equal(uo2.nuclides[0]!.name, "U235");
    const h2o = lib.materials.get("H2O")!;
    assert.equal(h2o.nuclides[0]!.mods, "H2OK");
  });

  it("remaps DENSxY by densType", () => {
    assert.equal(remapDensParamForType("DENSWW", 1), "DENSWA");
    assert.equal(remapDensParamForType("DENSWA", 2), "DENSWW");
    assert.equal(remapDensParamForType("DENSAA", 1), "DENSAA");
  });

  it("resolves .DBM in MDBNR root case-insensitively", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-dbm-"));
    try {
      const file = path.join(dir, "mymat.dbm");
      fs.writeFileSync(file, SAMPLE_DBM, "utf8");
      const r = resolveDbmFilePath(dir, "MYMAT");
      assert.equal(r.exists, true);
      assert.equal(path.normalize(r.fsPath).toLowerCase(), path.normalize(file).toLowerCase());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("MATR NAME=.DBM (§8.11)", () => {
  it("parses code name composition", () => {
    const text = ["PIN 1", "MATR 1 NAME=MYMAT", "UO2", "END", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "t.mcu" });
    assert.equal(ast.materials.length, 1);
    const m = ast.materials[0]!;
    assert.equal(m.nameLib, "MYMAT");
    assert.equal(m.libMaterialName, "UO2");
    assert.equal(m.nuclides.length, 0);
  });

  it("rejects mixing nuclides with DBM code name", () => {
    const text = ["PIN 1", "MATR 1 NAME=MYMAT", "UO2", "U235 1e-3", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "t.mcu" });
    const diags = analyzeSemantics(ast);
    assert.ok(diags.some((d) => d.code === "matr-dbm-mixed"), JSON.stringify(diags));
  });

  it("accepts NAME=MYMAT without matr-param-value", () => {
    const text = ["PIN 1", "MATR 1 NAME=MYMAT", "UO2", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "t.mcu" });
    const bad = analyzeSemantics(ast).filter((d) => d.code === "matr-param-value");
    assert.equal(bad.length, 0);
  });

  it("does not flag DBM code name as unknown-statement", () => {
    const text = ["PIN 1", "MATR 33 T=750 NAME=GRAPHI", "CARB17", "END", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "t.mcu" });
    assert.equal(ast.materials[0]?.libMaterialName, "CARB17");
    assert.ok(
      !ast.diagnostics.some((d) => d.code === "unknown-statement" && d.message.includes("CARB17")),
      ast.diagnostics.map((d) => d.message).join("; ")
    );
  });

  it("rejects NAME longer than 6 chars", () => {
    const text = ["PIN 1", "MATR 1 NAME=TOOLONG", "U235 1e-3", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "t.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "matr-param-value");
    assert.ok(diags.some((d) => d.message.includes("TOOLONG")));
  });

  it("summaries expose libMaterialName and expand nuclides from .DBM", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-dbm-"));
    try {
      fs.writeFileSync(path.join(dir, "MYMAT.DBM"), SAMPLE_DBM, "utf8");
      setDbmLibRoot(dir);
      clearDbmCache();
      const text = ["PIN 1", "MATR 1 NAME=MYMAT", "UO2", "FINISH"].join("\n");
      const ast = parseDocument(text, { uri: "t.mcu" });
      const sum = buildSummaries(ast);
      const m = sum.materials[0]!;
      assert.equal(m.libMaterialName, "UO2");
      assert.equal(m.dbm?.library, "MYMAT");
      assert.equal(m.dbm?.exists, true);
      assert.ok(m.nuclides.some((n) => n.name === "U235"));
      assert.ok(getDbmMaterial("MYMAT", "UO2"));
    } finally {
      setDbmLibRoot(null);
      clearDbmCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("DBM export from MATR", () => {
  it("extracts nuclides and rewrites usage block", () => {
    const text = [
      "PIN 1",
      "MATR 1 T=300 GROUP=fuel NAME=MCU DENSWA=10.4",
      "U235 0.0008 MODS=X",
      "U238 0.02",
      "O 0.04",
      "FINISH",
    ].join("\n");
    const span = findMatrCompositionSpan(text, 2)!;
    assert.equal(span.number, 1);
    assert.equal(densTypeFromMatrHeader(span.headerText), 1);
    assert.equal(suggestDbmMaterialCode(span), "FUEL");

    const extracted = extractDbmEntryFromMatrSpan(span, "UO2");
    assert.equal(extracted.ok, true);
    if (!extracted.ok) return;
    assert.equal(extracted.entry.nuclides.length, 3);
    assert.equal(extracted.entry.nuclides[0]!.mods, "X");
    assert.equal(extracted.entry.nuclides[1]!.mods, "A");

    const { text: dbm, replaced } = upsertDbmMaterialInText("", extracted.entry);
    assert.equal(replaced, false);
    const lib = parseDbmLibrary(dbm);
    assert.ok(lib.materials.get("UO2"));

    const usage = buildMatrDbmUsageBlock(span.headerText, "MYMAT", "UO2");
    assert.match(usage, /^MATR 1 T=300 GROUP=fuel DENSWA=10\.4 NAME=MYMAT$/m);
    assert.match(usage, /^UO2$/m);
    assert.ok(!/NAME=MCU/i.test(usage));
  });

  it("rejects already-coded DBM material", () => {
    const text = ["PIN 1", "MATR 1 NAME=MYMAT", "UO2", "FINISH"].join("\n");
    const span = findMatrCompositionSpan(text, 2)!;
    const r = extractDbmEntryFromMatrSpan(span, "UO2");
    assert.equal(r.ok, false);
  });

  it("upsert replaces existing material keeping others", () => {
    const { text } = upsertDbmMaterialInText(SAMPLE_DBM, {
      name: "UO2",
      densType: 1,
      nuclides: [{ name: "U235", density: "1", mods: "A" }],
    });
    const lib = parseDbmLibrary(text);
    assert.equal(lib.materials.get("UO2")!.nuclides.length, 1);
    assert.ok(lib.materials.get("H2O"));
  });

  it("rename upsert removes previous code", () => {
    const { text, renamedFrom } = upsertDbmMaterialWithRename(
      SAMPLE_DBM,
      {
        name: "FUEL1",
        densType: 1,
        nuclides: [{ name: "U235", density: "1", mods: "A" }],
      },
      "UO2"
    );
    assert.equal(renamedFrom, "UO2");
    const lib = parseDbmLibrary(text);
    assert.equal(lib.materials.has("UO2"), false);
    assert.ok(lib.materials.get("FUEL1"));
    assert.ok(lib.materials.get("H2O"));
  });

  it("removeDbmMaterialFromText drops one entry", () => {
    const { text, removed } = removeDbmMaterialFromText(SAMPLE_DBM, "H2O");
    assert.equal(removed, true);
    const lib = parseDbmLibrary(text);
    assert.equal(lib.materials.has("H2O"), false);
    assert.ok(lib.materials.get("UO2"));
  });

  it("finds MATR when cursor is on END after composition", () => {
    const text = ["PIN 1", "MATR 1", "U235 1e-3", "END", "FINISH"].join("\n");
    // lines: 0 PIN, 1 MATR, 2 U235, 3 END, 4 FINISH
    const span = findMatrCompositionSpan(text, 3);
    assert.ok(span);
    assert.equal(span!.number, 1);
    assert.equal(span!.endLine, 2);
    assert.deepEqual(span!.bodyLines, ["U235 1e-3"]);
  });

  it("finds MATR when cursor is on blank line before next MATR", () => {
    const text = ["PIN 1", "MATR 1", "U235 1", "END", "", "MATR 2", "H 1", "FINISH"].join("\n");
    const span = findMatrCompositionSpan(text, 4);
    assert.ok(span);
    assert.equal(span!.number, 1);
  });
});
