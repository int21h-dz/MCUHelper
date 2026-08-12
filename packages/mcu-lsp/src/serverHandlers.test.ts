import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeDocument, clearAwLibTable, clearParameteThrTable, parseAwLib, parseParameteThr, setAwLibTable, setParameteThrTable } from "@mcuhelper/mcu-language";
import { setAwMassMismatchesForTest } from "./awLibVerify";
import { setCachedSolverResult } from "./solver";
import {
  buildDocumentSymbols,
  buildFoldingRanges,
  buildDocumentLinks,
  buildSemanticTokenData,
  collectDiagnostics,
  collectDiagnosticsBundle,
  handleGetDiagnostics,
  handleGetIndex,
  handleGetIncludeGraph,
  handleGetSlice,
  handleValidateInput,
  handleRunMcuStep,
  resolveDocumentIndex,
  resolveHoverDocumentIndex,
  ensureSourceDocumentIndex,
  resolveContinueFinalSession,
  hasVariantRunArtifacts,
  uriToBaseDir,
  toLspDiagnostic,
  slimSummariesForIndex,
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

  it("collectDiagnostics does not duplicate solver diags when extra overlaps cache", () => {
    const text = fs.readFileSync(path.join(fixtures, "pin_example.mcu"), "utf8");
    const uri = "file:///fixtures/pin_dup.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    const solverDiag = {
      severity: "error" as const,
      message: "Include file is absent:'confpd'",
      code: "mcu-solver",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
        offset: 0,
        endOffset: 1,
      },
    };
    setCachedSolverResult(index.hash, {
      diagnostics: [solverDiag],
      exitCode: 1,
      stdout: "",
      stderr: "",
    });
    const extra = [
      {
        severity: 1,
        message: solverDiag.message,
        code: "mcu-solver",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        source: "mcuhelper",
      },
    ];
    const diags = collectDiagnostics(doc, extra as never);
    assert.strictEqual(diags.filter((d) => d.message === solverDiag.message).length, 1);
  });

  it("collectDiagnostics keeps main clean but exposes include diagnostics in bundle", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-diag-inc-"));
    fs.writeFileSync(path.join(dir, "frag.mcu"), "MATR 1 T=\nU235 1.E-3\nFINISH", "utf8");
    const mainText = "#include frag\nFINISH\n";
    const mainPath = path.join(dir, "main.mcu");
    fs.writeFileSync(mainPath, mainText, "utf8");
    const uri = `file:///${mainPath.replace(/\\/g, "/")}`;
    const doc = TextDocument.create(uri, "mcunr", 1, mainText);
    const expanded = analyzeDocument(uri, mainText, 1, { baseDir: dir, expandInclude: true });
    const published = collectDiagnostics(doc);
    const bundle = collectDiagnosticsBundle(doc);
    assert.ok(expanded.ast.diagnostics.some((d) => d.code === "matr-param-empty"));
    assert.ok(!published.some((d) => d.code === "matr-param-empty"));
    assert.ok(published.some((d) => d.code === "include-diag"));
    assert.ok(bundle.includeGroups.some((g) => g.diagnostics.some((d) => d.code === "matr-param-empty")));
    for (const d of published) {
      assert.ok(d.range.start.line < doc.lineCount);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolveHoverDocumentIndex uses parent expanded AST for include buffer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-hover-resolve-"));
    try {
      const matsPath = path.join(dir, "mats.mcu");
      fs.writeFileSync(matsPath, "N 1.0E-5\n", "utf8");
      const mainPath = path.join(dir, "main.mcu");
      const mainText = "PIN\nMATR 1\n#include mats\nFINISH\n";
      fs.writeFileSync(mainPath, mainText, "utf8");
      const mainUri = pathToFileURL(mainPath).href;
      const matsUri = pathToFileURL(matsPath).href;
      const mainDoc = TextDocument.create(mainUri, "mcunr", 1, mainText);
      const matsDoc = TextDocument.create(matsUri, "mcunr", 1, "N 1.0E-5\n");
      const docs = new Map([
        [mainUri, mainDoc],
        [matsUri, matsDoc],
      ]);
      const getDoc = (u: string) => docs.get(u);
      const parents = new Map<string, Set<string>>([[matsUri, new Set([mainUri])]]);
      const index = resolveHoverDocumentIndex(matsDoc, parents, getDoc, docs.values());
      assert.ok(index.ast.materials.some((m) => m.nuclides.some((n) => n.name.toUpperCase() === "N")));
      assert.ok(index.ast.includeLineMap?.some((e) => e.source === "include"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ensureDocumentIndex uses expanded AST after source-only cache (no false matr-gap)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-src-cache-"));
    try {
      fs.writeFileSync(
        path.join(dir, "mats.mcu"),
        ["MATR 2", "U235 1.E-3", "MATR 3", "U238 1.E-3", "FINISH"].join("\n"),
        "utf8"
      );
      const mainText = ["PIN 1 0", "MATR 1", "U235 1.E-3", "#include mats", "MATR 4", "U235 1.E-3", "FINISH"].join(
        "\n"
      );
      const mainPath = path.join(dir, "main.mcu");
      fs.writeFileSync(mainPath, mainText, "utf8");
      const uri = `file:///${mainPath.replace(/\\/g, "/")}`;
      const doc = TextDocument.create(uri, "mcunr", 1, mainText);

      ensureSourceDocumentIndex(doc);
      const bundle = collectDiagnosticsBundle(doc);
      const gap = bundle.diagnostics.filter((d) => d.code === "matr-gap");
      assert.ok(
        gap.length === 0,
        `expected no matr-gap with expanded includes, got: ${gap.map((d) => d.message).join("; ")}`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collectDiagnostics treats include as part of unified variant (EQU from include)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-diag-equ-"));
    try {
      fs.writeFileSync(path.join(dir, "consts.mcu"), "EQU DENSU = 1.0E-3\n", "utf8");
      // EQU до PIN (geometry-контекст); в physical после PIN — card-wrong-fragment.
      const mainText = ["#include consts", "PIN", "MATR 1", "U235 DENSU", "FINISH"].join("\n");
      const mainPath = path.join(dir, "main.mcu");
      fs.writeFileSync(mainPath, mainText, "utf8");
      const uri = `file:///${mainPath.replace(/\\/g, "/")}`;
      const doc = TextDocument.create(uri, "mcunr", 1, mainText);
      const diags = collectDiagnostics(doc);
      assert.ok(
        !diags.some((d) => d.code === "matr-nuclide-conc" && /DENSU/i.test(d.message)),
        diags.map((d) => `${d.code}:${d.message}`).join(" | ") || "(none)"
      );
      for (const d of diags) {
        assert.ok(d.range.start.line < doc.lineCount);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collectDiagnostics flags MATR empty when SIDEN from #include swallows all nuclides", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-diag-siden-"));
    try {
      fs.writeFileSync(path.join(dir, "confpd"), "SIDEN 1.0E-6\n", "utf8");
      const mainText = ["PIN", "#include confpd", "MATR 1 T=300", "O 1E-10", "FINISH"].join("\n");
      const mainPath = path.join(dir, "main.mcu");
      fs.writeFileSync(mainPath, mainText, "utf8");
      const uri = `file:///${mainPath.replace(/\\/g, "/")}`;
      const doc = TextDocument.create(uri, "mcunr", 1, mainText);
      const diags = collectDiagnostics(doc);
      const empty = diags.filter((d) => d.code === "matr-empty");
      assert.strictEqual(empty.length, 1, diags.map((d) => `${d.code}:${d.message}`).join(" | "));
      assert.match(empty[0]!.message, /SIDEN/i);
      assert.strictEqual(empty[0]!.range.start.line, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collectDiagnostics treats geometry from include as unified (zone body ref)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-diag-geo-"));
    try {
      fs.writeFileSync(path.join(dir, "geo.mcu"), "GEO\nRCZ FU 0 0 0 1 10\n", "utf8");
      const mainText = ["PIN", "#include geo", "FU :1", "FINISH", "FINISH"].join("\n");
      const mainPath = path.join(dir, "main.mcu");
      fs.writeFileSync(mainPath, mainText, "utf8");
      const uri = `file:///${mainPath.replace(/\\/g, "/")}`;
      const doc = TextDocument.create(uri, "mcunr", 1, mainText);
      const diags = collectDiagnostics(doc);
      assert.ok(
        !diags.some((d) => d.code === "zone-body"),
        diags.map((d) => `${d.code}:${d.message}`).join(" | ") || "(none)"
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collectDiagnostics reports matr-nuclide-conc when EQU name is undefined", () => {
    const mainText = ["PIN", "MATR 1", "U235 DENSU", "FINISH"].join("\n");
    const uri = "file:///inline-no-equ.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, mainText);
    const diags = collectDiagnostics(doc);
    assert.ok(diags.some((d) => d.code === "matr-nuclide-conc" && /DENSU/i.test(d.message)));
  });

  it("handleGetDiagnostics returns main diagnostics and include groups", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-diag-get-"));
    fs.writeFileSync(path.join(dir, "frag.mcu"), "MATR 1 T=\nU235 1.E-3\nFINISH", "utf8");
    const mainText = "#include frag\nFINISH\n";
    const mainPath = path.join(dir, "main.mcu");
    fs.writeFileSync(mainPath, mainText, "utf8");
    const uri = `file:///${mainPath.replace(/\\/g, "/")}`;
    const doc = TextDocument.create(uri, "mcunr", 1, mainText);
    const getDoc = (u: string) => (u === uri ? doc : undefined);
    const published = collectDiagnostics(doc);
    const payload = handleGetDiagnostics(uri, getDoc);
    assert.equal(payload.diagnostics.length, published.length);
    assert.ok(!payload.diagnostics.some((d) => d.code === "matr-param-empty"));
    assert.ok(payload.includeGroups.some((g) => g.diagnostics.some((d) => d.code === "matr-param-empty")));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("routes aw-mass-mismatch for include-only nuclide into includeGroups", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-aw-inc-"));
    try {
      fs.writeFileSync(path.join(dir, "mat.mcu"), "MATR 1\nCS37 1.0E-3\n", "utf8");
      const mainText = ["PIN", "#include mat", "FINISH"].join("\n");
      const mainPath = path.join(dir, "main.mcu");
      fs.writeFileSync(mainPath, mainText, "utf8");
      const uri = `file:///${mainPath.replace(/\\/g, "/")}`;
      const doc = TextDocument.create(uri, "mcunr", 1, mainText);
      setAwMassMismatchesForTest([
        {
          name: "CS37",
          zaid: 55037,
          awLib: 136.9,
          iaea: 136.907,
          delta: -0.007,
          relDelta: 5e-5,
          source: "livechart",
          iaeaTarget: "Cs-137",
        },
      ]);
      const bundle = collectDiagnosticsBundle(doc);
      assert.ok(
        !bundle.diagnostics.some((d) => d.code === "aw-mass-mismatch"),
        "mismatch must not sit on main Problems"
      );
      assert.ok(
        bundle.includeGroups.some((g) => g.diagnostics.some((d) => d.code === "aw-mass-mismatch" && /CS37/i.test(d.message))),
        JSON.stringify(bundle.includeGroups)
      );
    } finally {
      setAwMassMismatchesForTest([]);
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
      mcuConstantsLibPath: "",
      enableSolverValidation: false,
      variantName: "VAR",
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
    const ranges = buildFoldingRanges(index, text.split(/\r?\n/).length);
    assert.ok(ranges.some((r) => r.startLine === 0 && r.endLine >= 8));
    assert.ok(ranges.some((r) => r.startLine === 2 && r.endLine === 5));
    assert.ok(ranges.some((r) => r.startLine === 6 && r.endLine === 7));
  });

  it("buildFoldingRanges folds LCELL…ENDL and LATT…LFIXSO", () => {
    const text = `HEAD 3 0
CONT T T
RCZ CNT 0 0 0 10 5
END
ZL CNT /1:1
END
LCELL A
RPP N1 0 1 0 1 0 1
END
Z1 1 /1:1
END
ENDL
LCELL B
RPP N1 0 1 0 1 0 1
END
ENDL
LATT GLTL ZL
LISTEL A B
PARM /1 0,0,0
/2 25,0,0
LFIXSO 2,1
FINISH`;
    const uri = "file:///fold-latt.mcu";
    const index = analyzeDocument(uri, text, 1);
    const ranges = buildFoldingRanges(index, text.split(/\r?\n/).length);
    const lcellA = index.ast.statements.find((s) => /^LCELL\s+A\b/i.test(s.text))!;
    const endlA = index.ast.statements.find(
      (s) => s.label.toUpperCase() === "ENDL" && s.range.start.line > lcellA.range.start.line
    )!;
    assert.ok(
      ranges.some((r) => r.startLine === lcellA.range.start.line && r.endLine === endlA.range.start.line),
      `expected LCELL A fold ${lcellA.range.start.line}..${endlA.range.start.line}, got ${JSON.stringify(ranges)}`
    );
    const latt = index.ast.statements.find((s) => s.label.toUpperCase() === "LATT")!;
    const lfixso = index.ast.statements.find((s) => s.label.toUpperCase() === "LFIXSO")!;
    assert.ok(
      ranges.some((r) => r.startLine === latt.range.start.line && r.endLine === lfixso.range.start.line),
      `expected LATT fold ${latt.range.start.line}..${lfixso.range.start.line}, got ${JSON.stringify(ranges)}`
    );
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
    assert.ok(result!.fragments?.some((f) => f.id === "geometry"));
    assert.ok(result!.statements?.some((s) => s.label === "LCELL"));
    assert.ok(result!.editorContext);
    assert.ok(result!.editorContext!.scope.includes("P1"));
    const hall = result!.summaries.constants.find((c) => c.name === "HALL");
    assert.ok(hall);
    assert.strictEqual(hall!.value, 1024);
  });

  it("handleGetIndex omits MATR nuclide rows from statements", () => {
    const text = `PIN 0 0
MATR 1
U235 1.0E-3
H 0.06
END
FINISH ALL`;
    const uri = "file:///slim-index.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const getDoc = (u: string) => (u === uri ? doc : undefined);
    const result = handleGetIndex(uri, getDoc);
    assert.ok(result);
    assert.ok(result!.statements?.some((s) => s.label === "MATR"));
    assert.ok(result!.statements?.some((s) => s.label === "END"));
    assert.ok(!result!.statements?.some((s) => /U235/i.test(s.label)));
    assert.ok(result!.summaries.materials.some((m) => m.nuclides.some((n) => n.name === "U235")));
  });

  it("handleGetIndex projects #include into navigation payload", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-nav-inc-"));
    try {
      fs.writeFileSync(path.join(dir, "si.inc"), "SI FP1 FP2\nSIDEN 1e-6\n", "utf8");
      const mainPath = path.join(dir, "main.mcu");
      const text = ["PIN 0 0", "#include si.inc", "MATR 1", "U235 1e-3", "FINISH"].join("\n");
      fs.writeFileSync(mainPath, text, "utf8");
      const uri = pathToFileURL(mainPath).href;
      const doc = TextDocument.create(uri, "mcunr", 1, text);
      const getDoc = (u: string) => (u === uri ? doc : undefined);
      const result = handleGetIndex(uri, getDoc);
      assert.ok(result);
      assert.ok(Array.isArray(result!.includes));
      assert.strictEqual(result!.includes!.length, 1);
      assert.strictEqual(result!.includes![0]!.path, "si.inc");
      assert.strictEqual(result!.includes![0]!.fragment, "physical");
      assert.strictEqual(result!.includes![0]!.range.start.line, 1);
      assert.strictEqual(result!.includes![0]!.exists, true);

      assert.ok(Array.isArray(result!.includeGraph));
      assert.strictEqual(result!.includeGraph!.length, 1);
      assert.strictEqual(result!.includeGraph![0]!.path, "si.inc");
      assert.strictEqual(result!.includeGraph![0]!.exists, true);
      assert.strictEqual(result!.includeGraph![0]!.mainLine, 1);
      assert.ok(result!.includeGraph![0]!.encoding);
      assert.strictEqual(typeof result!.includeGraph![0]!.diagCount, "number");

      const graphOnly = handleGetIncludeGraph(uri, getDoc);
      assert.ok(graphOnly);
      assert.strictEqual(graphOnly!.length, 1);
      assert.strictEqual(graphOnly![0]!.path, "si.inc");

      const si = result!.statements?.find((s) => s.label.toUpperCase() === "SI");
      assert.ok(!si, "SI from include must not appear in nav statements");

      const matr = result!.statements?.find((s) => s.label.toUpperCase() === "MATR");
      assert.ok(matr);
      assert.strictEqual(matr!.range.start.line, 2, "MATR stays on main line");

      const pinFrag = result!.fragments?.find((f) => f.id === "physical");
      assert.ok(pinFrag);
      assert.ok(pinFrag!.endLine < 20, "fragment end should be remapped to main lines, not expanded");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("slimSummariesForIndex drops ordinary nuclides above soft limit but keeps sum-isotope", () => {
    const materials = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      nuclideCount: 300,
      sumIsotopeCount: 1,
      nuclidesPreview: "U235",
      massDensityGcm3: null as number | null,
      volumeCm3: null as number | null,
      massG: null as number | null,
      activityBqPerG: null as number | null,
      nuclides: Array.from({ length: 300 }, (__, j) => ({
        name: `N${j}`,
        concentration: "1",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 }, offset: 0, endOffset: 1 },
        ...(j === 0 ? { sumIsotope: { reasons: ["входит в суммарный изотоп (указан в SI)"] } } : {}),
      })),
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 }, offset: 0, endOffset: 1 },
    }));
    const slim = slimSummariesForIndex({
      materials,
      zones: [],
      objects: [],
      constants: [],
      bodies: [],
      nets: [],
      lattices: [],
    });
    assert.strictEqual(slim.materials[0]!.nuclides.length, 1);
    assert.ok(slim.materials[0]!.nuclides[0]!.sumIsotope);
    assert.strictEqual(slim.materials[0]!.nuclideCount, 300);
  });

  it("handleGetIndex always returns sumIsotopeMarks", () => {
    const text = ["PIN", "SI FP1", "SIDEN 1e-5", "MATR 1", "U235 1e-2", "FP1 1e-8", "FINISH"].join("\n");
    const uri = "file:///sum-marks.mcu";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const getDoc = (u: string) => (u === uri ? doc : undefined);
    const result = handleGetIndex(uri, getDoc);
    assert.ok(result);
    assert.ok(Array.isArray(result!.sumIsotopeMarks));
    assert.ok(result!.sumIsotopeMarks!.some((m) => m.name.toUpperCase() === "FP1"));
  });

  it("handleGetIndex returns stableIsotopeMarks without overriding sum-isotope priority", () => {
    setAwLibTable(
      parseAwLib(`
CS33  55133 132.905451
CS37  55137 136.907089
`)
    );
    setParameteThrTable(
      parseParameteThr(`
LONGLIFE ISOTOPES
LIST
Cs-133  551330   133.
Cs-137  551370   137.      3.000E+00 y
stop
`)
    );
    try {
      const text = ["PIN", "SI CS33", "MATR 1", "CS33 1e-4", "CS37 1e-6", "FINISH"].join("\n");
      const uri = "file:///stable-marks.mcu";
      const doc = TextDocument.create(uri, "mcunr", 1, text);
      const getDoc = (u: string) => (u === uri ? doc : undefined);
      const result = handleGetIndex(uri, getDoc);
      assert.ok(result);
      assert.ok(Array.isArray(result!.stableIsotopeMarks));
      assert.ok(result!.stableIsotopeMarks!.some((m) => m.name.toUpperCase() === "CS33"));
      assert.ok(!result!.stableIsotopeMarks!.some((m) => m.name.toUpperCase() === "CS37"));
      assert.ok(result!.sumIsotopeMarks!.some((m) => m.name.toUpperCase() === "CS33"));
    } finally {
      clearParameteThrTable();
      clearAwLibTable();
    }
  });

  it("handleValidateInput without document returns error", async () => {
    const settings = {
      mcuNrPath: "",
      mcuConstantsLibPath: "",
      enableSolverValidation: false,
      variantName: "VAR",
    };
    const result = await handleValidateInput(
      { uri: "file:///missing", mcuNrPath: "", variantName: "" },
      settings,
      () => undefined
    );
    assert.strictEqual(result.ok, false);
  });

  it("resolveContinueFinalSession uses disk artifacts without memory session", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-sess-"));
    try {
      const runDir = path.join(tmp, ".mcuhelper-runs", "burnup");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, "burnup.DAT"), "x", "utf8");
      assert.ok(hasVariantRunArtifacts(runDir, "burnup"));
      const resolved = resolveContinueFinalSession({
        uri: "file:///no-memory-session",
        runDir,
        variantName: "burnup",
        deckHash: "abc",
        mode: "f",
      });
      assert.ok("session" in resolved);
      assert.ok(fs.existsSync(path.join(runDir, ".mcuhelper-session.json")));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolveContinueFinalSession fails without artifacts", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-nosess-"));
    try {
      const runDir = path.join(tmp, ".mcuhelper-runs", "burnup");
      fs.mkdirSync(runDir, { recursive: true });
      const resolved = resolveContinueFinalSession({
        uri: "file:///empty-run",
        runDir,
        variantName: "burnup",
        deckHash: "abc",
        mode: "continue",
      });
      assert.ok("message" in resolved);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("collectOnly copies FIN for successful calculation mode", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-colfin-"));
    try {
      const source = path.join(tmp, "burnup");
      const runDir = path.join(tmp, ".mcuhelper-runs", "burnup");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(source, "PIN 1\nFINISH\n", "utf8");
      fs.writeFileSync(path.join(runDir, "burnup.fin"), "FIN BODY\n", "utf8");
      fs.writeFileSync(path.join(runDir, "burnup.lst"), "WARNINGS in initial data of MCU: 0\n", "utf8");
      const uri = `file:///${source.replace(/\\/g, "/")}`;
      const doc = TextDocument.create(uri, "mcunr", 1, "PIN 1\nFINISH\n");
      const settings = {
        mcuNrPath: "x",
        mcuConstantsLibPath: "y",
        enableSolverValidation: false,
        variantName: "burnup",
      };
      const result = await handleRunMcuStep(
        {
          uri,
          variantName: "burnup",
          mode: "c",
          collectOnly: true,
          runDir,
          sourceFsPath: source,
          exitCode: 0,
        },
        settings,
        (u) => (u === uri ? doc : undefined)
      );
      assert.ok(result.ok);
      assert.ok(result.finCopiedPath);
      assert.ok(result.lstPath);
      assert.strictEqual(fs.readFileSync(result.finCopiedPath!, "utf8"), "FIN BODY\n");
      assert.match(result.lstPath!, /burnup\.lst$/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
