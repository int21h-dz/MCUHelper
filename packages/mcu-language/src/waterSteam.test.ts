import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATM_MPA,
  DEFAULT_WATER_T_K,
  buildSaturationCurve,
  defaultAmbientState,
  formatMcuNuclearDens,
  initialStateFromMaterial,
  materialHasHO,
  nuclearHOFromMassDensity,
  pressureFromMPa,
  pressureToMPa,
  psatAtT,
  stateFromPT,
  stateFromPsat,
  stateFromPRho,
  stateFromTRho,
  waterElementFamily,
  massDensityGcm3FromHONuclides,
  extractWaterComponentFromNuclides,
  WATER_DENSITY_MIXTURE_FOOTNOTE,
} from "./waterSteam";

describe("waterSteam", () => {
  it("nuclearHOFromMassDensity: n_H = 2 n_O, ~1 g/cm³", () => {
    const { nH, nO } = nuclearHOFromMassDensity(1);
    assert.ok(nO > 0.033 && nO < 0.034);
    assert.ok(Math.abs(nH - 2 * nO) < 1e-12);
  });

  it("massDensityGcm3FromHONuclides: pure H2O", () => {
    const rho = massDensityGcm3FromHONuclides([
      { name: "H", concentration: "0.06674" },
      { name: "O", concentration: "0.03337" },
    ]);
    assert.ok(rho != null && rho > 0.9 && rho < 1.1, `rho=${rho}`);
  });

  it("massDensityGcm3FromHONuclides ignores non-water isotopes without U", () => {
    const pure = massDensityGcm3FromHONuclides([
      { name: "H", concentration: "0.06674" },
      { name: "O", concentration: "0.03337" },
    ]);
    const withC = massDensityGcm3FromHONuclides([
      { name: "H", concentration: "0.06674" },
      { name: "O", concentration: "0.03337" },
      { name: "C", concentration: "0.02" },
      { name: "ZR", concentration: "0.04" },
    ]);
    assert.ok(pure != null && withC != null && Math.abs(withC - pure!) < 1e-12);
  });

  it("extractWaterComponentFromNuclides: H2O formula only (ignores U, oxides)", () => {
    const ex = extractWaterComponentFromNuclides([
      { name: "O", concentration: "2.0003E-02" },
      { name: "H", concentration: "5.9747E-01" },
      { name: "U235", concentration: "2.2020E-05" },
      { name: "U238", concentration: "5.5041E-04" },
      { name: "C", concentration: "2.6279E-02" },
    ]);
    assert.ok(ex != null, "extract");
    assert.ok(Math.abs(ex!.nO - ex!.nOTotal) < 1e-15, "O-limited: all O in H2O");
    assert.ok(Math.abs(ex!.nH - 2 * ex!.nO) < 1e-15);
    assert.ok(ex!.rhoGcm3 > 0.55 && ex!.rhoGcm3 < 0.65, `rho=${ex!.rhoGcm3}`);
    assert.ok(ex!.warning && ex!.warning.includes("избыток H"), ex!.warning);
  });

  it("defaultAmbientState: T=313 K, P=1 atm, rho≈0.99", () => {
    const s = defaultAmbientState();
    assert.equal(s.T, DEFAULT_WATER_T_K);
    assert.ok(Math.abs(s.P - ATM_MPA) < 1e-9);
    assert.ok(s.rho > 0.98 && s.rho < 1.0);
    assert.ok(Math.abs(s.nH - 2 * s.nO) < 1e-9);
  });

  it("stateFromPT matches default ambient", () => {
    const s = stateFromPT(ATM_MPA, 313);
    assert.ok(s.rho > 0.98 && s.rho < 1.0);
  });

  it("psatAtT near 100 °C ≈ 0.101 MPa", () => {
    const sat = psatAtT(373.15);
    assert.ok(Math.abs(sat.P - 0.101325) < 0.002);
    assert.ok(sat.rhoF > 0.9);
    assert.ok(sat.rhoG < 0.01);
  });

  it("initialStateFromMaterial solves P from T+ρ (not force Psat)", () => {
    const sat = psatAtT(293);
    const s = initialStateFromMaterial({ T: 293, rho: sat.rhoF * 1.002 });
    assert.equal(s.T, 293);
    assert.ok(s.P > sat.P * 1.5, `expected compressed P>${sat.P}, got ${s.P}`);
    assert.ok(Math.abs(s.rho - sat.rhoF * 1.002) < 1e-9);
    assert.equal(s.phase, "liquid");
  });

  it("initialStateFromMaterial near sat liquid keeps P≈Psat", () => {
    const s = initialStateFromMaterial({ T: 373.15, rho: 0.958 });
    assert.equal(s.T, 373.15);
    assert.ok(Math.abs(s.P - 0.101325) < 0.002);
    assert.ok(Math.abs(s.rho - 0.958) < 1e-9);
  });

  it("stateFromTRho warns when rho is beyond IF97 liquid", () => {
    const s = stateFromTRho(293, 2.28);
    assert.ok(s.P >= 99, `P=${s.P}`);
    assert.ok(s.warning && s.warning.includes("недостижима"), s.warning);
  });

  it("materialHasHO / waterElementFamily", () => {
    assert.equal(waterElementFamily("H"), "H");
    assert.equal(waterElementFamily("H1"), "H");
    assert.equal(waterElementFamily("D"), "H");
    assert.equal(waterElementFamily("O16"), "O");
    assert.equal(waterElementFamily("U235"), null);
    assert.equal(materialHasHO(["H", "O"]), true);
    assert.equal(materialHasHO(["H1", "O16"]), true);
    assert.equal(materialHasHO(["H", "U"]), false);
  });

  it("buildSaturationCurve returns rising P with T", () => {
    const curve = buildSaturationCurve({ steps: 20 });
    assert.ok(curve.length > 10);
    assert.ok(curve[curve.length - 1]!.P > curve[0]!.P);
  });

  it("formatMcuNuclearDens", () => {
    assert.match(formatMcuNuclearDens(0.066714), /^0\.06671/);
    assert.ok(formatMcuNuclearDens(1e-8).includes("E"));
  });

  it("stateFromTRho sets Psat and dens from rho", () => {
    const s = stateFromTRho(373.15, 0.958);
    assert.ok(Math.abs(s.P - 0.101325) < 0.002);
    assert.ok(Math.abs(s.nH - 2 * s.nO) < 1e-9);
  });

  it("stateFromTRho recovers P≈1 atm from T=313 and IF97 liquid rho", () => {
    const a = stateFromPT(ATM_MPA, 313);
    const b = stateFromTRho(a.T, a.rho);
    assert.ok(Math.abs(b.P - ATM_MPA) / ATM_MPA < 0.02, `P=${b.P}`);
    assert.ok(Math.abs(b.rho - a.rho) < 1e-9);
  });

  it("stateFromPT at 313 K / 1 atm gives liquid rho≈0.992", () => {
    const s = stateFromPT(ATM_MPA, 313);
    assert.ok(Math.abs(s.P - ATM_MPA) < 1e-9);
    assert.ok(s.rho > 0.98 && s.rho < 1.0);
    assert.equal(s.phase, "liquid");
  });

  it("stateFromPRho recovers T≈313 from P=1 atm and liquid rho", () => {
    const a = stateFromPT(ATM_MPA, 313);
    const b = stateFromPRho(a.P, a.rho);
    assert.ok(Math.abs(b.T - 313) < 0.5, `T=${b.T}`);
  });

  it("pressure unit conversions round-trip", () => {
    assert.ok(Math.abs(pressureToMPa(1, "atm") - ATM_MPA) < 1e-12);
    assert.ok(Math.abs(pressureFromMPa(ATM_MPA, "Pa") - 101325) < 1e-6);
    assert.ok(Math.abs(pressureToMPa(101325, "Pa") - ATM_MPA) < 1e-12);
  });

  it("stateFromPsat / satAtP near 1 atm", () => {
    const s = stateFromPsat(ATM_MPA, { phase: "liquid" });
    assert.ok(s.T > 370 && s.T < 375);
    assert.ok(s.rho > 0.9);
  });
});
