import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandLinesForSumIsotope,
  MCU_MAX_CODE_LINE_LENGTH,
  packSumCardLines,
  planAddToSumIsotope,
  planAddToSumIsotopeExpanded,
  rebuildSumCardText,
} from "./addToSumIsotope";

describe("planAddToSumIsotope", () => {
  it("inserts SI after PIN when no sum cards", () => {
    const lines = ["PIN", "MATR 1", "FP1 1e-10", "FINISH"];
    const plan = planAddToSumIsotope(lines, "FP1", 2);
    assert.equal(plan.kind, "insert-line");
    if (plan.kind === "insert-line") {
      assert.equal(plan.beforeLine, 1);
      assert.equal(plan.text, "SI FP1");
    }
  });

  it("appends to existing SI list", () => {
    const lines = ["PIN", "SI AM241", "MATR 1", "FP1 1e-10"];
    const plan = planAddToSumIsotope(lines, "FP1", 3);
    assert.equal(plan.kind, "replace-line");
    if (plan.kind === "replace-line") {
      assert.equal(plan.line, 1);
      assert.equal(plan.newText, "SI AM241 FP1");
    }
  });

  it("preserves comment when appending to SI", () => {
    const lines = ["SI AM241  ; sum", "MATR 1", "CS137 1e-12"];
    const plan = planAddToSumIsotope(lines, "CS137", 2);
    assert.equal(plan.kind, "replace-line");
    if (plan.kind === "replace-line") {
      assert.equal(plan.newText, "SI AM241 CS137  ; sum");
    }
  });

  it("reports already when name is in SI", () => {
    const lines = ["SI FP1 AM241", "MATR 1", "FP1 1e-10"];
    const plan = planAddToSumIsotope(lines, "FP1", 2);
    assert.equal(plan.kind, "already");
  });

  it("removes name from SINOT and inserts SI", () => {
    const lines = ["SINOT FP1 AM241", "MATR 1", "FP1 1e-10"];
    const plan = planAddToSumIsotope(lines, "FP1", 2);
    assert.equal(plan.kind, "replace-line");
    if (plan.kind === "replace-line") {
      assert.equal(plan.newText, "SINOT AM241\nSI FP1");
    }
  });

  it("replaces sole SINOT exclude with SI", () => {
    const lines = ["SINOT FP1", "MATR 1", "FP1 1e-10"];
    const plan = planAddToSumIsotope(lines, "FP1", 2);
    assert.equal(plan.kind, "replace-line");
    if (plan.kind === "replace-line") {
      assert.equal(plan.newText, "SI FP1");
    }
  });

  it("inserts SI when SINOT is active but name is not listed", () => {
    const lines = ["PIN", "SINOT U235", "MATR 1", "FP1 1e-10"];
    const plan = planAddToSumIsotope(lines, "FP1", 3);
    assert.equal(plan.kind, "insert-line");
    if (plan.kind === "insert-line") {
      assert.equal(plan.text, "SI FP1");
    }
  });

  it("does not treat SI dens as sum card", () => {
    const lines = ["PIN", "MATR 1", "SI 1.1E-2", "FP1 1e-10"];
    const plan = planAddToSumIsotope(lines, "FP1", 3);
    assert.equal(plan.kind, "insert-line");
    if (plan.kind === "insert-line") {
      assert.equal(plan.text, "SI FP1");
      assert.equal(plan.beforeLine, 1);
    }
  });

  it("wraps SI list when line would exceed max code length", () => {
    const names = Array.from({ length: 40 }, (_, i) => `N${String(i).padStart(3, "0")}`);
    const lines = ["PIN", `SI ${names.join(" ")}`, "MATR 1", "ZZ99 1e-10"];
    const plan = planAddToSumIsotope(lines, "ZZ99", 3);
    assert.equal(plan.kind, "replace-line");
    if (plan.kind === "replace-line") {
      const packed = plan.newText.split("\n");
      assert.ok(packed.length > 1, "ожидалась continuation-строка");
      for (const row of packed) {
        const codeLen = row.includes(";") ? row.indexOf(";") : row.length;
        assert.ok(codeLen <= MCU_MAX_CODE_LINE_LENGTH, `codeLen=${codeLen} line=${row}`);
      }
      assert.ok(plan.newText.includes("ZZ99"));
      assert.ok(packed[1]!.startsWith(" "));
    }
  });
});

describe("packSumCardLines", () => {
  it("keeps short list on one line", () => {
    assert.deepEqual(packSumCardLines("SI", ["A", "B"]), ["SI A B"]);
  });

  it("packs to max length with leading-space continuations", () => {
    const tokens = Array.from({ length: 30 }, (_, i) => `ISO${i}`);
    const lines = packSumCardLines("SI", tokens, "", 40);
    assert.ok(lines.length > 1);
    assert.ok(lines[0]!.startsWith("SI "));
    for (const line of lines.slice(1)) {
      assert.ok(line.startsWith(" "), line);
      assert.ok(line.length <= 40, line);
    }
  });
});

describe("expand + plan with includes", () => {
  it("finds SI inside include and edits that file", () => {
    const mainUri = "file:///main.mcu";
    const incUri = "file:///si.inc";
    const mainLines = ["PIN", "#include si.inc", "MATR 1", "FP1 1e-10", "FINISH"];
    const expanded = expandLinesForSumIsotope(mainUri, mainLines, (p) => {
      if (p !== "si.inc") return null;
      return { uri: incUri, lines: ["SI AM241", ""] };
    });
    const plan = planAddToSumIsotopeExpanded(
      expanded,
      mainUri,
      mainLines,
      "FP1",
      mainUri,
      3
    );
    assert.equal(plan.kind, "replace-range");
    if (plan.kind === "replace-range") {
      assert.equal(plan.uri, incUri);
      assert.equal(plan.startLine, 0);
      assert.equal(plan.newText, "SI AM241 FP1");
    }
  });

  it("sees SI list across include before MATR in include", () => {
    const mainUri = "file:///main.mcu";
    const incUri = "file:///body.inc";
    const mainLines = ["PIN", "#include body.inc", "FINISH"];
    const expanded = expandLinesForSumIsotope(mainUri, mainLines, () => ({
      uri: incUri,
      lines: ["SI AM241", "MATR 1", "FP1 1e-10"],
    }));
    const plan = planAddToSumIsotopeExpanded(
      expanded,
      mainUri,
      mainLines,
      "FP1",
      incUri,
      2
    );
    assert.equal(plan.kind, "replace-range");
    if (plan.kind === "replace-range") {
      assert.equal(plan.uri, incUri);
      assert.equal(plan.newText, "SI AM241 FP1");
    }
  });

  it("rebuildSumCardText stays within limit", () => {
    const tokens = Array.from({ length: 50 }, (_, i) => `X${i}`);
    const text = rebuildSumCardText("SI", tokens);
    for (const row of text.split("\n")) {
      assert.ok(row.length <= MCU_MAX_CODE_LINE_LENGTH || row.trim().split(/\s+/).length <= 2);
    }
  });
});
