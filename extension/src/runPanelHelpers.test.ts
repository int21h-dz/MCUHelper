import { describe, it } from "node:test";
import assert from "node:assert";
import {
  THANKS_URL,
  isAllowedThanksUrl,
  shouldFocusDiagnosticsAfterRun,
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
});
