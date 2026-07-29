import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { analyzeDocument } from "@mcuhelper/mcu-language";
import {
  wordAtPosition,
  isOnStatementKeyword,
  fullLine,
  findNuclideAtPosition,
  getHover,
  getHoverContent,
  getHoverAsync,
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
    const text = ["PIN 1 0", "EQU CZR = 0.04273", "MATR 1", "ZR CZR", "FINISH"].join("\n");
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
});
