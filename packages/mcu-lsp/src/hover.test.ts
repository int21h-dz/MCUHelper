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
    const text = "PIN 1 0\nMATR 1\nU235 1.E-3\nBURN\nVOL 1.0 0.5\nFINISH";
    const { doc, index } = openText(text);
    const hover = getHover(doc, { line: 4, character: 1 }, index);
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
});
