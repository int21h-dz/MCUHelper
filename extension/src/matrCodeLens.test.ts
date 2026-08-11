import { describe, it } from "node:test";
import assert from "node:assert";
import { formatMatrCodeLensTitle, type MatrLensMaterial } from "./matrCodeLens";

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
    nuclides: [],
    range,
    ...partial,
  };
}

describe("formatMatrCodeLensTitle", () => {
  it("includes nuclide count and density", () => {
    const title = formatMatrCodeLensTitle(
      mat({ number: 1, nuclideCount: 12, massDensityGcm3: 10.4, temperature: 293 })
    );
    assert.ok(title.includes("12 нукл."), title);
    assert.ok(title.includes("ρ≈"), title);
    assert.ok(title.includes("T=293"), title);
  });

  it("includes volume, mass, activity and SI count when present", () => {
    const title = formatMatrCodeLensTitle(
      mat({
        number: 2,
        nuclideCount: 5,
        sumIsotopeCount: 2,
        volumeCm3: 0.5,
        massG: 5.2,
        activityBqPerG: 1.2e6,
        group: "fuel",
      })
    );
    assert.ok(title.includes("2 в SI"), title);
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
});
