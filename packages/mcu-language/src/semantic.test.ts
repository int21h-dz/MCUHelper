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
