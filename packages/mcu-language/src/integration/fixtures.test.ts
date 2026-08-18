import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { parseDocument } from "../parser";
import { analyzeSemantics, buildConstantSummaries, buildSummaries } from "../semantic";
import { evaluateExpression, findUndefinedVariables } from "../expression";
import { lexDocument } from "../lexer";
import { expandRepeats } from "../preprocessor";
import { detectMcunrContent, scoreMcunrContent } from "../detect";
import { listVisibleConstants, resolveScopeAtLine } from "../constantScope";
import { mcuNuclideToIaeaElement, mcuNuclideToIaeaTarget } from "../nuclideIaea";
import { computeMaterialMassDensityGcm3 } from "../materialDensity";
import { computeBodyVolumeCm3FromAst } from "../bodyVolume";
import { getTotalHistoriesEstimate } from "../calculationControl";
import {
  getBurnupLoadAnalysis,
  integrateEnergyKwd,
  isIncrementalStepTimeValues,
  parseDstpPlateaus,
  parsePowePlateaus,
  parseStepPlateaus,
  parseStepPlateausCumulative,
} from "../burnupLoad";
import { renderBurnupLoadSvg } from "../burnupLoadChart";
import { validateEnergyGroupValues } from "../energyGroups";
import { checkNonNegativeToken } from "../positiveQuantities";
import { buildSemanticTokenSpans } from "../semanticHighlight";
import { getCompositionLineParameterHover, getParameterSignatureHelp } from "../parameterHints";
import {
  collectSourceSpectra,
  findSourceSpectrumAtLine,
} from "../sourceSpectrum";
import { formatSourceSpectrumHover, renderSourceSpectrumSvg } from "../sourceSpectrumChart";
import {
  buildMaterialMassRows,
  parseMaterialVolumes,
  specificBurnupMwdPerKg,
  totalMaterialMassG,
} from "../materialVolumes";
import { buildZoneRegistrationMap } from "../zoneRegistration";
import { computeMcuIsotopeLines, iaeaLabelToMcuNuclide } from "../naturalIsotopes";

const fixtures = path.join(__dirname, "../../../../test/fixtures");

describe("lexer", () => {
  it("detects tabs in code", () => {
    const { diagnostics } = lexDocument("PIN\t1");
    assert.ok(diagnostics.some((d) => d.code === "no-tabs"));
  });

  it("allows tabs in ** comment lines", () => {
    const { diagnostics } = lexDocument("**\tMATR 17\t96% H2O");
    assert.ok(!diagnostics.some((d) => d.code === "no-tabs"));
  });

  it("allows tabs after inline semicolon", () => {
    const { diagnostics } = lexDocument("MATR 1 T=300;\tcomment");
    assert.ok(!diagnostics.some((d) => d.code === "no-tabs"));
  });

  it("still rejects tabs before inline semicolon", () => {
    const { diagnostics } = lexDocument("MATR\t1 T=300; ok");
    assert.ok(diagnostics.some((d) => d.code === "no-tabs"));
  });

  it("skips line-length in ** comment lines", () => {
    const { diagnostics } = lexDocument("** " + "x".repeat(250));
    assert.ok(!diagnostics.some((d) => d.code === "line-length"));
  });

  it("skips line-length in C= comment lines", () => {
    const { diagnostics } = lexDocument("C=" + "note ".repeat(80));
    assert.ok(!diagnostics.some((d) => d.code === "line-length"));
  });

  it("skips line-length in text after semicolon", () => {
    const { diagnostics } = lexDocument("PIN 1;" + "x".repeat(250));
    assert.ok(!diagnostics.some((d) => d.code === "line-length"));
  });

  it("warns when code before semicolon exceeds 200 chars", () => {
    const { diagnostics } = lexDocument("PIN " + "1".repeat(200));
    assert.ok(diagnostics.some((d) => d.code === "line-length"));
  });
});

describe("preprocessor", () => {
  it("expands repeats", () => {
    const r = expandRepeats("[3|10.,]");
    assert.strictEqual(r, "10.,10.,10.,");
  });
});

describe("expression", () => {
  it("evaluates EQU", () => {
    const vars = new Map<string, number>();
    vars.set("R", 50);
    vars.set("A", 48);
    const v = evaluateExpression("SQRT(R*R-A*A)", vars);
    assert.ok(v !== null && Math.abs(v - 14) < 0.01);
  });

  it("evaluates LN in EQU", () => {
    const vars = new Map<string, number>([["RR", 0.8]]);
    const v = evaluateExpression("LN(1/RR)", vars);
    assert.ok(v !== null && Math.abs(v - Math.log(1 / 0.8)) < 1e-9);
  });

  it("finds undefined variables in expression", () => {
    const vars = new Map<string, number>([["A", 1]]);
    assert.deepStrictEqual(findUndefinedVariables("A+B*2", vars), ["B"]);
    assert.deepStrictEqual(findUndefinedVariables("SQRT(R)", vars), ["R"]);
    assert.deepStrictEqual(findUndefinedVariables("1.5E2", vars), []);
  });
});

describe("equ geometry", () => {
  it("does not parse compact EQU as zone", () => {
    const text = `HEAD
CONT B B B
EQU RIO=0.055
EQU RII=0.038
EQU RR=RII/RIO
EQU RIW=RIO*SQRT((1-RR*RR)/(2*LN(1/RR)))
RCZ FU 0,0,0 100 1
FINISH`;
    const ast = parseDocument(text, { uri: "equ.mcu" });
    ast.diagnostics = analyzeSemantics(ast);
    assert.ok(!ast.zones.some((z) => z.name === "EQU"));
    assert.ok(!ast.diagnostics.some((d) => d.code === "zone-body"));
    const riw = buildConstantSummaries(ast).find((c) => c.name === "RIW");
    assert.ok(riw?.value != null, `RIW=${riw?.value}`);
  });

  it("rhdet_pbg RUNTEST: EQU with LN and ** draft lines", () => {
    const runtest = path.join(__dirname, "../../../../RUNTEST/PH_EL/rhdet_pbg");
    if (!fs.existsSync(runtest)) return;
    const ast = parseDocument(fs.readFileSync(runtest, "utf8"), { uri: "rhdet_pbg" });
    const diags = analyzeSemantics(ast);
    const bad = diags.filter((d) => d.code === "zone-body" || d.code === "var-undef" || d.code === "expr-syntax");
    assert.strictEqual(bad.length, 0, bad.map((d) => d.message).join("; "));
    const riw = buildConstantSummaries(ast).find((c) => c.name === "RIW");
    assert.ok(riw?.value != null && riw.value > 0, `RIW=${riw?.value}`);
  });
});

describe("source spectrum hover", () => {
  it("pairs EMES and EPRO from rhdet_pbg", () => {
    const runtest = path.join(__dirname, "../../../../RUNTEST/PH_EL/rhdet_pbg");
    if (!fs.existsSync(runtest)) return;
    const ast = parseDocument(fs.readFileSync(runtest, "utf8"), { uri: "rhdet_pbg" });
    const specs = collectSourceSpectra(ast);
    assert.strictEqual(specs.length, 2);
    assert.strictEqual(specs[0].name, "elRh");
    assert.strictEqual(specs[0].energies.length, 59);
    assert.strictEqual(specs[0].probabilities.length, 59);
    assert.ok(findSourceSpectrumAtLine(ast, 69));
    assert.ok(findSourceSpectrumAtLine(ast, 80));
    const svg = renderSourceSpectrumSvg(specs[0]);
    assert.ok(svg.includes("<svg"));
    assert.ok(svg.includes("elRh"));
    const hover = formatSourceSpectrumHover(specs[0]);
    assert.ok(hover.includes("data:image/svg+xml;base64,"));
  });
});

describe("pin fixture", () => {
  it("parses materials", () => {
    const text = fs.readFileSync(path.join(fixtures, "pin_example.mcu"), "utf8");
    const ast = parseDocument(text, { uri: "pin_example.mcu" });
    ast.diagnostics = analyzeSemantics(ast);
    assert.strictEqual(ast.materials.length, 2);
    assert.strictEqual(ast.materials[0].nuclides.length, 3);
    assert.ok(!ast.diagnostics.some((d) => d.severity === "error" && d.code === "matr-gap"));
    const sum = buildSummaries(ast);
    assert.ok(sum.materials[0].massDensityGcm3 != null && sum.materials[0].massDensityGcm3 > 0);
    assert.strictEqual(sum.materials[0].nuclides.length, 3);
  });
});

describe("trx geometry", () => {
  it("parses bodies and zones", () => {
    const text = fs.readFileSync(path.join(fixtures, "trx_geometry.mcu"), "utf8");
    const ast = parseDocument(text, { uri: "trx.mcu" });
    ast.diagnostics = analyzeSemantics(ast);
    assert.ok(ast.bodies.length >= 4);
    assert.strictEqual(ast.zones.length, 4);
    assert.ok(ast.bodies.some((b) => b.bodyType === "HEX"));
    const sum = buildSummaries(ast);
    assert.ok(sum.bodies.length >= 4);
    assert.ok(sum.bodies.some((b) => b.name === "FU" && b.bodyType === "RCZ"));
    const hex = sum.bodies.find((b) => b.name === "C" && b.bodyType === "HEX");
    assert.ok(hex?.volumeCm3 != null && hex.volumeCm3 > 250 && hex.volumeCm3 < 320, `HEX C V=${hex?.volumeCm3}`);
    const fu = sum.bodies.find((b) => b.name === "FU");
    assert.ok(fu?.volumeCm3 != null && fu.volumeCm3 > 70 && fu.volumeCm3 < 85, `RCZ FU V=${fu?.volumeCm3}`);
  });
});

describe("latt fixture", () => {
  it("parses lattice elements", () => {
    const text = fs.readFileSync(path.join(fixtures, "latt_example.mcu"), "utf8");
    const ast = parseDocument(text, { uri: "latt.mcu" });
    assert.ok(ast.latticeElements.length >= 3);
    assert.ok(ast.lattices.length >= 1);
  });

  it("parses LISTEL and PARM for LATT", () => {
    const text = fs.readFileSync(path.join(fixtures, "latt_example.mcu"), "utf8");
    const ast = parseDocument(text, { uri: "latt.mcu" });
    const lat = ast.lattices[0];
    assert.ok(lat);
    assert.deepStrictEqual(lat.elements, ["A", "B", "C"]);
    assert.ok(lat.positions.some((p) => p.includes("0,0,0")));
    assert.deepStrictEqual(lat.zoneNames, ["Z0"]);
    const sum = buildSummaries(ast);
    assert.strictEqual(sum.lattices.length, 1);
    assert.deepStrictEqual(sum.lattices[0].elements.map((e) => e.name), ["A", "B", "C"]);
    assert.ok(sum.lattices[0].zoneNames.includes("Z0"));
  });

  it("no false duplicate errors in LCELL scopes", () => {
    const text = fs.readFileSync(path.join(fixtures, "latt_example.mcu"), "utf8");
    const ast = parseDocument(text, { uri: "latt.mcu" });
    const diags = analyzeSemantics(ast);
    const falsePos = diags.filter(
      (d) => d.severity === "error" && (d.code === "body-dup" || d.code === "zone-dup" || d.code === "zone-mat")
    );
    assert.strictEqual(falsePos.length, 0, falsePos.map((d) => d.message).join("; "));
  });

  it("no false duplicate errors in CELL scopes (same body/zone names)", () => {
    const text = fs.readFileSync(path.join(fixtures, "cell_example.mcu"), "utf8");
    const ast = parseDocument(text, { uri: "cell.mcu" });
    const diags = analyzeSemantics(ast);
    const falsePos = diags.filter(
      (d) => d.severity === "error" && (d.code === "body-dup" || d.code === "zone-dup" || d.code === "zone-body")
    );
    assert.strictEqual(falsePos.length, 0, falsePos.map((d) => d.message).join("; "));
    const n1 = ast.bodies.filter((b) => b.name === "N1");
    assert.strictEqual(n1.length, 2);
    assert.notStrictEqual(n1[0].scope, n1[1].scope);
    const z2 = ast.zones.filter((z) => z.name === "Z002");
    assert.strictEqual(z2.length, 2);
    assert.notStrictEqual(z2[0].scope, z2[1].scope);
  });
});

function fixtureDiagnostics(name: string): void {
  const text = fs.readFileSync(path.join(fixtures, name), "utf8");
  const ast = parseDocument(text, { uri: name });
  const diags = analyzeSemantics(ast);
  const errors = diags.filter((d) => d.severity === "error");
  if (errors.length) {
    console.log(`\n--- ${name} (${errors.length} errors) ---`);
    for (const d of errors) {
      console.log(`  L${d.range.start.line + 1} [${d.code}]: ${d.message}`);
    }
  }
}

describe("matr kdmk aux line", () => {
  it("parses nuclides after ** density header", () => {
    const text = fs.readFileSync(path.join(fixtures, "matr_kdmk_example.mcu"), "utf8");
    const ast = parseDocument(text, { uri: "matr_kdmk_example.mcu" });
    const m6 = ast.materials.find((m) => m.number === 6);
    const m7 = ast.materials.find((m) => m.number === 7);
    assert.ok(m6, "material 6");
    assert.strictEqual(m6!.nuclides.length, 8);
    assert.ok(m6!.nuclides.some((n) => n.name === "U235"));
    assert.ok(m7, "material 7");
    assert.strictEqual(m7!.nuclides.length, 1);
    const sum = buildSummaries(ast);
    assert.strictEqual(sum.materials.find((m) => m.number === 6)?.nuclideCount, 8);
  });
});

describe("gor_sp RUNTEST", () => {
  it("parses materials, zones and constants", () => {
    const gorPath = path.join(__dirname, "../../../../RUNTEST/N_PH/gor_sp");
    if (!fs.existsSync(gorPath)) return;
    const text = fs.readFileSync(gorPath, "utf8");
    const ast = parseDocument(text, { uri: "gor_sp" });
    assert.strictEqual(ast.materials.length, 7);
    assert.ok(ast.zones.length >= 7, `zones=${ast.zones.length}`);
    assert.ok(ast.constants.length >= 10);
    const sum = buildSummaries(ast);
    assert.strictEqual(sum.materials.length, 7);
    assert.ok(sum.zones.some((z) => z.name === "GRBL"));
    assert.ok(sum.constants.find((c) => c.name === "HPOLCL" && c.value === 700));
  });
});

describe("lexer semicolon", () => {
  it("treats inline semicolon as comment", () => {
    const { lines } = lexDocument("EQU HPOLCL = 700.0 ; comment");
    const types = lines[0].tokens.map((t) => t.type);
    assert.ok(types.includes("comment"));
    assert.ok(!types.includes("identifier") || lines[0].tokens.every((t) => t.type !== "identifier" || t.value !== "comment"));
  });
});

describe("content detect", () => {
  it("detects gor_sp by content", () => {
    const gorPath = path.join(__dirname, "../../../../RUNTEST/N_PH/gor_sp");
    if (!fs.existsSync(gorPath)) return;
    const text = fs.readFileSync(gorPath, "utf8");
    assert.ok(detectMcunrContent(text));
    const s = scoreMcunrContent(text);
    assert.ok(s.hits.includes("PIN"));
    assert.ok(s.hits.includes("MATR"));
  });

  it("detects PIN without optional print args", () => {
    const text = "PIN\nMATR 1\nU235 1.E-3\nFINISH";
    assert.ok(detectMcunrContent(text));
    const s = scoreMcunrContent(text);
    assert.ok(s.hits.includes("PIN"));
    assert.ok(s.hits.includes("MATR"));
  });

  it("detects through long ** comment preamble", () => {
    const comments = "** KDMK banner\n".repeat(20_000);
    const text = `${comments}PIN\nMATR 1\nU235 1.E-3\nFINISH`;
    assert.ok(detectMcunrContent(text));
  });

  it("detects RUNTEST/958 (PIN without number, geometry after materials)", () => {
    const p = path.join(__dirname, "../../../../RUNTEST/958");
    if (!fs.existsSync(p)) return;
    assert.ok(detectMcunrContent(fs.readFileSync(p, "utf8")));
  });

  it("detects RUNTEST/3l070626 (KDMK preamble before PIN)", () => {
    const p = path.join(__dirname, "../../../../RUNTEST/3l070626");
    if (!fs.existsSync(p)) return;
    assert.ok(detectMcunrContent(fs.readFileSync(p, "utf8")));
  });

  it("rejects plain text", () => {
    assert.ok(!detectMcunrContent("hello world\nfoo bar\n"));
  });
});

describe("matr nuclide ranges", () => {
  it("assigns nuclides to correct material by line", () => {
    const text = [
      "PIN 1",
      "MATR 2",
      "ZR 1.0E-02",
      "HF 2.0E-05",
      "MATR 5",
      "ZR 3.0E-02",
      "HF 4.0E-05",
      "END",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "matr_lines.mcu" });
    const m5 = ast.materials.find((m) => m.number === 5);
    const hf5 = m5?.nuclides.find((n) => n.name.toUpperCase() === "HF");
    const m2 = ast.materials.find((m) => m.number === 2);
    const hf2 = m2?.nuclides.find((n) => n.name.toUpperCase() === "HF");
    assert.ok(hf5 && hf2);
    assert.strictEqual(hf5!.density, "4.0E-05");
    assert.strictEqual(hf2!.density, "2.0E-05");
    assert.ok(hf5!.range.start.line > hf2!.range.start.line);
  });

  it("assigns per-line ranges to indented MATR continuation nuclides", () => {
    const text = ["PIN", "SI FP1", "MATR 1 T=300", " FP1 1e-8", " U235 1e-2", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "matr_indent.mcu" });
    const mat = ast.materials[0]!;
    const fp = mat.nuclides.find((n) => n.name.toUpperCase() === "FP1");
    const u = mat.nuclides.find((n) => n.name.toUpperCase() === "U235");
    assert.ok(fp && u, "indented nuclides parsed");
    assert.strictEqual(fp!.range.start.line, 3);
    assert.strictEqual(u!.range.start.line, 4);
    assert.notStrictEqual(fp!.range.start.line, mat.range.start.line);
  });

  it("reports invalid nuclide concentration typo", () => {
    const text = [
      "PIN 1",
      "MATR 4 T=1000",
      "U234 0.43615E-05",
      "U235 0.60790E-03",
      "U236 0.21623E-04",
      "U238 owl.20836E-01",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "matr_typo.mcu" });
    const m4 = ast.materials.find((m) => m.number === 4);
    assert.ok(m4);
    assert.ok(m4!.nuclides.some((n) => n.name === "U238"));
    const syntax = ast.diagnostics.find((d) => d.code === "matr-nuclide-syntax");
    assert.ok(!syntax, "typo dens goes to semantic matr-nuclide-conc, not parser syntax");
    const diags = analyzeSemantics(ast).filter((d) => d.code === "matr-nuclide-conc");
    assert.ok(diags.some((d) => d.message.includes("U238") && d.message.includes("owl")));
    const rho = computeMaterialMassDensityGcm3(m4!);
    assert.ok(rho != null && rho > 0, "ρ from remaining U isotopes");
  });
});

describe("fragment order", () => {
  it("keeps EGRC NEUT DELN before FINISH in physical fragment (pr2)", () => {
    const pr2 = path.join(fixtures, "../../RUNTEST/pr2/mcuinp");
    if (!fs.existsSync(pr2)) return;
    const ast = parseDocument(fs.readFileSync(pr2, "utf8"), { uri: "pr2" });
    assert.ok(!ast.diagnostics.some((d) => d.code === "fragment-order"));
    const phys = ast.fragments.find((f) => f.id === "physical");
    const geo = ast.fragments.find((f) => f.id === "geometry");
    assert.ok(phys && geo);
    assert.ok(phys!.endLine >= 304, "DELN/FINISH still in physical");
    assert.ok(geo!.startLine <= 305, "HEAD starts geometry");
  });

  it("DELN in registration keeps fragment and warns card-wrong-fragment", () => {
    const text = "RGS 1 0\nKEFF\nDELN 0\nEND\nFINISH";
    const ast = parseDocument(text, { uri: "reg-deln.mcu" });
    const deln = ast.statements.find((s) => s.label === "DELN");
    assert.strictEqual(deln?.fragment, "registration");
    const diag = ast.diagnostics.find((d) => d.code === "card-wrong-fragment" && d.message.includes("DELN"));
    assert.ok(diag, ast.diagnostics.map((d) => d.message).join("; "));
    assert.strictEqual(diag!.severity, "error");
  });

  it("NTOT in trajectory is allowed; DELN in trajectory is error", () => {
    const text = "TRJD\nNTOT 1000\nDELN 0\nFINISH";
    const ast = parseDocument(text, { uri: "trj.mcu" });
    assert.ok(!ast.diagnostics.some((d) => d.code === "card-wrong-fragment" && d.message.includes("NTOT")));
    assert.ok(ast.diagnostics.some((d) => d.code === "card-wrong-fragment" && d.message.includes("DELN")));
  });

  it("CALD weight-window cards from UserGuide 14.2.2 are allowed in calculationControl", () => {
    const text = [
      "CALD",
      "NAMVAR BURNUP",
      "MAXSER 150",
      "DTZM 2",
      "SETT N",
      "WWEN 0.1 5000 150000000000000",
      "XYZ0 0 0 0",
      "RADS 100 160 216 285 350 450 545 750",
      "INPM 1 1 1 1",
      "SANG -0.806 -0.6580 -0.4811 -0.2380 0.2380 0.4811 0.6580 0.806",
      "INRA 0 1 1 1",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "cald-weight-window.mcu" });
    const wrongFragment = ast.diagnostics.filter((d) => d.code === "card-wrong-fragment");
    assert.strictEqual(
      wrongFragment.length,
      0,
      wrongFragment.map((d) => d.message).join("; ")
    );
    assert.ok(ast.fragments.some((f) => f.id === "calculationControl"));
    assert.ok(ast.statements.find((s) => s.label === "XYZ0")?.fragment === "calculationControl");
    assert.ok(ast.statements.find((s) => s.label === "INRA")?.fragment === "calculationControl");
  });

  it("geometry zones named like registration cards are not card-wrong-fragment", () => {
    const text = [
      "HEAD 3 0",
      "CONT T T",
      "RPP A 0 1 0 1 0 1",
      "RPP B 0 2 0 2 0 2",
      "END",
      "FVOID A /1:1",
      "GROU B -A /2:2",
      "GZAZI A /3:3",
      "GZAZO B /4:4",
      "CROD A /5:5",
      "GRIN B /6:6",
      "END",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "zone-homonym.mcu" });
    assert.ok(ast.zones.some((z) => z.name === "GROU"));
    assert.ok(ast.zones.some((z) => z.name === "CROD"));
    assert.ok(
      !ast.diagnostics.some((d) => d.code === "card-wrong-fragment"),
      ast.diagnostics.filter((d) => d.code === "card-wrong-fragment").map((d) => d.message).join("; ")
    );
  });
});

describe("nuclideIaea", () => {
  it("converts MCU names to IAEA Target", () => {
    assert.strictEqual(mcuNuclideToIaeaTarget("U235"), "U-235");
    assert.strictEqual(mcuNuclideToIaeaTarget("TH30"), "Th-230");
    assert.strictEqual(mcuNuclideToIaeaTarget("PU39"), "Pu-239");
    assert.strictEqual(mcuNuclideToIaeaTarget("HE3"), "He-3");
    assert.strictEqual(mcuNuclideToIaeaTarget("O16"), "O-16");
    assert.strictEqual(mcuNuclideToIaeaTarget("ZR94"), "Zr-94");
    assert.strictEqual(mcuNuclideToIaeaTarget("HF"), null);
  });

  it("converts natural element MCU names", () => {
    assert.strictEqual(mcuNuclideToIaeaElement("HF"), "Hf");
    assert.strictEqual(mcuNuclideToIaeaElement("ZR"), "Zr");
    assert.strictEqual(mcuNuclideToIaeaElement("U"), "U");
    assert.strictEqual(mcuNuclideToIaeaElement("U235"), null);
  });
});

describe("materialDensity", () => {
  it("computes mass density from nuclear concentrations", () => {
    const zrOnly = {
      nuclides: [{ name: "ZR", density: "0.04273" }],
    };
    const rho = computeMaterialMassDensityGcm3(zrOnly as import("../ast").MaterialNode);
    assert.ok(rho != null && rho > 6.3 && rho < 6.7, `ZR rho=${rho}`);

    const clad = {
      nuclides: [
        { name: "ZR", density: "0.04273" },
        { name: "NB", density: "0.000432" },
        { name: "HF", density: "6.6E-6" },
      ],
    };
    const rhoClad = computeMaterialMassDensityGcm3(clad as import("../ast").MaterialNode);
    assert.ok(rhoClad != null && rhoClad > 6.4 && rhoClad < 6.8, `clad rho=${rhoClad}`);
  });
});

describe("bodyVolume", () => {
  it("computes volumes for analytic primitives", () => {
    const ast = parseDocument(
      `HEAD 1 0
RPP B -1,1 -1,1 0,2
RCZ C 0,0,0 10 1
SPH S 0,0,0 2
FINISH`,
      { uri: "vol.mcu" }
    );
    const rpp = ast.bodies.find((b) => b.name === "B")!;
    const rcz = ast.bodies.find((b) => b.name === "C")!;
    const sph = ast.bodies.find((b) => b.name === "S")!;
    assert.ok(Math.abs(computeBodyVolumeCm3FromAst(rpp, ast)! - 8) < 1e-6);
    assert.ok(Math.abs(computeBodyVolumeCm3FromAst(rcz, ast)! - Math.PI * 10) < 1e-4);
    assert.ok(Math.abs(computeBodyVolumeCm3FromAst(sph, ast)! - (32 / 3) * Math.PI) < 1e-4);
  });
});

describe("calculationControl", () => {
  it("estimates total histories as NTOT * MAXSER", () => {
    const text = fs.readFileSync(path.join(fixtures, "../../RUNTEST/BURNUPR/burnup"), "utf8");
    const ast = parseDocument(text, { uri: "burnup" });
    const est = getTotalHistoriesEstimate(ast);
    assert.ok(est);
    assert.strictEqual(est!.ntot, 200);
    assert.strictEqual(est!.maxser, 500);
    assert.strictEqual(est!.total, 100_000);
  });
});

describe("naturalIsotopes", () => {
  it("converts IAEA labels to MCU names", () => {
    assert.strictEqual(iaeaLabelToMcuNuclide("U-235"), "U235");
    assert.strictEqual(iaeaLabelToMcuNuclide("Pu-239"), "PU39");
    assert.strictEqual(iaeaLabelToMcuNuclide("Sn-112"), "SN12");
  });

  it("splits concentration by molar abundance", () => {
    const lines = computeMcuIsotopeLines(1, [
      { mcuName: "U235", abundancePercent: 0.72 },
      { mcuName: "U238", abundancePercent: 99.28 },
    ]);
    assert.strictEqual(lines.length, 2);
    const sum = lines.reduce((s, l) => s + parseFloat(l.concentration), 0);
    assert.ok(Math.abs(sum - 1) < 1e-5);
  });
});

describe("zoneRegistration", () => {
  it("defaults reg and obj to 1 for :mat tail", () => {
    const ast = parseDocument("HEAD 1 0\nCONT T T\nRPP A 0 1 0 1 0 1\nZ1 A :4\nEND\nFINISH", { uri: "t" });
    const reg = buildZoneRegistrationMap(ast.zones).get("Z1");
    assert.ok(reg);
    assert.strictEqual(reg!.materialNum, 4);
    assert.strictEqual(reg!.regNum, 1);
    assert.strictEqual(reg!.objNum, 1);
  });

  it("defaults obj to 1 for /reg:mat without object", () => {
    const ast = parseDocument("HEAD 1 0\nCONT T T\nRPP A 0 1 0 1 0 1\nZ1 A /4:2\nEND\nFINISH", { uri: "t" });
    const reg = buildZoneRegistrationMap(ast.zones).get("Z1");
    assert.ok(reg);
    assert.strictEqual(reg!.materialNum, 2);
    assert.strictEqual(reg!.regNum, 4);
    assert.strictEqual(reg!.objNum, 1);
  });

  it("inherits mat from prior /reg:mat for /reg/obj", () => {
    const ast = parseDocument(
      "HEAD 1 0\nCONT T T\nRPP A 0 1 0 1 0 1\nZON1 A /2:2\nZON2 A /2/3\nEND\nFINISH",
      { uri: "t" }
    );
    const map = buildZoneRegistrationMap(ast.zones);
    const z2 = map.get("ZON2");
    assert.ok(z2);
    assert.strictEqual(z2!.materialNum, 2);
    assert.strictEqual(z2!.regNum, 2);
    assert.strictEqual(z2!.objNum, 3);
  });

  it("resolves burnup :mat zones as M Z O = mat 1 1", () => {
    const text = fs.readFileSync(path.join(fixtures, "../../RUNTEST/BURNUPR/burnup"), "utf8");
    const ast = parseDocument(text, { uri: "burnup" });
    const sum = buildSummaries(ast);
    const r001 = sum.zones.find((z) => z.name === "R001");
    const r002 = sum.zones.find((z) => z.name === "R002");
    assert.ok(r001);
    assert.strictEqual(r001!.materialNum, 1);
    assert.strictEqual(r001!.regNum, 1);
    assert.strictEqual(r001!.objNum, 1);
    assert.ok(r002);
    assert.strictEqual(r002!.materialNum, 4);
    assert.strictEqual(r002!.regNum, 1);
    assert.strictEqual(r002!.objNum, 1);
  });
});

describe("materialVolumes", () => {
  it("parses VOL and computes masses from density", () => {
    const text = fs.readFileSync(path.join(fixtures, "../../RUNTEST/BURNUPR/burnup"), "utf8");
    const ast = parseDocument(text, { uri: "burnup" });
    const volumes = parseMaterialVolumes(ast);
    assert.ok(volumes);
    assert.strictEqual(volumes!.length, 8);
    assert.ok(Math.abs(volumes![0] - 0.45) < 1e-9);
    assert.ok(Math.abs(volumes![1] - 0.17) < 1e-9);

    const rows = buildMaterialMassRows(ast);
    assert.strictEqual(rows.length, 8);
    const clad = rows.find((r) => r.number === 2);
    assert.ok(clad?.volumeCm3 != null && Math.abs(clad.volumeCm3 - 0.17) < 1e-9);
    assert.ok(clad?.massDensityGcm3 != null && clad.massDensityGcm3 > 6.3 && clad.massDensityGcm3 < 6.8);
    assert.ok(clad?.massG != null && clad.massG > 1 && clad.massG < 1.2);

    const totalG = totalMaterialMassG(rows);
    assert.ok(totalG > 5);

    const load = getBurnupLoadAnalysis(ast);
    assert.ok(load);
    const mwdKg = specificBurnupMwdPerKg(load!.totalEnergyKwd, totalG);
    assert.ok(mwdKg != null && mwdKg > 0);
    assert.ok(Math.abs(mwdKg! - load!.totalEnergyKwd / totalG) < 1e-9);
  });
});

describe("burnupLoad", () => {
  it("parses POWER and STEP load profile", () => {
    const text = fs.readFileSync(path.join(fixtures, "../../RUNTEST/BURNUPR/burnup"), "utf8");
    const ast = parseDocument(text, { uri: "burnup" });
    const load = getBurnupLoadAnalysis(ast);
    assert.ok(load);
    assert.strictEqual(load!.totalTimeDays, 20);
    assert.strictEqual(load!.totalSteps, 2);
    assert.ok(Math.abs(load!.powerPlateaus[0].qKw - 0.146) < 1e-9);
    assert.ok(Math.abs(load!.totalEnergyKwd - 0.146 * 20) < 1e-6);
  });

  it("integrates piecewise POWE profile", () => {
    const plateaus = parsePowePlateaus([0.2, 500, 0.1, 600, 0.3, 1000]);
    const e = integrateEnergyKwd(plateaus, 1000);
    assert.ok(Math.abs(e - (0.2 * 500 + 0.1 * 100 + 0.3 * 400)) < 1e-6);
  });

  it("parses STEP timeline", () => {
    const steps = parseStepPlateaus([20, 2]);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].stepCount, 2);
    assert.strictEqual(steps[0].dtDays, 10);
    assert.strictEqual(steps[0].tEndDays, 20);
  });

  it("parses incremental STEP as DSTP (20+10=30)", () => {
    assert.ok(isIncrementalStepTimeValues([20, 3, 10, 2]));
    const steps = parseStepPlateaus([20, 3, 10, 2]);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].tEndDays, 20);
    assert.strictEqual(steps[1].tEndDays, 30);
    assert.strictEqual(steps[1].dtDays, 5);
    const load = getBurnupLoadAnalysis(
      parseDocument("BURN\nPOWER 0.146\nSTEP 20 3 10 2\nFINISH", { uri: "t.mcu" })
    );
    assert.ok(load);
    assert.strictEqual(load!.totalTimeDays, 30);
    assert.strictEqual(load!.totalSteps, 5);
    assert.ok(Math.abs(load!.totalEnergyKwd - 0.146 * 30) < 1e-6);
  });

  it("keeps cumulative STEP for monotonic times", () => {
    assert.ok(!isIncrementalStepTimeValues([1000, 4, 3000, 3, 3500, 1]));
    const steps = parseStepPlateausCumulative([1000, 4, 3000, 3, 3500, 1]);
    assert.strictEqual(steps[steps.length - 1].tEndDays, 3500);
    const dstp = parseDstpPlateaus([1000, 4, 3000, 3, 3500, 1]);
    assert.strictEqual(dstp[dstp.length - 1].tEndDays, 7500);
  });

  it("renders combined SVG load chart", () => {
    const ast = parseDocument("BURN\nPOWER 0.146\nSTEP 20 3 10 2\nFINISH", { uri: "chart.mcu" });
    const load = getBurnupLoadAnalysis(ast);
    assert.ok(load);
    const svg = renderBurnupLoadSvg(load!);
    assert.ok(svg.includes("<svg"));
    assert.ok(svg.includes("Мощность Q(T)"));
    assert.ok(svg.includes('stroke="#ea580c"'));
    assert.ok(svg.includes("3×Δt"));
  });
});

describe("fixture diagnostics report", () => {
  for (const f of ["pin_example.mcu", "full_variant.mcu", "trx_geometry.mcu", "latt_example.mcu"]) {
    it(`reports ${f}`, () => fixtureDiagnostics(f));
  }

  it("burnup RUNTEST has no false zone-body errors", () => {
    const burnPath = path.join(__dirname, "../../../../RUNTEST/BURNUPR/burnup");
    if (!fs.existsSync(burnPath)) return;
    const text = fs.readFileSync(burnPath, "utf8");
    const ast = parseDocument(text, { uri: "burnup" });
    const diags = analyzeSemantics(ast);
    const zoneBody = diags.filter((d) => d.code === "zone-body");
    assert.strictEqual(zoneBody.length, 0, zoneBody.map((d) => d.message).join("; "));
    assert.ok(ast.zones.length >= 7, `zones=${ast.zones.length}`);
    assert.ok(buildSummaries(ast).objects.length >= 1);
  });

  it("RUNTEST/vs_ru: net-carrier zone ZT01 (ZT01) is valid", () => {
    const vsPath = path.join(__dirname, "../../../../RUNTEST/vs_ru");
    if (!fs.existsSync(vsPath)) return;
    const text = fs.readFileSync(vsPath, "utf8");
    const ast = parseDocument(text, { uri: "vs_ru" });
    const zt = ast.zones.find((z) => z.name === "ZT01" && z.netCarrier === "ZT01");
    assert.ok(zt, "ZT01 net-carrier zone");
    assert.strictEqual(zt!.expression, "2 -4");
    const diags = analyzeSemantics(ast).filter((d) => d.code === "zone-body" && d.message.includes("ZT01"));
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });

  it("RUNTEST/vs_ru: PARM with COS/SIN is not a zone", () => {
    const vsPath = path.join(__dirname, "../../../../RUNTEST/vs_ru");
    if (!fs.existsSync(vsPath)) return;
    const text = fs.readFileSync(vsPath, "utf8");
    const ast = parseDocument(text, { uri: "vs_ru" });
    assert.ok(!ast.zones.some((z) => z.name === "PARM"), "PARM must not be parsed as zone");
    const latt = ast.lattices.find((l) => l.latticeType === "G2MP");
    assert.ok(latt?.positions.some((p) => p.includes("COS(60)")), "PARM stored on LATT");
    const diags = analyzeSemantics(ast).filter((d) => d.code === "zone-body" && d.message.includes("PARM"));
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });

  it("parses zone L10 after GLTL LATT (not G2MP cartogram)", () => {
    const text = `HEAD 3 0
CONT B B B
RCZ CNT 0 0 0 10 5
END
Z0 CNT /1:1
L10 CNT /2:2
END
LATT GLTL Z0
LISTEL A
PARM 0,0,0
FINISH`;
    const ast = parseDocument(text, { uri: "l10.mcu" });
    assert.ok(ast.zones.some((z) => z.name === "L10"), "zone L10 before LATT");
    const diags = analyzeSemantics(ast).filter((d) => d.code === "zone-body");
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });

  it("G2MP LATT: cartogram rows L01… are not unknown-statement", () => {
    const text = `HEAD 1 0
CONT T T T
RCZ C 0 0 0 10 5
END
ZZZ C /1:1
END
LATT G2MP ZZZ
LISTEL L16 L24 W16 W24 W36 LWT LAB L2
PARM 23,23 -11*14.7*COS(60), -11*14.7*SIN(60),HZ -14.7*COS(60), 14.7*SIN(60),0 14.7, 0, 0
* 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
L01 0 0 0 0 L2 L2 L2 L2 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
L02 0 0 0 L2 L2 L2 L2 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
FINISH`;
    const ast = parseDocument(text, { uri: "g2mp.mcu" });
    const unknown = ast.diagnostics.filter((d) => d.code === "unknown-statement");
    assert.strictEqual(unknown.length, 0, unknown.map((d) => d.message).join("; "));
    const lat = ast.lattices.find((l) => l.latticeType === "G2MP");
    assert.ok(lat?.typeMap?.length === 2, "cartogram rows stored");
    assert.deepStrictEqual(lat!.typeMap![0]!.slice(0, 5), ["0", "0", "0", "0", "L2"]);
    assert.ok(!ast.zones.some((z) => z.name === "L01"), "L01 is cartogram row, not zone");
  });
});

describe("ENERGY group bounds", () => {
  it("accepts strictly decreasing non-negative list ending with 0", () => {
    const text = `REGISTRATION
ENERGY 1.E6 1.E5 1000. 100. 10. 1. 0.
FINISH`;
    const ast = parseDocument(text, { uri: "energy.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code?.startsWith("energy"));
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });

  it("accepts multi-line ENERGY continuation", () => {
    const text = `REGISTRATION
ENERGY      .105E8   .65E7  .4E7
            .25E7   .14E7     .8E6
            10.      4.65   2.15      1.0     0.
FINISH`;
    const ast = parseDocument(text, { uri: "energy.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code?.startsWith("energy"));
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });

  it("rejects negative boundary", () => {
    const issues = validateEnergyGroupValues([100, 10, -1, 0]);
    assert.ok(issues.some((i) => i.code === "energy-negative"));
  });

  it("accepts ascending RUNTEST-style ENERGY", () => {
    const text = `PTYPE 1
TTYPE 1
ENERGY 0.0 0.1 0.4 5000
SPECTR 1
OFLU 1-29
RCT 3,18,918
END
FINISH`;
    const ast = parseDocument(text, { uri: "energy-runtest.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code?.startsWith("energy"));
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });

  it("URBMK and NSKIP are known cards (not unknown-statement)", () => {
    const text = `RGS
URBMK userf
FINISH
TRJD
NSKIP 3
NTOT 1000
FINISH`;
    const ast = parseDocument(text, { uri: "urbmk.mcu" });
    assert.strictEqual(
      ast.diagnostics.filter((d) => d.code === "unknown-statement").length,
      0,
      ast.diagnostics.map((d) => d.message).join("; ")
    );
  });

  it("ignores trailing garbage after FINISH ALL", () => {
    const text = `PIN 1 0
FINISH ALL
□`;
    const ast = parseDocument(text, { uri: "tail.mcu" });
    assert.ok(!ast.diagnostics.some((d) => d.code === "unknown-statement"));
  });

  it("reports garbage standalone line in source block", () => {
    const text = `PTYPE 1
TTYPE 1
ENERGY 0.0 0.1 0.4 5000
SPECTR 1
OFLU 1-3
RCT 3,18,918
АшЯФ
END
FINISH`;
    const ast = parseDocument(text, { uri: "energy-garbage.mcu" });
    assert.ok(
      ast.diagnostics.some((d) => d.code === "unknown-statement" && d.message.includes("АшЯФ")),
      ast.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ")
    );
  });

  it("rejects non-monotonic sequence", () => {
    const issues = validateEnergyGroupValues([100, 50, 50, 0]);
    assert.ok(issues.some((i) => i.code === "energy-order"));
    const issues2 = validateEnergyGroupValues([10, 20, 0]);
    assert.ok(issues2.some((i) => i.code === "energy-order"));
  });

  it("requires explicit 0 at end of descending list", () => {
    const issues = validateEnergyGroupValues([100, 10, 1]);
    assert.ok(issues.some((i) => i.code === "energy-missing-zero"));
  });

  it("requires explicit 0 at start of ascending list", () => {
    const issues = validateEnergyGroupValues([0.1, 0.4, 5000]);
    assert.ok(issues.some((i) => i.code === "energy-missing-zero"));
  });

  it("pr2 ENERGY cards pass validation", () => {
    const pr2 = path.join(__dirname, "../../../../RUNTEST/pr2/mcuinp");
    if (!fs.existsSync(pr2)) return;
    const ast = parseDocument(fs.readFileSync(pr2, "utf8"), { uri: "pr2" });
    const diags = analyzeSemantics(ast).filter((d) => d.code?.startsWith("energy"));
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });
});

describe("positive physical quantities", () => {
  it("rejects negative VOL", () => {
    const ast = parseDocument("BURN\nVOL 1.0 -0.5\nFINISH", { uri: "v.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "positive-qty");
    assert.ok(diags.some((d) => d.message.includes("VOL")));
  });

  it("rejects negative POWER", () => {
    const ast = parseDocument("BURN\nPOWER -0.1 100\nFINISH", { uri: "p.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "positive-qty");
    assert.ok(diags.some((d) => d.message.includes("мощность")));
  });

  it("rejects negative STEP time", () => {
    const ast = parseDocument("BURN\nSTEP -10 5\nFINISH", { uri: "s.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "positive-qty");
    assert.ok(diags.some((d) => d.message.includes("STEP")));
  });

  it("rejects negative nuclide concentration", () => {
    const ast = parseDocument("PIN\nMATR 1 T=300.\nU235 -1.E-5\nFINISH", { uri: "m.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "positive-qty");
    assert.ok(diags.some((d) => d.message.includes("U235")));
  });

  it("rejects negative constant used as volume", () => {
    const vars = new Map<string, number>([["VNEG", -2]]);
    const issue = checkNonNegativeToken("VNEG", vars, "VOL: объём [1]");
    assert.ok(issue);
  });

  it("burnup RUNTEST has no false positive-qty errors", () => {
    const burnPath = path.join(__dirname, "../../../../RUNTEST/BURNUPR/burnup");
    if (!fs.existsSync(burnPath)) return;
    const ast = parseDocument(fs.readFileSync(burnPath, "utf8"), { uri: "burnup" });
    const diags = analyzeSemantics(ast).filter((d) => d.code?.startsWith("positive"));
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });
});

describe("undefined variables", () => {
  it("errors on undefined name in VOL", () => {
    const ast = parseDocument("BURN\nVOL VUNDEF 1.0\nFINISH", { uri: "u.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "var-undef");
    assert.ok(diags.some((d) => d.message.includes("VUNDEF")));
  });

  it("errors on forward reference in EQU", () => {
    const ast = parseDocument("EQU A = B + 1\nEQU B = 2\nFINISH", { uri: "f.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "var-undef");
    assert.ok(diags.some((d) => d.message.includes("B")));
  });

  it("allows defined constant in body params", () => {
    const ast = parseDocument("EQU R = 10.\nRPP BOX 0 R 0 R 0 R\nFINISH", { uri: "b.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "var-undef");
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });
});

describe("constant scope CELL/LCELL", () => {
  const geoHead = "HEAD 1 0\nCONT T T T\nEQU LG = 25\nEQU LG2 = LG/2\n";

  it("allows same EQU name in different LCELL prototypes", () => {
    const text = `${geoHead}LCELL P1
EQU HALL = 1024
RPP N1 0,LG 0,LG 0,HALL
ENDL
LCELL P2
EQU HALL = 2000
RPP N1 0,LG 0,LG 0,HALL
ENDL
FINISH`;
    const diags = analyzeSemantics(parseDocument(text, { uri: "lcell.mcu" }));
    assert.ok(!diags.some((d) => d.code === "const-redef"));
  });

  it("errors on duplicate EQU in the same LCELL", () => {
    const text = `${geoHead}LCELL P1
EQU HALL = 1024
EQU HALL = 2000
ENDL
FINISH`;
    const diags = analyzeSemantics(parseDocument(text, { uri: "dup.mcu" }));
    assert.ok(diags.some((d) => d.code === "const-redef" && d.message.includes("HALL")));
  });

  it("allows LCELL EQU to shadow global name", () => {
    const text = `${geoHead}EQU HALL = 100
LCELL P1
EQU HALL = 1024
RPP N1 0,LG 0,LG 0,HALL
ENDL
FINISH`;
    const diags = analyzeSemantics(parseDocument(text, { uri: "shadow.mcu" }));
    assert.ok(!diags.some((d) => d.code === "const-redef"));
  });

  it("RUNTEST/958: HALL in multiple LCELL without const-redef", () => {
    const p = path.join(__dirname, "../../../../RUNTEST/958");
    if (!fs.existsSync(p)) return;
    const diags = analyzeSemantics(parseDocument(fs.readFileSync(p, "utf8"), { uri: "958" }));
    const redef = diags.filter((d) => d.code === "const-redef" && d.message.includes("HALL"));
    assert.strictEqual(redef.length, 0, redef.map((d) => `${d.message} @${d.range.start.line}`).join("; "));
  });
});

describe("visible constants at cursor", () => {
  it("resolves LCELL scope at line", () => {
    const text = `HEAD 1 0
CONT T T
EQU LG = 25
LCELL P1
EQU HALL = 1024
ENDL
LCELL P2
EQU HALL = 2000
ENDL
FINISH`;
    const ast = parseDocument(text, { uri: "scope.mcu" });
    assert.strictEqual(resolveScopeAtLine(ast.statements, 2), "global");
    assert.strictEqual(resolveScopeAtLine(ast.statements, 4), "lcell:P1");
    assert.strictEqual(resolveScopeAtLine(ast.statements, 7), "lcell:P2");
  });

  it("lists global + local with shadowing", () => {
    const text = `HEAD 1 0
CONT T T
EQU LG = 25
EQU HALL = 100
LCELL P1
EQU HALL = 1024
ENDL
FINISH`;
    const ast = parseDocument(text, { uri: "vis.mcu" });
    const scope = resolveScopeAtLine(ast.statements, 5);
    const vis = listVisibleConstants(ast.constants, scope, 5, 80);
    const hall = vis.find((c) => c.name === "HALL");
    assert.ok(hall);
    assert.strictEqual(hall!.value, 1024);
    assert.strictEqual(hall!.scope, "lcell:P1");
    assert.ok(vis.some((c) => c.name === "LG"));
  });

  it("excludes constants defined after cursor line", () => {
    const text = `HEAD 1 0
CONT T T
EQU A = 1
EQU B = 2
FINISH`;
    const ast = parseDocument(text, { uri: "after.mcu" });
    const vis = listVisibleConstants(ast.constants, "global", 3, 0);
    assert.ok(vis.some((c) => c.name === "A"));
    assert.ok(!vis.some((c) => c.name === "B"));
  });

  it("keeps document order, not alphabetical", () => {
    const text = `HEAD 1 0
CONT T T
EQU ZZZ = 1
EQU AAA = 2
EQU MMM = 3
FINISH`;
    const ast = parseDocument(text, { uri: "order.mcu" });
    const vis = listVisibleConstants(ast.constants, "global", 10, 0);
    assert.deepStrictEqual(
      vis.map((c) => c.name),
      ["ZZZ", "AAA", "MMM"]
    );
  });
});

describe("semantic highlight", () => {
  function spanAt(text: string, word: string) {
    const ast = parseDocument(text, { uri: "hl.mcu" });
    const spans = buildSemanticTokenSpans(ast, text);
    const idx = text.indexOf(word);
    const line = text.slice(0, idx).split("\n").length - 1;
    const char = idx - text.lastIndexOf("\n", idx - 1) - 1;
    return spans.find((s) => s.line === line && s.char === char && s.length === word.length);
  }

  it("PIN SI card vs MATR nuclide SI", () => {
    const text = "PIN\nSI SI28 SI29\nMATR 1 T=300.\nSI 1.1E-2\nFINISH";
    assert.strictEqual(spanAt(text, "SI")?.kind, "card");
    const siNuclideIdx = text.indexOf("SI 1.1E-2");
    const ast = parseDocument(text, { uri: "hl.mcu" });
    const spans = buildSemanticTokenSpans(ast, text);
    const line = text.slice(0, siNuclideIdx).split("\n").length - 1;
    const char = siNuclideIdx - text.lastIndexOf("\n", siNuclideIdx - 1) - 1;
    const nuclideSpan = spans.find((s) => s.line === line && s.char === char && s.kind === "nuclide");
    assert.ok(nuclideSpan, spans.map((s) => `${s.line}:${s.char} ${s.kind}`).join("; "));
  });

  it("SI dens without sci notation is nuclide not card", () => {
    const text = "PIN\nMATR 1\nSI    0.00054999\nFINISH";
    const siIdx = text.indexOf("SI    0.00054999");
    const ast = parseDocument(text, { uri: "hl-si0.mcu" });
    const spans = buildSemanticTokenSpans(ast, text);
    const line = text.slice(0, siIdx).split("\n").length - 1;
    const char = siIdx - text.lastIndexOf("\n", siIdx - 1) - 1;
    const span = spans.find((s) => s.line === line && s.char === char && s.length === 2);
    assert.ok(span, spans.map((s) => `${s.line}:${s.char}:${s.length} ${s.kind}`).join("; "));
    assert.strictEqual(span!.kind, "nuclide");
  });

  it("geometry CROD is zone not card", () => {
    const text = "HEAD\nCONT B B B\nEND\nCROD  5   /-3:2/1\nFINISH";
    assert.strictEqual(spanAt(text, "CROD")?.kind, "zone");
  });

  it("registration PTYPE is card", () => {
    const text = "REGD\nRGS\nKEFF\nPTYPE  1\nEND\nFINISH";
    assert.strictEqual(spanAt(text, "PTYPE")?.kind, "card");
  });

  it("trajectory UPOLY is body", () => {
    const text = "TRJD\nEND\nUPOLY  1 1 1\nFINISH";
    assert.strictEqual(spanAt(text, "UPOLY")?.kind, "body");
  });
});

describe("parameter signature help", () => {
  it("RCC highlights center after name", () => {
    const line = "RCC FUEL ";
    const help = getParameterSignatureHelp(line, line.length);
    assert.ok(help);
    assert.strictEqual(help!.parameters[help!.activeParameter].label, "x,y,z");
  });

  it("RCC highlights radius as last parameter", () => {
    const line = "RCC FUEL 0,0,0 0,0,100 ";
    const help = getParameterSignatureHelp(line, line.length);
    assert.ok(help);
    assert.strictEqual(help!.parameters[help!.activeParameter].label, "R");
  });

  it("POWER alternates Q and t", () => {
    const line = "POWER 0.146 ";
    const help = getParameterSignatureHelp(line, line.length);
    assert.ok(help);
    assert.strictEqual(help!.parameters[help!.activeParameter].label, "t");
  });

  it("SUMZON suggests enum tokens", () => {
    const line = "SUMZON SUMB ";
    const help = getParameterSignatureHelp(line, line.length);
    assert.ok(help);
    assert.ok(help!.parameters.some((p) => p.label === "ZONB"));
  });

  it("CONTEN suggests enum tokens instead of nuclide params", () => {
    const line = "CONTEN DENS ";
    const help = getParameterSignatureHelp(line, line.length);
    assert.ok(help);
    assert.ok(help!.parameters.some((p) => p.label === "SIGM"));
    assert.ok(!help!.parameters.some((p) => p.label === "dens"));
  });

  it("CODE keeps single-value enum signature", () => {
    const line = "CODE RSTP";
    const help = getParameterSignatureHelp(line, line.length);
    assert.ok(help);
    assert.ok(help!.parameters.some((p) => p.label === "RSTP"));
    assert.ok(!help!.parameters.some((p) => p.label === "ACE=ace"));
  });

  it("SPNT shows coordinates only", () => {
    const line = "SPNT 2.99 ";
    const help = getParameterSignatureHelp(line, line.length);
    assert.ok(help);
    assert.strictEqual(help!.parameters.length, 1);
    assert.strictEqual(help!.parameters[0].label, "x,y,z");
    assert.ok(!help!.parameters.some((p) => p.label.includes("FINISH")));
  });
});

describe("body parameter excess", () => {
  const geo = `HEAD
CONT B B B B B B B B
END
`;

  it("reports extra params on PLZ", () => {
    const text = `${geo}PLZ P4 2 3 3 3 3\nFINISH`;
    const ast = parseDocument(text, { uri: "geo.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "body-params-extra");
    assert.ok(diags.some((d) => d.message.includes("PLZ")));
  });

  it("reports extra params on SPH", () => {
    const text = `${geo}SPH SPH1 0,0,0 5 0,0,0 1 99\nFINISH`;
    const ast = parseDocument(text, { uri: "geo.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "body-params-extra");
    assert.ok(diags.some((d) => d.message.includes("SPH")));
  });

  it("reports extra params on PLG", () => {
    const text = `${geo}PLG P3 1,0,0 2 0,1,0 0 99\nFINISH`;
    const ast = parseDocument(text, { uri: "geo.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "body-params-extra");
    assert.ok(diags.some((d) => d.message.includes("PLG")));
  });

  it("accepts valid HEX line (comma form)", () => {
    const text = `${geo}HEX H1 0,0,0 1.806,0,100\nFINISH`;
    const ast = parseDocument(text, { uri: "geo.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "body-params-extra");
    assert.strictEqual(diags.length, 0);
  });

  it("accepts valid HEX line (whitespace form, 7 tokens)", () => {
    const text = `${geo}HEX N1 0.0 0.0 0.0 14.5 0.0 H\nFINISH`;
    const ast = parseDocument(text, { uri: "geo.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "body-params-extra");
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });

  it("accepts valid HEXX line (whitespace form)", () => {
    const text = `${geo}HEXX H10 139.5 0.0 0.0 HCORE 14.7\nFINISH`;
    const ast = parseDocument(text, { uri: "geo.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "body-params-extra");
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });

  it("accepts HEXX with optional angle (comma form)", () => {
    const text = `${geo}HEXY K 0,0,-1 3 4 90\nFINISH`;
    const ast = parseDocument(text, { uri: "geo.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "body-params-extra");
    assert.strictEqual(diags.length, 0);
  });

  it("accepts RPP with spaces only (no commas)", () => {
    const text = `${geo}RPP FICT 0 100 0 100 0 1024\nFINISH`;
    const ast = parseDocument(text, { uri: "geo.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "body-params-extra");
    assert.strictEqual(diags.length, 0);
  });

  it("accepts RCZ with mixed commas and spaces", () => {
    const text = `${geo}RCZ N2 LG2 LG2 0,HALL RGC\nFINISH`;
    const ast = parseDocument(text, { uri: "geo.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "body-params-extra");
    assert.strictEqual(diags.length, 0);
  });
});

describe("nuclide parameter excess", () => {
  const pin = "PIN 1\n";

  it("reports extra numeric tokens on nuclide line", () => {
    const text = `${pin}MATR 1\nU235 1.10E-03 0.5 3 3\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "matr-nuclide-extra");
    assert.ok(diags.some((d) => d.message.includes("U235")));
    assert.ok(diags.some((d) => d.message.includes("0.5")));
  });

  it("accepts MODS optional parameter", () => {
    const text = `${pin}MATR 1\nH 0.0001 MODS=G\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "matr-nuclide-extra");
    assert.strictEqual(diags.length, 0);
  });

  it("reports second nuclide without slash as extra", () => {
    const text = `${pin}MATR 1\nU235 1.0 U238 2.0\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "matr-nuclide-extra");
    assert.ok(diags.some((d) => d.message.includes("U238")));
  });

  it("reports invalid MODS numeric value", () => {
    const text = `${pin}MATR 1\nU235 0.0008255 MODS=0,52364\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "matr-nuclide-param");
    assert.ok(diags.some((d) => d.message.includes("MODS=0,52364")));
    assert.ok(diags.some((d) => d.message.includes("COHR")));
  });

  it("reports duplicate nuclide on separate lines", () => {
    const text = `${pin}MATR 1\nU235 1.0E-03\nU238 2.0E-04\nU235 3.0E-03\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "matr-nuclide-dup");
    assert.strictEqual(diags.length, 1);
    assert.ok(diags[0]!.message.includes("U235"));
    assert.ok(diags[0]!.message.includes("MATR 1"));
  });

  it("reports duplicate nuclide on one line with slash", () => {
    const text = `${pin}MATR 1\nU235 1.0 /U235 2.0\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const m1 = ast.materials.find((m) => m.number === 1);
    assert.ok(m1 && m1.nuclides.length >= 2);
    const diags = analyzeSemantics(ast).filter((d) => d.code === "matr-nuclide-dup");
    assert.strictEqual(diags.length, 1);
  });

  it("reports unparseable nuclide concentration (matr-nuclide-conc)", () => {
    const text = `${pin}MATR 1\nU235 BADCONC\nZR 0.04273\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "matr-nuclide-conc");
    assert.ok(diags.some((d) => d.message.includes("U235") && d.message.includes("BADCONC")));
    assert.strictEqual(
      diags.filter((d) => d.message.includes("ZR")).length,
      0,
      "ZR with numeric dens should not warn"
    );
    const rho = computeMaterialMassDensityGcm3(ast.materials[0]!);
    assert.ok(rho != null && rho > 6, "density from remaining ZR");
  });

  it("accepts EQU name as nuclide concentration", () => {
    const text = `EQU CZR = 0.04273\n${pin}MATR 1\nZR CZR\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "matr-nuclide-conc");
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });
});

describe("MATR card validation", () => {
  const pin = "PIN 1\n";

  it("reports negative temperature and empty GROUP", () => {
    const text = `${pin}MATR 100500 T=-10 GROUP=\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const diags = analyzeSemantics(ast);
    assert.ok(diags.some((d) => d.code === "positive-qty" && d.message.includes("T")));
    assert.ok(diags.some((d) => d.code === "matr-param-empty" && d.message.includes("GROUP=")));
  });

  it("reports invalid NAME value", () => {
    const text = `${pin}MATR 1 NAME=FOO\nU235 1.E-3\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code === "matr-param-value");
    assert.ok(diags.some((d) => d.message.includes("NAME=FOO")));
  });

  it("accepts valid MATR header", () => {
    const text = `${pin}MATR 1 T=300. GROUP=fuel\nU235 1.E-3\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const bad = analyzeSemantics(ast).filter((d) =>
      ["matr-param-empty", "matr-param-value"].includes(d.code ?? "")
    );
    assert.strictEqual(bad.length, 0);
  });

  it("accepts MATR header with spaces after =", () => {
    const text = `${pin}MATR 1 T= 313 GROUP= 1 NAME= MCU\nU235 1.E-3\nFINISH`;
    const ast = parseDocument(text, { uri: "pin.mcu" });
    const bad = analyzeSemantics(ast).filter((d) =>
      ["matr-param-empty", "matr-param-value"].includes(d.code ?? "")
    );
    assert.strictEqual(bad.length, 0);
  });
});

describe("nuclide parameter hints", () => {
  it("highlights dens while typing concentration", () => {
    const line = "U235 0.0008";
    const help = getParameterSignatureHelp(line, line.length);
    assert.ok(help);
    assert.strictEqual(help!.parameters[help!.activeParameter].label, "dens");
  });

  it("highlights MODS when editing MODS=value", () => {
    const line = "U235 0.0008255 MODS=0,52364";
    const help = getParameterSignatureHelp(line, line.length);
    assert.ok(help);
    assert.strictEqual(help!.parameters[help!.activeParameter].label, "MODS=mods");
  });

  it("hover describes active nuclide parameter", () => {
    const line = "U235 ";
    const hover = getCompositionLineParameterHover(line, line.length);
    assert.ok(hover);
    assert.ok(hover!.includes("яд/см"));
  });

  it("does not treat geometry zone line as nuclide parameter hover", () => {
    const line = "R003 3 -4 -G3 /1:1";
    const hover = getCompositionLineParameterHover(line, line.indexOf("G3") + 1);
    assert.strictEqual(hover, null);
  });

  it("does not treat DELN card line as nuclide dens hover", () => {
    const line = "DELN 0.01";
    const help = getParameterSignatureHelp(line, line.indexOf("0"));
    assert.ok(!help || !help.parameters.some((p) => p.label === "dens"));
    assert.strictEqual(getCompositionLineParameterHover(line, line.indexOf("DELN")), null);
  });

  it("does not treat SIDEN card line as nuclide dens hover", () => {
    const line = "SIDEN 1";
    const help = getParameterSignatureHelp(line, line.indexOf("1"));
    assert.ok(help);
    assert.ok(!help!.parameters.some((p) => p.label === "dens" || p.label === "name"));
    assert.ok(help!.parameters.some((p) => p.label === "value"));
    assert.ok(help!.documentation?.includes("суммарного изотопа"));
    assert.strictEqual(getCompositionLineParameterHover(line, line.indexOf("SIDEN")), null);
    assert.strictEqual(getCompositionLineParameterHover(line, line.indexOf("1")), null);
  });

  it("treats SI dens as nuclide, SI list as card", () => {
    const nuclide = "SI 1.1E-2";
    const nuclHelp = getParameterSignatureHelp(nuclide, nuclide.length);
    assert.ok(nuclHelp);
    assert.strictEqual(nuclHelp!.parameters[nuclHelp!.activeParameter].label, "dens");

    const card = "SI FP1 FP2";
    const cardHelp = getParameterSignatureHelp(card, card.indexOf("FP1"));
    assert.ok(cardHelp);
    assert.ok(cardHelp!.parameters.some((p) => p.label === "list"));
    assert.ok(!cardHelp!.parameters.some((p) => p.label === "dens"));
    assert.strictEqual(getCompositionLineParameterHover(card, card.indexOf("FP1")), null);
  });

  it("does not treat SINOT card line as nuclide dens hover", () => {
    const line = "SINOT U235 U238";
    const help = getParameterSignatureHelp(line, line.indexOf("U235"));
    assert.ok(help);
    assert.ok(help!.parameters.some((p) => p.label === "list"));
    assert.ok(!help!.parameters.some((p) => p.label === "dens"));
    assert.strictEqual(getCompositionLineParameterHover(line, line.indexOf("SINOT")), null);
  });

  it("highlights GROUP on MATR header", () => {
    const line = "MATR 14 T=100 GROUP=MOD";
    const help = getParameterSignatureHelp(line, line.length);
    assert.ok(help);
    assert.strictEqual(help!.parameters[help!.activeParameter].label, "GROUP=имя");
    assert.ok(help!.parameters[help!.activeParameter].documentation!.includes("MOD"));
  });
});
