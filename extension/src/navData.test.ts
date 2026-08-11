import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { analyzeDocument } from "@mcuhelper/mcu-language";
import {
  buildNavTree,
  buildFragmentsTree,
  buildIncludeGraphSection,
  buildMaterialsTree,
  buildZonesTree,
  buildObjectsTree,
  buildConstantsTree,
  buildBodiesTree,
  buildNetsTree,
  buildLatticesTree,
  type IndexPayload,
  type NavTreeNode,
} from "./navData";

const fixtures = path.join(__dirname, "../../test/fixtures");
const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } };

function richPayload(): IndexPayload {
  return {
    fragments: [
      { id: "physical", startLine: 0, endLine: 5 },
      { id: "geometry", startLine: 6, endLine: 20 },
    ],
    statements: [
      { label: "PIN", text: "PIN 1 0", fragment: "physical", range },
      { label: "MATR", text: "MATR 1 fuel", fragment: "physical", range },
      { label: "U235", text: "U235 1.E-3", fragment: "physical", range },
      { label: "HEAD", text: "HEAD 1 0", fragment: "geometry", range },
      { label: "CONT", text: "CONT T T M M", fragment: "geometry", range },
      { label: "RCZ", text: "RCZ FU 0 0 0 10 1", fragment: "geometry", range },
      { label: "Z0", text: "Z0 FU :1", fragment: "geometry", range },
      { label: "T01", text: "T01 A B C", fragment: "geometry", range },
      { label: "END", text: "END", fragment: "geometry", range },
    ],
    summaries: {
      materials: [
        {
          number: 1,
          group: "fuel",
          temperature: 300,
          nuclideCount: 2,
          nuclidesPreview: "U235, H",
          massDensityGcm3: 10.5,
          volumeCm3: 100,
          massG: 1050,
          nuclides: [
            { name: "U235", concentration: "1.E-3", range },
            { name: "H", concentration: "1.E-2", range },
          ],
          range,
        },
        {
          number: 2,
          nuclideCount: 0,
          nuclidesPreview: "",
          massDensityGcm3: 0.001,
          volumeCm3: 1e-5,
          massG: 1e-8,
          nuclides: [],
          range,
        },
      ],
      zones: [
        { name: "FUEL", expression: "FU", materialNum: 1, regNum: 1, objNum: 1, range },
        { name: "Z0", expression: "C", materialNum: 2, regNum: 2, objNum: 1, range },
      ],
      objects: [{ objectNum: 1, zoneNames: ["FUEL", "Z0"], materialNums: [1, 2] }],
      constants: [
        { name: "R", expression: "10", value: 10, mutable: false, scope: "global", range },
        { name: "H", expression: "LN(2)", value: null, mutable: false, scope: "lcell:A", range },
        { name: "BIG", expression: "1E10", value: 1e10, mutable: true, scope: "cell:P", range },
      ],
      bodies: [
        {
          name: "FU",
          bodyType: "RCZ",
          paramsPreview: "0,0,0 100 1",
          volumeCm3: 314,
          scope: "global",
          range,
        },
        {
          name: "K",
          bodyType: "RCC",
          paramsPreview: "...",
          volumeCm3: null,
          scope: "lcell:A",
          transf: true,
          protoName: "BASE",
          range,
        },
        {
          name: "BOX",
          bodyType: "RPP",
          paramsPreview: "...",
          volumeCm3: 1e12,
          scope: "cell:PROT",
          range,
        },
      ],
      nets: [
        {
          name: "NET1",
          root: "0,0,0",
          cols: 2,
          rows: 2,
          layers: 3,
          typeMapRowCount: 2,
          cartogram: [
            { row: 1, label: "T01", prototypes: ["A", "B"] },
            { row: 2, label: "T02", prototypes: ["C", "D"] },
          ],
          carrierZones: [{ name: "HOST", range }],
          prototypes: [{ name: "A", range }, { name: "B" }],
          range,
        },
      ],
      lattices: [
        {
          latticeType: "GLTL",
          zoneNames: ["Z0"],
          elements: [{ name: "A", range }, { name: "B" }],
          positionsPreview: "/3 0,0,0",
          range,
        },
      ],
    },
    editorContext: { line: 5, character: 2, scope: "lcell:A" },
  };
}

function loadIndex(name: string) {
  const text = fs.readFileSync(path.join(fixtures, `${name}.mcu`), "utf8");
  const uri = `file:///fixtures/${name}.mcu`;
  const index = analyzeDocument(uri, text, 1);
  return { summaries: index.summaries, fragments: index.ast.fragments, statements: index.ast.statements, uri };
}

describe("navData", () => {
  const views = ["fragments", "materials", "zones", "objects", "constants", "bodies", "nets", "lattices"] as const;

  for (const viewId of views) {
    it(`buildNavTree for ${viewId}`, () => {
      const { summaries, uri } = loadIndex("full_variant");
      const tree = buildNavTree(viewId, { summaries } as IndexPayload, uri);
      assert.ok(Array.isArray(tree));
    });
  }

  it("materials tree has MATR nodes with group and badges", () => {
    const tree = buildMaterialsTree(richPayload(), "file:///t.mcu");
    assert.ok(tree[0]!.label.includes("fuel"));
    assert.ok(tree[0]!.badges?.length);
    assert.strictEqual(tree[0]!.children?.length, 2);
    assert.ok(tree[1]!.description?.includes("нукл."));
  });

  it("materials tree marks sum-isotope nuclides as muted", () => {
    const payload = richPayload();
    payload.summaries.materials[0]!.nuclides[0]!.sumIsotope = {
      reasons: ["входит в суммарный изотоп (указан в SI)"],
    };
    const tree = buildMaterialsTree(payload, "file:///t.mcu");
    const n0 = tree[0]!.children![0]!;
    assert.strictEqual(n0.muted, true);
    assert.ok(n0.tooltip?.includes("суммарный"));
    assert.strictEqual(tree[0]!.children![1]!.muted, false);
  });

  it("materials tree adds SI action for suggested nuclides", () => {
    const payload = richPayload();
    const n = payload.summaries.materials[0]!.nuclides[1]!;
    const key = `${n.range.start.line}:${n.name.toUpperCase()}`;
    const tree = buildMaterialsTree(payload, "file:///t.mcu", new Set([key]));
    const child = tree[0]!.children![1]!;
    assert.ok(child.action);
    assert.equal(child.action!.command, "mcuhelper.addToSumIsotope");
    assert.equal((child.action!.args as { nuclideName: string }).nuclideName, n.name);
  });

  it("fragments tree formats ranges and labels", () => {
    const tree = buildFragmentsTree(richPayload(), "file:///t.mcu");
    assert.strictEqual(tree.length, 2);
    assert.strictEqual(tree[0]!.label, "PIN");
    assert.ok(tree[0]!.description?.includes("строки 1-6"));
    assert.ok(tree[0]!.children?.some((c) => c.label === "MATR"));
    assert.ok(!tree[0]!.children?.some((c) => c.label === "U235"));
    assert.strictEqual(tree[1]!.label, "HEAD");
    assert.ok(tree[1]!.children?.some((c) => c.label === "HEAD"));
    assert.ok(!tree[1]!.children?.some((c) => c.label === "CONT"));
    assert.ok(!tree[1]!.children?.some((c) => c.label === "RCZ"));
    assert.ok(!tree[1]!.children?.some((c) => c.label === "Z0"));
    assert.ok(tree[1]!.children?.some((c) => c.label === "END"));
  });

  it("fragments tree inserts #include as leaf pointing to main directive", () => {
    const payload: IndexPayload = {
      fragments: [{ id: "physical", startLine: 0, endLine: 4 }],
      includes: [
        {
          path: "si.inc",
          exists: true,
          fragment: "physical",
          range: { start: { line: 1, character: 9 }, end: { line: 1, character: 15 } },
        },
      ],
      statements: [
        {
          label: "PIN",
          text: "PIN 0 0",
          fragment: "physical",
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
        },
        {
          label: "MATR",
          text: "MATR 1",
          fragment: "physical",
          range: { start: { line: 2, character: 0 }, end: { line: 2, character: 6 } },
        },
      ],
      summaries: {
        materials: [],
        zones: [],
        objects: [],
        constants: [],
        bodies: [],
        nets: [],
        lattices: [],
      },
    };
    const tree = buildFragmentsTree(payload, "file:///t.mcu");
    const kids = tree[0]!.children ?? [];
    assert.strictEqual(kids[0]!.label, "PIN");
    const inc = kids.find((c) => c.id.startsWith("include-"));
    assert.ok(inc);
    assert.strictEqual(inc!.label, "#include si.inc");
    assert.strictEqual(inc!.uri, "file:///t.mcu");
    assert.strictEqual(inc!.range?.start.line, 1);
    assert.ok(!inc!.children);
    assert.ok(kids.some((c) => c.label === "MATR"));
    const pinIdx = kids.findIndex((c) => c.label === "PIN");
    const incIdx = kids.findIndex((c) => c.id.startsWith("include-"));
    const matrIdx = kids.findIndex((c) => c.label === "MATR");
    assert.ok(pinIdx < incIdx && incIdx < matrIdx);
  });

  it("fragments tree prepends include graph section that opens include file", () => {
    const payload: IndexPayload = {
      fragments: [{ id: "physical", startLine: 0, endLine: 4 }],
      includes: [
        {
          path: "si.inc",
          exists: true,
          fragment: "physical",
          range: { start: { line: 1, character: 9 }, end: { line: 1, character: 15 } },
        },
      ],
      includeGraph: [
        {
          path: "si.inc",
          uri: "file:///si.inc",
          exists: true,
          encoding: "utf8",
          diagCount: 2,
          mainLine: 1,
        },
        {
          path: "gone.inc",
          exists: false,
          mainLine: 3,
        },
      ],
      statements: [
        {
          label: "PIN",
          text: "PIN 0 0",
          fragment: "physical",
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
        },
      ],
      summaries: {
        materials: [],
        zones: [],
        objects: [],
        constants: [],
        bodies: [],
        nets: [],
        lattices: [],
      },
    };
    const tree = buildFragmentsTree(payload, "file:///t.mcu");
    assert.strictEqual(tree[0]!.id, "include-graph");
    assert.strictEqual(tree[0]!.label, "#include");
    assert.strictEqual(tree[1]!.label, "PIN");

    const section = buildIncludeGraphSection(payload, "file:///t.mcu");
    assert.ok(section);
    assert.strictEqual(section!.children!.length, 2);
    const ok = section!.children![0]!;
    assert.strictEqual(ok.label, "si.inc");
    assert.strictEqual(ok.uri, "file:///si.inc");
    assert.strictEqual(ok.range?.start.line, 0);
    assert.ok(ok.description?.includes("utf8"));
    assert.ok(ok.description?.includes("2 диаг."));
    assert.ok(ok.badges?.includes("2"));

    const missing = section!.children![1]!;
    assert.strictEqual(missing.uri, "file:///t.mcu");
    assert.strictEqual(missing.range?.start.line, 3);
    assert.ok(missing.muted);
    assert.ok(missing.badges?.includes("missing"));
  });

  it("fragments tree marks missing include", () => {
    const payload: IndexPayload = {
      fragments: [{ id: "physical", startLine: 0, endLine: 2 }],
      includes: [
        {
          path: "missing.inc",
          exists: false,
          fragment: "physical",
          range: { start: { line: 1, character: 9 }, end: { line: 1, character: 20 } },
        },
      ],
      statements: [
        {
          label: "PIN",
          text: "PIN",
          fragment: "physical",
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        },
      ],
      summaries: {
        materials: [],
        zones: [],
        objects: [],
        constants: [],
        bodies: [],
        nets: [],
        lattices: [],
      },
    };
    const tree = buildFragmentsTree(payload, "file:///t.mcu");
    const inc = tree[0]!.children?.find((c) => c.id.startsWith("include-"));
    assert.ok(inc);
    assert.strictEqual(inc!.muted, true);
    assert.ok(inc!.badges?.includes("missing"));
    assert.ok(inc!.description?.includes("не найден"));
  });

  it("fragments keeps card when zone name collides (filter zone by range)", () => {
    const matrRange = { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } };
    const zoneRange = { start: { line: 9, character: 0 }, end: { line: 9, character: 10 } };
    const payload: IndexPayload = {
      fragments: [{ id: "physical", startLine: 0, endLine: 12 }],
      statements: [
        { label: "MATR", text: "MATR 1", fragment: "physical", range: matrRange },
        { label: "MATR", text: "MATR A :1", fragment: "physical", range: zoneRange },
      ],
      summaries: {
        materials: [],
        zones: [{ name: "MATR", expression: "A", materialNum: 1, regNum: 1, objNum: 1, range: zoneRange }],
        objects: [],
        constants: [],
        bodies: [],
        nets: [],
        lattices: [],
      },
    };
    const tree = buildFragmentsTree(payload, "file:///t.mcu");
    const kids = tree[0]!.children ?? [];
    assert.ok(kids.some((c) => c.label === "MATR" && c.range?.start.line === 1));
    assert.ok(!kids.some((c) => c.range?.start.line === 9));
  });

  it("zones and objects trees format registration", () => {
    const payload = richPayload();
    const zones = buildZonesTree(payload, "file:///t.mcu");
    assert.ok(zones[0]!.description?.includes("M1"));
    const objects = buildObjectsTree(payload, "file:///t.mcu");
    assert.ok(objects[0]!.children?.length === 2);
    assert.ok(objects[0]!.children?.[0]!.uri);
    assert.ok(objects[0]!.children?.[0]!.range);
  });

  it("objects tree prefers zone with matching objNum when names duplicate", () => {
    const r1 = { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } };
    const r2 = { start: { line: 9, character: 0 }, end: { line: 9, character: 5 } };
    const payload: IndexPayload = {
      summaries: {
        materials: [],
        zones: [
          { name: "Z", expression: "A", materialNum: 1, regNum: 1, objNum: 1, range: r1 },
          { name: "Z", expression: "B", materialNum: 2, regNum: 2, objNum: 2, range: r2 },
        ],
        objects: [
          { objectNum: 1, zoneNames: ["Z"], materialNums: [1] },
          { objectNum: 2, zoneNames: ["Z"], materialNums: [2] },
        ],
        constants: [],
        bodies: [],
        nets: [],
        lattices: [],
      },
    };
    const objects = buildObjectsTree(payload, "file:///t.mcu");
    assert.strictEqual(objects[0]!.children?.[0]!.range?.start.line, 1);
    assert.strictEqual(objects[1]!.children?.[0]!.range?.start.line, 9);
  });

  it("constants tree with editor context wraps header", () => {
    const payload = richPayload();
    const tree = buildConstantsTree(payload, "file:///t.mcu", payload.editorContext);
    assert.strictEqual(tree.length, 1);
    assert.ok(tree[0]!.label.includes("LCELL"));
    assert.ok(tree[0]!.children!.length >= 3);
    assert.ok(tree[0]!.children!.some((c) => c.description?.includes("ошибка")));
    assert.ok(tree[0]!.children!.some((c) => c.description?.includes("SET")));
  });

  it("bodies tree groups by scope", () => {
    const tree = buildBodiesTree(richPayload(), "file:///t.mcu");
    assert.ok(tree.some((n) => n.label === "Общие"));
    assert.ok(tree.some((n) => n.label.includes("LCELL")));
    assert.ok(tree.some((n) => n.label.includes("CELL")));
    const global = tree.find((n) => n.label === "Общие");
    assert.ok(global?.children?.[0]?.description?.includes("RCZ"));
    assert.ok(global?.children?.[0]?.description?.includes("см³"));
  });

  it("nets tree includes cartogram, prototypes, carriers", () => {
    const tree = buildNetsTree(richPayload(), "file:///t.mcu");
    assert.strictEqual(tree.length, 1);
    const children = tree[0]!.children ?? [];
    assert.ok(children.some((c) => c.label === "Картограмма"));
    assert.ok(children.some((c) => c.label === "Прототипы CELL"));
    assert.ok(children.some((c) => c.label === "Зоны-носители"));
    assert.ok(tree[0]!.description?.includes("×"));
  });

  it("lattices tree includes zones and LISTEL", () => {
    const tree = buildLatticesTree(richPayload(), "file:///t.mcu");
    assert.strictEqual(tree.length, 1);
    const children = tree[0]!.children ?? [];
    assert.ok(children.some((c) => c.label === "Зоны-носители"));
    assert.ok(children.some((c) => c.label === "LISTEL"));
  });

  it("buildNavTree default returns empty for unknown view", () => {
    const tree = buildNavTree("unknown" as import("./navData").NavViewId, richPayload(), "file:///t");
    assert.deepStrictEqual(tree, []);
  });
});
