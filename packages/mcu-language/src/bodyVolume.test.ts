import { describe, it } from "node:test";
import assert from "node:assert";
import type { BodyNode } from "./ast";
import {
  computeBodyVolumeCm3,
  computeBodyVolumeCm3FromAst,
  formatBodyVolumeCm3,
} from "./bodyVolume";

const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, offset: 0, endOffset: 0 };

function body(partial: Partial<BodyNode>): BodyNode {
  return {
    kind: "body",
    name: "B",
    bodyType: "RPP",
    params: [],
    scope: "global",
    range,
    ...partial,
  } as BodyNode;
}

describe("bodyVolume", () => {
  const vars = new Map<string, number>();

  it("formatBodyVolumeCm3 formats small and large values", () => {
    assert.strictEqual(formatBodyVolumeCm3(0), "—");
    assert.ok(formatBodyVolumeCm3(12.345).includes("см³"));
    assert.ok(formatBodyVolumeCm3(1e12).includes("e"));
  });

  it("computes RPP volume", () => {
    const v = computeBodyVolumeCm3(
      body({ bodyType: "RPP", params: ["0", "10", "0", "20", "0", "30"] }),
      vars
    );
    assert.strictEqual(v, 6000);
  });

  it("computes RCZ, SPH, RCC volumes", () => {
    const rcz = computeBodyVolumeCm3(
      body({ bodyType: "RCZ", params: ["0", "0", "0", "100", "5"] }),
      vars
    );
    assert.ok(rcz != null && rcz > 7800);

    const sph = computeBodyVolumeCm3(
      body({ bodyType: "SPH", params: ["0", "0", "0", "2"] }),
      vars
    );
    assert.ok(sph != null && Math.abs(sph - (4 / 3) * Math.PI * 8) < 0.01);

    const rcc = computeBodyVolumeCm3(
      body({ bodyType: "RCC", params: ["0", "0", "0", "0", "0", "10", "3"] }),
      vars
    );
    assert.ok(rcc != null && Math.abs(rcc - Math.PI * 9 * 10) < 0.01);
  });

  it("computes HEX, HEXX, SHEX, BOX, SBOX", () => {
    const hex = computeBodyVolumeCm3(
      body({ bodyType: "HEX", params: ["0", "0", "0", "2", "0", "10"] }),
      vars
    );
    assert.ok(hex != null && hex > 0);

    const hexx = computeBodyVolumeCm3(
      body({ bodyType: "HEXX", params: ["0", "0", "0", "4", "5"] }),
      vars
    );
    assert.ok(hexx != null && hexx > 0);

    const shex = computeBodyVolumeCm3(body({ bodyType: "SHEX", params: ["3", "10"] }), vars);
    assert.ok(shex != null && shex > 0);

    const box = computeBodyVolumeCm3(
      body({
        bodyType: "BOX",
        params: ["0", "0", "0", "1", "0", "0", "0", "1", "0", "0", "0", "1", "2", "3", "4"],
      }),
      vars
    );
    assert.ok(box != null && Math.abs(box - 1) < 0.01);

    const sbox = computeBodyVolumeCm3(
      body({ bodyType: "SBOX", params: ["2", "0", "0", "0", "3", "0", "0", "0", "4"] }),
      vars
    );
    assert.ok(sbox != null && Math.abs(sbox - 24) < 0.01);
  });

  it("computes TRC and REC", () => {
    const trc = computeBodyVolumeCm3(
      body({ bodyType: "TRC", params: ["0", "0", "0", "0", "0", "10", "2", "4"] }),
      vars
    );
    assert.ok(trc != null && trc > 0);

    const rec = computeBodyVolumeCm3(
      body({
        bodyType: "REC",
        params: ["0", "0", "0", "0", "0", "5", "3", "0", "0", "0", "4", "0"],
      }),
      vars
    );
    assert.ok(rec != null && rec > 0);
  });

  it("computes ELL (foci) and WED", () => {
    const ell = computeBodyVolumeCm3(
      body({ bodyType: "ELL", params: ["0", "0", "-1", "0", "0", "1", "1"] }),
      vars
    );
    const c = 1;
    const b = 1;
    const a = Math.sqrt(c * c + b * b);
    const expect = (4 / 3) * Math.PI * a * b * b;
    assert.ok(ell != null && Math.abs(ell - expect) < 1e-6);

    const wed = computeBodyVolumeCm3(
      body({ bodyType: "WED", params: ["0", "0", "0", "2", "0", "0", "0", "2", "0", "0", "0", "3"] }),
      vars
    );
    assert.ok(wed != null && Math.abs(wed - 6) < 1e-6);

    const hexg = computeBodyVolumeCm3(
      body({ bodyType: "HEXG", params: ["0", "0", "0", "0", "0", "10", "2", "0", "0"] }),
      vars
    );
    const hexgExpect = (Math.sqrt(3) / 2) * 4 * 10;
    assert.ok(hexg != null && Math.abs(hexg - hexgExpect) < 1e-6);
  });

  it("TRANSF delegates to prototype", () => {
    const proto = body({ name: "P", bodyType: "RPP", params: ["0", "2", "0", "2", "0", "2"] });
    const transf = body({
      name: "T",
      bodyType: "TRANSF",
      protoName: "P",
      params: [],
    });
    const v = computeBodyVolumeCm3(transf, vars, [proto, transf]);
    assert.strictEqual(v, 8);
  });

  it("returns null for PLX and insufficient params", () => {
    assert.strictEqual(computeBodyVolumeCm3(body({ bodyType: "PLX", params: ["0", "1", "0", "0"] }), vars), null);
    assert.strictEqual(computeBodyVolumeCm3(body({ bodyType: "RPP", params: ["0", "1"] }), vars), null);
  });

  it("computeBodyVolumeCm3FromAst uses document constants", () => {
    const ast = {
      constants: [{ name: "H", expression: "10", mutable: false, range }],
      bodies: [body({ bodyType: "RCZ", name: "C", params: ["0", "0", "0", "H", "1"] })],
    } as import("./ast").DocumentAst;
    const v = computeBodyVolumeCm3FromAst(ast.bodies[0]!, ast);
    assert.ok(v != null && v > 30);
  });
});
