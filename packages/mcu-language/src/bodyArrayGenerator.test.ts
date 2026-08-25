import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPatternExclusions,
  applyTranslateToBodyParamStrings,
  buildPatternInstances,
  emitBodyArray,
  formatParamWithDelta,
  MAX_BODY_ARRAY_COUNT,
} from "./bodyArrayGenerator";

describe("bodyArrayGenerator", () => {
  it("linear n=3 uses step vector", () => {
    const r = buildPatternInstances({
      group: "array",
      mode: "linear",
      values: { count: 3, stepMode: "vector", sx: 2, sy: 0, sz: 0 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.instances.length, 3);
    assert.deepEqual(r.instances[1]?.pose, { kind: "T", dx: 2, dy: 0, dz: 0 });
    assert.deepEqual(r.instances[2]?.pose, { kind: "T", dx: 4, dy: 0, dz: 0 });
  });

  it("ring n=4 uses 90° steps", () => {
    const r = buildPatternInstances({
      group: "curve",
      mode: "ring",
      values: { count: 4, cx: 0, cy: 0, f0: 0 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.useTransfCandidate, true);
    assert.equal(r.instances.length, 4);
    assert.deepEqual(r.instances[1]?.pose, { kind: "R", A: 0, B: 0, f: 90 });
    assert.deepEqual(r.instances[2]?.pose, { kind: "R", A: 0, B: 0, f: 180 });
    assert.deepEqual(r.instances[3]?.pose, { kind: "R", A: 0, B: 0, f: 270 });
  });

  it("ring f0 rotates seed with the whole ring", () => {
    const r = buildPatternInstances({
      group: "curve",
      mode: "ring",
      values: { count: 4, cx: 1, cy: 2, f0: 30 },
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.instances[0]?.pose, { kind: "R", A: 1, B: 2, f: 30 });
    assert.deepEqual(r.instances[1]?.pose, { kind: "R", A: 1, B: 2, f: 120 });
    assert.deepEqual(r.instances[2]?.pose, { kind: "R", A: 1, B: 2, f: 210 });
    assert.deepEqual(r.instances[3]?.pose, { kind: "R", A: 1, B: 2, f: 300 });
  });

  it("ring with f0 emits TRANSF relative to rotated seed", () => {
    const built = buildPatternInstances({
      group: "curve",
      mode: "ring",
      values: { count: 4, cx: 0, cy: 0, f0: 30 },
    });
    const emit = emitBodyArray({
      seed: { bodyType: "RCZ", name: "Z1", params: ["1", "0", "0", "1", "1"] },
      instances: built.instances,
      expand: false,
      canUseTransf: true,
      existingNames: ["Z1"],
      transformExpanded: (pose) => {
        if (pose.kind !== "R") return null;
        // seed moved by f0 — достаточно заглушки для emit
        return pose.f === 30 ? ["0.866", "0.5", "0", "1", "1"] : null;
      },
    });
    assert.equal(emit.okToInsert, true);
    assert.match(emit.text, /^RCZ Z1 /m);
    assert.match(emit.text, /TRANSF \S+ Z1 R 0,0 90/);
    assert.match(emit.text, /TRANSF \S+ Z1 R 0,0 180/);
    assert.match(emit.text, /TRANSF \S+ Z1 R 0,0 270/);
    assert.ok(!/TRANSF \S+ Z1 R 0,0 120/.test(emit.text));
  });

  it("segment starts at seed anchor, not world origin", () => {
    const r = buildPatternInstances({
      group: "curve",
      mode: "segment",
      values: { count: 3, x1: 12, y1: 4, z1: 0 },
      seedAnchor: { x: 6, y: 4, z: 0 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.instances.length, 3);
    assert.deepEqual(r.instances[1]?.pose, { kind: "T", dx: 3, dy: 0, dz: 0 });
    assert.deepEqual(r.instances[2]?.pose, { kind: "T", dx: 6, dy: 0, dz: 0 });
  });

  it("hex lattice rings=1 has 7 instances", () => {
    const r = buildPatternInstances({
      group: "array",
      mode: "hexRings",
      values: { rings: 1, pitch: 2 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.instances.length, 7);
  });

  it("hex lattice rings=1 is centered on seed (flat-top)", () => {
    const pitch = 3;
    const r = buildPatternInstances({
      group: "array",
      mode: "hexRings",
      values: { rings: 1, pitch },
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.instances[0]?.pose, { kind: "T", dx: 0, dy: 0, dz: 0 });
    let sx = 0;
    let sy = 0;
    const neighbors = r.instances.slice(1);
    assert.equal(neighbors.length, 6);
    for (const inst of neighbors) {
      assert.equal(inst.pose.kind, "T");
      if (inst.pose.kind !== "T") continue;
      sx += inst.pose.dx;
      sy += inst.pose.dy;
      const d = Math.hypot(inst.pose.dx, inst.pose.dy);
      assert.ok(Math.abs(d - pitch) < 1e-9, `neighbor dist ${d} ≠ pitch ${pitch}`);
    }
    assert.ok(Math.abs(sx) < 1e-9, `centroid x ${sx}`);
    assert.ok(Math.abs(sy) < 1e-9, `centroid y ${sy}`);
    // flat-top (HEXX f=0): соседи по ±X на расстоянии pitch
    const east = neighbors.some((i) => i.pose.kind === "T" && Math.abs(i.pose.dx - pitch) < 1e-9 && Math.abs(i.pose.dy) < 1e-9);
    const west = neighbors.some((i) => i.pose.kind === "T" && Math.abs(i.pose.dx + pitch) < 1e-9 && Math.abs(i.pose.dy) < 1e-9);
    assert.ok(east && west, "expected ±X neighbors for flat-top lattice");
  });

  it("hex lattice rings=6 has 127 instances (TVS-style)", () => {
    const r = buildPatternInstances({
      group: "array",
      mode: "hexRings",
      values: { rings: 6, pitch: 1.5 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.instances.length, 127);
    const last = r.instances[126]?.pose;
    assert.equal(last?.kind, "T");
    let sx = 0;
    let sy = 0;
    for (const inst of r.instances.slice(1)) {
      if (inst.pose.kind !== "T") continue;
      sx += inst.pose.dx;
      sy += inst.pose.dy;
    }
    assert.ok(Math.abs(sx) < 1e-6);
    assert.ok(Math.abs(sy) < 1e-6);
  });

  it("blocks N above insert limit", () => {
    const r = buildPatternInstances({
      group: "array",
      mode: "linear",
      values: { count: MAX_BODY_ARRAY_COUNT + 1, stepMode: "vector", sx: 1, sy: 0, sz: 0 },
    });
    assert.equal(r.ok, false);
    assert.ok(r.warnings.some((w) => /лимит/i.test(w)));
  });

  it("emits TRANSF for ring when allowed", () => {
    const built = buildPatternInstances({
      group: "curve",
      mode: "ring",
      values: { count: 4, cx: 0, cy: 0, f0: 0 },
    });
    const emit = emitBodyArray({
      seed: { bodyType: "RCZ", name: "Z1", params: ["0", "0", "0", "1", "1"] },
      instances: built.instances,
      expand: false,
      canUseTransf: true,
      existingNames: ["Z1"],
    });
    assert.equal(emit.okToInsert, true);
    assert.match(emit.summary, /1×RCZ \+ 3×TRANSF/);
    const lines = emit.text.trim().split(/\n/);
    assert.equal(lines.length, 4);
    assert.match(lines[0]!, /^RCZ Z1 /);
    assert.match(lines[1]!, /^TRANSF \S+ Z1 R 0,0 90/);
  });

  it("expands ring instead of TRANSF when expand=true", () => {
    const built = buildPatternInstances({
      group: "curve",
      mode: "ring",
      values: { count: 2, cx: 0, cy: 0, f0: 0 },
    });
    const emit = emitBodyArray({
      seed: { bodyType: "RCZ", name: "Z1", params: ["1", "0", "0", "1", "1"] },
      instances: built.instances,
      expand: true,
      canUseTransf: true,
      existingNames: [],
      transformExpanded: (pose) => {
        if (pose.kind !== "R") return null;
        return pose.f === 180 ? ["-1", "0", "0", "1", "1"] : ["1", "0", "0", "1", "1"];
      },
    });
    assert.equal(emit.okToInsert, true);
    assert.match(emit.summary, /2×RCZ \(развёртка\)/);
    assert.ok(!/TRANSF/.test(emit.text));
  });

  it("hex perimeter center moves seed onto contour", () => {
    const r = buildPatternInstances({
      group: "curve",
      mode: "hexPerimeter",
      values: { count: 6, perimeterRef: "center", cx: 0, cy: 0, phi: 0, size: Math.sqrt(3), sizeMode: "flat" },
      seedAnchor: { x: 0, y: 0, z: 0 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.instances.length, 6);
    const p0 = r.instances[0]?.pose;
    assert.ok(p0 && p0.kind === "T");
    assert.ok(Math.hypot(p0.dx, p0.dy) > 0.5);
    const p1 = r.instances[1]?.pose;
    assert.ok(p1 && p1.kind === "T");
    assert.ok(Math.hypot(p1.dx - p0.dx, p1.dy - p0.dy) > 0.5);
  });

  it("hex perimeter seed keeps prototype on contour", () => {
    const r = buildPatternInstances({
      group: "curve",
      mode: "hexPerimeter",
      values: { count: 6, perimeterRef: "seed", phi: 0, size: 2, sizeMode: "side" },
      seedAnchor: { x: 5, y: 7, z: 0 },
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.instances[0]?.pose, { kind: "T", dx: 0, dy: 0, dz: 0 });
    assert.equal(r.instances.length, 6);
    const p1 = r.instances[1]?.pose;
    assert.ok(p1 && p1.kind === "T");
    assert.ok(Math.hypot(p1.dx, p1.dy) > 0.5);
  });

  it("mirror emits one TRANSF M", () => {
    const built = buildPatternInstances({
      group: "mirror",
      values: { A: 10.5, B: 0, f: 90 },
    });
    const emit = emitBodyArray({
      seed: { bodyType: "RCZ", name: "Z1", params: ["0", "0", "0", "10", "1"] },
      instances: built.instances,
      expand: false,
      canUseTransf: true,
      existingNames: [],
    });
    assert.equal(emit.okToInsert, true);
    assert.match(emit.text, /TRANSF \S+ Z1 M 10\.5,0 90/);
  });

  it("applyPatternExclusions drops copy indices only", () => {
    const built = buildPatternInstances({
      group: "array",
      mode: "linear",
      values: { count: 4, stepMode: "vector", sx: 1, sy: 0, sz: 0 },
    });
    const filtered = applyPatternExclusions(built.instances, [1, 3]);
    assert.equal(filtered.ok, true);
    assert.equal(filtered.instances.length, 2);
    assert.equal(filtered.excludedCount, 2);
    assert.deepEqual(filtered.instances[1]?.pose, { kind: "T", dx: 2, dy: 0, dz: 0 });
  });

  it("applyPatternExclusions ignores seed index 0", () => {
    const built = buildPatternInstances({
      group: "array",
      mode: "linear",
      values: { count: 3, stepMode: "vector", sx: 1, sy: 0, sz: 0 },
    });
    const filtered = applyPatternExclusions(built.instances, [0, 2]);
    assert.equal(filtered.ok, true);
    assert.equal(filtered.instances.length, 2);
    assert.equal(filtered.excludedCount, 1);
  });

  it("emit after exclusions skips excluded copies", () => {
    const built = buildPatternInstances({
      group: "array",
      mode: "linear",
      values: { count: 4, stepMode: "vector", sx: 1, sy: 0, sz: 0 },
    });
    const filtered = applyPatternExclusions(built.instances, [2, 3]);
    const emit = emitBodyArray({
      seed: { bodyType: "RCZ", name: "Z1", params: ["0", "0", "0", "1", "1"] },
      instances: filtered.instances,
      expand: true,
      canUseTransf: false,
      existingNames: [],
      transformExpanded: (pose) => {
        if (pose.kind !== "T") return null;
        return ["0", "0", "0", String(1 + pose.dx), "1"];
      },
    });
    assert.equal(emit.okToInsert, true);
    assert.equal(emit.text.trim().split(/\n/).length, 2);
  });

  it("formatParamWithDelta keeps EQU names", () => {
    assert.equal(formatParamWithDelta("LG2", 3), "LG2+3");
    assert.equal(formatParamWithDelta("LG2", -1.5), "LG2-1.5");
    assert.equal(formatParamWithDelta("LG2", 0), "LG2");
    assert.equal(formatParamWithDelta("12.5", 3), "15.5");
  });

  it("applyTranslateToBodyParamStrings preserves HEXX EQU center", () => {
    const next = applyTranslateToBodyParamStrings("HEXX", ["LG2", "LG2", "0", "100", "1.806", "0"], 3, 0, 0);
    assert.deepEqual(next, ["LG2+3", "LG2", "0", "100", "1.806", "0"]);
  });

  it("emit expands HEXX copies with EQU offsets", () => {
    const built = buildPatternInstances({
      group: "array",
      mode: "linear",
      values: { count: 2, stepMode: "vector", sx: 3, sy: 0, sz: 0 },
    });
    const emit = emitBodyArray({
      seed: { bodyType: "HEXX", name: "H", params: ["LG2", "LG2", "0", "100", "1.806", "0"] },
      instances: built.instances,
      expand: true,
      canUseTransf: false,
      existingNames: [],
      transformExpanded: (pose) => {
        if (pose.kind !== "T") return null;
        return applyTranslateToBodyParamStrings("HEXX", ["LG2", "LG2", "0", "100", "1.806", "0"], pose.dx, pose.dy, pose.dz);
      },
    });
    assert.equal(emit.okToInsert, true);
    assert.match(emit.text, /HEXX H LG2,LG2,0 100 1\.806 0/i);
    assert.match(emit.text, /HEXX \S+ LG2\+3,LG2,0 100 1\.806 0/i);
  });
});
