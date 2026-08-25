import { describe, it } from "node:test";
import assert from "node:assert";
import { isG2mpCartogramRow, latticeTypeUsesCartogram, looksLikeZoneStatement } from "./zoneStatement";
import { parseDocument } from "./parser";
import type { ZoneNode } from "./ast";

describe("zoneStatement lattice cartogram", () => {
  it("latticeTypeUsesCartogram only for G2MP", () => {
    assert.ok(latticeTypeUsesCartogram("G2MP"));
    assert.ok(latticeTypeUsesCartogram("G2 MP"));
    assert.ok(!latticeTypeUsesCartogram("GLTL"));
    assert.ok(!latticeTypeUsesCartogram("G2AR"));
  });

  it("isG2mpCartogramRow matches L01…L23 style labels", () => {
    assert.ok(isG2mpCartogramRow("L01"));
    assert.ok(isG2mpCartogramRow("L10"));
    assert.ok(isG2mpCartogramRow("L23"));
    assert.ok(!isG2mpCartogramRow("L1"));
    assert.ok(!isG2mpCartogramRow("LATT"));
    assert.ok(!isG2mpCartogramRow("LISTEL"));
  });
});

describe("zone names that look like NET pointers (T1, P1, …)", () => {
  it("looksLikeZoneStatement accepts T1 N1 -N2 /reg:mat", () => {
    assert.ok(looksLikeZoneStatement("T1      N1  -N2     /1:3/4"));
    assert.ok(looksLikeZoneStatement("T2      2  -3     /2:4/3"));
    assert.ok(!looksLikeZoneStatement("T01 1 2 3 4"));
  });

  it("does not treat CNTAND/PHOT numeric cards as zones", () => {
    assert.ok(!looksLikeZoneStatement("CNTAND 1"));
    assert.ok(!looksLikeZoneStatement("PHOT 1"));
    assert.ok(!looksLikeZoneStatement("NEUT 0"));
  });

  it("parseDocument keeps T1… as zones when expression looks like a zone", () => {
    const ast = parseDocument(
      [
        "HEAD 3 0",
        "CONT T T",
        "RCZ N1 0 0 -100 200 10",
        "RCZ N2 0 0 -100 200 5",
        "END",
        "T1      N1  -N2     /1:3/4",
        "T2      2  -3     /2:4/3",
        "END",
        "FINISH",
      ].join("\n"),
      { uri: "t1-zone.mcu" }
    );
    assert.deepStrictEqual(
      ast.zones.map((z: ZoneNode) => z.name),
      ["T1", "T2"]
    );
    assert.ok(ast.zones[0]!.expression.includes("N1"));
  });
});
