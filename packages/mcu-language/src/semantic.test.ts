import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDocument } from "./parser";
import { analyzeSemantics, buildSummaries } from "./semantic";
import { clearAwLibTable, parseAwLib, setAwLibTable } from "./awLib";
import { clearParameteThrTable, parseParameteThr, setParameteThrTable } from "./parameteThr";

function diags(text: string, uri = "semantic.mcu") {
  return analyzeSemantics(parseDocument(text, { uri }));
}

describe("semantic diagnostics", () => {
  it("errors on duplicate global EQU", () => {
    const d = diags("EQU A = 1\nEQU A = 2\nFINISH");
    assert.ok(d.some((x) => x.code === "const-redef" && x.message.includes("A")));
  });

  it("errors on EQU/SET inside physical (PIN) module", () => {
    const d = diags("PIN 1 0\nEQU DENS = 1e-3\nMATR 1\nU235 1e-3\nFINISH");
    assert.ok(
      d.some((x) => x.code === "card-wrong-fragment" && /EQU/i.test(x.message)),
      d.map((x) => `${x.code}:${x.message}`).join(" | ")
    );
    const dSet = diags("PIN 1 0\nSET DENS = 1e-3\nMATR 1\nU235 1e-3\nFINISH");
    assert.ok(
      dSet.some((x) => x.code === "card-wrong-fragment" && /SET/i.test(x.message)),
      dSet.map((x) => `${x.code}:${x.message}`).join(" | ")
    );
  });

  it("allows EQU in geometry (HEAD)", () => {
    const d = diags("HEAD 3 0\nEQU R = 10\nRPP BOX 0 R 0 R 0 R\nFINISH");
    assert.ok(!d.some((x) => x.code === "card-wrong-fragment" && /EQU/i.test(x.message)));
  });

  it("errors on TRANSF with unknown prototype", () => {
    const text = `HEAD 3 0
CONT T T
TRANSF T1 MISSING 0 0 0 1 0 0 0 1 0 0 0 1
FINISH`;
    const d = diags(text);
    assert.ok(d.some((x) => x.code === "transf-ref" && x.message.includes("MISSING")));
  });

  it("errors on MATR number gap (ordinal mismatch)", () => {
    const text = `PIN 1 0
MATR 1
U235 1.E-3
MATR 3
U238 1.E-3
FINISH`;
    const d = diags(text);
    assert.ok(
      d.some((x) => x.code === "matr-gap" && x.message.includes("порядковому") && x.message.includes("2")),
      d.filter((x) => x.code === "matr-gap").map((x) => x.message).join("; ")
    );
  });

  it("errors on empty MATR without nuclides", () => {
    const d = diags("MATR 1\nEND\nFINISH");
    const empty = d.find((x) => x.code === "matr-empty");
    assert.ok(empty);
    assert.match(empty!.message, /пуст/i);
  });

  it("errors when all MATR nuclides fall into SIDEN sum isotope", () => {
    const text = `PIN
SIDEN 1.0E-6
MATR 1 T=300
O 1E-10
END
FINISH`;
    const d = diags(text);
    const empty = d.find((x) => x.code === "matr-empty");
    assert.ok(empty, d.map((x) => `${x.code}:${x.message}`).join("; "));
    assert.match(empty!.message, /суммарн/i);
    assert.match(empty!.message, /SIDEN/i);
  });

  it("errors when all MATR nuclides are listed in SI", () => {
    const text = `PIN
SI U235 U238
MATR 1
U235 1.0E-2
U238 1.0E-2
END
FINISH`;
    const d = diags(text);
    const empty = d.find((x) => x.code === "matr-empty");
    assert.ok(empty);
    assert.match(empty!.message, /SI/i);
  });

  it("does not flag MATR empty when at least one nuclide stays outside sum isotope", () => {
    const text = `PIN
SIDEN 1.0E-6
MATR 1
O 1E-10
U235 1.0E-2
END
FINISH`;
    const d = diags(text);
    assert.ok(!d.some((x) => x.code === "matr-empty"));
  });

  it("errors on MATR redefinition with the same number", () => {
    const text = `PIN 1 0
MATR 1
U235 1.E-3
MATR 1
U238 1.E-3
FINISH`;
    const d = diags(text);
    const redef = d.find((x) => x.code === "matr-redef");
    assert.ok(redef, d.map((x) => `${x.code}:${x.message}`).join("; "));
    assert.ok(redef!.message.includes("MATR 1"));
    assert.ok(redef!.message.includes("строке 2"), redef!.message);
    assert.ok(redef!.related?.length === 1);
    assert.ok(!d.some((x) => x.code === "matr-gap"));
  });

  it("matr-redef prior ref points into #include path:line, not expanded line", () => {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const os = require("os") as typeof import("os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-matr-redef-"));
    try {
      fs.writeFileSync(path.join(dir, "MATR5"), "MATR 5\nU235 1.E-3\n", "utf8");
      const mainPath = path.join(dir, "main.mcu");
      const text = `PIN 1 0
#include MATR5
** ---
MATR 5
U238 1.E-3
FINISH
`;
      fs.writeFileSync(mainPath, text, "utf8");
      const { pathToFileURL } = require("url") as typeof import("url");
      const ast = parseDocument(text, { uri: pathToFileURL(mainPath).href, baseDir: dir });
      const d = analyzeSemantics(ast);
      const redef = d.find((x) => x.code === "matr-redef");
      assert.ok(redef, d.map((x) => `${x.code}:${x.message}`).join("; "));
      assert.ok(
        /MATR5:1/.test(redef!.message),
        `expected include path:line in message, got: ${redef!.message}`
      );
      assert.ok(!/ранее на строке \d+/.test(redef!.message), redef!.message);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors when later MATR reuses an earlier number", () => {
    const text = `PIN 1 0
MATR 1
U235 1.E-3
MATR 2
U238 1.E-3
MATR 1
H 1.E-2
FINISH`;
    const d = diags(text);
    assert.ok(d.some((x) => x.code === "matr-redef" && x.message.includes("MATR 1")));
  });

  it("allows same local number in different GROUP materials", () => {
    const text = `PIN 1 0
MATR 1 GROUP=A
U235 1.E-3
MATR 1 GROUP=B
U238 1.E-3
FINISH`;
    const d = diags(text);
    assert.ok(!d.some((x) => x.code === "matr-redef" || x.code === "matr-gap"));
  });

  it("errors on duplicate number inside the same GROUP", () => {
    const text = `PIN 1 0
MATR 1 GROUP=FUEL
U235 1.E-3
MATR 1 GROUP=FUEL
U238 1.E-3
FINISH`;
    const d = diags(text);
    assert.ok(d.some((x) => x.code === "matr-redef" && /GROUP=FUEL/i.test(x.message)));
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

  it("material summary activityBqPerG from PARAMETE.THR and ρ", () => {
    setAwLibTable(
      parseAwLib(`
CS37  55137 136.907089
`)
    );
    setParameteThrTable(
      parseParameteThr(`
LONGLIFE ISOTOPES
LIST
Cs-137  551370   137.      3.000E+00 y
stop
`)
    );
    try {
      const ast = parseDocument("PIN 1 0\nMATR 1\nCS37 1.0E-6\nFINISH", { uri: "act.mcu" });
      const m = buildSummaries(ast).materials[0]!;
      assert.ok(m.massDensityGcm3 != null && m.massDensityGcm3 > 0);
      assert.ok(m.activityBqPerG != null && m.activityBqPerG > 0);
    } finally {
      clearParameteThrTable();
      clearAwLibTable();
    }
  });

  it("material summary splits used nuclides and SI groups by AW.LIB presence", () => {
    setAwLibTable(
      parseAwLib(`
U235  92235 235.0439299
XE35  54135 134.907227
`)
    );
    try {
      const text = `PIN
SI U235 FP1
MATR 1
U235 1.0E-2
XE35 1.0E-3
FP1 1.0E-8
XYZZY BAD
FINISH`;
      const ast = parseDocument(text, { uri: "sum-groups.mcu" });
      const m = buildSummaries(ast).materials[0]!;
      assert.strictEqual(m.nuclideCount, 4);
      assert.strictEqual(m.usedNuclideCount, 3);
      assert.strictEqual(m.sumIsotopeCount, 2);
      assert.strictEqual(m.sumIsotopeUsedCount, 1);
      assert.strictEqual(m.sumIsotopeMissingAwLibCount, 1);
    } finally {
      clearAwLibTable();
    }
  });

  it("material summary still counts SI when nuclide rows are slimmed", () => {
    const lines = ["PIN", "SI FP1", "SIDEN 1e-20", "MATR 1"];
    for (let i = 0; i < 2001; i++) lines.push(`N${i} 1.0E-2`);
    lines.push("FP1 1.0E-8", "FINISH");
    const ast = parseDocument(lines.join("\n"), { uri: "slim-si.mcu" });
    const m = buildSummaries(ast).materials[0]!;
    assert.ok(m.nuclideCount > 2000);
    assert.strictEqual(m.nuclides.length, 0);
    assert.strictEqual(m.sumIsotopeCount, 1);
  });
});
