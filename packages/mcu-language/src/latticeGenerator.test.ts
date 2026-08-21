import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildG2arLatticeStatement,
  buildG2mpLatticeStatement,
  buildGltlLatticeStatement,
  buildLatticeStatement,
  collectLcellFootprintsFromText,
  defaultLatticeGeneratorInput,
  emptyCartogram,
  findLatticeBlockAtLine,
  formatG2mpRowLabel,
  inferGltlGridSize,
  parseLatticeAtLine,
  parseLatticeBlockText,
  resizeCartogram,
} from "./latticeGenerator";
import { parseDocument } from "./parser";

describe("latticeGenerator", () => {
  it("formats L01…L10 labels", () => {
    assert.equal(formatG2mpRowLabel(1), "L01");
    assert.equal(formatG2mpRowLabel(10), "L10");
  });

  it("resizes cartogram preserving cells", () => {
    const src = [
      ["A", "0"],
      ["B", "A"],
    ];
    const next = resizeCartogram(src, 3, 2);
    assert.deepEqual(next[0], ["A", "0", "0"]);
    assert.deepEqual(next[1], ["B", "A", "0"]);
  });

  it("builds G2MP text parseable by MCU parser", () => {
    const input = defaultLatticeGeneratorInput();
    input.latticeType = "G2MP";
    input.elements = ["A", "B"];
    input.cols = 5;
    input.rows = 5;
    input.vectorA = ["-2", "-2", "0"];
    input.vectorB = ["1", "0", "0"];
    input.vectorC = ["0", "1", "0"];
    input.cartogram = emptyCartogram(5, 5);
    input.cartogram[0]![0] = "A";
    input.cartogram[2]![2] = "B";
    const built = buildG2mpLatticeStatement(input);
    assert.ok(built.okToInsert, built.warnings.join("; "));
    assert.match(built.text, /^LATT G2MP ZL$/m);
    assert.match(built.text, /^LISTEL A B$/m);
    assert.match(built.text, /^PARM 5,5 /m);
    assert.match(built.text, /^L01 A /m);
    assert.match(built.text, /^L03 0 0 B /m);

    const doc = `HEAD 1 0
CONT T T T
RCZ C 0 0 0 10 5
END
ZL C /1:1
END
LCELL A
RPP BL -0.4,0.4 -0.4,0.4 0,1
END
Z A BL /1:1
END
ENDL
LCELL B
RPP BL -0.4,0.4 -0.4,0.4 0,1
END
Z A BL /1:1
END
ENDL
${built.text}FINISH
`;
    const ast = parseDocument(doc, { uri: "gen.mcu" });
    const lat = ast.lattices.find((l) => l.latticeType === "G2MP");
    assert.ok(lat);
    assert.deepEqual(lat!.elements, ["A", "B"]);
    assert.equal(lat!.typeMap?.length, 5);
    assert.equal(lat!.typeMap![0]![0], "A");
    assert.equal(lat!.typeMap![2]![2], "B");
  });

  it("round-trips G2MP via parseLatticeBlockText", () => {
    const input = defaultLatticeGeneratorInput();
    input.latticeType = "G2MP";
    input.elements = ["A", "B"];
    input.cols = 5;
    input.rows = 5;
    input.vectorA = ["-2", "-2", "0"];
    input.vectorB = ["1", "0", "0"];
    input.vectorC = ["0", "1", "0"];
    input.cartogram = emptyCartogram(5, 5);
    input.cartogram[1]![1] = "B";
    const built = buildG2mpLatticeStatement(input);
    const parsed = parseLatticeBlockText(built.text);
    assert.ok(parsed);
    assert.equal(parsed!.latticeType, "G2MP");
    assert.equal(parsed!.cols, 5);
    assert.equal(parsed!.cartogram[1]![1], "B");
  });

  it("builds GLTL and finds block at cursor", () => {
    const input = defaultLatticeGeneratorInput();
    input.latticeType = "GLTL";
    input.elements = ["A", "B"];
    input.placements = [
      { element: "A", protoIndex: 1, x: "0", y: "0", z: "0" },
      { element: "B", protoIndex: 2, x: "2", y: "0", z: "0" },
    ];
    const built = buildGltlLatticeStatement(input);
    assert.ok(built.okToInsert, built.warnings.join("; "));
    assert.match(built.text, /^LATT GLTL ZL$/m);
    assert.match(built.text, /\/2 2,0,0/);

    const doc = `HEAD 1 0
CONT T T T
RCZ C 0 0 0 10 5
END
ZL C /1:1
END
${built.text}FINISH
`;
    const lines = doc.split("\n");
    const lattLine = lines.findIndex((l) => /^LATT\b/i.test(l.trim()));
    const range = findLatticeBlockAtLine(lines, lattLine);
    assert.ok(range);
    assert.equal(range!.startLine, lattLine);
    const hit = parseLatticeAtLine(doc, lattLine + 1);
    assert.ok(hit);
    assert.equal(hit!.input.latticeType, "GLTL");
    assert.equal(hit!.input.placements.length, 2);
  });

  it("builds G2AR with exclusions and /2", () => {
    const input = defaultLatticeGeneratorInput();
    input.latticeType = "G2AR";
    input.elements = ["A", "B"];
    input.iMin = 0;
    input.iMax = 2;
    input.jMin = 0;
    input.jMax = 1;
    input.cols = 3;
    input.rows = 2;
    input.cartogram = [
      ["A", "0", "B"],
      ["A", "A", "A"],
    ];
    const built = buildG2arLatticeStatement(input);
    assert.ok(built.okToInsert, built.warnings.join("; "));
    assert.match(built.text, /^LATT G2AR ZL$/m);
    assert.match(built.text, /PARM 2 1 /);
    assert.match(built.text, /1,0/);
    assert.match(built.text, /\/2 2,0/);

    const parsed = parseLatticeBlockText(built.text);
    assert.ok(parsed);
    assert.equal(parsed!.latticeType, "G2AR");
    assert.equal(parsed!.cartogram[0]![1], "0");
    assert.equal(parsed!.cartogram[0]![2], "B");
  });

  it("buildLatticeStatement dispatches by type", () => {
    const input = defaultLatticeGeneratorInput();
    input.latticeType = "GLTL";
    const t = buildLatticeStatement(input).text;
    assert.match(t, /^LATT GLTL /m);
  });

  it("parses LISTEL names without leading spaces via AST enrich", () => {
    const doc = `HEAD 1 0
CONT T T T
RCZ C 0 0 0 10 5
END
ZL C /1:1
END
LCELL Pogl20
RPP BL -5,5 -5,5 0,10
END
Z A BL /1:1
END
ENDL
LCELL TVS281
RPP BL -4,4 -4,4 0,10
END
Z A BL /1:1
END
ENDL
LCELL PustY2
RCZ CL 0,0,0 10 3
END
Z A CL /1:1
END
ENDL
LATT GLTL ZL
LISTEL Pogl20
TVS281
PustY2
PARM
 /2 0,0,0
 /2 25,0,0
 /3 50,25,0
FINISH
`;
    const hit = parseLatticeAtLine(doc, doc.split("\n").findIndex((l) => /^LATT\b/i.test(l)));
    assert.ok(hit);
    assert.deepEqual(hit!.input.elements, ["Pogl20", "TVS281", "PustY2"]);
    assert.equal(hit!.input.placements[0]!.element, "TVS281");
    const fp = hit!.input.footprints;
    assert.ok(fp.some((f) => f.name === "Pogl20" && f.shapes.some((s) => s.kind === "rect")));
    assert.ok(fp.some((f) => f.name === "PustY2" && f.shapes.some((s) => s.kind === "circle")));
  });

  it("user sample: spaced LISTEL + /n → 4×4 grid", () => {
    const doc = `HEAD 1 0
CONT T T T
RCZ C 0 0 0 100 50
END
ZL C /1:1
END
LCELL Pogl20
RPP BL -10,10 -10,10 0,20
END
Z A BL /1:1
END
ENDL
LCELL TVS281
RPP BL -8,8 -8,8 0,20
END
Z A BL /1:1
END
ENDL
LCELL PustY2
RPP BL -6,6 -6,6 0,20
END
Z A BL /1:1
END
ENDL
LATT      GLTL ZL
LISTEL    Pogl20
          TVS281
          PustY2
PARM      
   /2   0,0,0
   /2   25,0,0
   /2   50,0,0
   /2   75,0,0
   /2   0,25,0
   /2   25,25,0
   /3   50,25,0
   /2   75,25,0
   /2   0,50,0
   /2   25,50,0
   /2   50,50,0
   /2   75,50,0
   /1   0,75,0
   /2   25,75,0
   /2   50,75,0
   /2   75,75,0
FINISH
`;
    const hit = parseLatticeAtLine(doc, doc.split("\n").findIndex((l) => /^\s*LATT\b/i.test(l)));
    assert.ok(hit);
    assert.deepEqual(hit!.input.elements, ["Pogl20", "TVS281", "PustY2"]);
    assert.equal(hit!.input.placements.length, 16);
    assert.equal(hit!.input.placements[0]!.element, "TVS281");
    assert.equal(hit!.input.placements[0]!.protoIndex, 2);
    assert.equal(hit!.input.placements[6]!.element, "PustY2");
    assert.equal(hit!.input.placements[12]!.element, "Pogl20");
    const g = inferGltlGridSize(hit!.input.placements);
    assert.equal(g.cols, 4);
    assert.equal(g.rows, 4);
    assert.equal(g.layers, 1);
    assert.ok(hit!.input.footprints.some((f) => f.name === "TVS281" && f.shapes.length > 0));
  });

  it("collectLcellFootprintsFromText recovers LCELL when not in stub AST", () => {
    const text = `HEAD 1 0
CONT T T T
RCZ C 0 0 0 10 5
END
Z C /1:1
END
LCELL BigOne
RPP BL -20,20 -15,15 0,10
END
Z A BL /1:1
END
ENDL
LCELL Tiny
RCZ CL 0,0,0 5 2
END
Z A BL /1:1
END
ENDL
`;
    const fp = collectLcellFootprintsFromText(text, ["BigOne", "Tiny"]);
    const big = fp.find((f) => f.name === "BigOne");
    const tiny = fp.find((f) => f.name === "Tiny");
    assert.ok(big?.shapes.some((s) => s.kind === "rect"));
    assert.ok(tiny?.shapes.some((s) => s.kind === "circle"));
    const br = big!.shapes.find((s) => s.kind === "rect") as {
      kind: "rect";
      x1: number;
      x2: number;
    };
    assert.ok(Math.abs(br.x2 - br.x1) >= 39);
  });
});
