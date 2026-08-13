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
  DRAFT_BODY_COLOR,
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
