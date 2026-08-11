import { describe, it } from "node:test";
import assert from "node:assert";
import type { MaterialNode } from "./ast";
import {
  analyzeMaterialMassDensity,
  computeMaterialMassDensityGcm3,
  computeNuclideMassFractionInMaterial,
  formatMassDensityGcm3,
  mcuNuclideAtomicWeight,
  resolveNuclideConcentration,
  MCU_NUCLEAR_DENSITY_SCALE,
} from "./materialDensity";

const baseNuclides = [
  { name: "U235", density: "0.7" },
  { name: "U238", density: "0.3" },
];

type MatPick = Pick<MaterialNode, "nuclides" | "densParam" | "densValue">;

describe("mcuNuclideAtomicWeight", () => {
  it("resolves isotope mass numbers", () => {
    assert.strictEqual(mcuNuclideAtomicWeight("U235"), 235);
    assert.strictEqual(mcuNuclideAtomicWeight("O16"), 16);
  });

  it("resolves natural element average weights", () => {
    assert.ok(mcuNuclideAtomicWeight("U")! > 230);
    assert.ok(mcuNuclideAtomicWeight("HF")! > 170);
    assert.ok(mcuNuclideAtomicWeight("GD")! > 150);
  });

  it("returns null for unknown symbols", () => {
    assert.strictEqual(mcuNuclideAtomicWeight("XYZZY"), null);
  });
});

describe("resolveNuclideConcentration", () => {
  it("parses literals and EQU expressions", () => {
    assert.strictEqual(resolveNuclideConcentration("1.5E-2"), 0.015);
    const vars = new Map([["DENSU", 0.04]]);
    assert.strictEqual(resolveNuclideConcentration("DENSU", vars), 0.04);
    assert.strictEqual(resolveNuclideConcentration("2*DENSU", vars), 0.08);
    assert.strictEqual(resolveNuclideConcentration("BAD", vars), null);
    assert.strictEqual(resolveNuclideConcentration(""), null);
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
    } as MatPick);
    assert.ok(rho != null && rho > 6.3 && rho < 6.7);
  });

  it("computes with DENSAA atomic fractions", () => {
    const rho = computeMaterialMassDensityGcm3({
      nuclides: baseNuclides,
      densParam: "DENSAA",
      densValue: 0.5,
    } as MatPick);
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
    } as MatPick);
    const wa = computeMaterialMassDensityGcm3({
      nuclides: baseNuclides,
      densParam: "DENSWA",
      densValue: 0.4,
    } as MatPick);
    assert.ok(aa != null && wa != null);
    assert.strictEqual(aa, wa);
  });

  it("computes with DENSAW weight fractions", () => {
    const rho = computeMaterialMassDensityGcm3({
      nuclides: baseNuclides,
      densParam: "DENSAW",
      densValue: 10,
    } as MatPick);
    assert.ok(rho != null && rho > 0);
  });

  it("computes with DENSWW alias", () => {
    const aw = computeMaterialMassDensityGcm3({
      nuclides: baseNuclides,
      densParam: "DENSAW",
      densValue: 8,
    } as MatPick);
    const ww = computeMaterialMassDensityGcm3({
      nuclides: baseNuclides,
      densParam: "DENSWW",
      densValue: 8,
    } as MatPick);
    assert.strictEqual(aw, ww);
  });

  it("skips bad concentration / unknown mass and still returns rho", () => {
    const analysis = analyzeMaterialMassDensity({
      nuclides: [
        { name: "ZR", density: "0.04273" },
        { name: "U235", density: "NOTANUM" },
        { name: "XYZZY", density: "0.01" },
      ],
    } as MatPick);
    assert.ok(analysis.rho != null && analysis.rho > 6.3 && analysis.rho < 6.7);
    assert.strictEqual(analysis.usedCount, 1);
    assert.strictEqual(analysis.skipped.length, 2);
    assert.ok(analysis.skipped.some((s) => s.reason === "bad-conc" && s.name === "U235"));
    assert.ok(analysis.skipped.some((s) => s.reason === "unknown-mass" && s.name === "XYZZY"));
  });

  it("resolves EQU concentration via vars", () => {
    const vars = new Map([["CZR", 0.04273]]);
    const rho = computeMaterialMassDensityGcm3(
      { nuclides: [{ name: "ZR", density: "CZR" }] } as MatPick,
      vars
    );
    assert.ok(rho != null && rho > 6.3 && rho < 6.7);
  });

  it("returns null for invalid inputs", () => {
    assert.strictEqual(computeMaterialMassDensityGcm3({ nuclides: [] } as MatPick), null);
    assert.strictEqual(
      computeMaterialMassDensityGcm3({
        nuclides: [{ name: "U235", density: "bad" }],
      } as MatPick),
      null
    );
    assert.strictEqual(
      computeMaterialMassDensityGcm3({
        nuclides: baseNuclides,
        densParam: "DENSAA",
        densValue: undefined,
      } as MatPick),
      null
    );
    assert.strictEqual(
      computeMaterialMassDensityGcm3({
        nuclides: [{ name: "U235", density: "0" }],
        densParam: "DENSAA",
        densValue: 1,
      } as MatPick),
      null
    );
    assert.strictEqual(
      computeMaterialMassDensityGcm3({
        nuclides: baseNuclides,
        densParam: "UNKNOWN",
        densValue: 1,
      } as MatPick),
      null
    );
  });
});

describe("computeNuclideMassFractionInMaterial", () => {
  it("uses n·A share without DENSxx", () => {
    // U235:U238 = 1:3 by atoms → mass ≈ 235/(235+3*238)
    const frac = computeNuclideMassFractionInMaterial(
      {
        nuclides: [
          { name: "U235", density: "1.0E-2" },
          { name: "U238", density: "3.0E-2" },
        ],
      } as MatPick,
      "U235"
    );
    assert.ok(frac != null);
    const expect = 235 / (235 + 3 * 238);
    assert.ok(Math.abs(frac! - expect) < 1e-6, String(frac));
  });

  it("uses weight dens as-is for DENSAW", () => {
    const frac = computeNuclideMassFractionInMaterial(
      {
        nuclides: [
          { name: "U235", density: "0.25" },
          { name: "U238", density: "0.75" },
        ],
        densParam: "DENSAW",
        densValue: 10.5,
      } as MatPick,
      "U235"
    );
    assert.ok(frac != null);
    assert.ok(Math.abs(frac! - 0.25) < 1e-9, String(frac));
  });
});
