import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { parseAwLib, setAwLibTable, clearAwLibTable } from "./awLib";
import {
  addImpurity,
  buildMatrCard,
  catalogCompositionWarning,
  clearNameTranslations,
  diffNameTranslations,
  displayName,
  draftFromCatalog,
  draftFromUserMaterial,
  draftFromVisibleMatr,
  draftToUserMaterial,
  emptyDraft,
  findMatrBlockEndLine,
  findMatrInsert,
  findVisibleMatrAtLine,
  findUserMaterial,
  formatUserCatalogJson,
  loadCatalogJson,
  loadNameTranslations,
  matrCommentTitle,
  parseUserCatalog,
  pnnlNuclideToIaea,
  pnnlNuclideToMcu,
  searchCatalog,
  slimMaterialsCompendium,
  syncDraftMassDensity,
  upsertUserMaterial,
  type SlimMaterial,
} from "./materialsCompendium";
import { computeMaterialMassDensityGcm3 } from "./materialDensity";

afterEach(() => {
  clearNameTranslations();
  clearAwLibTable();
});

const RAW = {
  siteVersion: "rev2-test",
  data: [
    {
      Name: "Water, Liquid",
      Formula: "H2O",
      Acronym: "H2O",
      Density: 0.997,
      MaterialAtomDensity: 0.1,
      Comment: ["CAS water"],
      Source: "PNNL",
      References: ["ref-water"],
      Contact: { Name: "x", Phone: "1", Email: "a@b.c" },
      MatNum: 1,
      MaterialWeight: "0",
      Mols: [{ Mols: 2, Element: "H", Isotope: "H1" }],
      Elements: [
        {
          Element: "H",
          ZAID: "1000",
          WeightFraction: 0.1119,
          WeightFraction_whole: 0.11190001,
          AtomFraction: 0.666,
          Isotopes: [
            {
              Isotope: "H1",
              ZAID: "1001",
              WeightFraction: 0.1118,
              AtomFraction: 0.665,
              IsotopicAtomDensity: 0.0667,
              WeightFraction_whole: 0.11180001,
            },
            {
              Isotope: "H2",
              ZAID: "1002",
              WeightFraction: 0.0001,
              AtomFraction: 0.001,
              IsotopicAtomDensity: 0.00001,
            },
          ],
        },
        {
          Element: "O",
          ZAID: "8000",
          WeightFraction: 0.8881,
          AtomFraction: 0.334,
          Isotopes: [
            {
              Isotope: "O16",
              ZAID: "8016",
              WeightFraction: 0.8881,
              AtomFraction: 0.334,
              IsotopicAtomDensity: 0.0333,
            },
          ],
        },
      ],
    },
    {
      Name: "Uranium Dioxide",
      Formula: "UO2",
      Acronym: null,
      Density: 10.96,
      MaterialAtomDensity: 0.07,
      Comment: ["Uranium isotopics assumed for LEU: Wt% U234/235/236/238 = 0.0267/3.0/0.0138/96.9595."],
      Source: "BNL",
      References: [],
      Elements: [
        {
          Element: "U",
          ZAID: "92000",
          WeightFraction: 0.8815,
          AtomFraction: 0.333,
          Isotopes: [
            {
              Isotope: "U235",
              ZAID: "92235",
              WeightFraction: 0.026,
              AtomFraction: 0.01,
              IsotopicAtomDensity: 0.0007,
            },
          ],
        },
        {
          Element: "O",
          ZAID: "8000",
          WeightFraction: 0.1185,
          AtomFraction: 0.667,
          Isotopes: [
            {
              Isotope: "O16",
              ZAID: "8016",
              WeightFraction: 0.1185,
              AtomFraction: 0.667,
              IsotopicAtomDensity: 0.046,
            },
          ],
        },
      ],
    },
    {
      Name: "Stainless Steel, Type 304",
      Formula: null,
      Acronym: ["SS304"],
      Density: 8.0,
      MaterialAtomDensity: 0.086,
      Comment: ["austenitic steel with Fe Cr Ni"],
      Source: "PNNL",
      References: [],
      Elements: [
        { Element: "Fe", ZAID: "26000", WeightFraction: 0.70, AtomFraction: 0.69, Isotopes: [] },
        { Element: "Cr", ZAID: "24000", WeightFraction: 0.19, AtomFraction: 0.20, Isotopes: [] },
        { Element: "Ni", ZAID: "28000", WeightFraction: 0.09, AtomFraction: 0.09, Isotopes: [] },
        { Element: "Mn", ZAID: "25000", WeightFraction: 0.02, AtomFraction: 0.02, Isotopes: [] },
      ],
    },
  ],
};

function steel(): SlimMaterial {
  return slimMaterialsCompendium(RAW).materials.find((m) => m.name.startsWith("Stainless"))!;
}

describe("materialsCompendium slim", () => {
  it("drops Contact / *_whole / MatNum / Mols and keeps Comment", () => {
    const cat = slimMaterialsCompendium(RAW, { sourceSha: "abc" });
    assert.equal(cat.materialCount, 3);
    assert.equal(cat.siteVersion, "rev2-test");
    assert.equal(cat.sourceSha, "abc");
    const water = cat.materials[0]!;
    assert.equal(water.name, "Water, Liquid");
    assert.deepEqual(water.comment, ["CAS water"]);
    assert.equal(water.formula, "H2O");
    const dumped = JSON.stringify(water);
    assert.ok(!dumped.includes("Contact"));
    assert.ok(!dumped.includes("WeightFraction_whole"));
    assert.ok(!dumped.includes("MatNum"));
    assert.ok(!dumped.includes("Mols"));
    assert.ok(!("Contact" in water));
  });

  it("loadCatalogJson accepts already-slim catalog", () => {
    const slim = slimMaterialsCompendium(RAW);
    const again = loadCatalogJson(slim);
    assert.equal(again.materialCount, 3);
    assert.equal(again.materials[0]!.name, "Water, Liquid");
  });
});

describe("materialsCompendium translations", () => {
  it("overlays Russian name and falls back to original", () => {
    loadNameTranslations({ "Water, Liquid": "Вода, жидкая" });
    assert.equal(displayName("Water, Liquid"), "Вода, жидкая");
    assert.equal(displayName("Uranium Dioxide"), "Uranium Dioxide");
  });

  it("diff reports missing and orphan without mutating dict", () => {
    const dict = { "Water, Liquid": "Вода, жидкая", Ghost: "Призрак" };
    const d = diffNameTranslations(["Water, Liquid", "Uranium Dioxide"], dict);
    assert.deepEqual(d.missing, ["Uranium Dioxide"]);
    assert.deepEqual(d.orphan, ["Ghost"]);
  });
});

describe("materialsCompendium search", () => {
  it("matches original name, translation, comment and nuclides AND", () => {
    const cat = slimMaterialsCompendium(RAW);
    loadNameTranslations({ "Water, Liquid": "Вода, жидкая" });
    assert.equal(searchCatalog(cat, "вода").length, 1);
    assert.equal(searchCatalog(cat, "Water").length, 1);
    assert.equal(searchCatalog(cat, "CAS water").length, 1);
    assert.equal(searchCatalog(cat, "U235").length, 1);
    const steelHits = searchCatalog(cat, "Fe Cr Ni");
    assert.equal(steelHits.length, 1);
    assert.equal(steelHits[0]!.name, "Stainless Steel, Type 304");
    assert.equal(searchCatalog(cat, "Fe U235").length, 0);
  });
});

describe("materialsCompendium draft / MATR", () => {
  it("DENSWA card uses weight fractions and display name comment", () => {
    loadNameTranslations({ "Water, Liquid": "Вода, жидкая" });
    const water = slimMaterialsCompendium(RAW).materials[0]!;
    const draft = draftFromCatalog(water, "denswa", 3);
    const { text } = buildMatrCard(draft);
    assert.match(text, /^\*\* Вода, жидкая/m);
    assert.match(text, /MATR 3 NAME=MCU DENSWA=0\.997/);
    assert.match(text, /^H 0\.1119/m);
    assert.match(text, /^O 0\.8881/m);
  });

  it("isotope mode uses isotopic atom densities", () => {
    const water = slimMaterialsCompendium(RAW).materials[0]!;
    const draft = draftFromCatalog(water, "isotope", 1);
    const { text } = buildMatrCard(draft);
    assert.match(text, /^MATR 1 NAME=MCU$/m);
    assert.match(text, /^H1 /m);
    assert.match(text, /^O16 /m);
    assert.ok(!text.includes("DENSWA"));
  });

  it("renormalizes weight fractions when adding impurity", () => {
    const draft = draftFromCatalog(steel(), "denswa", 1);
    const withB = addImpurity(draft, "B", 1);
    const boron = withB.nuclides.find((n) => n.name === "B");
    assert.ok(boron);
    assert.equal(boron!.impurity, true);
    assert.ok(Math.abs(boron!.value - 0.01) < 1e-12);
    const fe = withB.nuclides.find((n) => n.name === "FE" || n.name === "Fe")!;
    assert.ok(Math.abs(fe.value - 0.7 * 0.99) < 1e-12);
    const sum = withB.nuclides.reduce((s, n) => s + n.value, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });

  it("warns on LEU isotopics", () => {
    const uo2 = slimMaterialsCompendium(RAW).materials[1]!;
    const w = catalogCompositionWarning(uo2);
    assert.ok(w && /LEU/i.test(w));
  });
});

describe("pnnlNuclideToMcu", () => {
  it("maps H1 / Ca40 without AW.LIB", () => {
    assert.equal(pnnlNuclideToIaea("H1"), "H-1");
    assert.equal(pnnlNuclideToIaea("Ca40"), "Ca-40");
    assert.equal(pnnlNuclideToMcu("H1").mcuName, "H1");
    assert.equal(pnnlNuclideToMcu("Fe").mcuName, "FE");
  });

  it("drops hundreds from 5-character isotope names (SN112→SN12)", () => {
    assert.equal(pnnlNuclideToMcu("SN112").mcuName, "SN12");
    assert.equal(pnnlNuclideToMcu("Sn114").mcuName, "SN14");
    assert.equal(pnnlNuclideToMcu("Cs133").mcuName, "CS33");
    assert.equal(pnnlNuclideToMcu("Pu239").mcuName, "PU39");
    assert.equal(pnnlNuclideToMcu("U235").mcuName, "U235");
    assert.equal(pnnlNuclideToMcu("O16").mcuName, "O16");
    assert.equal(pnnlNuclideToMcu("Ca40").mcuName, "CA40");
  });

  it("uses AW.LIB CS33 for Cs-133", () => {
    setAwLibTable(parseAwLib("CS33  55133  132.9\nCS  55000  132.9\n"));
    assert.equal(pnnlNuclideToMcu("Cs133").mcuName, "CS33");
    assert.equal(pnnlNuclideToMcu("Cs133").inAwLib, true);
  });
});

describe("user catalog", () => {
  it("round-trips a draft and replaces by name case-insensitively", () => {
    const water = slimMaterialsCompendium(RAW).materials[0]!;
    const draft = draftFromCatalog(water, "denswa", 2);
    const rec = draftToUserMaterial(draft, "Моя вода");
    assert.equal(rec.name, "Моя вода");
    assert.equal(rec.mode, "denswa");
    assert.ok(rec.nuclides.some((n) => n.name === "H"));
    const restored = draftFromUserMaterial(rec, 4);
    assert.equal(restored.number, 4);
    assert.equal(restored.sourceName, "Моя вода");
    assert.equal(restored.densityGcm3, draft.densityGcm3);
    assert.match(restored.comment ?? "", /из Water, Liquid/);

    const empty = parseUserCatalog(null);
    const once = upsertUserMaterial(empty, rec);
    const twice = upsertUserMaterial(once, { ...rec, name: "моя вода", density: 1.2 });
    assert.equal(twice.materials.length, 1);
    assert.equal(twice.materials[0]!.density, 1.2);
    assert.equal(findUserMaterial(twice, "МОЯ ВОДА")?.name, "моя вода");
  });

  it("skips broken rows and empty names", () => {
    const parsed = parseUserCatalog({
      materials: [
        { name: "", nuclides: [{ name: "H", value: 1 }] },
        { name: "ok", nuclides: [{ name: "FE", value: 0.7 }] },
        { name: "bad", nuclides: [{ name: "X", value: 0 }] },
      ],
    });
    assert.equal(parsed.materials.length, 1);
    assert.equal(parsed.materials[0]!.name, "ok");
    assert.throws(() => draftToUserMaterial(emptyDraft(1), "Пусто"));
    assert.throws(() => draftToUserMaterial(draftFromCatalog(slimMaterialsCompendium(RAW).materials[0]!, "denswa"), "  "));
  });

  it("writes hand-editable JSON with one nuclide per line", () => {
    const water = slimMaterialsCompendium(RAW).materials[0]!;
    const rec = draftToUserMaterial(draftFromCatalog(water, "denswa"), "Моя вода");
    rec.nuclides.push({ name: "B", value: 0.01, impurity: true });
    const text = formatUserCatalogJson(upsertUserMaterial(parseUserCatalog(null), rec));
    assert.match(text, /"name": "Моя вода"/);
    assert.match(text, /^\s+\{ "name": "H", "value": /m);
    assert.match(text, /"impurity": true/);
    assert.ok(!text.includes('"temperature": null'));
    const back = parseUserCatalog(JSON.parse(text));
    assert.equal(back.materials[0]!.name, "Моя вода");
    assert.ok(back.materials[0]!.nuclides.some((n) => n.name === "B" && n.impurity));
  });

  it("keeps a user comment through save, JSON and MATR preview", () => {
    const water = slimMaterialsCompendium(RAW).materials[0]!;
    const draft = { ...draftFromCatalog(water, "denswa", 1), comment: "для ВВЭР\nсталь корпуса" };
    const rec = draftToUserMaterial(draft, "Моя вода");
    assert.ok(rec.comment?.includes("для ВВЭР"));
    assert.ok(rec.comment?.includes("сталь корпуса"));
    const text = formatUserCatalogJson(upsertUserMaterial(parseUserCatalog(null), rec));
    assert.match(text, /"comment": \[/);
    assert.match(text, /"для ВВЭР"/);
    const parsed = parseUserCatalog(JSON.parse(text));
    const again = draftFromUserMaterial(parsed.materials[0]!, 1);
    assert.equal(again.comment, "для ВВЭР\nсталь корпуса\nиз Water, Liquid");
    const card = buildMatrCard(again);
    assert.match(card.text, /^\*\* для ВВЭР/m);
    assert.match(card.text, /^\*\* сталь корпуса/m);
  });
});

describe("findMatrInsert", () => {
  it("inserts after last MATR before FINISH with last number + 1", () => {
    const text = ["PIN 1 0", "TEMPR 300.", "MATR 1", "U235 1e-3", "MATR 2", "H 0.1", "FINISH"].join("\n");
    const hint = findMatrInsert(text);
    assert.equal(hint.nextNumber, 3);
    assert.equal(hint.line, 6);
  });

  it("increments the last MATR number, not the count of cards", () => {
    const text = ["PIN", "MATR 1", "H 1", "MATR 5", "Fe 1", "FINISH"].join("\n");
    assert.equal(findMatrInsert(text).nextNumber, 6);
  });

  it("finds block end including nuclides", () => {
    const text = ["MATR 1", "U235 1", "H 0.1", "FINISH"].join("\n");
    assert.equal(findMatrBlockEndLine(text, 0), 2);
  });

  it("reads visible MATR at cursor including ** title and impurity", () => {
    const text = [
      "PIN",
      "** Вода",
      "MATR 2 NAME=MCU T=300 DENSWA=0.997",
      "H 0.1119",
      "O 0.8881",
      "B 0.01  ; примесь",
      "MATR 5",
      "FE 1",
      "FINISH",
    ].join("\n");
    assert.equal(findVisibleMatrAtLine(text, 1)?.number, 2);
    assert.equal(findVisibleMatrAtLine(text, 4)?.number, 2);
    assert.equal(findVisibleMatrAtLine(text, 7)?.number, 5);
    const d = draftFromVisibleMatr(text, 4);
    assert.ok(d);
    assert.equal(d!.sourceName, "Вода");
    assert.equal(d!.mode, "denswa");
    assert.equal(d!.densityGcm3, 0.997);
    assert.equal(d!.temperature, 300);
    assert.equal(d!.nuclides.length, 3);
    assert.equal(d!.nuclides[2]!.impurity, true);
  });

  it("fills ρ from nuclear dens when MATR has no DENSxx (same as hover)", () => {
    const text = ["PIN", "MATR 1", "ZR 0.04273", "FINISH"].join("\n");
    const d = draftFromVisibleMatr(text, 1);
    assert.ok(d);
    assert.equal(d!.mode, "isotope");
    assert.ok(d!.densityGcm3 > 6.3 && d!.densityGcm3 < 6.7, `rho=${d!.densityGcm3}`);
  });

  it("reads DENSWA from a line after the MATR header", () => {
    const text = ["PIN", "MATR 4 NAME=MCU", "DENSWA=7.85", "FE 1", "FINISH"].join("\n");
    const d = draftFromVisibleMatr(text, 2);
    assert.ok(d);
    assert.equal(d!.mode, "denswa");
    assert.equal(d!.densityGcm3, 7.85);
    assert.equal(d!.nuclides[0]!.name.toUpperCase(), "FE");
  });

  it("keeps MCU names from the card and ρ via AW.LIB (AG07 stays AG07)", () => {
    setAwLibTable(parseAwLib("AG07  47107  106.905093\nCS33  55133  132.9054519\n"));
    const text = ["PIN", "MATR 1", "AG07 1.2898E-6", "CS33 1.0E-4", "FINISH"].join("\n");
    const d = draftFromVisibleMatr(text, 1);
    assert.ok(d);
    assert.equal(d!.nuclides[0]!.name, "AG07");
    assert.equal(d!.nuclides[1]!.name, "CS33");
    const expected = computeMaterialMassDensityGcm3({
      nuclides: [
        { name: "AG07", density: "1.2898E-6" },
        { name: "CS33", density: "1.0E-4" },
      ],
    } as Parameters<typeof computeMaterialMassDensityGcm3>[0]);
    assert.ok(expected != null && expected > 0);
    assert.ok(Math.abs(d!.densityGcm3 - Number(expected.toPrecision(6))) < 1e-12);
  });

  it("ignores decorative ** separator as MATR title", () => {
    assert.equal(matrCommentTitle("** ----------------------"), undefined);
    assert.equal(matrCommentTitle("** Вода"), "Вода");
    const text = ["PIN", "** ----------------------", "MATR 1", "U235 1e-2", "FINISH"].join("\n");
    const d = draftFromVisibleMatr(text, 2);
    assert.ok(d);
    assert.equal(d!.sourceName, undefined);
  });

  it("syncDraftMassDensity updates ρ in isotope mode, leaves DENSWA alone", () => {
    setAwLibTable(parseAwLib("U235  92235  235.0439299\n"));
    const iso = emptyDraft(1);
    iso.mode = "isotope";
    iso.nuclides = [{ name: "U235", value: 1e-2 }];
    const before = iso.densityGcm3;
    syncDraftMassDensity(iso);
    assert.ok(iso.densityGcm3 !== before);
    assert.ok(iso.densityGcm3 > 3, `rho=${iso.densityGcm3}`);

    const wa = emptyDraft(1);
    wa.mode = "denswa";
    wa.densityGcm3 = 7.85;
    wa.nuclides = [{ name: "FE", value: 1 }];
    syncDraftMassDensity(wa);
    assert.equal(wa.densityGcm3, 7.85);
  });
});
