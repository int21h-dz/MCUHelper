import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildExpandedDbmBlock,
  collectCollapsedDbmUsages,
  extractExpandedDbmContent,
  findExpandedDbmBlocks,
  formatDbmExpandDirective,
  parseDbmExpandDirective,
} from "./dbmPreviewCore";

describe("dbmPreviewCore", () => {
  it("formats and parses DBM expand directive", () => {
    assert.equal(formatDbmExpandDirective("graphi", "carb17"), "DBM GRAPHI/CARB17");
    assert.deepEqual(parseDbmExpandDirective("DBM GRAPHI/CARB17"), {
      library: "GRAPHI",
      code: "CARB17",
    });
  });

  it("builds expand block and finds matching markers", () => {
    const block = buildExpandedDbmBlock("GRAPHI", "CARB17", "CARB17 1 2\nC12 1.0 A\n");
    assert.match(block, /^\*\* \[mcuhelper\] ▼ DBM GRAPHI\/CARB17/);
    assert.match(block, /\*\* \[mcuhelper\] ▲ DBM GRAPHI\/CARB17$/);
    const text = `MATR 1 NAME=GRAPHI\n${block}\nEND\n`;
    const found = findExpandedDbmBlocks(text);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.library, "GRAPHI");
    assert.equal(found[0]!.code, "CARB17");
    assert.equal(found[0]!.beginLine, 1);
    const lines = text.split(/\n/);
    const body = extractExpandedDbmContent(lines, found[0]!.beginLine, found[0]!.endLine);
    assert.match(body, /C12/);
  });

  it("collects collapsed NAME=lib + code usages", () => {
    const text = [
      "PIN",
      "MATR 38 NAME=GRAPHI",
      "CARB17",
      "END",
      "MATR 1 NAME=MCU",
      "U235 1e-3",
      "END",
      "",
    ].join("\n");
    const spans = collectCollapsedDbmUsages(text);
    assert.equal(spans.length, 1);
    assert.equal(spans[0]!.library, "GRAPHI");
    assert.equal(spans[0]!.code, "CARB17");
    assert.equal(spans[0]!.line, 2);
  });

  it("skips code lines inside expanded DBM blocks", () => {
    const inner = buildExpandedDbmBlock("GRAPHI", "CARB17", "CARB17 1 2\nC12 1 A");
    const text = `MATR 1 NAME=GRAPHI\n${inner}\nEND\n`;
    assert.equal(collectCollapsedDbmUsages(text).length, 0);
  });
});
