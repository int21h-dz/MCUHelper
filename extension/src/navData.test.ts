import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import { analyzeDocument } from "@mcuhelper/mcu-language";
import {
  buildNavTree,
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
  return { summaries: index.summaries, uri };
}

describe("navData", () => {
  const views = ["materials", "zones", "objects", "constants", "bodies", "nets", "lattices"] as const;

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

  it("zones and objects trees format registration", () => {
    const payload = richPayload();
    const zones = buildZonesTree(payload, "file:///t.mcu");
    assert.ok(zones[0]!.description?.includes("M1"));
    const objects = buildObjectsTree(payload);
    assert.ok(objects[0]!.children?.length === 2);
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
