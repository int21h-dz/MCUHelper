import { describe, it } from "node:test";
import assert from "node:assert";
import { isG2mpCartogramRow, latticeTypeUsesCartogram } from "./zoneStatement";

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
