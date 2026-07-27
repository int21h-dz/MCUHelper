import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeDocument } from "@mcuhelper/mcu-language";
import { setCachedSolverResult } from "./solver";
import {
  buildDocumentSymbols,
  buildFoldingRanges,
  buildDocumentLinks,
  buildSemanticTokenData,
  collectDiagnostics,
  handleGetIndex,
  handleGetSlice,
  handleValidateInput,
  resolveDocumentIndex,
  uriToBaseDir,
  toLspDiagnostic,
} from "./serverHandlers";

const fixtures = path.join(__dirname, "../../../test/fixtures");

describe("serverHandlers extended", () => {
  it("uriToBaseDir strips file protocol", () => {
    const dir = uriToBaseDir("file:///z:/Data/fixtures/test.mcu");
    assert.ok(dir.includes("fixtures"));
  });

  it("toLspDiagnostic maps severities", () => {
    const d = toLspDiagnostic({
      severity: "warning",
      message: "warn",
      code: "x",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
        offset: 0,
        endOffset: 1,
      },
    });
    assert.strictEqual(d.severity, 2);
    assert.strictEqual(d.source, "mcuhelper");
  });

  it("buildSemanticTokenData returns encoded spans", () => {
    const text = fs.readFileSync(path.join(fixtures, "full_variant.mcu"), "utf8");
    const uri = "file:///fixtures/full_variant.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    analyzeDocument(uri, text, 1);
    const data = buildSemanticTokenData(doc);
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 5);
  });

  it("collectDiagnostics merges cached solver results", () => {
    const text = fs.readFileSync(path.join(fixtures, "pin_example.mcu"), "utf8");
    const uri = "file:///fixtures/pin_example.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    setCachedSolverResult(index.hash, {
      diagnostics: [
        {
          severity: "error",
          message: "solver error",
          code: "mcu-solver",
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
            offset: 0,
            endOffset: 1,
          },
        },
      ],
      exitCode: 1,
      stdout: "",
      stderr: "",
    });
    const diags = collectDiagnostics(doc);
    assert.ok(diags.some((d) => d.message === "solver error"));
  });

  it("handleGetSlice returns grid for trx", () => {
    const text = fs.readFileSync(path.join(fixtures, "trx_geometry.mcu"), "utf8");
    const uri = "file:///fixtures/trx_geometry.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    analyzeDocument(uri, text, 1);
    const getDoc = (u: string) => (u === uri ? doc : undefined);
    const slice = handleGetSlice({ uri, axis: "z", position: 50, resolution: 32 }, getDoc);
    assert.ok(slice);
    assert.ok(slice!.grid.length > 0);
  });

  it("handleValidateInput uses mocked solver", async () => {
    const text = "PIN 1 0\nFINISH";
    const uri = "file:///inline.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    analyzeDocument(uri, text, 1);
    const getDoc = (u: string) => (u === uri ? doc : undefined);
    const settings = {
      mcuNrPath: "",
      enableSolverValidation: false,
      variantName: "VAR",
      enableIaeaNuclideHover: false,
    };
    const result = await handleValidateInput(
      { uri, mcuNrPath: "mcu", variantName: "VAR" },
      settings,
      getDoc,
      async () => ({
        diagnostics: [],
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        lstPath: undefined,
      })
    );
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.exitCode, 0);
  });

  it("buildDocumentSymbols lists materials bodies and zones", () => {
    const text = fs.readFileSync(path.join(fixtures, "full_variant.mcu"), "utf8");
    const uri = "file:///fixtures/full_variant.mcu";
    const index = analyzeDocument(uri, text, 1);
    const symbols = buildDocumentSymbols(index, uri);
    assert.ok(symbols.some((s) => s.name.startsWith("MATR")));
    assert.ok(symbols.some((s) => s.name.startsWith("Body")));
    assert.ok(symbols.some((s) => s.name.startsWith("Zone")));
  });

  it("buildFoldingRanges returns fragment and MATR folds", () => {
    const text = fs.readFileSync(path.join(fixtures, "full_variant.mcu"), "utf8");
    const uri = "file:///fixtures/full_variant.mcu";
    const index = analyzeDocument(uri, text, 1);
    const ranges = buildFoldingRanges(index);
    assert.ok(ranges.some((r) => r.startLine === 0 && r.endLine >= 8));
    assert.ok(ranges.some((r) => r.startLine === 2 && r.endLine === 5));
    assert.ok(ranges.some((r) => r.startLine === 6 && r.endLine === 7));
  });

  it("buildDocumentLinks resolves #include target", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-link-"));
    const mainPath = path.join(dir, "main.mcu");
    const incPath = path.join(dir, "confpd");
    fs.writeFileSync(incPath, "PIN 1 0\nFINISH", "utf8");
    fs.writeFileSync(mainPath, "#include confpd\nFINISH", "utf8");
    const uri = `file:///${mainPath.replace(/\\/g, "/")}`;
    const text = fs.readFileSync(mainPath, "utf8");
    const index = analyzeDocument(uri, text, 1, { baseDir: dir, expandInclude: true });
    const links = buildDocumentLinks(index, uri);
    assert.strictEqual(links.length, 1);
    assert.strictEqual(links[0]!.range.start.character, 9);
    assert.ok(links[0]!.target?.includes("confpd"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolveDocumentIndex falls back to getDoc when cache empty", () => {
    const text = "PIN 1 0\nFINISH";
    const uri = "file:///uncached.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const getDoc = (u: string) => (u === uri ? doc : undefined);
    const index = resolveDocumentIndex(uri, getDoc);
    assert.ok(index);
    assert.ok(index!.summaries.materials.length >= 0);
  });

  it("handleGetIndex returns scoped constants with editorContext", () => {
    const text = `HEAD 1 0
CONT T T
EQU LG = 25
LCELL P1
EQU HALL = 1024
ENDL
FINISH`;
    const uri = "file:///scope-index.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const getDoc = (u: string) => (u === uri ? doc : undefined);
    const result = handleGetIndex({ uri, line: 4, character: 5 }, getDoc);
    assert.ok(result);
    assert.ok(result!.editorContext);
    assert.ok(result!.editorContext!.scope.includes("P1"));
    const hall = result!.summaries.constants.find((c) => c.name === "HALL");
    assert.ok(hall);
    assert.strictEqual(hall!.value, 1024);
  });

  it("handleValidateInput without document returns error", async () => {
    const settings = {
      mcuNrPath: "",
      enableSolverValidation: false,
      variantName: "VAR",
      enableIaeaNuclideHover: false,
    };
    const result = await handleValidateInput(
      { uri: "file:///missing", mcuNrPath: "", variantName: "" },
      settings,
      () => undefined
    );
    assert.strictEqual(result.ok, false);
  });
});
