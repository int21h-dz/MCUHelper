import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDocument } from "./parser";
import {
  formatTotalHistoriesEstimate,
  getTotalHistoriesEstimate,
  parseStatementFirstNumber,
} from "./calculationControl";

describe("calculationControl", () => {
  it("parseStatementFirstNumber reads first numeric field", () => {
    const vars = new Map<string, number>();
    assert.strictEqual(parseStatementFirstNumber("NTOT 1000", vars), 1000);
    assert.strictEqual(parseStatementFirstNumber("EQU X = 5", vars), null);
    assert.strictEqual(parseStatementFirstNumber("MAXSER 2.5E2", vars), 250);
  });

  it("getTotalHistoriesEstimate multiplies NTOT and MAXSER", () => {
    const ast = parseDocument(
      `PIN 1 0
NTOT 1.E6
MAXSER 100
NSKI 5
FINISH`,
      { uri: "hist" }
    );
    const est = getTotalHistoriesEstimate(ast);
    assert.ok(est);
    assert.strictEqual(est!.ntot, 1e6);
    assert.strictEqual(est!.maxser, 100);
    assert.strictEqual(est!.total, 1e8);
    assert.strictEqual(est!.nski, 5);
    const fmt = formatTotalHistoriesEstimate(est!);
    assert.ok(fmt.includes("истор"));
  });

  it("returns null when cards missing", () => {
    const ast = parseDocument("PIN 1 0\nFINISH", { uri: "nohist" });
    assert.strictEqual(getTotalHistoriesEstimate(ast), null);
  });
});
