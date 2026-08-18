import { describe, it } from "node:test";
import assert from "node:assert";
import { formatMatrCodeLensTitle, planMatrCodeLenses, sameDocumentUri, type MatrLensMaterial } from "./matrCodeLens";

const range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 10 },
};

function mat(partial: Partial<MatrLensMaterial> & Pick<MatrLensMaterial, "number" | "nuclideCount">): MatrLensMaterial {
  return {
    nuclidesPreview: "",
    massDensityGcm3: null,
    volumeCm3: null,
    massG: null,
    usedNuclideCount: partial.nuclideCount,
    sumIsotopeCount: 0,
    sumIsotopeUsedCount: 0,
    sumIsotopeMissingAwLibCount: 0,
    nuclides: [],
    range,
    ...partial,
  };
}

describe("formatMatrCodeLensTitle", () => {
  it("includes nuclide count and density", () => {
    const title = formatMatrCodeLensTitle(
      mat({ number: 1, nuclideCount: 12, usedNuclideCount: 9, massDensityGcm3: 10.4, temperature: 293 })
    );
    assert.ok(title.includes("12 нукл."), title);
    assert.ok(!title.includes("ρ: 9 из"), title);
    assert.ok(title.includes("ρ≈"), title);
    assert.ok(title.includes("T=293"), title);
  });

  it("includes volume, mass, activity and split SI counts when present", () => {
    const title = formatMatrCodeLensTitle(
      mat({
        number: 2,
        nuclideCount: 5,
        usedNuclideCount: 4,
        sumIsotopeCount: 3,
        sumIsotopeUsedCount: 2,
        sumIsotopeMissingAwLibCount: 1,
        volumeCm3: 0.5,
        massG: 5.2,
        activityBqPerG: 1.2e6,
        group: "fuel",
      })
    );
    assert.ok(title.includes("5 нукл."), title);
    assert.ok(title.includes("в SI: 3"), title);
    assert.ok(title.includes("нет в AW: 1"), title);
    assert.ok(title.includes("V≈"), title);
    assert.ok(title.includes("m≈"), title);
    assert.ok(title.includes("A≈"), title);
    assert.ok(/МБк\/г/.test(title), title);
    assert.ok(title.includes("GROUP=fuel"), title);
  });

  it("omits empty metrics", () => {
    const title = formatMatrCodeLensTitle(mat({ number: 3, nuclideCount: 1 }));
    assert.strictEqual(title, "1 нукл.");
  });

  it("falls back to legacy counters when new fields are absent", () => {
    const legacy = mat({
      number: 4,
      nuclideCount: 205,
      sumIsotopeCount: 7,
    }) as unknown as MatrLensMaterial & {
      usedNuclideCount?: number;
      sumIsotopeUsedCount?: number;
      sumIsotopeMissingAwLibCount?: number;
    };
    delete legacy.usedNuclideCount;
    delete legacy.sumIsotopeUsedCount;
    delete legacy.sumIsotopeMissingAwLibCount;
    const title = formatMatrCodeLensTitle(legacy);
    assert.ok(title.includes("205 нукл."), title);
    assert.ok(title.includes("в SI: 7"), title);
    assert.ok(!title.includes("ρ:"), title);
  });
});

describe("planMatrCodeLenses", () => {
  it("places lens on visible MATR when summary range is still expanded", () => {
    const lines = ["PIN", "#include x", "MATR 1", "U235 1e-3", "FINISH"];
    const materials = [
      mat({
        number: 1,
        nuclideCount: 1,
        massDensityGcm3: 10.4,
        range: { start: { line: 4, character: 0 }, end: { line: 4, character: 6 } },
      }),
    ];
    const placed = planMatrCodeLenses("file:///a.mcu", lines.length, (i) => lines[i]!, materials);
    assert.equal(placed.length, 1);
    assert.equal(placed[0]!.line, 2);
    assert.equal(placed[0]!.material.number, 1);
  });

  it("skips materials that belong to another file", () => {
    const lines = ["PIN", "MATR 2", "H 1", "FINISH"];
    const materials = [
      mat({
        number: 1,
        nuclideCount: 1,
        uri: "file:///inc.mcu",
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      }),
      mat({
        number: 2,
        nuclideCount: 1,
        uri: "file:///a.mcu",
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 6 } },
      }),
    ];
    const placed = planMatrCodeLenses("file:///a.mcu", lines.length, (i) => lines[i]!, materials);
    assert.equal(placed.length, 1);
    assert.equal(placed[0]!.material.number, 2);
  });
});

describe("sameDocumentUri", () => {
  it("matches drive letter case and percent-encoding", () => {
    assert.ok(
      sameDocumentUri(
        "file:///Z:/DataDisk/Projects/McuHelper/RUNTEST/958",
        "file:///z:/DataDisk/Projects/McuHelper/RUNTEST/958"
      )
    );
    assert.ok(
      sameDocumentUri(
        "file:///Z:/DataDisk/Projects/McuHelper/RUNTEST/958",
        "file:///z%3A/DataDisk/Projects/McuHelper/RUNTEST/958"
      )
    );
    assert.ok(!sameDocumentUri("file:///a.mcu", "file:///b.mcu"));
  });
});
