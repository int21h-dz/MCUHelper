import { describe, it } from "node:test";
import assert from "node:assert";
import { formatNaturalInsertHoverButton, getNaturalIsotopeLines } from "./iaeaNds";

describe("iaeaNds", () => {
  it("formatNaturalInsertHoverButton includes command link", () => {
    const md = formatNaturalInsertHoverButton({
      uri: "file:///t.mcu",
      line: 5,
      character: 10,
      nuclideName: "U",
      concentration: "1.E-3",
    });
    assert.ok(md.includes("mcuhelper.expandNaturalIsotope"));
    assert.ok(md.includes("U"));
  });

  it("getNaturalIsotopeLines returns bundled U isotopes without blocking on network", async () => {
    const t0 = performance.now();
    const lines = await getNaturalIsotopeLines("U", "0.1");
    const ms = performance.now() - t0;
    assert.ok(lines && lines.length >= 2);
    assert.ok(ms < 500, `expected instant bundled path, took ${ms.toFixed(0)}ms`);
    assert.ok(lines.some((l) => l.mcuName.startsWith("U2")));
  });

  it("getNaturalIsotopeLines returns bundled Hf isotopes without network", async () => {
    const t0 = performance.now();
    const lines = await getNaturalIsotopeLines("Hf", "1.0E-6");
    const ms = performance.now() - t0;
    assert.ok(lines && lines.length >= 2);
    assert.ok(ms < 500, `expected instant bundled path, took ${ms.toFixed(0)}ms`);
    assert.ok(lines.some((l) => l.mcuName === "HF174"));
    assert.ok(lines.some((l) => l.mcuName === "HF180"));
  });
});