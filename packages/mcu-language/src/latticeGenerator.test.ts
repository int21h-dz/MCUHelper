import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildG2arLatticeStatement,
  buildG2mpLatticeStatement,
  convertLatticeGeneratorType,
  parseLatticeBlockText,
} from "./latticeGenerator";

/** Пример UserGuide §9.2.6.2 (рис. A.57). */
const USERGUIDE_G2AR = `LATT G2AR CUB
LISTEL TW1 TW2
PARM 0:5 -1:4 0,0,0 25,0,0 0,25,0
     0:1,-1 0:1,0 0,1 0,3:4 4:5,2:4
     /2 3,0 2,1:2`;

/** Мини-картограмма G2MP (§9.2.6.3). */
const MINI_G2MP = `LATT G2MP ZZZ
LISTEL K1 K3
PARM 3,3 0,0,0 10,0,0 0,10,0
L03 0 K3 0
L02 0 K1 K3
L01 K1 K1 K1`;

describe("latticeGenerator G2MP", () => {
  it("parses PARM + L01…LJ cartogram", () => {
    const parsed = parseLatticeBlockText(MINI_G2MP);
    assert.ok(parsed);
    assert.equal(parsed.latticeType, "G2MP");
    assert.equal(parsed.zoneName, "ZZZ");
    assert.deepEqual(parsed.elements, ["K1", "K3"]);
    assert.equal(parsed.cols, 3);
    assert.equal(parsed.rows, 3);
    assert.deepEqual(parsed.vectorA, ["0", "0", "0"]);
    assert.deepEqual(parsed.vectorB, ["10", "0", "0"]);
    assert.deepEqual(parsed.vectorC, ["0", "10", "0"]);
    assert.equal(parsed.cartogram[0]![0], "K1");
    assert.equal(parsed.cartogram[0]![1], "K1");
    assert.equal(parsed.cartogram[1]![1], "K1");
    assert.equal(parsed.cartogram[1]![2], "K3");
    assert.equal(parsed.cartogram[2]![1], "K3");
    assert.equal(parsed.cartogram[2]![0], "0");
  });

  it("builds L01… rows and round-trips", () => {
    const parsed = parseLatticeBlockText(MINI_G2MP);
    assert.ok(parsed);
    const built = buildG2mpLatticeStatement(parsed);
    assert.equal(built.okToInsert, true);
    assert.match(built.text, /^LATT G2MP ZZZ/m);
    assert.match(built.text, /PARM 3,3 0,0,0 10,0,0 0,10,0/);
    assert.match(built.text, /^L01 /m);
    assert.match(built.text, /^L03 /m);

    const again = parseLatticeBlockText(built.text);
    assert.ok(again);
    assert.equal(again.latticeType, "G2MP");
    assert.equal(again.cartogram[1]![1], "K1");
    assert.equal(again.cartogram[1]![2], "K3");
    assert.equal(again.cartogram[2]![0], "0");
  });
});

describe("latticeGenerator G2AR", () => {
  it("parses UserGuide cartogram with exclusions and /2", () => {
    const parsed = parseLatticeBlockText(USERGUIDE_G2AR);
    assert.ok(parsed);
    assert.equal(parsed.latticeType, "G2AR");
    assert.equal(parsed.zoneName, "CUB");
    assert.deepEqual(parsed.elements, ["TW1", "TW2"]);
    assert.equal(parsed.iMin, 0);
    assert.equal(parsed.iMax, 5);
    assert.equal(parsed.jMin, -1);
    assert.equal(parsed.jMax, 4);
    assert.deepEqual(parsed.vectorA, ["0", "0", "0"]);
    assert.deepEqual(parsed.vectorB, ["25", "0", "0"]);
    assert.deepEqual(parsed.vectorC, ["0", "25", "0"]);

    const at = (i: number, j: number) => parsed.cartogram[j - parsed.jMin]![i - parsed.iMin]!;

    assert.equal(at(0, -1), "0");
    assert.equal(at(1, -1), "0");
    assert.equal(at(0, 0), "0");
    assert.equal(at(1, 0), "0");
    assert.equal(at(0, 1), "0");
    assert.equal(at(0, 3), "0");
    assert.equal(at(0, 4), "0");
    assert.equal(at(4, 2), "0");
    assert.equal(at(5, 2), "0");
    assert.equal(at(3, 0), "TW2");
    assert.equal(at(2, 1), "TW2");
    assert.equal(at(2, 2), "TW2");
    assert.equal(at(1, 2), "TW1");
  });

  it("builds multiline PARM and round-trips exclusions + /2", () => {
    const parsed = parseLatticeBlockText(USERGUIDE_G2AR);
    assert.ok(parsed);

    const built = buildG2arLatticeStatement(parsed);
    assert.equal(built.okToInsert, true);
    assert.match(built.text, /^LATT G2AR CUB/m);
    assert.match(built.text, /PARM 5 -1:4 0,0,0 25,0,0 0,25,0/);
    assert.match(built.text, /\/2 .*3,0/);
    assert.match(built.text, /\/2 .*2,1/);
    assert.match(built.text, /\/2 .*2,2/);

    const again = parseLatticeBlockText(built.text);
    assert.ok(again);
    assert.equal(again.latticeType, "G2AR");

    const cell = (inp: typeof again, i: number, j: number) =>
      inp.cartogram[j - inp.jMin]![i - inp.iMin]!;

    assert.equal(cell(again, 0, 1), "0");
    assert.equal(cell(again, 3, 0), "TW2");
    assert.equal(cell(again, 2, 2), "TW2");
    assert.equal(cell(again, 1, 2), "TW1");
  });
});

describe("latticeGenerator convertLatticeGeneratorType", () => {
  it("G2MP ↔ G2AR keeps cartogram and root geometry", () => {
    const g2mp = parseLatticeBlockText(MINI_G2MP)!;
    const g2ar = convertLatticeGeneratorType(g2mp, "G2AR");
    assert.equal(g2ar.latticeType, "G2AR");
    assert.equal(g2ar.iMin, 0);
    assert.equal(g2ar.iMax, 2);
    assert.equal(g2ar.jMin, 0);
    assert.equal(g2ar.jMax, 2);
    assert.equal(g2ar.cartogram[0]![0], "K1");
    assert.equal(g2ar.cartogram[2]![1], "K3");

    const back = convertLatticeGeneratorType(g2ar, "G2MP");
    assert.equal(back.latticeType, "G2MP");
    assert.equal(back.cols, 3);
    assert.equal(back.rows, 3);
    assert.deepEqual(back.vectorA, ["0", "0", "0"]);
    assert.equal(back.cartogram[1]![2], "K3");
  });

  it("G2AR with nonzero iMin shifts A when converting to G2MP", () => {
    const g2ar = parseLatticeBlockText(USERGUIDE_G2AR)!;
    const g2mp = convertLatticeGeneratorType(g2ar, "G2MP");
    assert.equal(g2mp.latticeType, "G2MP");
    assert.equal(g2mp.cols, 6);
    assert.equal(g2mp.rows, 6);
    // A' = A + 0·B + (−1)·C = (0,0,0)+(0,−25,0)
    assert.deepEqual(g2mp.vectorA, ["0", "-25", "0"]);
    assert.equal(g2mp.cartogram[0]![0], "0"); // was (0,-1)
    assert.equal(g2mp.cartogram[1]![3], "TW2"); // (3,0) → ci=3,cj=1
  });

  it("GLTL ↔ G2MP maps placements to cartogram cells", () => {
    const gltl = parseLatticeBlockText(`LATT GLTL ZL
LISTEL A B
PARM /1 0,0,0
     /2 10,0,0
     /1 0,10,0`)!;
    const g2mp = convertLatticeGeneratorType(gltl, "G2MP");
    assert.equal(g2mp.latticeType, "G2MP");
    assert.equal(g2mp.cols, 2);
    assert.equal(g2mp.rows, 2);
    assert.equal(g2mp.cartogram[0]![0], "A");
    assert.equal(g2mp.cartogram[0]![1], "B");
    assert.equal(g2mp.cartogram[1]![0], "A");

    const back = convertLatticeGeneratorType(g2mp, "GLTL");
    assert.equal(back.latticeType, "GLTL");
    assert.ok(back.placements.some((p) => p.element === "B" && p.x === "10"));
  });
});
