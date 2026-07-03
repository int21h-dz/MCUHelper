import { describe, it } from "node:test";
import assert from "node:assert";
import type { MaterialNode } from "./ast";
import {
  computeMaterialMassDensityGcm3,
  formatMassDensityGcm3,
  mcuNuclideAtomicWeight,
  MCU_NUCLEAR_DENSITY_SCALE,
} from "./materialDensity";

const baseNuclides = [
  { name: "U235", density: "0.7" },
  { name: "U238", density: "0.3" },
];

describe("mcuNuclideAtomicWeight", () => {
  it("resolves isotope mass numbers", () => {
    assert.strictEqual(mcuNuclideAtomicWeight("U235"), 235);
    assert.strictEqual(mcuNuclideAtomicWeight("O16"), 16);
  });

  it("resolves natural element average weights", () => {
    assert.ok(mcuNuclideAtomicWeight("U")! > 230);
    assert.ok(mcuNuclideAtomicWeight("HF")! > 170);
  });

  it("returns null for unknown symbols", () => {
    assert.strictEqual(mcuNuclideAtomicWeight("XYZZY"), null);
  });
});

describe("formatMassDensityGcm3", () => {
  it("formats normal and extreme densities", () => {
    assert.strictEqual(formatMassDensityGcm3(0), "—");
    assert.strictEqual(formatMassDensityGcm3(-1), "—");
    assert.ok(formatMassDensityGcm3(1.05).includes("г/см³"));
    assert.ok(formatMassDensityGcm3(50_000).includes("e+"));
  });
});

describe("computeMaterialMassDensityGcm3", () => {
  it("computes from nuclear concentrations without DENS param", () => {
    const rho = computeMaterialMassDensityGcm3({
      nuclides: [{ name: "ZR", density: "0.04273" }],
    } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">);
    assert.ok(rho != null && rho > 6.3 && rho < 6.7);
  });

  it("computes with DENSAA atomic fractions", () => {
    const rho = computeMaterialMassDensityGcm3({
      nuclides: baseNuclides,
      densParam: "DENSAA",
      densValue: 0.5,
    } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">);
    assert.ok(rho != null && rho > 0);
    const avgA = 0.7 * 235 + 0.3 * 238;
    const expected = 0.5 * MCU_NUCLEAR_DENSITY_SCALE * 1.660_539_066_60e-24 * avgA;
    assert.ok(Math.abs(rho! - expected) / expected < 0.01);
  });

  it("computes with DENSWA (same formula as DENSAA)", () => {
    const aa = computeMaterialMassDensityGcm3({
      nuclides: baseNuclides,
      densParam: "DENSAA",
      densValue: 0.4,
    } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">);
    const wa = computeMaterialMassDensityGcm3({
      nuclides: baseNuclides,
      densParam: "DENSWA",
      densValue: 0.4,
    } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">);
    assert.ok(aa != null && wa != null);
    assert.strictEqual(aa, wa);
  });

  it("computes with DENSAW weight fractions", () => {
    const rho = computeMaterialMassDensityGcm3({
      nuclides: baseNuclides,
      densParam: "DENSAW",
      densValue: 10,
    } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">);
    assert.ok(rho != null && rho > 0);
  });

  it("computes with DENSWW alias", () => {
    const aw = computeMaterialMassDensityGcm3({
      nuclides: baseNuclides,
      densParam: "DENSAW",
      densValue: 8,
    } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">);
    const ww = computeMaterialMassDensityGcm3({
      nuclides: baseNuclides,
      densParam: "DENSWW",
      densValue: 8,
    } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">);
    assert.strictEqual(aw, ww);
  });

  it("returns null for invalid inputs", () => {
    assert.strictEqual(
      computeMaterialMassDensityGcm3({ nuclides: [] } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">),
      null
    );
    assert.strictEqual(
      computeMaterialMassDensityGcm3({
        nuclides: [{ name: "U235", density: "bad" }],
      } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">),
      null
    );
    assert.strictEqual(
      computeMaterialMassDensityGcm3({
        nuclides: baseNuclides,
        densParam: "DENSAA",
        densValue: undefined,
      } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">),
      null
    );
    assert.strictEqual(
      computeMaterialMassDensityGcm3({
        nuclides: [{ name: "U235", density: "0" }],
        densParam: "DENSAA",
        densValue: 1,
      } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">),
      null
    );
    assert.strictEqual(
      computeMaterialMassDensityGcm3({
        nuclides: baseNuclides,
        densParam: "UNKNOWN",
        densValue: 1,
      } as Pick<MaterialNode, "nuclides" | "densParam" | "densValue">),
      null
    );
  });
});
