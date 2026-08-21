import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { pathToFileURL } from "url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeDocument, clearDocument, parseAwLib, setAwLibTable, clearAwLibTable, parseParameteThr, setParameteThrTable, clearParameteThrTable } from "@mcuhelper/mcu-language";
import {
  wordAtPosition,
  isOnStatementKeyword,
  fullLine,
  findNuclideAtPosition,
  getHover,
  getHoverContent,
  getHoverAsync,
  formatMaterialBriefHover,
} from "./hover";

const fixtures = path.join(__dirname, "../../../test/fixtures");
const runtest = path.join(__dirname, "../../../RUNTEST");

function openFixture(name: string) {
  const text = fs.readFileSync(path.join(fixtures, `${name}.mcu`), "utf8");
  const uri = `file:///fixtures/${name}.mcu`;
  const doc = TextDocument.create(uri, "mcunr", 1, text);
  const index = analyzeDocument(uri, text, 1);
  return { doc, index, uri };
}

function openText(text: string, uri = "file:///inline.mcu") {
  clearDocument(uri);
  const doc = TextDocument.create(uri, "mcunr", 1, text);
  const index = analyzeDocument(uri, text, 1);
  return { doc, index, uri };
}

describe("hover helpers", () => {
  it("wordAtPosition finds identifier under cursor", () => {
    const line = "MATR 1 U235 1.E-3";
    assert.strictEqual(wordAtPosition(line, 0), "MATR");
    assert.strictEqual(wordAtPosition(line, 8), "U235");
    assert.strictEqual(wordAtPosition(line, 100), null);
  });

  it("isOnStatementKeyword detects card label", () => {
    const line = "  PIN 1 0";
    assert.ok(isOnStatementKeyword(line, 3, "PIN"));
    assert.ok(!isOnStatementKeyword(line, 8, "PIN"));
  });

  it("fullLine returns line text", () => {
    const doc = {
      getText: (r: { start: { line: number; character: number }; end: { line: number; character: number } }) =>
        r.start.line === 0 ? "PIN 1 0" : "",
    };
    assert.strictEqual(fullLine(doc, { line: 0, character: 2 }), "PIN 1 0");
  });
});

describe("findNuclideAtPosition", () => {
  it("finds nuclide on its line", () => {
    const { index } = openFixture("full_variant");
    const matr = index.ast.materials[0]!;
    const nuclLine = matr.nuclides[0]!.range.start.line;
    const nuclName = matr.nuclides[0]!.name;
    const hit = findNuclideAtPosition(index, { line: nuclLine, character: 2 }, nuclName);
    assert.ok(hit);
    assert.strictEqual(hit!.materialNumber, matr.number);
  });
});

describe("getHover", () => {
  it("hover on zone FUEL in trx", () => {
    const { doc, index } = openFixture("trx_geometry");
    const zone = index.ast.zones.find((z) => z.name === "FUEL")!;
    const hover = getHover(doc, { line: zone.range.start.line, character: 2 }, index);
    assert.ok(hover);
    assert.ok(hover!.includes("FUEL"));
    assert.ok(hover!.includes("Выражение"));
  });

  it("hover on body RCZ name", () => {
    const { doc, index } = openFixture("trx_geometry");
    const body = index.ast.bodies.find((b) => b.name === "FU")!;
    const hover = getHover(doc, { line: body.range.start.line, character: 5 }, index);
    assert.ok(hover);
    assert.ok(hover!.includes("FU"));
    assert.ok(hover!.includes("RCZ"));
  });

  it("hover on RCZ keyword with volume on same line", () => {
    const { doc, index } = openFixture("trx_geometry");
    const body = index.ast.bodies.find((b) => b.name === "FU")!;
    const hover = getHover(doc, { line: body.range.start.line, character: 0 }, index);
    assert.ok(hover);
    assert.ok(hover!.includes("RCZ") || hover!.includes("цилиндр"));
  });

  it("hover on BOX keyword documents four coordinate triplets", () => {
    const text = "HEAD 1 0\nBOX B 0,0,0 1,0,0 0,1,0 0,0,1\nFINISH";
    const { doc, index } = openText(text);
    const hover = getHover(doc, { line: 1, character: 0 }, index);
    assert.ok(hover?.includes("параллелепипед"));
    assert.ok(hover?.includes("P1"));
    assert.ok(hover?.includes("P2"));
    assert.ok(hover?.includes("P3"));
    assert.ok(hover?.includes("тройки"));
  });

  it("hover on BOX coordinate triplet shows parameter help", () => {
    const text = "HEAD 1 0\nBOX B 0,0,0 1,0,0 0,1,0 0,0,1\nFINISH";
    const { doc, index } = openText(text);
    const line = text.split("\n")[1]!;
    const hover = getHoverContent(doc, { line: 1, character: line.indexOf("1,0,0") + 1 }, index, {
      enableIaeaNuclide: false,
    });
    assert.ok(hover?.includes("P1"), hover ?? "(null)");
  });

  it("hover contextual MODS on nuclide line", () => {
    const { doc, index } = openFixture("full_variant");
    const matr = index.ast.materials[0]!;
    const hLine = matr.nuclides.find((n) => n.name === "H")!.range.start.line;
    const hover = getHover(doc, { line: hLine, character: 20 }, index);
    if (hover) assert.ok(hover.includes("MODS") || hover.includes("G"));
  });

  it("hover MODS keyword documents values", () => {
    const text = "PIN 1 0\nMATR 1\nU235 1.E-3 MODS=\nFINISH";
    const { doc, index } = openText(text);
    const line = 2;
    const stmt = index.ast.statements.find((s) => s.range.start.line === line)?.text ?? "";
    const modsIdx = stmt.indexOf("MODS");
    const hover = getHover(doc, { line, character: modsIdx + 1 }, index);
    assert.ok(hover?.includes("MODS"));
  });

  it("hover hash hints on zone tail", () => {
    const { doc, index } = openFixture("trx_geometry");
    const zone = index.ast.zones[0]!;
    const line = index.ast.statements.find((s) => s.range.start.line === zone.range.start.line)?.text ?? "";
    const mIdx = line.indexOf("#");
    if (mIdx >= 0) {
      const hover = getHover(doc, { line: zone.range.start.line, character: mIdx + 2 }, index);
      if (hover) assert.ok(hover.includes("материал") || hover.includes("m"));
    }
  });

  it("hover without index still returns card info", () => {
    const doc = TextDocument.create("file:///x", "mcunr", 1, "PIN 1 0");
    const hover = getHover(doc, { line: 0, character: 1 }, null);
    assert.ok(hover?.includes("PIN"));
  });

  it("hover NTOT with histories estimate", () => {
    const text = `PIN 1 0\nNTOT 1000\nMAXSER 50\nFINISH`;
    const { doc, index } = openText(text);
    const hover = getHover(doc, { line: 1, character: 1 }, index);
    assert.ok(hover?.includes("NTOT") || hover?.includes("истор"));
  });

  it("hover on zone label in geometry line prefers zone, not nuclide params", () => {
    const text = [
      "HEAD 3 0",
      "CONT T T",
      "RCZ N3 0 0 0 10 1",
      "RCZ N4 0 0 0 10 2",
      "RCZ G3 0 0 0 10 3",
      "END",
      "R003 3 -4 -G3 /1:1",
      "END",
      "FINISH",
    ].join("\n");
    const { doc, index } = openText(text);
    const hover = getHoverContent(doc, { line: 6, character: 1 }, index, { enableIaeaNuclide: false });
    assert.ok(hover?.includes("Зона **R003**"));
    assert.ok(!hover?.includes("Параметр:"));
  });

  it("hover on duplicate zone name uses LCELL scope under cursor", () => {
    const text = [
      "HEAD 3 0",
      "CONT T T",
      "RCZ CNT 0 0 0 10 5",
      "END",
      "Z0 CNT /8:8",
      "END",
      "LCELL A",
      "RPP L 0 1 0 1 0 1",
      "END",
      "GROU L /-7:7/2",
      "END",
      "ENDL",
      "LCELL B",
      "RPP L 0 1 0 1 0 1",
      "END",
      "GROU L /-15:27/2",
      "END",
      "ENDL",
      "LATT GLTL Z0",
      "LISTEL A B",
      "PARM /1 0,0,0",
      "FINISH",
    ].join("\n");
    const { doc, index } = openText(text);
    const grouA = index.ast.zones.find((z) => z.name === "GROU" && z.scope === "lcell:A")!;
    const grouB = index.ast.zones.find((z) => z.name === "GROU" && z.scope === "lcell:B")!;
    const hoverA = getHover(doc, { line: grouA.range.start.line, character: 2 }, index);
    const hoverB = getHover(doc, { line: grouB.range.start.line, character: 2 }, index);
    assert.ok(hoverA?.includes("УРУ **−7**"), hoverA ?? "");
    assert.ok(hoverA?.includes("материал **7**"), hoverA ?? "");
    assert.ok(hoverA?.includes("lcell:A"), hoverA ?? "");
    assert.ok(hoverB?.includes("УРУ **−15**"), hoverB ?? "");
    assert.ok(hoverB?.includes("материал **27**"), hoverB ?? "");
    assert.ok(hoverB?.includes("lcell:B"), hoverB ?? "");
  });

  it("zone hover appends MATR brief and reveal link when material exists", () => {
    const text = [
      "PIN 1 0",
      "MATR 7 GROUP=FUEL NAME=UOX",
      "U235 1.0E-3",
      "U238 2.0E-2",
      "O16 4.0E-2",
      "MATR 27",
      "ZR 4.0E-2",
      "HEAD 3 0",
      "CONT T T",
      "RCZ CNT 0 0 0 10 5",
      "END",
      "ZFUEL CNT /1:7",
      "ZCLAD CNT /2:27",
      "END",
      "FINISH",
    ].join("\n");
    const { doc, index } = openText(text);
    const zFuel = index.ast.zones.find((z) => z.name === "ZFUEL")!;
    const hover = getHover(doc, { line: zFuel.range.start.line, character: 2 }, index);
    assert.ok(hover?.includes("материал **7**"), hover ?? "");
    assert.ok(hover?.includes("**MATR 7**"), hover ?? "");
    assert.ok(hover?.includes("GROUP=`FUEL`"), hover ?? "");
    assert.ok(hover?.includes("NAME=`UOX`"), hover ?? "");
    assert.ok(hover?.includes("U235"), hover ?? "");
    assert.ok(hover?.includes("mcuhelper.revealEditorRange"), hover ?? "");
    assert.ok(hover?.includes("Открыть MATR 7"), hover ?? "");
  });

  it("hover on material number in zone tail shows MATR brief", () => {
    const text = [
      "PIN 1 0",
      "MATR 27",
      "ZR 4.0E-2",
      "HF 1.0E-4",
      "HEAD 3 0",
      "CONT T T",
      "RCZ CNT 0 0 0 10 5",
      "END",
      "ZCLAD CNT /-15:27/2",
      "END",
      "FINISH",
    ].join("\n");
    const { doc, index } = openText(text);
    const zoneLine = index.ast.zones.find((z) => z.name === "ZCLAD")!.range.start.line;
    const lineText = doc.getText({
      start: { line: zoneLine, character: 0 },
      end: { line: zoneLine, character: 200 },
    });
    const matIdx = lineText.indexOf(":27");
    assert.ok(matIdx >= 0, lineText);
    const hover = getHover(doc, { line: zoneLine, character: matIdx + 1 }, index);
    assert.ok(hover?.includes("**MATR 27**"), hover ?? "");
    assert.ok(hover?.includes("ZR"), hover ?? "");
    assert.ok(hover?.includes("HF"), hover ?? "");
    assert.ok(hover?.includes("mcuhelper.revealEditorRange"), hover ?? "");
  });

  it("hover on reg digit equal to mat does not show MATR brief", () => {
    const text = [
      "PIN 1 0",
      "MATR 13",
      "AL 1.0E-2",
      "HEAD 3 0",
      "CONT T T",
      "RCZ CNT 0 0 0 10 5",
      "END",
      "ZSAME CNT /13:13",
      "END",
      "FINISH",
    ].join("\n");
    const { doc, index } = openText(text);
    const zoneLine = index.ast.zones.find((z) => z.name === "ZSAME")!.range.start.line;
    const lineText = doc.getText({
      start: { line: zoneLine, character: 0 },
      end: { line: zoneLine, character: 200 },
    });
    const slash = lineText.indexOf("/13:13");
    assert.ok(slash >= 0, lineText);
    const hoverReg = getHover(doc, { line: zoneLine, character: slash + 1 }, index);
    assert.ok(!hoverReg?.includes("**MATR 13**"), hoverReg ?? "(null)");
    const hoverMat = getHover(doc, { line: zoneLine, character: slash + 4 }, index);
    assert.ok(hoverMat?.includes("**MATR 13**"), hoverMat ?? "");
  });

  it("hover on MATR number shows material brief", () => {
    const text = ["PIN 1 0", "MATR 3 GROUP=WATER", "H 6.0E-2", "O16 3.0E-2", "FINISH"].join("\n");
    const { doc, index } = openText(text);
    const hover = getHover(doc, { line: 1, character: 5 }, index); // на "3"
    assert.ok(hover?.includes("**MATR 3**"), hover ?? "");
    assert.ok(hover?.includes("GROUP=`WATER`"), hover ?? "");
    assert.ok(hover?.includes("H"), hover ?? "");
  });

  it("formatMaterialBriefHover reports missing MATR", () => {
    const { index } = openText(["PIN 1 0", "MATR 1", "U235 1e-3", "FINISH"].join("\n"));
    const brief = formatMaterialBriefHover(index, 99);
    assert.ok(brief.includes("не найден"), brief);
  });

  it("hover on body name inside zone expression prefers body, not nuclide params", () => {
    const text = [
      "HEAD 3 0",
      "CONT T T",
      "RCZ N3 0 0 0 10 1",
      "RCZ N4 0 0 0 10 2",
      "RCZ G3 0 0 0 10 3",
      "END",
      "R003 3 -4 -G3 /1:1",
      "END",
      "FINISH",
    ].join("\n");
    const { doc, index } = openText(text);
    const line = text.split("\n")[6]!;
    const hover = getHoverContent(
      doc,
      { line: 6, character: line.indexOf("G3") + 1 },
      index,
      { enableIaeaNuclide: false }
    );
    assert.ok(hover?.includes("Тело **G3**"));
    assert.ok(hover?.includes("RCZ"));
  });

  it("hover on numeric body shorthand resolves to N-body", () => {
    const text = [
      "HEAD 3 0",
      "CONT T T",
      "RCZ N3 0 0 0 10 1",
      "RCZ N4 0 0 0 10 2",
      "END",
      "R003 3 -4 /1:1",
      "END",
      "FINISH",
    ].join("\n");
    const { doc, index } = openText(text);
    const hover = getHoverContent(doc, { line: 5, character: 5 }, index, { enableIaeaNuclide: false });
    assert.ok(hover?.includes("Тело **N3**"));
    assert.ok(hover?.includes("RCZ"));
  });

  it("hover on numeric body shorthand works on multi-line zone continuation", () => {
    const text = [
      "HEAD 3 0",
      "CONT T T",
      "RCZ N16 0 0 0 10 1",
      "RCZ N17 0 0 0 10 2",
      "RCZ N51 0 0 0 10 3",
      "RCZ N52 0 0 0 10 4",
      "END",
      "CLAD  17  -16 U",
      "               52  -51 U",
      "      /-1:13/2",
      "END",
      "FINISH",
    ].join("\n");
    const { doc, index } = openText(text);
    const cont = text.split("\n")[8]!;
    const hover52 = getHoverContent(
      doc,
      { line: 8, character: cont.indexOf("52") + 1 },
      index,
      { enableIaeaNuclide: false }
    );
    assert.ok(hover52?.includes("Тело **N52**"), hover52 ?? "(null)");
    assert.ok(hover52?.includes("RCZ"));

    const hoverTail = getHoverContent(doc, { line: 9, character: 10 }, index, { enableIaeaNuclide: false });
    assert.ok(!hoverTail?.includes("Тело **N13**"), hoverTail ?? "(null)");
  });
});

describe("getHoverContent", () => {
  it("shows list-only hover on SI nuclide token", () => {
    const text = ["PIN", "SI FP1 AM241", "MATR 1", "U235 1e-2", "FP1 1e-8", "FINISH"].join("\n");
    const { doc, index } = openText(text);
    const line = text.split("\n")[1]!;
    const hover = getHoverContent(
      doc,
      { line: 1, character: line.indexOf("FP1") + 1 },
      index,
      { enableIaeaNuclide: false }
    );
    assert.ok(hover?.includes("Нуклид **FP1**"), hover ?? "(null)");
    assert.ok(hover?.includes("списке карты SI"), hover ?? "(null)");
    assert.ok(!hover?.includes("Концентрация:"), hover ?? "(null)");
    assert.ok(!hover?.includes("Удельная активность материала"), hover ?? "(null)");
    assert.ok(!hover?.includes("Плотность материала"), hover ?? "(null)");
  });

  it("shows collapsible nuclide list on SI card hover", () => {
    const text = ["PIN", "SI FP1 AM241 U235 U238", "MATR 1", "U235 1e-2", "FP1 1e-8", "FINISH"].join("\n");
    const { doc, index } = openText(text);
    const hover = getHoverContent(doc, { line: 1, character: 1 }, index, { enableIaeaNuclide: false });
    assert.ok(hover?.includes("<details>"), hover ?? "(null)");
    assert.ok(hover?.includes("<summary>Нуклиды в карте SI (4)</summary>"), hover ?? "(null)");
    assert.ok(hover?.includes("- `FP1`"), hover ?? "(null)");
    assert.ok(hover?.includes("- `AM241`"), hover ?? "(null)");
  });

  it("shows list-only hover on SINOT nuclide token", () => {
    const text = ["PIN", "SINOT U235 U238", "MATR 1", "U235 1e-2", "U238 2e-2", "FINISH"].join("\n");
    const { doc, index } = openText(text);
    const line = text.split("\n")[1]!;
    const hover = getHoverContent(
      doc,
      { line: 1, character: line.indexOf("U238") + 1 },
      index,
      { enableIaeaNuclide: false }
    );
    assert.ok(hover?.includes("Нуклид **U238**"), hover ?? "(null)");
    assert.ok(hover?.includes("списке карты SINOT"), hover ?? "(null)");
    assert.ok(!hover?.includes("Концентрация:"), hover ?? "(null)");
    assert.ok(!hover?.includes("Удельная активность материала"), hover ?? "(null)");
    assert.ok(!hover?.includes("Плотность материала"), hover ?? "(null)");
  });

  it("SI dens (silicon) is nuclide hover, not SI card", () => {
    const text = ["PIN", "MATR 1", "SI 1.1E-2", "FINISH"].join("\n");
    const { doc, index } = openText(text);
    const hover = getHoverContent(doc, { line: 2, character: 1 }, index, { enableIaeaNuclide: false });
    assert.ok(hover?.includes("Нуклид **SI**"), hover ?? "(null)");
    assert.ok(hover?.includes("материале"), hover ?? "(null)");
    assert.ok(!hover?.includes("Нуклиды суммарного изотопа"), hover ?? "(null)");
    assert.ok(!hover?.includes("SI list"), hover ?? "(null)");
    assert.ok(!hover?.includes("<details>"), hover ?? "(null)");
  });

  it("does not duplicate SI reasons in LSP hover (decoration hover owns them)", () => {
    const text = ["PIN", "SI FP1", "MATR 1", "U235 1e-2", "FP1 1e-8", "FINISH"].join("\n");
    const { doc, index } = openText(text);
    const fp = index.ast.materials[0]!.nuclides.find((n) => n.name.toUpperCase() === "FP1")!;
    const hover = getHoverContent(
      doc,
      { line: fp.range.start.line, character: 1 },
      index,
      { enableIaeaNuclide: false }
    );
    assert.ok(hover);
    assert.ok(!hover!.includes("входит в суммарный изотоп"), hover);
    assert.ok(!hover!.includes("указан в SI"), hover);
  });

  it("returns nuclide local data", () => {
    const { doc, index, uri } = openFixture("full_variant");
    const matr = index.ast.materials[0]!;
    const nucl = matr.nuclides[0]!;
    const hover = getHoverContent(
      doc,
      { line: nucl.range.start.line, character: 2 },
      index,
      { enableIaeaNuclide: false },
      uri
    );
    assert.ok(hover);
    assert.ok(hover!.includes(nucl.name.toUpperCase()));
    assert.ok(hover!.includes("концентрация") || hover!.includes("яд/см"));
  });

  it("hover nuclide shows enrichment within element and mass fraction in material", () => {
    const text = ["PIN 1 0", "MATR 1", "U235 1.0E-2", "U238 3.0E-2", "FINISH"].join("\n");
    const { doc, index } = openText(text);
    const nucl = index.ast.materials[0]!.nuclides.find((n) => n.name.toUpperCase() === "U235")!;
    const hover = getHoverContent(doc, { line: nucl.range.start.line, character: 1 }, index, { enableIaeaNuclide: false });
    assert.ok(hover);
    assert.ok(hover!.includes("содержание в элементе U"), hover ?? "");
    // 1/(1+3)=0.25 => 25%
    assert.ok(hover!.includes("25"), hover ?? "");
    assert.ok(hover!.includes("массовая доля в материале"), hover ?? "");
    // mass ≈ 235/(235+3*238) ≈ 24.76%
    assert.ok(/24\.7/.test(hover!), hover ?? "");
  });

  it("suggests add-to-sum-isotope when AW.LIB loaded and nuclide missing", () => {
    setAwLibTable(parseAwLib("H 1001 1.00784\n"));
    try {
      const text = ["PIN", "MATR 1", "FP1 1.0E-10", "H 6.0E-2", "FINISH"].join("\n");
      const { doc, index, uri } = openText(text);
      const fp = index.ast.materials[0]!.nuclides[0]!;
      const hover = getHoverContent(
        doc,
        { line: fp.range.start.line, character: 1 },
        index,
        { enableIaeaNuclide: false },
        uri
      );
      assert.ok(hover);
      assert.ok(hover!.includes("mcuhelper.addToSumIsotope"), hover);
      assert.ok(hover!.includes("Добавить в суммарный изотоп"), hover);
    } finally {
      clearAwLibTable();
    }
  });

  it("does not suggest add-to-sum-isotope when already in SI", () => {
    setAwLibTable(parseAwLib("H 1001 1.00784\n"));
    try {
      const text = ["PIN", "SI FP1", "MATR 1", "FP1 1.0E-10", "FINISH"].join("\n");
      const { doc, index, uri } = openText(text);
      const fp = index.ast.materials[0]!.nuclides[0]!;
      const hover = getHoverContent(
        doc,
        { line: fp.range.start.line, character: 1 },
        index,
        { enableIaeaNuclide: false },
        uri
      );
      assert.ok(hover);
      assert.ok(!hover!.includes("mcuhelper.addToSumIsotope"), hover);
    } finally {
      clearAwLibTable();
    }
  });

  it("shows approximate material density note when some nuclides are skipped", () => {
    const text = [
      "PIN 1 0",
      "MATR 1",
      "ZR 0.04273",
      "U235 BADCONC",
      "XYZZY 0.01",
      "FINISH",
    ].join("\n");
    const { doc, index, uri } = openText(text);
    const nucl = index.ast.materials[0]!.nuclides[0]!;
    const hover = getHoverContent(
      doc,
      { line: nucl.range.start.line, character: 1 },
      index,
      { enableIaeaNuclide: false },
      uri
    );
    assert.ok(hover?.includes("Плотность материала"));
    assert.ok(hover?.includes("по 1 из 3 нуклидов"));
    assert.ok(hover?.includes("без концентраций: U235"));
    assert.ok(hover?.includes("без атомных масс: XYZZY"));
  });

  it("uses EQU concentration when computing nuclide hover density", () => {
    const text = ["EQU CZR = 0.04273", "PIN 1 0", "MATR 1", "ZR CZR", "FINISH"].join("\n");
    const { doc, index, uri } = openText(text);
    const nucl = index.ast.materials[0]!.nuclides[0]!;
    const hover = getHoverContent(
      doc,
      { line: nucl.range.start.line, character: 1 },
      index,
      { enableIaeaNuclide: false },
      uri
    );
    assert.ok(hover?.includes("Плотность материала"));
    assert.ok(hover?.includes("6."));
  });

  it("shows AW.LIB atomic mass for CS33 (not truncated 33)", () => {
    setAwLibTable(
      parseAwLib(`
CS33  55133 132.905451
`)
    );
    try {
      const text = ["PIN 1 0", "MATR 1", "CS33 1.183831e-06", "FINISH"].join("\n");
      const { doc, index, uri } = openText(text);
      const nucl = index.ast.materials[0]!.nuclides[0]!;
      const hover = getHoverContent(
        doc,
        { line: nucl.range.start.line, character: 1 },
        index,
        { enableIaeaNuclide: false },
        uri
      );
      assert.ok(hover?.includes("132.905451"), hover ?? "");
      assert.ok(hover?.includes("AW.LIB"), hover ?? "");
      assert.ok(hover?.includes("A=133"), hover ?? "");
      assert.ok(!hover?.includes("**33** а.е.м."), hover ?? "");
    } finally {
      clearAwLibTable();
    }
  });

  it("shows specific activity from PARAMETE.THR T½", () => {
    setAwLibTable(
      parseAwLib(`
CS37  55137 136.907089
CS33  55133 132.905452
`)
    );
    setParameteThrTable(
      parseParameteThr(`
LONGLIFE ISOTOPES
LIST
Cs-137  551370   137.      3.000E+00 y
Cs-133  551330   133.
stop
`)
    );
    try {
      const text = ["PIN 1 0", "MATR 1", "CS37 1.0E-6", "CS33 1.0E-4", "FINISH"].join("\n");
      const { doc, index, uri } = openText(text);
      const nucl = index.ast.materials[0]!.nuclides.find((n) => n.name === "CS37")!;
      const hover = getHoverContent(
        doc,
        { line: nucl.range.start.line, character: 1 },
        index,
        { enableIaeaNuclide: false },
        uri
      );
      assert.ok(hover?.includes("Удельная активность:"), hover ?? "");
      assert.ok(hover?.includes("вклад в А мат."), hover ?? "");
      assert.ok(hover?.includes("100%"), hover ?? "");
      assert.ok(!hover?.includes("по T½ PARAMETE.THR"), hover ?? "");
      assert.ok(hover?.includes("Бк/г"), hover ?? "");
      assert.ok(!hover?.includes("Бк/см³"), hover ?? "");
      assert.ok(hover?.includes("Удельная активность материала"), hover ?? "");
      assert.ok(!hover?.includes("без объёма VOL"), hover ?? "");
    } finally {
      clearParameteThrTable();
      clearAwLibTable();
    }
  });

  it("getHoverAsync delegates to getHoverContent", async () => {
    const { doc, index } = openFixture("pin_example");
    const hover = await getHoverAsync(doc, { line: 0, character: 1 }, index);
    assert.ok(hover?.includes("PIN"));
  });

  it("GROUP parameter hint lists known groups", () => {
    const text = `PIN 1 0\nMATR 1 GROUP=\nFINISH`;
    const { doc, index } = openText(text);
    const hover = getHoverContent(doc, { line: 1, character: 14 }, index);
    if (hover) assert.ok(hover.includes("GROUP") || hover.includes("fuel") || hover.includes("файле"));
  });

  it("burnup POWER hover includes load chart", () => {
    const burnPath = path.join(runtest, "BURNUPR", "burnup");
    if (!fs.existsSync(burnPath)) return;
    const text = fs.readFileSync(burnPath, "utf8");
    const uri = "file:///burnup";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    const powerLine = index.ast.statements.find((s) => /^POWER|^POWE/i.test(s.label))?.range.start.line;
    if (powerLine == null) return;
    const hover = getHoverContent(doc, { line: powerLine, character: 1 }, index, { enableIaeaNuclide: false });
    assert.ok(hover && hover.length > 20);
  });

  it("hover on EQU constant shows evaluated value", () => {
    const text = "HEAD 3 0\nEQU R = 10\nFINISH";
    const { doc, index } = openText(text);
    const hover = getHover(doc, { line: 1, character: 4 }, index);
    assert.ok(hover?.includes("EQU R"));
    assert.ok(hover?.includes("10"));
  });

  it("hover on EQU at body param shows role and computed value", () => {
    const text = "HEAD 3 0\nEQU R = 10\nEQU H = 25\nRCZ Z1 0,0,0 H R\nFINISH";
    const { doc, index } = openText(text);
    const line = doc.getText().split("\n")[3]!;
    const ch = line.lastIndexOf("R");
    const hover = getHoverContent(doc, { line: 3, character: ch }, index, { enableIaeaNuclide: false });
    assert.ok(hover?.includes("Параметр"), hover ?? "(null)");
    assert.ok(hover?.includes("Радиус") || hover?.includes("R"), hover ?? "(null)");
    assert.ok(hover?.includes("EQU R"), hover ?? "(null)");
    assert.ok(hover?.includes("10"), hover ?? "(null)");
    assert.ok(!hover?.includes("Значение"), hover ?? "(null)");
  });

  it("hover on EQU expression shows computed value once", () => {
    const text = "HEAD 3 0\nEQU A = 5\nEQU R = A+5\nRCZ Z1 0,0,0 1 R\nFINISH";
    const { doc, index } = openText(text);
    const line = doc.getText().split("\n")[3]!;
    const ch = line.lastIndexOf("R");
    const hover = getHoverContent(doc, { line: 3, character: ch }, index, { enableIaeaNuclide: false });
    assert.ok(hover?.includes("EQU R"), hover ?? "(null)");
    assert.ok(hover?.includes("A+5"), hover ?? "(null)");
    assert.ok(hover?.includes("Значение"), hover ?? "(null)");
    assert.ok(hover?.includes("**10**"), hover ?? "(null)");
    assert.equal((hover!.match(/Значение/g) ?? []).length, 1);
  });

  it("hover on SET usage shows last assigned value", () => {
    const text = "HEAD 3 0\nSET X = 1\nSET X = 2\nRCZ Z1 0,0,0 X 1\nFINISH";
    const { doc, index } = openText(text);
    const line = doc.getText().split("\n")[3]!;
    const ch = line.lastIndexOf("X");
    const hover = getHoverContent(doc, { line: 3, character: ch }, index, { enableIaeaNuclide: false });
    assert.ok(hover?.includes("SET X"), hover ?? "(null)");
    assert.ok(hover?.includes("`2`"), hover ?? "(null)");
    assert.ok(!hover?.includes("Значение"), hover ?? "(null)");
  });

  it("hover on EQU concentration shows role and value", () => {
    const text = ["EQU CZR = 0.04273", "PIN 1 0", "MATR 1", "ZR CZR", "FINISH"].join("\n");
    const { doc, index } = openText(text);
    const line = doc.getText().split("\n")[3]!;
    const ch = line.indexOf("CZR");
    const hover = getHoverContent(doc, { line: 3, character: ch + 1 }, index, { enableIaeaNuclide: false });
    assert.ok(hover?.includes("EQU CZR"), hover ?? "(null)");
    assert.ok(hover?.includes("0.04273"), hover ?? "(null)");
  });

  it("hover VOL keyword appends volume table", () => {
    const text = "PIN 1 0\nMATR 1\nU235 1.E-3\nVOL 1.0 0.5\nFINISH";
    const { doc, index } = openText(text);
    const hover = getHover(doc, { line: 3, character: 1 }, index);
    assert.ok(hover?.includes("VOL"));
    assert.ok(hover?.includes("0.5") || hover?.includes("объём"));
  });

  it("hover natural element nuclide without IAEA fetch", () => {
    const text = "PIN 1 0\nMATR 1\nHF 1.E-6\nFINISH";
    const { doc, index, uri } = openText(text);
    const nucl = index.ast.materials[0]!.nuclides[0]!;
    const hover = getHoverContent(
      doc,
      { line: nucl.range.start.line, character: nucl.range.start.character + 1 },
      index,
      { enableIaeaNuclide: false },
      uri
    );
    assert.ok(hover?.includes("HF"));
    assert.ok(hover?.includes("концентрация") || hover?.includes("яд/см"));
  });

  it("hover EMES line includes source spectrum block", () => {
    const rhdet = path.join(runtest, "PH_EL", "rhdet_pbg");
    if (!fs.existsSync(rhdet)) return;
    const text = fs.readFileSync(rhdet, "utf8");
    const uri = "file:///rhdet_pbg";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    const emesLine = index.ast.statements.find((s) => s.label?.toUpperCase() === "EMES")?.range.start.line;
    if (emesLine == null) return;
    const hover = getHover(doc, { line: emesLine, character: 2 }, index);
    assert.ok(hover?.includes("EMES") || hover?.includes("Спектр") || hover?.includes("svg"));
  });

  it("hover card label mid-line when not on keyword", () => {
    const text = "PIN 1 0\n; comment FINISH later\nFINISH";
    const { doc, index } = openText(text);
    const hover = getHover(doc, { line: 1, character: 10 }, index);
    if (hover) assert.ok(hover.includes("FINISH") || hover.includes("PIN"));
  });

  it("hover DELN in registration shows card description, not nuclide dens", () => {
    const text = "RGS 1 0\nKEFF\nDELN 0\nEND\nFINISH";
    const { doc, index } = openText(text);
    const delnLine = index!.ast.statements.find((s) => s.label === "DELN")!.range.start.line;
    const hover = getHoverContent(doc, { line: delnLine, character: 1 }, index, { enableIaeaNuclide: false });
    assert.ok(hover?.includes("другого модуля") || hover?.includes("недопустима"));
    assert.ok(!hover?.includes("Параметр: `dens`"));
    assert.ok(!hover?.includes("запаздывающ"));
  });

  it("hover on natural nuclide after #include uses editor line (not expanded)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-hover-inc-"));
    try {
      const pad = Array.from({ length: 40 }, (_, i) => `** pad ${i}`).join("\n");
      fs.writeFileSync(path.join(dir, "confpd.mcu"), `${pad}\nSI N, O\nSIDEN 1.0E-4\n`, "utf8");
      const mainText = [
        "PIN",
        "#include confpd",
        "** materials",
        "MATR 1 T=480",
        "N     4.994E-5",
        "O     1.338E-5",
        "U235  0.00034711",
        "FINISH",
      ].join("\n");
      const mainPath = path.join(dir, "main.mcu");
      fs.writeFileSync(mainPath, mainText, "utf8");
      const uri = pathToFileURL(mainPath).href;
      const doc = TextDocument.create(uri, "mcunr", 1, mainText);
      const index = analyzeDocument(uri, mainText, 1, { baseDir: dir, expandInclude: true });
      assert.ok(index.ast.includeLineMap?.length);

      const nLine = mainText.split(/\r?\n/).findIndex((l) => /^\s*N\s+/.test(l));
      const uLine = mainText.split(/\r?\n/).findIndex((l) => /^\s*U235\s+/.test(l));
      assert.ok(nLine >= 0 && uLine >= 0);

      const hoverN = getHoverContent(
        doc,
        { line: nLine, character: 0 },
        index,
        { enableIaeaNuclide: false },
        uri
      );
      assert.ok(hoverN?.includes("Нуклид **N**"), hoverN ?? "(null)");
      assert.ok(hoverN?.includes("4.994E-5"), hoverN ?? "(null)");
      assert.ok(hoverN?.includes("Разложить на изотопы"), hoverN ?? "(null)");

      const hoverU = getHoverContent(
        doc,
        { line: uLine, character: 0 },
        index,
        { enableIaeaNuclide: false },
        uri
      );
      assert.ok(hoverU?.includes("Нуклид **U235**"), hoverU ?? "(null)");
      assert.ok(hoverU?.includes("0.00034711"), hoverU ?? "(null)");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hover on nuclide inside include file uses parent expanded index", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-hover-incfile-"));
    try {
      const matsText = "N     4.994E-5\nO     1.338E-5\nU235  0.00034711\n";
      const matsPath = path.join(dir, "mats.mcu");
      fs.writeFileSync(matsPath, matsText, "utf8");
      const mainText = ["PIN", "MATR 1 T=480", "#include mats", "FINISH"].join("\n");
      const mainPath = path.join(dir, "main.mcu");
      fs.writeFileSync(mainPath, mainText, "utf8");

      const mainUri = pathToFileURL(mainPath).href;
      const matsUri = pathToFileURL(matsPath).href;
      const parentIndex = analyzeDocument(mainUri, mainText, 1, { baseDir: dir, expandInclude: true });
      const matsDoc = TextDocument.create(matsUri, "mcunr", 1, matsText);
      const standalone = analyzeDocument(matsUri, matsText, 1, { baseDir: dir, expandInclude: false });
      assert.strictEqual(standalone.ast.materials.length, 0, "standalone include has no MATR");

      const nLine = 0;
      const miss = getHoverContent(
        matsDoc,
        { line: nLine, character: 0 },
        standalone,
        { enableIaeaNuclide: false },
        matsUri
      );
      assert.ok(!miss?.includes("Нуклид **N**"), "standalone must miss parent MATR composition");

      const hoverN = getHoverContent(
        matsDoc,
        { line: nLine, character: 0 },
        parentIndex,
        { enableIaeaNuclide: false },
        matsUri
      );
      assert.ok(hoverN?.includes("Нуклид **N**"), hoverN ?? "(null)");
      assert.ok(hoverN?.includes("4.994E-5"), hoverN ?? "(null)");
      assert.ok(hoverN?.includes("Разложить на изотопы"), hoverN ?? "(null)");

      const hit = findNuclideAtPosition(parentIndex, { line: nLine, character: 0 }, "N", matsUri);
      assert.ok(hit);
      assert.strictEqual(hit!.materialNumber, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hides ICE expand button when natural element is listed in ICENOT", () => {
    const text = [
      "PIN",
      "ICENOT N O",
      "MATR 1 T=480",
      "N     4.994E-5",
      "U     1.0E-3",
      "FINISH",
    ].join("\n");
    const { doc, index, uri } = openText(text);
    const nLine = text.split(/\r?\n/).findIndex((l) => /^\s*N\s+/.test(l));
    const uLine = text.split(/\r?\n/).findIndex((l) => /^\s*U\s+/.test(l));
    assert.ok(nLine >= 0 && uLine >= 0);

    const hoverN = getHoverContent(
      doc,
      { line: nLine, character: 0 },
      index,
      { enableIaeaNuclide: false },
      uri
    );
    assert.ok(hoverN?.includes("Нуклид **N**"), hoverN ?? "(null)");
    assert.ok(!hoverN?.includes("Разложить на изотопы"), hoverN ?? "(null)");

    const hoverU = getHoverContent(
      doc,
      { line: uLine, character: 0 },
      index,
      { enableIaeaNuclide: false },
      uri
    );
    assert.ok(hoverU?.includes("Нуклид **U**"), hoverU ?? "(null)");
    assert.ok(hoverU?.includes("Разложить на изотопы"), hoverU ?? "(null)");
  });

  it("ICE/ICENOT list tokens and card hover mirror SI/SINOT", () => {
    const text = ["PIN", "ICE Fe U", "ICENOT N", "MATR 1", "Fe 1e-2", "FINISH"].join("\n");
    const { doc, index, uri } = openText(text);

    const hoverFe = getHoverContent(doc, { line: 1, character: 4 }, index, { enableIaeaNuclide: false }, uri);
    assert.ok(hoverFe?.includes("списке карты ICE"), hoverFe ?? "(null)");

    const hoverIce = getHoverContent(doc, { line: 1, character: 0 }, index, { enableIaeaNuclide: false }, uri);
    assert.ok(hoverIce?.includes("<summary>Элементы в карте ICE (2)</summary>"), hoverIce ?? "(null)");

    const hoverIcenot = getHoverContent(doc, { line: 2, character: 0 }, index, { enableIaeaNuclide: false }, uri);
    assert.ok(hoverIcenot?.includes("<summary>Элементы в карте ICENOT (1)</summary>"), hoverIcenot ?? "(null)");
  });

  it("ICE outside physical shows wrong-fragment hover like SI", () => {
    const text = ["HEAD", "ICE Fe", "SI FP1", "FINISH"].join("\n");
    const { doc, index, uri } = openText(text);
    const hoverIce = getHover(doc, { line: 1, character: 0 }, index, uri);
    const hoverSi = getHover(doc, { line: 2, character: 0 }, index, uri);
    assert.ok(hoverIce?.includes("карта другого модуля"), hoverIce ?? "(null)");
    assert.ok(hoverSi?.includes("карта другого модуля"), hoverSi ?? "(null)");
  });
});
