import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildExpandedBlock,
  collectCollapsedIncludes,
  extractExpandedContent,
  findExpandedBlocks,
  parseIncludeDirective,
} from "./includePreviewCore";

describe("includePreviewCore", () => {
  it("builds and parses expanded block", () => {
    const block = buildExpandedBlock("#include confpd", "SI N, O\nSIDEN 1.0E-4\n");
    const blocks = findExpandedBlocks(`${block}\nMATR 1\n`);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.directive, "#include confpd");
    const lines = block.split("\n");
    assert.equal(extractExpandedContent(lines, blocks[0]!.beginLine, blocks[0]!.endLine), "SI N, O\nSIDEN 1.0E-4");
  });

  it("collects collapsed includes outside expanded blocks", () => {
    const text = [
      "PIN",
      "#include confpd",
      buildExpandedBlock("#include geo", "GEO\n"),
      "MATR 1",
      "FINISH",
    ].join("\n");
    const collapsed = collectCollapsedIncludes(text);
    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0]!.path, "confpd");
    assert.equal(collapsed[0]!.line, 1);
  });

  it("parseIncludeDirective supports angle brackets", () => {
    const p = parseIncludeDirective("#include <frag.mcu>");
    assert.ok(p);
    assert.equal(p!.path, "frag.mcu");
    assert.equal(p!.directive, "#include <frag.mcu>");
  });
});
