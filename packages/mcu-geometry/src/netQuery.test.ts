import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import type { BodyNode, NetNode } from "@mcuhelper/mcu-language";
import { parseDocument } from "@mcuhelper/mcu-language";
import {
  cellPitchFromContainer,
  netPrototypeAt,
  netCarrierZones,
  findNetForZone,
  resolveNetCell,
  findNetCellAtPoint,
} from "./netQuery";

const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, offset: 0, endOffset: 0 };

function mockBody(partial: Partial<BodyNode>): BodyNode {
  return { kind: "body", name: "B", bodyType: "RPP", params: [], scope: "global", range, ...partial } as BodyNode;
}

function mockAst(partial: {
  bodies: BodyNode[];
  nets: NetNode[];
}): import("@mcuhelper/mcu-language").DocumentAst {
  return {
    uri: "test",
    constants: [],
    materials: [],
    zones: [],
    lattices: [],
    statements: [],
    fragments: [],
    diagnostics: [],
    cells: [],
    latticeElements: [],
    includes: [],
    cameraPresets: [],
    ...partial,
  } as import("@mcuhelper/mcu-language").DocumentAst;
}

function mockNet(partial: Partial<NetNode>): NetNode {
  return {
    kind: "net",
    name: "N",
    cols: 1,
    rows: 1,
    root: "0,0,0",
    typeMap: [["A"]],
    range,
    ...partial,
  } as NetNode;
}

describe("netQuery", () => {
  it("cellPitchFromContainer for RPP", () => {
    const body = mockBody({
      name: "BOX",
      bodyType: "RPP",
      params: ["0", "10", "0", "20", "0", "30"],
      scope: "cell:PROT",
    });
    const pitch = cellPitchFromContainer(body, new Map());
    assert.ok(pitch);
    assert.strictEqual(pitch!.e1.x, 10);
    assert.strictEqual(pitch!.e2.y, 20);
    assert.strictEqual(pitch!.e3.z, 30);
  });

  it("cellPitchFromContainer for SBOX", () => {
    const body = mockBody({
      name: "S",
      bodyType: "SBOX",
      params: ["1", "0", "0", "0", "1", "0", "0", "0", "1"],
      scope: "cell:P",
    });
    const pitch = cellPitchFromContainer(body, new Map());
    assert.ok(pitch);
    assert.strictEqual(pitch!.e1.x, 1);
    assert.strictEqual(pitch!.e2.y, 1);
    assert.strictEqual(pitch!.e3.z, 1);
  });

  it("netPrototypeAt reads type map", () => {
    const net = mockNet({
      name: "NET1",
      cols: 2,
      rows: 2,
      typeMap: [["A", "B"], ["C", "D"]],
    });
    assert.strictEqual(netPrototypeAt(net, 1, 1), "A");
    assert.strictEqual(netPrototypeAt(net, 2, 1), "B");
    assert.strictEqual(netPrototypeAt(net, 1, 2), "C");
    assert.strictEqual(netPrototypeAt(net, 2, 2), "D");
  });

  it("netPrototypeAt strips repeat prefix and zero", () => {
    const net = mockNet({
      name: "N",
      cols: 2,
      rows: 1,
      typeMap: [["3*FU", "-0"]],
    });
    assert.strictEqual(netPrototypeAt(net, 1, 1), "FU");
    assert.strictEqual(netPrototypeAt(net, 2, 1), null);
  });

  it("netPrototypeAt and findNetForZone on parsed document", () => {
    const ast = parseDocument(
      fs.readFileSync(path.join(__dirname, "../../../test/fixtures/latt_example.mcu"), "utf8"),
      { uri: "latt" }
    );
    assert.ok(ast.nets.length > 0 || ast.lattices.length > 0);
    if (ast.nets.length > 0) {
      const net = ast.nets[0]!;
      assert.ok(netPrototypeAt(net, 1, 1));
      assert.ok(findNetForZone(ast, net.name));
    }
  });

  it("netCarrierZones on latt fixture", () => {
    const ast = parseDocument(
      fs.readFileSync(path.join(__dirname, "../../../test/fixtures/latt_example.mcu"), "utf8"),
      { uri: "latt2" }
    );
    const carriers = netCarrierZones(ast);
    assert.ok(Array.isArray(carriers));
  });

  it("cellPitchFromContainer for HEX prism", () => {
    const body = mockBody({
      bodyType: "HEXX",
      params: ["0", "0", "0", "2", "0", "10"],
    });
    const pitch = cellPitchFromContainer(body, new Map());
    assert.ok(pitch);
    assert.strictEqual(pitch!.e1.x, 2);
    assert.ok(Math.abs(pitch!.e2.x) < 1e-9);
    assert.strictEqual(pitch!.e3.z, 10);
  });

  it("resolveNetCell finds cell from synthetic NET document", () => {
    const ast = mockAst({
      bodies: [
        mockBody({
          name: "BOX",
          bodyType: "RPP",
          params: ["0", "10", "0", "10", "0", "10"],
          scope: "cell:A",
        }),
      ],
      nets: [
        mockNet({
          name: "N1",
          root: "0,0,0",
          cols: 2,
          rows: 2,
          typeMap: [
            ["A", "A"],
            ["A", "A"],
          ],
        }),
      ],
    });

    const hit = resolveNetCell(ast, ast.nets[0]!, { x: 5, y: 5, z: 5 });
    assert.ok(hit);
    assert.deepStrictEqual(hit!.cellIndex, [1, 1, 1]);
    assert.strictEqual(hit!.prototype, "A");
    assert.ok(hit!.localPoint.x >= 0 && hit!.localPoint.x < 10);

    const alias = findNetCellAtPoint(ast, ast.nets[0]!, { x: 15, y: 5, z: 5 }, "A");
    assert.ok(alias);
    assert.deepStrictEqual(alias!.cellIndex, [2, 1, 1]);
  });

  it("resolveNetCell returns null outside grid", () => {
    const ast = mockAst({
      bodies: [
        mockBody({
          name: "BOX",
          bodyType: "RPP",
          params: ["0", "10", "0", "10", "0", "10"],
          scope: "cell:A",
        }),
      ],
      nets: [
        mockNet({
          name: "N1",
          root: "0,0,0",
          cols: 1,
          rows: 1,
          typeMap: [["A"]],
        }),
      ],
    });
    assert.strictEqual(resolveNetCell(ast, ast.nets[0]!, { x: -1, y: 0, z: 0 }), null);
  });
});
