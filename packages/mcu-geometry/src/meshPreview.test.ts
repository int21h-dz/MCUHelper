import { describe, it } from "node:test";
import assert from "node:assert";
import {
  MESH_PREVIEW_BODY_CAP,
  bodyToMeshDescriptor,
  buildMeshPreview,
  isMeshPreviewSupported,
  isMeshPreviewUnsupported,
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
});
