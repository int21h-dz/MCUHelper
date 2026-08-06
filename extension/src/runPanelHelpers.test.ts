import { describe, it } from "node:test";
import assert from "node:assert";
import {
  THANKS_URL,
  isAllowedThanksUrl,
  shouldFocusDiagnosticsAfterRun,
  resolvePostRunOpenTarget,
  lstPathCandidates,
} from "./runPanelHelpers";

describe("runPanelHelpers", () => {
  it("isAllowedThanksUrl accepts exact CloudTips link", () => {
    assert.equal(isAllowedThanksUrl(THANKS_URL), true);
  });

  it("isAllowedThanksUrl rejects other hosts and schemes", () => {
    assert.equal(isAllowedThanksUrl("http://pay.cloudtips.ru/p/84f5f8d5"), false);
    assert.equal(isAllowedThanksUrl("https://evil.example/p/84f5f8d5"), false);
    assert.equal(isAllowedThanksUrl("https://pay.cloudtips.ru/p/other"), false);
    assert.equal(isAllowedThanksUrl("not-a-url"), false);
  });

  it("shouldFocusDiagnosticsAfterRun only when there are diagnostics", () => {
    assert.equal(shouldFocusDiagnosticsAfterRun({ diagnosticCount: 0, hasFirstError: false }), false);
    assert.equal(shouldFocusDiagnosticsAfterRun({ diagnosticCount: 2, hasFirstError: false }), true);
    assert.equal(shouldFocusDiagnosticsAfterRun({ diagnosticCount: 0, hasFirstError: true }), true);
  });

  it("lstPathCandidates prefers LSP path then runDir variants", () => {
    assert.deepEqual(
      lstPathCandidates({
        lstPath: "C:/tmp/NAME.LST",
        runDir: "C:/tmp",
        variantName: "NAME",
      }),
      ["C:/tmp/NAME.LST", "C:/tmp/NAME.lst"]
    );
    assert.deepEqual(lstPathCandidates({ runDir: "D:\\runs\\v", variantName: "958" }), [
      "D:\\runs\\v\\958.LST",
      "D:\\runs\\v\\958.lst",
    ]);
  });

  it("resolvePostRunOpenTarget opens LST after Debug", () => {
    assert.deepEqual(
      resolvePostRunOpenTarget({ mode: "i", lstPath: "C:/tmp/NAME.LST" }),
      { kind: "lst", path: "C:/tmp/NAME.LST", reason: "debug" }
    );
    assert.equal(resolvePostRunOpenTarget({ mode: "i" }), undefined);
  });

  it("resolvePostRunOpenTarget prefers FIN for Run/Final, else LST", () => {
    assert.deepEqual(
      resolvePostRunOpenTarget({
        mode: "c",
        finCopiedPath: "C:/work/NAME.FIN",
        finOverwritten: true,
        lstPath: "C:/tmp/NAME.LST",
      }),
      { kind: "fin", path: "C:/work/NAME.FIN", overwritten: true }
    );
    assert.deepEqual(
      resolvePostRunOpenTarget({ mode: "f", lstPath: "C:/tmp/NAME.LST" }),
      { kind: "lst", path: "C:/tmp/NAME.LST", reason: "fin-missing" }
    );
    assert.equal(resolvePostRunOpenTarget({ mode: "c" }), undefined);
    assert.equal(resolvePostRunOpenTarget({ mode: "continue", lstPath: "C:/tmp/NAME.LST" }), undefined);
  });
});
