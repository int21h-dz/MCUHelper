import { describe, it } from "node:test";
import assert from "node:assert";
import {
  MESH_PREVIEW_BODY_CAP,
  bodyToMeshDescriptor,
  buildMeshPreview,
  isMeshPreviewSupported,
  isMeshPreviewUnsupported,
  selectNearbyBodies,
  buildDraftBodyPreview,
  bboxFromBodyParams,
  firstContainerIndex,
  isNeighborExcluded,
  DRAFT_BODY_COLOR,
  applyTransfToBodyParams,
  transfPoint,
} from "./meshPreview";
import type { GeometryScene, PrimitiveSolid } from "./types";

function prim(
  type: string,
  name: string,
  params: number[],
  bbox?: PrimitiveSolid["bbox"]
): PrimitiveSolid {
  const b =
    bbox ??
    ({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 1, y: 1, z: 1 },
    } as const);
  return { type, name, params, bbox: b };
}

describe("meshPreview", () => {
  it("marks ARB/QUAD as unsupported", () => {
    assert.ok(isMeshPreviewUnsupported("ARB"));
    assert.ok(isMeshPreviewUnsupported("QUAD"));
    assert.ok(isMeshPreviewSupported("RPP"));
    assert.ok(isMeshPreviewSupported("SPH"));
  });

  it("maps RPP to box center/size", () => {
    const body = prim("RPP", "B1", [0, 2, -1, 1, 0, 4], {
      min: { x: 0, y: -1, z: 0 },
      max: { x: 2, y: 1, z: 4 },
    });
    const m = bodyToMeshDescriptor(body);
    assert.ok(m);
    assert.strictEqual(m!.kind, "box");
    assert.strictEqual(m!.center.x, 1);
    assert.strictEqual(m!.center.y, 0);
    assert.strictEqual(m!.center.z, 2);
    assert.deepStrictEqual(m!.size, { x: 2, y: 2, z: 4 });
  });

  it("maps SPH and RCZ", () => {
    const sph = bodyToMeshDescriptor(prim("SPH", "S", [1, 2, 3, 0.5]));
    assert.ok(sph);
    assert.strictEqual(sph!.kind, "sphere");
    assert.strictEqual(sph!.radius, 0.5);

    const rcz = bodyToMeshDescriptor(prim("RCZ", "C", [0, 0, 0, 10, 1]));
    assert.ok(rcz);
    assert.strictEqual(rcz!.kind, "cylinder");
    assert.strictEqual(rcz!.height, 10);
    assert.strictEqual(rcz!.center.z, 5);
  });

  it("maps BOX to orientedBox with edges", () => {
    const m = bodyToMeshDescriptor(
      prim("BOX", "O", [0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4])
    );
    assert.ok(m);
    assert.strictEqual(m!.kind, "orientedBox");
    assert.deepStrictEqual(m!.size, { x: 2, y: 3, z: 4 });
    assert.ok(m!.edges);
    assert.strictEqual(m!.center.x, 1);
  });

  it("buildMeshPreview lists unsupported and builds meshes", () => {
    const scene = {
      primitives: [
        prim("RPP", "A", [0, 1, 0, 1, 0, 1], {
          min: { x: 0, y: 0, z: 0 },
          max: { x: 1, y: 1, z: 1 },
        }),
        prim("ARB", "Poly", [0, 0, 0]),
        prim("QUAD", "Q1", [1, 0, 0, 0, 1, 0, 0, 0, 1, -1]),
      ],
      bbox: { min: { x: -5, y: -5, z: -5 }, max: { x: 5, y: 5, z: 5 } },
    } as Pick<GeometryScene, "primitives" | "bbox">;

    const prev = buildMeshPreview(scene);
    assert.strictEqual(prev.meshes.length, 1);
    assert.strictEqual(prev.meshes[0].name, "A");
    assert.strictEqual(prev.unsupported.length, 2);
    assert.ok(prev.unsupported.every((u) => u.reason === "не в 3D"));
    assert.strictEqual(prev.totalBodies, 3);
    assert.strictEqual(prev.detailSkipped, false);
  });

  it("skipDetail and bodyCap", () => {
    const many: PrimitiveSolid[] = [];
    for (let i = 0; i < 3; i++) {
      many.push(
        prim("RPP", "B" + i, [0, 1, 0, 1, 0, 1], {
          min: { x: 0, y: 0, z: 0 },
          max: { x: 1, y: 1, z: 1 },
        })
      );
    }
    const scene = {
      primitives: many,
      bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    };

    const capped = buildMeshPreview(scene, { bodyCap: 2 });
    assert.strictEqual(capped.meshes.length, 2);
    assert.strictEqual(capped.detailSkipped, true);
    assert.strictEqual(capped.bodyCap, 2);

    const skipped = buildMeshPreview(scene, { skipDetail: true });
    assert.strictEqual(skipped.meshes.length, 0);
    assert.strictEqual(skipped.detailSkipped, true);
    assert.strictEqual(MESH_PREVIEW_BODY_CAP, 500);
  });

  it("maps PLX plane using scene bbox", () => {
    const body = prim("PLX", "PX", [2]);
    const m = bodyToMeshDescriptor(body, {
      min: { x: -10, y: -5, z: 0 },
      max: { x: 10, y: 5, z: 20 },
    });
    assert.ok(m);
    assert.strictEqual(m!.kind, "plane");
    assert.strictEqual(m!.center.x, 2);
    assert.deepStrictEqual(m!.normal, { x: 1, y: 0, z: 0 });
  });

  it("selectNearbyBodies keeps only close bodies", () => {
    const focus = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    const near = prim("SPH", "near", [0.5, 0.5, 0.5, 0.2], {
      min: { x: 0.3, y: 0.3, z: 0.3 },
      max: { x: 0.7, y: 0.7, z: 0.7 },
    });
    const far = prim("SPH", "far", [100, 0, 0, 1], {
      min: { x: 99, y: -1, z: -1 },
      max: { x: 101, y: 1, z: 1 },
    });
    const picked = selectNearbyBodies(focus, [near, far], { maxCount: 5, maxGapFactor: 4 });
    assert.deepStrictEqual(
      picked.map((p) => p.name),
      ["near"]
    );
  });

  it("skips section container as nearest and keeps camera on locals", () => {
    const container = prim("HEX", "C", [0, 0, 0, 20, 0, 100], {
      min: { x: -20, y: -20, z: 0 },
      max: { x: 20, y: 20, z: 100 },
    });
    const fuel = prim("RCZ", "FU", [0, 0, 0, 100, 0.5], {
      min: { x: -0.5, y: -0.5, z: 0 },
      max: { x: 0.5, y: 0.5, z: 100 },
    });
    const prev = buildDraftBodyPreview({
      bodyType: "RCZ",
      name: "newz",
      params: [2, 0, 0, 100, 0.4],
      scenePrimitives: [container, fuel],
      nearby: { maxCount: 8, maxGapFactor: 20 },
    });
    assert.ok(prev.nearest);
    assert.strictEqual(prev.nearest!.name, "FU");
    assert.ok(!prev.neighborNames.includes("C"));
    assert.ok(prev.bbox);
    assert.ok(prev.bbox!.max.x < 15);
  });

  it("buildDraftBodyPreview honors slicePositions", () => {
    const prev = buildDraftBodyPreview({
      bodyType: "RPP",
      name: "box",
      params: [-1, 1, -2, 2, -3, 3],
      scenePrimitives: [],
      slicePositions: { x: 0.5, y: -1, z: 2 },
    });
    assert.ok(prev.focusBbox);
    const byAxis = Object.fromEntries(prev.slices.map((s) => [s.axis, s.position]));
    assert.strictEqual(byAxis.x, 0.5);
    assert.strictEqual(byAxis.y, -1);
    assert.strictEqual(byAxis.z, 2);
  });

  it("buildDraftBodyPreview colors draft and neighbors", () => {
    const neighbor = prim("RPP", "box1", [-2, -1, -2, -1, 0, 1], {
      min: { x: -2, y: -2, z: 0 },
      max: { x: -1, y: -1, z: 1 },
    });
    const prev = buildDraftBodyPreview({
      bodyType: "SPH",
      name: "ball",
      params: [0, 0, 0.5, 0.5],
      scenePrimitives: [neighbor],
      nearby: { maxCount: 8, maxGapFactor: 20 },
    });
    assert.ok(prev.meshes.length >= 1);
    assert.strictEqual(prev.focusName, "ball");
    assert.ok(prev.neighborNames.includes("box1"));
    assert.ok(prev.nearest);
    assert.strictEqual(prev.nearest!.name, "box1");
    assert.ok(prev.nearest!.gap >= 0);
    assert.strictEqual(prev.meshes[0]!.color, DRAFT_BODY_COLOR);
    assert.ok(prev.slices.length === 3);
    assert.deepStrictEqual(
      prev.slices.map((s) => s.axis),
      ["z", "y", "x"]
    );
    const xy = prev.slices[0]!;
    assert.ok(xy.polylines.some((p) => p.highlight && p.points.length >= 8));
  });

  it("slices SPH as a circle on XY through the center", () => {
    const prev = buildDraftBodyPreview({
      bodyType: "SPH",
      name: "s",
      params: [0, 0, 0, 2],
      scenePrimitives: [],
    });
    const xy = prev.slices.find((s) => s.axis === "z");
    assert.ok(xy);
    const draft = xy!.polylines.find((p) => p.highlight);
    assert.ok(draft);
    const r = Math.max(...draft!.points.map((q) => Math.hypot(q.u, q.v)));
    assert.ok(Math.abs(r - 2) < 0.05);
  });

  it("maps ELL/WED/TRC/UCZ for slices", () => {
    const ell = buildDraftBodyPreview({
      bodyType: "ELL",
      name: "e",
      params: [0, 0, -1, 0, 0, 1, 1],
      scenePrimitives: [],
    });
    assert.ok(!ell.unsupported);
    const xy = ell.slices.find((s) => s.axis === "z");
    const draft = xy?.polylines.find((p) => p.highlight);
    assert.ok(draft && draft.points.length >= 8);

    const wed = buildDraftBodyPreview({
      bodyType: "WED",
      name: "w",
      params: [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 3],
      scenePrimitives: [],
    });
    const wedXy = wed.slices.find((s) => s.axis === "z");
    assert.ok(wedXy?.polylines.some((p) => p.highlight && p.points.length >= 3));

    const trc = buildDraftBodyPreview({
      bodyType: "TRC",
      name: "t",
      params: [0, 0, 0, 0, 0, 10, 2, 1],
      scenePrimitives: [],
    });
    const trcXy = trc.slices.find((s) => s.axis === "z");
    const trcDraft = trcXy?.polylines.find((p) => p.highlight);
    assert.ok(trcDraft && trcDraft.points.length >= 8);

    const ucz = buildDraftBodyPreview({
      bodyType: "UCZ",
      name: "u",
      params: [0, 0, 1],
      scenePrimitives: [],
    });
    const uczXy = ucz.slices.find((s) => s.axis === "z");
    const uczDraft = uczXy?.polylines.find((p) => p.highlight);
    assert.ok(uczDraft);
    const rr = Math.max(...uczDraft!.points.map((q) => Math.hypot(q.u, q.v)));
    assert.ok(Math.abs(rr - 1) < 0.08);

    const hexg = buildDraftBodyPreview({
      bodyType: "HEXG",
      name: "hg",
      params: [0, 0, 0, 0, 0, 10, 2, 0, 0],
      scenePrimitives: [],
    });
    const hexgXy = hexg.slices.find((s) => s.axis === "z");
    const hexgDraft = hexgXy?.polylines.find((p) => p.highlight);
    assert.ok(hexgDraft && hexgDraft.points.length === 6);
  });
});

describe("meshPreview extra types and slices", () => {
  it("maps RCC/SBOX/HEX family/planes/infinite/slabs/REC", () => {
    const rcc = bodyToMeshDescriptor(prim("RCC", "r", [0, 0, 0, 0, 0, 4, 1]));
    assert.ok(rcc);
    assert.strictEqual(rcc!.kind, "cylinder");
    assert.ok(Math.abs(rcc!.height! - 4) < 1e-9);

    const sbox = bodyToMeshDescriptor(prim("SBOX", "s", [2, 0, 0, 0, 3, 0, 0, 0, 4]));
    assert.ok(sbox);
    assert.strictEqual(sbox!.kind, "orientedBox");
    assert.deepStrictEqual(sbox!.size, { x: 2, y: 3, z: 4 });

    const hex = bodyToMeshDescriptor(prim("HEX", "h", [0, 0, 0, 2, 0, 10]));
    assert.ok(hex);
    assert.strictEqual(hex!.kind, "hex");
    assert.ok(hex!.flatToFlat! > 0);

    const hexx = bodyToMeshDescriptor(prim("HEXX", "hx", [0, 0, 0, 8, 3, 0]));
    assert.strictEqual(hexx!.kind, "hex");
    const hexy = bodyToMeshDescriptor(prim("HEXY", "hy", [0, 0, 0, 8, 3, 15]));
    assert.strictEqual(hexy!.kind, "hex");
    const shex = bodyToMeshDescriptor(prim("SHEX", "sh", [2, 10, 30]));
    assert.strictEqual(shex!.kind, "hex");

    const sceneBb = { min: { x: -5, y: -5, z: -5 }, max: { x: 5, y: 5, z: 5 } };
    const ply = bodyToMeshDescriptor(prim("PLY", "py", [1]), sceneBb);
    assert.deepStrictEqual(ply!.normal, { x: 0, y: 1, z: 0 });
    const plz = bodyToMeshDescriptor(prim("PLZ", "pz", [2]), sceneBb);
    assert.deepStrictEqual(plz!.normal, { x: 0, y: 0, z: 1 });
    const plg = bodyToMeshDescriptor(prim("PLG", "pg", [0, 0, 1, 3]), sceneBb);
    assert.ok(plg);
    assert.strictEqual(plg!.kind, "plane");

    const ucx = bodyToMeshDescriptor(prim("UCX", "ux", [1, 2, 0.5]), sceneBb);
    assert.strictEqual(ucx!.axis!.x, 1);
    const ucy = bodyToMeshDescriptor(prim("UCY", "uy", [1, 2, 0.5]), sceneBb);
    assert.strictEqual(ucy!.axis!.y, 1);

    const sla = bodyToMeshDescriptor(prim("SLA", "sa", [0, 0, 0, 1, 0, 0]));
    assert.strictEqual(sla!.kind, "orientedBox");
    const slb = bodyToMeshDescriptor(prim("SLB", "sb", [0, 0, 1, 0, 2]));
    assert.strictEqual(slb!.kind, "orientedBox");

    const rec = bodyToMeshDescriptor(
      prim("REC", "e", [0, 0, 0, 0, 0, 10, 2, 0, 0, 0, 1, 0])
    );
    assert.strictEqual(rec!.kind, "ellipticCylinder");
  });

  it("bboxFromBodyParams covers the remaining body types", () => {
    assert.ok(bboxFromBodyParams("RPP", [1, 0, 2, -1, 0, 4]));
    assert.ok(bboxFromBodyParams("RCC", [0, 0, 0, 1, 0, 0, 0.5]));
    assert.ok(bboxFromBodyParams("BOX", [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]));
    assert.ok(bboxFromBodyParams("SBOX", [1, 0, 0, 0, 1, 0, 0, 0, 1]));
    assert.ok(bboxFromBodyParams("HEX", [0, 0, 0, 2, 0, 5]));
    assert.ok(bboxFromBodyParams("HEXX", [0, 0, 0, 4, 2]));
    assert.ok(bboxFromBodyParams("SHEX", [2, 8]));
    assert.ok(bboxFromBodyParams("HEXG", [0, 0, 0, 0, 0, 10, 2, 0, 0]));
    assert.ok(bboxFromBodyParams("PLX", [3]));
    assert.ok(bboxFromBodyParams("PLY", [1]));
    assert.ok(bboxFromBodyParams("PLZ", [0]));
    assert.ok(bboxFromBodyParams("PLG", [1, 0, 0, 0]));
    assert.ok(bboxFromBodyParams("ELL", [0, 0, 0, 0, 0, 2, 1]));
    assert.ok(bboxFromBodyParams("ELL", [0, 0, 0, 0, 0, 2, -0.5]));
    assert.ok(bboxFromBodyParams("WED", [0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 3]));
    assert.ok(bboxFromBodyParams("UCX", [0, 0, 1]));
    assert.ok(bboxFromBodyParams("UCY", [0, 0, 1]));
    assert.ok(bboxFromBodyParams("UCZ", [0, 0, 1]));
    assert.ok(bboxFromBodyParams("SLA", [0, 0, 0, 0, 0, 1]));
    assert.ok(bboxFromBodyParams("SLB", [1, 0, 0, -1, 1]));
    assert.ok(bboxFromBodyParams("TRC", [0, 0, 0, 0, 0, 5, 2, 1]));
    assert.ok(bboxFromBodyParams("REC", [0, 0, 0, 0, 0, 4, 1, 0, 0, 0, 0.5, 0]));
    const fb = bboxFromBodyParams("FOO", [8, 9, 1, 2]);
    assert.ok(fb);
    assert.strictEqual(fb!.min.x, 7);
    assert.strictEqual(bboxFromBodyParams("FOO", []), null);
  });

  it("HEXG with V along H still builds a frame", () => {
    const m = bodyToMeshDescriptor(prim("HEXG", "g", [0, 0, 0, 0, 0, 10, 0, 0, 4]));
    assert.ok(m);
    assert.strictEqual(m!.kind, "orientedHex");
  });

  it("buildMeshPreview records supported type with too few params as unsupported", () => {
    const scene = {
      primitives: [prim("RPP", "short", [0, 1])],
      bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    };
    const prev = buildMeshPreview(scene);
    assert.strictEqual(prev.meshes.length, 0);
    assert.strictEqual(prev.unsupported[0]!.name, "short");
  });

  it("nearby ranks infinite cylinders and excludes planes", () => {
    const focus = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    const ucx = prim("UCX", "ux", [0.5, 0.5, 0.2], {
      min: { x: -10, y: 0.3, z: 0.3 },
      max: { x: 10, y: 0.7, z: 0.7 },
    });
    const ucy = prim("UCY", "uy", [0.5, 0.5, 0.2], {
      min: { x: 0.3, y: -10, z: 0.3 },
      max: { x: 0.7, y: 10, z: 0.7 },
    });
    const ucz = prim("UCZ", "uz", [0.5, 0.5, 0.2], {
      min: { x: 0.3, y: 0.3, z: -10 },
      max: { x: 0.7, y: 0.7, z: 10 },
    });
    const plane = prim("PLX", "px", [0], {
      min: { x: 0, y: -1, z: -1 },
      max: { x: 0, y: 1, z: 1 },
    });
    const picked = selectNearbyBodies(focus, [ucx, ucy, ucz, plane], { maxCount: 8, maxGapFactor: 40 });
    const names = picked.map((p) => p.name);
    assert.ok(names.includes("ux"));
    assert.ok(names.includes("uy"));
    assert.ok(names.includes("uz"));
    assert.ok(!names.includes("px"));
    assert.ok(firstContainerIndex([plane, ucx]) < 0);
    assert.ok(isNeighborExcluded(plane, focus, false));
    assert.ok(!isNeighborExcluded(ucx, focus, false));
  });

  it("draft preview fallbacks: no bbox, ARB, neighbor without mesh", () => {
    const empty = buildDraftBodyPreview({
      bodyType: "RPP",
      name: " ",
      params: [1],
      scenePrimitives: [],
    });
    assert.strictEqual(empty.meshes.length, 0);
    assert.ok(empty.warnings.length);

    const arb = buildDraftBodyPreview({
      bodyType: "ARB",
      name: "poly",
      params: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
      scenePrimitives: [],
    });
    assert.ok(arb.unsupported);

    const hexgShort = buildDraftBodyPreview({
      bodyType: "HEXG",
      name: "hg",
      params: [1, 2, 3],
      scenePrimitives: [],
    });
    assert.ok(hexgShort.meshes.some((m) => m.kind === "bbox" && m.name === "hg"));

    const weird = prim("ARB", "blob", [0, 0, 0], {
      min: { x: 2, y: 0, z: 0 },
      max: { x: 3, y: 1, z: 1 },
    });
    const withBlob = buildDraftBodyPreview({
      bodyType: "SPH",
      name: "ball",
      params: [0, 0, 0, 0.5],
      scenePrimitives: [weird],
      nearby: { maxCount: 8, maxGapFactor: 40 },
    });
    assert.ok(withBlob.meshes.some((m) => m.kind === "bbox" && m.name === "blob"));
  });

  it("slices HEX/BOX/RCC-along-X/REC/TRC-along-X on all three planes", () => {
    const hex = buildDraftBodyPreview({
      bodyType: "HEX",
      name: "h",
      params: [0, 0, 0, 2, 0, 10],
      scenePrimitives: [],
    });
    assert.ok(hex.slices.every((s) => s.polylines.some((p) => p.highlight)));

    const box = buildDraftBodyPreview({
      bodyType: "BOX",
      name: "b",
      params: [0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4],
      scenePrimitives: [],
    });
    assert.ok(box.slices.some((s) => s.polylines.some((p) => p.highlight && p.points.length >= 3)));

    const rccX = buildDraftBodyPreview({
      bodyType: "RCC",
      name: "cx",
      params: [0, 0, 0, 10, 0, 0, 1],
      scenePrimitives: [],
    });
    const xy = rccX.slices.find((s) => s.axis === "z");
    assert.ok(xy?.polylines.some((p) => p.highlight));

    const rec = buildDraftBodyPreview({
      bodyType: "REC",
      name: "ec",
      params: [0, 0, 0, 0, 0, 8, 2, 0, 0, 0, 1, 0],
      scenePrimitives: [],
    });
    assert.ok(rec.slices[0]!.polylines.some((p) => p.highlight && p.points.length >= 8));

    const recX = buildDraftBodyPreview({
      bodyType: "REC",
      name: "ecx",
      params: [0, 0, 0, 8, 0, 0, 0, 1, 0, 0, 0, 0.5],
      scenePrimitives: [],
    });
    assert.ok(recX.slices.find((s) => s.axis === "z")?.polylines.length);

    const trcX = buildDraftBodyPreview({
      bodyType: "TRC",
      name: "tx",
      params: [0, 0, 0, 10, 0, 0, 2, 1],
      scenePrimitives: [],
    });
    assert.ok(trcX.slices.find((s) => s.axis === "z")?.polylines.some((p) => p.highlight));

    const hexgTilt = buildDraftBodyPreview({
      bodyType: "HEXG",
      name: "hg2",
      params: [0, 0, 0, 10, 0, 0, 0, 2, 0],
      scenePrimitives: [],
    });
    assert.ok(hexgTilt.slices.some((s) => s.polylines.some((p) => p.highlight)));
  });

  it("TRANSF R rotates a point 90° CCW around vertical", () => {
    const p = transfPoint({ x: 1, y: 0, z: 3 }, "R", 0, 0, 90);
    assert.ok(Math.abs(p.x) < 1e-9);
    assert.ok(Math.abs(p.y - 1) < 1e-9);
    assert.equal(p.z, 3);
  });

  it("TRANSF M mirrors RCZ across x=10.5 (UserGuide A.37 plane at 90°)", () => {
    const next = applyTransfToBodyParams("RCZ", [0, 0, 0, 10, 1], "M", 10.5, 0, 90);
    assert.ok(next);
    assert.ok(Math.abs(next![0] - 21) < 1e-6);
    assert.ok(Math.abs(next![1]) < 1e-6);
    assert.equal(next![3], 10);
    assert.equal(applyTransfToBodyParams("RPP", [0, 1, 0, 1, 0, 1], "R", 0, 0, 90), null);
  });

  it("buildDraftBodyPreview applies TRANSF to a scene prototype", () => {
    const proto = prim("RCZ", "R01", [1, 0, 0, 10, 2], {
      min: { x: -1, y: -2, z: 0 },
      max: { x: 3, y: 2, z: 10 },
    });
    const prev = buildDraftBodyPreview({
      bodyType: "TRANSF",
      name: "R02",
      params: [0, 0, 90],
      scenePrimitives: [proto],
      transf: { protoName: "R01", mode: "R", A: 0, B: 0, f: 90 },
    });
    assert.equal(prev.warnings.length, 0);
    assert.ok(!prev.unsupported);
    const draft = prev.meshes.find((m) => m.name === "R02");
    assert.ok(draft);
    assert.ok(Math.abs(draft!.center.x) < 1e-6);
    assert.ok(Math.abs(draft!.center.y - 1) < 1e-6);
  });
});
