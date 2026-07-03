import { describe, it } from "node:test";
import assert from "node:assert";
import type { LatticeNode } from "@mcuhelper/mcu-language";
import { parseGltlPlacements, translatePoint, latticeHostZones } from "./gltl";

const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, offset: 0, endOffset: 0 };

function mockLattice(partial: Partial<LatticeNode>): LatticeNode {
  return {
    kind: "lattice",
    latticeType: "GLTL",
    zoneName: "",
    zoneNames: [],
    elements: [],
    positions: [],
    range,
    ...partial,
  } as LatticeNode;
}

describe("gltl", () => {
  it("parseGltlPlacements reads /n offsets", () => {
    const lattice = mockLattice({
      positions: ["/1 0,0,0 /2 1,0,0"],
    });
    const placements = parseGltlPlacements(lattice, new Map());
    assert.strictEqual(placements.length, 2);
    assert.strictEqual(placements[0].protoIndex, 1);
    assert.strictEqual(placements[1].protoIndex, 2);
    assert.strictEqual(placements[1].offset.x, 1);
  });

  it("parseGltlPlacements skips /RZG tokens", () => {
    const lattice = mockLattice({
      positions: ["/RZG /1 0,0,0"],
    });
    const placements = parseGltlPlacements(lattice, new Map());
    assert.strictEqual(placements.length, 1);
    assert.strictEqual(placements[0].offset.x, 0);
  });

  it("parseGltlPlacements returns empty for blank", () => {
    const lattice = mockLattice({ positions: ["   "] });
    assert.deepStrictEqual(parseGltlPlacements(lattice, new Map()), []);
  });

  it("translatePoint subtracts offset", () => {
    const p = { x: 5, y: 3, z: 1 };
    const t = translatePoint(p, 2, 1, 0.5);
    assert.strictEqual(t.x, 3);
    assert.strictEqual(t.y, 2);
    assert.strictEqual(t.z, 0.5);
  });

  it("latticeHostZones prefers zoneNames array", () => {
    const lat = mockLattice({ zoneName: "Z0", zoneNames: ["Z0", "Z1"] });
    assert.deepStrictEqual(latticeHostZones(lat), ["Z0", "Z1"]);
  });

  it("latticeHostZones falls back to zoneName", () => {
    const lat = mockLattice({ zoneName: "HOST", zoneNames: [] });
    assert.deepStrictEqual(latticeHostZones(lat), ["HOST"]);
  });
});
