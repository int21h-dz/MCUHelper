import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeMcuResultText,
  compareResultSummaries,
  formatResultCompareCsv,
} from "./resultSummary";

describe("resultSummary", () => {
  it("extracts keff and counts", () => {
    const text = [
      "Keff = 1.01234",
      "WARNING: something",
      "error :12 material",
      "ERRORS in initial data: 0",
    ].join("\n");
    const s = summarizeMcuResultText(text, "a.LST");
    assert.equal(s.keff, 1.01234);
    assert.equal(s.warningCount, 1);
    assert.equal(s.errorCount, 1);
    assert.ok(s.firstError?.includes("error"));
  });

  it("compares summaries to CSV", () => {
    const a = summarizeMcuResultText("Keff = 1.0\n", "a");
    const b = summarizeMcuResultText("Keff = 1.1\nWARNING x\n", "b");
    const d = compareResultSummaries(a, b);
    assert.ok(d.some((x) => x.field === "keff" && x.changed));
    const csv = formatResultCompareCsv(d);
    assert.match(csv, /^field,left,right,changed/);
  });
});
