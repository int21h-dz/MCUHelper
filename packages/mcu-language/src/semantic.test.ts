import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDocument } from "./parser";
import { analyzeSemantics, buildSummaries } from "./semantic";

function diags(text: string, uri = "semantic.mcu") {
  return analyzeSemantics(parseDocument(text, { uri }));
}

describe("semantic diagnostics", () => {
  it("errors on duplicate global EQU", () => {
    const d = diags("EQU A = 1\nEQU A = 2\nFINISH");
    assert.ok(d.some((x) => x.code === "const-redef" && x.message.includes("A")));
  });

  it("errors on TRANSF with unknown prototype", () => {
    const text = `HEAD 3 0
CONT T T
TRANSF T1 MISSING 0 0 0 1 0 0 0 1 0 0 0 1
FINISH`;
    const d = diags(text);
    assert.ok(d.some((x) => x.code === "transf-ref" && x.message.includes("MISSING")));
  });

  it("errors on MATR number gap", () => {
    const text = `PIN 1 0
MATR 1
U235 1.E-3
MATR 3
U238 1.E-3
FINISH`;
    const d = diags(text);
    assert.ok(d.some((x) => x.code === "matr-gap" && x.message.includes("MATR 2")));
  });

  it("errors on zone with unknown body reference", () => {
    const text = `PIN 1 0
MATR 1
U235 1.E-3
HEAD 3 0
CONT T T
RPP A 0 1 0 1 0 1
END
Z1 GHOST /1:1
END
FINISH`;
    const d = diags(text);
    assert.ok(d.some((x) => x.code === "zone-body" && x.message.includes("GHOST")));
  });

  it("errors when CELL zone references body from another CELL", () => {
    const text = `HEAD 3 0
CONT T T
END
CELL A
RPP N1 0 1 0 1 0 1
END
Z1 N1 /1:1
END
CELL B
RPP N2 0 1 0 1 0 1
END
Z1 N1 /2:2
END
FINISH`;
    const d = diags(text);
    assert.ok(
      d.some((x) => x.code === "zone-body" && x.message.includes("N1")),
      d.filter((x) => x.code === "zone-body").map((x) => x.message).join("; ")
    );
  });

  it("accepts numeric body shorthand in same CELL scope", () => {
    const text = `HEAD 3 0
CONT T T
END
CELL A
RPP N1 0 1 0 1 0 1
RPP N2 0 2 0 3 0 4
END
Z1 1 -2 /1:1
END
FINISH`;
    const d = diags(text);
    assert.strictEqual(d.filter((x) => x.code === "zone-body").length, 0);
  });

  it("accepts zone first ref 0 as all space (UserGuide §9.1.4)", () => {
    const text = `HEAD 3 0
CONT T T
RPP KOP1 0 10 0 10 0 10
RCZ N2 0 0 0 10 5
END
Nzk 0 -N2 /1:1
END
FINISH`;
    const d = diags(text);
    assert.strictEqual(d.filter((x) => x.code === "zone-body").length, 0);
  });

  it("warns when zone material number exceeds MATR count", () => {
    const text = `PIN 1 0
MATR 1
U235 1.E-3
HEAD 3 0
CONT T T
RPP A 0 1 0 1 0 1
END
Z1 A :99
END
FINISH`;
    const d = diags(text);
    assert.ok(d.some((x) => x.code === "zone-mat" && x.message.includes("99")));
  });

  it("warns on NET with unknown cell prototype", () => {
    const text = `HEAD 3 0
CONT T T
CELL P1
RPP A 0 1 0 1 0 1
END
END
NET N1 0 0 0 2 2
T01 P1 GHOST 0 0
T02 0 0 0 0
END
FINISH`;
    const d = diags(text);
    assert.ok(d.some((x) => x.code === "net-cell" && x.message.includes("GHOST")));
  });

  it("reports PI as undefined unless user defines it", () => {
    const bad = diags(`HEAD 3 0
CONT T T
EQU Rs = SIN(SQRT(17.5*COS(PI/4)))
FINISH`);
    assert.ok(bad.some((x) => x.code === "var-undef" && x.message.includes("PI")));

    const ok = diags(`HEAD 3 0
CONT T T
EQU PI = 3.1415926
EQU Rs = SIN(SQRT(17.5*COS(PI/4)))
FINISH`);
    assert.strictEqual(ok.filter((x) => x.code === "var-undef" && x.message.includes("PI")).length, 0);
  });

  it("accepts NET repeat prefix N*PROTOTYPE", () => {
    const text = `HEAD 3 0
CONT T T
CELL CGRVA
RPP A 0 1 0 1 0 1
END
END
NET RBMK 0 0 0 1 1
T01 23*CGRVA
END
FINISH`;
    const d = diags(text);
    assert.strictEqual(d.filter((x) => x.code === "net-cell").length, 0);
  });

  it("parses O-cartogram rows as NET objMaps, not zones", () => {
    const text = `HEAD 3 0
CONT T T
END
NET N1 0 0 0 2 2
T01 A B
O0156 1 2 3 4 5 6
O0155 57 58 59
END
FINISH`;
    const ast = parseDocument(text, { uri: "net-o.mcu" });
    assert.ok(!ast.zones.some((z) => z.name === "O0156"), "O0156 is cartogram row, not zone");
    assert.ok(ast.nets[0]?.objMaps?.length === 2);
    const d = diags(text);
    assert.strictEqual(d.filter((x) => x.code === "zone-body").length, 0);
  });

  it("accepts body param with multiply split across tokens (DF-1* DELT)", () => {
    const text = `HEAD 3 0
CONT T T
EQU DF 5
EQU DELT 2
EQU LG2 1
EQU FDIS 3
EQU RWCI 4
RCZ F21 LG2 LG2 DF-1* DELT, FDIS RWCI
END
FINISH`;
    const ast = parseDocument(text, { uri: "rcz-mult.mcu" });
    const body = ast.bodies.find((b) => b.name === "F21");
    assert.ok(body?.params.includes("DF-1*DELT"), body?.params.join("|"));
    const d = diags(text);
    assert.strictEqual(d.filter((x) => x.code === "expr-syntax").length, 0);
    assert.strictEqual(
      d.filter((x) => x.code === "body-params-extra").length,
      0,
      d.filter((x) => x.code === "body-params-extra").map((x) => x.message).join("; ")
    );
  });

  it("parses M-cartogram rows as NET matMaps, not zones", () => {
    const text = `PIN 1 0
MATR 1
U235 1.E-3
HEAD 3 0
CONT T T
END
NET N1 0 0 0 2 2
T01 A B
M0156 56*1
M0152 4*1 2 3
END
FINISH`;
    const ast = parseDocument(text, { uri: "net-m.mcu" });
    assert.ok(!ast.zones.some((z) => z.name === "M0156"), "M0156 is cartogram, not zone");
    assert.ok(ast.nets[0]?.matMaps && ast.nets[0].matMaps.length >= 1);
    const row0 = ast.nets[0]!.matMaps![0]![0]!;
    assert.strictEqual(row0.length, 56);
    assert.ok(row0.every((v) => v === "1"));
    const d = diags(text);
    assert.strictEqual(d.filter((x) => x.code === "zone-body").length, 0);
  });

  it("warns on unknown material number in M-cartogram", () => {
    const text = `PIN 1 0
MATR 1
U235 1.E-3
HEAD 3 0
CONT T T
END
NET N1 0 0 0 1 1
T01 0
M01 99
END
FINISH`;
    const d = diags(text);
    assert.ok(d.some((x) => x.code === "net-mat" && x.message.includes("99")));
  });

  it("accepts NPS/PROB after geometry FINISH as source cards, not zones", () => {
    const text = `HEAD 3 0
CONT T T
END
NET N1 0 0 0 1 1
T01 0
M01 1
END
FINISH
* sources
NPS 1
PROB 1
FINISH`;
    const ast = parseDocument(text, { uri: "src-nps.mcu" });
    assert.ok(!ast.zones.some((z) => z.name === "NPS" || z.name === "PROB"));
    assert.ok(ast.fragments.some((f) => f.id === "source"), "source fragment after NPS");
    const d = diags(text);
    assert.strictEqual(
      d.filter((x) => x.code === "zone-body" && (x.message.includes("NPS") || x.message.includes("PROB"))).length,
      0
    );
  });

  it("keeps zone named like a card when registration tail present", () => {
    const text = `HEAD 3 0
CONT T T
RPP A 0 1 0 1 0 1
END
NPS A /1:1
END
FINISH`;
    const ast = parseDocument(text, { uri: "zone-nps.mcu" });
    assert.ok(ast.zones.some((z) => z.name === "NPS"));
    assert.ok(!ast.fragments.some((f) => f.id === "source"));
  });

  it("accepts GLTL LATT with LISTEL/PARM/LFIXSO as in UserGuide §9.2.6.1", () => {
    const text = `HEAD 3 0
CONT T T
RCZ CNT 0 0 0 10 5
END
ZL CNT /1:1
END
LCELL Pogl20
RPP A 0 1 0 1 0 1
END
ENDL
LCELL TVS281
RPP A 0 1 0 1 0 1
END
ENDL
LCELL PustY2
RPP A 0 1 0 1 0 1
END
ENDL
LATT GLTL ZL
LISTEL Pogl20 TVS281 PustY2
PARM /2 0,0,0 /2 25,0,0 /3 50,25,0 /1 0,75,0
LFIXSO 2,1
LBLACK 0,1
FINISH`;
    const ast = parseDocument(text, { uri: "gltl-lfixso.mcu" });
    assert.ok(ast.lattices.some((l) => l.latticeType === "GLTL" && l.zoneNames?.includes("ZL")));
    assert.deepStrictEqual(ast.lattices[0]?.elements, ["Pogl20", "TVS281", "PustY2"]);
    assert.ok(!ast.zones.some((z) => z.name === "LFIXSO"), "LFIXSO is lattice card, not zone");
    assert.ok(!ast.zones.some((z) => z.name === "LBLACK"), "LBLACK is lattice card, not zone");
    const d = diags(text);
    assert.strictEqual(d.filter((x) => x.code === "zone-body").length, 0);
    assert.strictEqual(d.filter((x) => x.code === "latt-el").length, 0);
  });

  it("warns on LATT with unknown LCELL element", () => {
    const text = `HEAD 3 0
CONT B B B
RCZ CNT 0 0 0 10 5
END
Z0 CNT /1:1
END
LATT GLTL Z0
LISTEL A GHOST
PARM /3 0,0,0
FINISH`;
    const d = diags(text);
    assert.ok(d.some((x) => x.code === "latt-el" && x.message.includes("GHOST")));
  });
});

describe("buildSummaries nets and lattices", () => {
  it("builds NET cartogram prototypes and carrier zones", () => {
    const text = `HEAD 3 0
CONT T T
CELL A16
HEX N1 0,0,0 1,0,0 0,1,0
END
END
ZT01 (ZT01) 2 -4 /1:1
END
NET ZT01 0 0 0 2 2
T01 1*A16 -A16 0 0
T02 0 A16 0 0
END
FINISH`;
    const ast = parseDocument(text, { uri: "net.mcu" });
    const sum = buildSummaries(ast);
    assert.strictEqual(sum.nets.length, 1);
    assert.strictEqual(sum.nets[0].name, "ZT01");
    assert.ok(sum.nets[0].carrierZones.some((z) => z.name === "ZT01"));
    assert.ok(sum.nets[0].prototypes.some((p) => p.name === "A16"));
    assert.strictEqual(sum.nets[0].cartogram.length, 2);
  });

  it("truncates long LATT positions preview", () => {
    const positions = Array.from({ length: 20 }, (_, i) => `${i},${i},${i}`).join(" ");
    const text = `HEAD 3 0
CONT B B B
RCZ CNT 0 0 0 10 5
END
Z0 CNT /1:1
END
LCELL A
RPP L 0 1 0 1 0 1
END
ENDL
LATT GLTL Z0
LISTEL A
PARM /3 ${positions}
FINISH`;
    const ast = parseDocument(text, { uri: "latt-long.mcu" });
    const sum = buildSummaries(ast);
    assert.ok(sum.lattices[0].positionsPreview.endsWith("…"));
    assert.ok(sum.lattices[0].positionsPreview.length <= 56);
  });

  it("material summary includes mass when VOL present", () => {
    const text = `PIN 1 0
MATR 1
U235 1.E-3
BURN
VOL 0.5
FINISH`;
    const ast = parseDocument(text, { uri: "mass.mcu" });
    const m = buildSummaries(ast).materials[0];
    assert.ok(m.volumeCm3 != null && Math.abs(m.volumeCm3 - 0.5) < 1e-9);
    assert.ok(m.massG != null && m.massG > 0);
  });
});
