import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeDocument } from "@mcuhelper/mcu-language";
import {
  handleGetIndex,
  handleQueryPoint,
  handleGetGeometry,
  handleGetLiveZonePreview,
  buildDocumentSymbols,
  collectDiagnostics,
  applyServerSettings,
  syncSettingsFromInitialize,
} from "./serverHandlers";
import { getHoverContent } from "./hover";
import { getCompletions } from "./completion";

const fixtures = path.join(__dirname, "../../../test/fixtures");

function setupFixture(name: string) {
  const text = fs.readFileSync(path.join(fixtures, `${name}.mcu`), "utf8");
  const uri = `file:///fixtures/${name}.mcu`;
  const doc = TextDocument.create(uri, "mcunr", 1, text);
  analyzeDocument(uri, text, 1);
  const getDoc = (u: string) => (u === uri ? doc : undefined);
  return { doc, uri, text, getDoc };
}

describe("serverHandlers integration", () => {
  it("handleGetIndex returns summaries", () => {
    const { uri, getDoc } = setupFixture("full_variant");
    const result = handleGetIndex(uri, getDoc);
    assert.ok(result);
    assert.ok(result!.fragments?.length);
    assert.ok(result!.statements?.length);
    assert.ok(result!.summaries.materials.length > 0);
    assert.ok(result!.hash.length === 64);
  });

  it("handleQueryPoint finds fuel zone in trx", () => {
    const { uri, getDoc } = setupFixture("trx_geometry");
    const result = handleQueryPoint({ uri, x: 0, y: 0, z: 50 }, getDoc);
    assert.ok(result);
    assert.strictEqual(result!.zone?.name, "FUEL");
  });

  it("handleGetGeometry returns scene", () => {
    const { uri, getDoc } = setupFixture("trx_geometry");
    const scene = handleGetGeometry(uri, getDoc);
    assert.ok(scene);
    assert.ok(scene!.primitives.length > 0);
  });

  it("handleGetGeometry with line uses LCELL scope", () => {
    const { uri, getDoc, text } = setupFixture("latt_example");
    const line = text.split(/\r?\n/).findIndex((l) => /^\s*RCZ\s+K\b/i.test(l));
    assert.ok(line >= 0);
    const scene = handleGetGeometry({ uri, line, character: 0 }, getDoc);
    assert.ok(scene);
    const names = (scene!.primitives ?? []).map((p: { name: string }) => p.name);
    assert.ok(names.includes("K"));
    assert.ok(names.includes("L"));
    assert.ok(!names.includes("CNT"));
  });

  it("handleGetLiveZonePreview returns slices for zone line", () => {
    const { uri, getDoc, text } = setupFixture("trx_geometry");
    const line = text.split(/\r?\n/).findIndex((l) => /^\s*FUEL\b/i.test(l));
    assert.ok(line >= 0);
    const preview = handleGetLiveZonePreview({ uri, line, character: 0, resolution: 40 }, getDoc);
    assert.ok(preview);
    assert.strictEqual(preview!.zoneName, "FUEL");
    assert.strictEqual(preview!.slices.length, 3);
    const zSlice = preview!.slices[0];
    assert.ok(zSlice.grid.some((row) => row.some((cell) => cell === 1)));
    assert.ok((zSlice.polylines?.length ?? 0) > 0);
  });

  it("buildDocumentSymbols lists fragments and zones", () => {
    const { uri, getDoc } = setupFixture("trx_geometry");
    const index = handleGetIndex(uri, getDoc);
    assert.ok(index);
    const doc = getDoc(uri)!;
    analyzeDocument(uri, doc.getText(), 1);
    const { getDocumentIndex } = require("@mcuhelper/mcu-language");
    const idx = getDocumentIndex(uri)!;
    const symbols = buildDocumentSymbols(idx, uri);
    assert.ok(symbols.some((s) => s.name.includes("Fragment")));
    assert.ok(symbols.some((s) => s.name.includes("Zone")));
  });

  it("collectDiagnostics on pin fixture", () => {
    const { doc } = setupFixture("pin_example");
    const diags = collectDiagnostics(doc);
    assert.ok(Array.isArray(diags));
  });

  it("getCompletions and hover on MATR nuclide", () => {
    const { doc, uri, getDoc } = setupFixture("full_variant");
    const indexResult = handleGetIndex(uri, getDoc);
    assert.ok(indexResult);
    const { getDocumentIndex } = require("@mcuhelper/mcu-language");
    const index = getDocumentIndex(uri)!;
    const matrLine = index.ast.materials[0]?.range.start.line ?? 2;
    const completions = getCompletions(doc, { line: 0, character: 0 }, index);
    assert.ok(completions.items.length > 0);
    const hover = getHoverContent(
      doc,
      { line: matrLine + 1, character: 2 },
      index,
      { enableIaeaNuclide: false },
      uri
    );
    if (hover) assert.ok(hover.length > 0);
  });

  it("applyServerSettings and syncSettingsFromInitialize", () => {
    const settings = {
      mcuNrPath: "",
      mcuConstantsLibPath: "",
      enableSolverValidation: false,
      variantName: "NAME",
    };
    syncSettingsFromInitialize(settings, {
      mcuNrPath: "/bin/mcu",
      variantName: "TEST",
    });
    assert.strictEqual(settings.mcuNrPath, "/bin/mcu");
    assert.strictEqual(settings.variantName, "TEST");
    applyServerSettings(settings, { enableSolverValidation: true });
    assert.strictEqual(settings.enableSolverValidation, true);
  });
});
