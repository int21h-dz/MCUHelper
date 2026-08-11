import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateBatchSummary,
  buildBatchItem,
  clampBatchConcurrency,
  countLspWarnings,
  formatBatchItemLine,
  formatBatchSummaryText,
  LSP_SEVERITY_ERROR,
  LSP_SEVERITY_WARNING,
  mapPool,
} from "./batchValidate";

describe("batchValidate", () => {
  it("clampBatchConcurrency defaults to 1 and caps at 2", () => {
    assert.equal(clampBatchConcurrency(undefined), 1);
    assert.equal(clampBatchConcurrency(0), 1);
    assert.equal(clampBatchConcurrency(1), 1);
    assert.equal(clampBatchConcurrency(1.4), 1);
    assert.equal(clampBatchConcurrency(1.5), 2);
    assert.equal(clampBatchConcurrency(2), 2);
    assert.equal(clampBatchConcurrency(99), 2);
    assert.equal(clampBatchConcurrency("2"), 2);
  });

  it("countLspWarnings counts only severity Warning", () => {
    assert.equal(countLspWarnings(undefined), 0);
    assert.equal(countLspWarnings([]), 0);
    assert.equal(
      countLspWarnings([
        { severity: LSP_SEVERITY_ERROR },
        { severity: LSP_SEVERITY_WARNING },
        { severity: LSP_SEVERITY_WARNING },
        { severity: 3 },
      ]),
      2
    );
  });

  it("aggregateBatchSummary counts ok/fail/warnings", () => {
    const items = [
      buildBatchItem({
        filePath: "a.mcu",
        variantName: "a",
        ok: true,
        warningCount: 2,
        lstPath: "/tmp/a.LST",
      }),
      buildBatchItem({
        filePath: "b.mcu",
        variantName: "b",
        ok: false,
        firstErrorMessage: "error :22",
        warningCount: 1,
      }),
      buildBatchItem({
        filePath: "c.mcu",
        variantName: "c",
        ok: false,
        message: "prepare failed",
        warningCount: 0,
      }),
    ];
    const summary = aggregateBatchSummary(items);
    assert.equal(summary.total, 3);
    assert.equal(summary.okCount, 1);
    assert.equal(summary.failCount, 2);
    assert.equal(summary.warningTotal, 3);
  });

  it("formatBatchSummaryText includes status columns and paths", () => {
    const summary = aggregateBatchSummary([
      buildBatchItem({
        filePath: "Z:\\decks\\ok.mcu",
        variantName: "ok",
        ok: true,
        warningCount: 0,
        lstPath: "Z:\\decks\\.mcuhelper-runs\\ok\\ok.LST",
      }),
      buildBatchItem({
        filePath: "Z:\\decks\\bad.mcu",
        variantName: "bad",
        ok: false,
        firstErrorMessage: "error :55 material empty",
        warningCount: 3,
        lstPath: "Z:\\decks\\.mcuhelper-runs\\bad\\bad.LST",
      }),
    ]);
    const text = formatBatchSummaryText(summary);
    assert.match(text, /всего 2, ok 1, fail 1, warnings 3/);
    assert.match(text, /file\tstatus\tfirstError/);
    const lines = text.split("\n");
    assert.equal(lines.length, 4);
    assert.equal(
      formatBatchItemLine(summary.items[0]!),
      "Z:\\decks\\ok.mcu\tok\t—\twarnings=0\tlst=Z:\\decks\\.mcuhelper-runs\\ok\\ok.LST"
    );
    assert.match(lines[3]!, /bad\.mcu\tfail\terror :55/);
  });

  it("mapPool runs with concurrency 1 in order", async () => {
    const seen: number[] = [];
    const out = await mapPool([10, 20, 30], 1, async (n, i) => {
      seen.push(i);
      return n + 1;
    });
    assert.deepEqual(seen, [0, 1, 2]);
    assert.deepEqual(out, [11, 21, 31]);
  });

  it("mapPool concurrency 2 preserves result order", async () => {
    const started: number[] = [];
    const out = await mapPool(["a", "b", "c", "d"], 2, async (v, i) => {
      started.push(i);
      await new Promise((r) => setTimeout(r, 5 + (3 - i) * 2));
      return `${v}${i}`;
    });
    assert.deepEqual(out, ["a0", "b1", "c2", "d3"]);
    assert.equal(started.length, 4);
  });
});
