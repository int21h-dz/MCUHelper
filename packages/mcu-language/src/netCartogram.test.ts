import { describe, it } from "node:test";
import assert from "node:assert";
import { expandCartogramToken, expandCartogramTokens, uniqueMaterialNumsFromCartogram } from "./netCartogram";

describe("netCartogram", () => {
  it("expands N*value repeats", () => {
    assert.deepStrictEqual(expandCartogramToken("56*1"), Array(56).fill("1"));
    assert.deepStrictEqual(expandCartogramToken("4*13"), ["13", "13", "13", "13"]);
    assert.deepStrictEqual(expandCartogramToken("7"), ["7"]);
  });

  it("expands mixed token list", () => {
    assert.deepStrictEqual(expandCartogramTokens(["4*1", "2", "3"]), ["1", "1", "1", "1", "2", "3"]);
  });

  it("collects unique material numbers", () => {
    assert.deepStrictEqual(uniqueMaterialNumsFromCartogram(["4*1", "2", "2", "99"]), [1, 2, 99]);
  });
});
