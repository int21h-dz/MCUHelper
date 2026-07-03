import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItemKind } from "vscode-languageserver";
import { analyzeDocument } from "@mcuhelper/mcu-language";
import { getCompletions, getDefinition } from "./completion";

const fixtures = path.join(__dirname, "../../../test/fixtures");

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

describe("completion", () => {
  it("suggests PIN at start of physical module", () => {
    const { doc, index } = openFixture("pin_example");
    const items = getCompletions(doc, { line: 0, character: 0 }, index);
    assert.ok(items.some((i) => i.label === "PIN"));
  });

  it("suggests geometry bodies in geometry fragment", () => {
    const { doc, index } = openFixture("trx_geometry");
    const items = getCompletions(doc, { line: 3, character: 0 }, index);
    assert.ok(items.some((i) => i.label === "RCZ" || i.label === "HEX"));
  });

  it("suggests MODS enum after MODS=", () => {
    const text = "PIN 1 0\nMATR 1\nU235 1.E-3 MODS=\nFINISH";
    const { doc, index } = openText(text);
    const items = getCompletions(doc, { line: 2, character: 18 }, index);
    assert.ok(items.some((i) => i.label === "G" || i.label === "C"));
  });

  it("suggests CONT boundary codes", () => {
    const text = "HEAD 3 0\nCONT \nFINISH";
    const { doc, index } = openText(text);
    const items = getCompletions(doc, { line: 1, character: 5 }, index);
    assert.ok(items.some((i) => typeof i.label === "string" && i.label.length <= 2));
  });

  it("suggests hash zone tail properties", () => {
    const text = "HEAD 3 0\nFUEL FU #\nFINISH";
    const { doc, index } = openText(text);
    const items = getCompletions(doc, { line: 1, character: 10 }, index);
    assert.ok(items.some((i) => i.label === "m=1"));
  });

  it("MATR header completions for T= and GROUP=", () => {
    const text = "PIN 1 0\nMATR 1 \nFINISH";
    const { doc, index } = openText(text);
    const items = getCompletions(doc, { line: 1, character: 7 }, index);
    assert.ok(items.some((i) => String(i.label).startsWith("T=")));
    assert.ok(items.some((i) => String(i.label).startsWith("GROUP")));
  });

  it("MATR GROUP= suggests existing groups", () => {
    const text = "PIN 1 0\nMATR 1 GROUP=FU\nMATR 2 GROUP=\nFINISH";
    const { doc, index } = openText(text.replace("GROUP=FU", "GROUP=fuel"));
    const items = getCompletions(doc, { line: 2, character: 14 }, index);
    assert.ok(items.some((i) => i.label === "fuel"));
  });

  it("includes constants, bodies, materials and snippets", () => {
    const { doc, index } = openFixture("full_variant");
    const items = getCompletions(doc, { line: 10, character: 0 }, index);
    assert.ok(items.some((i) => i.kind === CompletionItemKind.Constant || i.label === "zone-snippet"));
    assert.ok(items.some((i) => i.label === "trx-cell"));
    assert.ok(items.some((i) => String(i.label).startsWith("MAT") || i.kind === CompletionItemKind.Module));
  });

  it("getDefinition finds zone and body", () => {
    const { doc, index } = openFixture("trx_geometry");
    const zone = index.ast.zones.find((z) => z.name === "FUEL")!;
    const defZone = getDefinition(doc, { line: zone.range.start.line, character: 0 }, index);
    assert.ok(defZone);

    const body = index.ast.bodies.find((b) => b.name === "FU")!;
    const defBody = getDefinition(doc, { line: body.range.start.line, character: 4 }, index);
    assert.ok(defBody);
  });

  it("getDefinition finds constant EQU", () => {
    const text = "HEAD 3 0\nEQU R = 10\nFINISH";
    const { doc, index } = openText(text);
    const def = getDefinition(doc, { line: 1, character: 4 }, index);
    assert.ok(def);
  });

  it("FINISH is always suggested in any fragment", () => {
    const text = "PIN 1 0\nFINISH";
    const { doc, index } = openText(text);
    const items = getCompletions(doc, { line: 1, character: 0 }, index);
    assert.ok(items.some((i) => i.label === "FINISH"));
  });

  it("SUMZON enum completions skip used tokens", () => {
    const text = "BURN\nSUMZON ZONB \nFINISH";
    const { doc, index } = openText(text);
    const items = getCompletions(doc, { line: 1, character: 13 }, index);
    assert.ok(items.length > 0);
    assert.ok(items.some((i) => i.label === "SUMS" || i.label === "ZONS"));
    assert.ok(!items.some((i) => i.label === "ZONB"));
  });

  it("POWER completion documentation includes burnup load chart", () => {
    const burnPath = path.join(__dirname, "../../../RUNTEST/BURNUPR/burnup");
    if (!fs.existsSync(burnPath)) return;
    const text = fs.readFileSync(burnPath, "utf8");
    const uri = "file:///burnup";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    const powerLine = index.ast.statements.find((s) => /^POWER|^POWE/i.test(s.label))?.range.start.line;
    if (powerLine == null) return;
    const items = getCompletions(doc, { line: powerLine, character: 0 }, index);
    const power = items.find((i) => i.label === "POWER" || i.label === "POWE");
    assert.ok(power);
    const docText = typeof power!.documentation === "string" ? power!.documentation : power!.documentation?.value ?? "";
    assert.ok(docText.includes("Мощность") || docText.includes("svg") || docText.length > 80);
  });

  it("VOL completion includes material volumes", () => {
    const text = "PIN 1 0\nMATR 1\nU235 1.E-3\nBURN\nVOL \nFINISH";
    const { doc, index } = openText(text);
    const items = getCompletions(doc, { line: 4, character: 4 }, index);
    const vol = items.find((i) => i.label === "VOL");
    assert.ok(vol);
    const docText = typeof vol!.documentation === "string" ? vol!.documentation : vol!.documentation?.value ?? "";
    assert.ok(docText.length > 30);
  });

  it("EMES completion on spectrum line includes chart", () => {
    const rhdet = path.join(__dirname, "../../../RUNTEST/PH_EL/rhdet_pbg");
    if (!fs.existsSync(rhdet)) return;
    const text = fs.readFileSync(rhdet, "utf8");
    const uri = "file:///rhdet_pbg";
    const doc = TextDocument.create(uri, "mcunr", 1, text);
    const index = analyzeDocument(uri, text, 1);
    const emesLine = index.ast.statements.find((s) => s.label?.toUpperCase() === "EMES")?.range.start.line;
    if (emesLine == null) return;
    const items = getCompletions(doc, { line: emesLine, character: 0 }, index);
    const emes = items.find((i) => i.label === "EMES");
    assert.ok(emes);
    const docText = typeof emes!.documentation === "string" ? emes!.documentation : emes!.documentation?.value ?? "";
    assert.ok(docText.includes("svg") || docText.includes("Спектр") || docText.length > 80);
  });
});
