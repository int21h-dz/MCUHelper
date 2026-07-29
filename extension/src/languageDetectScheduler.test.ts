import { describe, it } from "node:test";
import assert from "node:assert";
import { scoreMcunrContent } from "./contentDetect";
import { shouldStopLanguageDetect } from "./languageDetectScheduler";

describe("languageDetectScheduler", () => {
  it("shouldStopLanguageDetect stops on success", () => {
    const result = { isMcunr: true, score: 5, hits: ["PIN"] };
    assert.ok(shouldStopLanguageDetect(1, result, 100, true));
  });

  it("shouldStopLanguageDetect stops on score 0 and long document", () => {
    const result = { isMcunr: false, score: 0, hits: [] };
    assert.ok(shouldStopLanguageDetect(1, result, 600, false));
    assert.ok(!shouldStopLanguageDetect(1, result, 100, false));
  });

  it("shouldStopLanguageDetect continues for small fragment below max attempts", () => {
    const result = { isMcunr: false, score: 2, hits: ["MATR"] };
    assert.ok(!shouldStopLanguageDetect(2, result, 50, false));
  });

  it("shouldStopLanguageDetect stops at max attempts", () => {
    const result = { isMcunr: false, score: 2, hits: ["MATR"] };
    assert.ok(shouldStopLanguageDetect(5, result, 50, false));
  });

  it("fast-path paste template scores as MCU", () => {
    const pasted = "PIN 1 0\nMATR 1\nU235 1.E-3\nFINISH";
    const result = scoreMcunrContent(pasted);
    assert.ok(result.isMcunr);
  });
});
