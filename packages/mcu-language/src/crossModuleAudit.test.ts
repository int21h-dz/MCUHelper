import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDocument } from "./parser";
import { analyzeSemantics } from "./semantic";
import {
  analyzeBrgVolLength,
  analyzeCrossModuleLinks,
  analyzeRegistrationListLinks,
  analyzeZoneMaterialLinks,
  parseRegistrationList,
  registrationListKind,
} from "./crossModuleAudit";

describe("parseRegistrationList", () => {
  it("parses comma/space ranges like 1, 3-5, 7", () => {
    const r = parseRegistrationList("MFLU 1, 3-5, 7");
    assert.strictEqual(r.all, false);
    assert.deepStrictEqual(r.numbers, [1, 3, 4, 5, 7]);
  });

  it("treats lone 0 as all", () => {
    const r = parseRegistrationList("ORCT 0");
    assert.strictEqual(r.all, true);
    assert.deepStrictEqual(r.numbers, []);
  });

  it("treats 0 among tokens as all", () => {
    const r = parseRegistrationList("OFLU 1 0 3");
    assert.strictEqual(r.all, true);
  });

  it("handles descending range", () => {
    const r = parseRegistrationList("ZNEN 5-3");
    assert.deepStrictEqual(r.numbers, [3, 4, 5]);
  });

  it("returns empty for label-only", () => {
    const r = parseRegistrationList("MNEN");
    assert.strictEqual(r.all, false);
    assert.deepStrictEqual(r.numbers, []);
  });
});

describe("registrationListKind", () => {
  it("maps M/Z/O list cards", () => {
    assert.strictEqual(registrationListKind("mnen"), "material");
    assert.strictEqual(registrationListKind("ZNEN"), "zone");
    assert.strictEqual(registrationListKind("OFLU"), "object");
    assert.strictEqual(registrationListKind("MRCT"), "material");
    assert.strictEqual(registrationListKind("ENERGY"), null);
  });
});

describe("analyzeRegistrationListLinks", () => {
  const geoPin = `PIN 1 0
MATR 1
U235 1.0
MATR 2
H1 1.0
FINISH
HEAD 1 0
CONT T T
RPP A 0 1 0 1 0 1
Z1 A /1:1/1
Z2 A /2:2/2
END
FINISH
`;

  it("warns on unknown material in MNEN", () => {
    const text = `${geoPin}RGS
MNEN 1, 3
FINISH`;
    const ast = parseDocument(text, { uri: "reg-mat.mcu" });
    const diags = analyzeRegistrationListLinks(ast);
    assert.ok(diags.some((d) => d.code === "reg-mat-unknown" && d.message.includes("№3")));
    assert.ok(!diags.some((d) => d.message.includes("№1")));
  });

  it("warns on unknown reg zone in ZFLU", () => {
    const text = `${geoPin}RGS
PTYPE 1
ZFLU 1-3
END
FINISH`;
    const ast = parseDocument(text, { uri: "reg-zone.mcu" });
    const diags = analyzeRegistrationListLinks(ast);
    assert.ok(diags.some((d) => d.code === "reg-zone-unknown" && d.message.includes("№3")));
  });

  it("warns on unknown object in OFLU", () => {
    const text = `${geoPin}RGS
PTYPE 1
OFLU 1, 9
END
FINISH`;
    const ast = parseDocument(text, { uri: "reg-obj.mcu" });
    const diags = analyzeRegistrationListLinks(ast);
    assert.ok(diags.some((d) => d.code === "reg-obj-unknown" && d.message.includes("№9")));
  });

  it("knows object numbers from NET O-cartogram (not only zone tails)", () => {
    const text = `PIN 1 0
MATR 1
U235 1.0
FINISH
HEAD 1 0
CONT T T
RPP A 0 1 0 1 0 1
Z1 A /1:1
END
NET N1 0 0 0 2 2
T01 A A
O0156 1 2
END
FINISH
RGS
PTYPE 1
ORCT 2
END
FINISH`;
    const ast = parseDocument(text, { uri: "reg-obj-net.mcu" });
    const diags = analyzeRegistrationListLinks(ast);
    assert.strictEqual(
      diags.filter((d) => d.code === "reg-obj-unknown").length,
      0,
      diags.map((d) => d.message).join("; ")
    );
  });

  it("keeps object numbers from earlier CELL when later CELL reuses the zone name", () => {
    const text = `PIN 1 0
MATR 1
U235 1.0
FINISH
HEAD 1 0
CONT T T
CELL CA
RPP A 0 1 0 1 0 1
END
Z1 A #M=1 #Z=1 #O=2
END
CELL CB
RPP B 0 1 0 1 0 1
END
Z1 B #M=1 #Z=1 #O=1
END
END
FINISH
RGS
PTYPE 1
ORCT 2
END
FINISH`;
    const ast = parseDocument(text, { uri: "reg-obj-cell.mcu" });
    const diags = analyzeRegistrationListLinks(ast);
    assert.strictEqual(
      diags.filter((d) => d.code === "reg-obj-unknown").length,
      0,
      diags.map((d) => d.message).join("; ")
    );
  });

  it("still warns when object is absent from zones and O-cartogram", () => {
    const text = `PIN 1 0
MATR 1
U235 1.0
FINISH
HEAD 1 0
CONT T T
RPP A 0 1 0 1 0 1
Z1 A /1:1
END
FINISH
RGS
PTYPE 1
ORCT 2
END
FINISH`;
    const ast = parseDocument(text, { uri: "reg-obj-missing.mcu" });
    const diags = analyzeRegistrationListLinks(ast);
    assert.ok(diags.some((d) => d.code === "reg-obj-unknown" && d.message.includes("№2")));
  });

  it("skips checks when list is 0 (all)", () => {
    const text = `${geoPin}RGS
PTYPE 1
ORCT 0
END
FINISH`;
    const ast = parseDocument(text, { uri: "reg-all.mcu" });
    const diags = analyzeRegistrationListLinks(ast);
    assert.strictEqual(diags.length, 0);
  });

  it("skips when geometry numbers are absent", () => {
    const text = `RGS
PTYPE 1
OFLU 1-29
END
FINISH`;
    const ast = parseDocument(text, { uri: "reg-nogeo.mcu" });
    const diags = analyzeRegistrationListLinks(ast);
    assert.strictEqual(diags.length, 0);
  });
});

describe("analyzeZoneMaterialLinks", () => {
  it("warns when :mat is not an existing MATR number", () => {
    const text = `PIN 1 0
MATR 1
U235 1.0
FINISH
HEAD 1 0
CONT T T
RPP A 0 1 0 1 0 1
Z1 A :4
END
FINISH`;
    const ast = parseDocument(text, { uri: "zone-mat.mcu" });
    const diags = analyzeZoneMaterialLinks(ast);
    assert.ok(diags.some((d) => d.code === "zone-mat" && d.message.includes("4")));
  });

  it("accepts existing material number", () => {
    const text = `PIN 1 0
MATR 1
U235 1.0
FINISH
HEAD 1 0
CONT T T
RPP A 0 1 0 1 0 1
Z1 A :1
END
FINISH`;
    const ast = parseDocument(text, { uri: "zone-mat-ok.mcu" });
    assert.strictEqual(analyzeZoneMaterialLinks(ast).length, 0);
  });
});

describe("analyzeBrgVolLength", () => {
  it("warns when VOL is shorter than material count", () => {
    const text = `PIN 1 0
MATR 1
U235 1.0
MATR 2
H1 1.0
MATR 3
O16 1.0
FINISH
BRG 1 0
VOL 0.5 0.2
FINISH`;
    const ast = parseDocument(text, { uri: "brg-vol.mcu" });
    const diags = analyzeBrgVolLength(ast);
    assert.ok(diags.some((d) => d.code === "brg-vol-short"));
  });

  it("silent when VOL covers all materials", () => {
    const text = `PIN 1 0
MATR 1
U235 1.0
MATR 2
H1 1.0
FINISH
BRG 1 0
VOL 0.5 0.2
FINISH`;
    const ast = parseDocument(text, { uri: "brg-vol-ok.mcu" });
    assert.strictEqual(analyzeBrgVolLength(ast).length, 0);
  });

  it("requires BRG/BRGD header", () => {
    const text = `PIN 1 0
MATR 1
U235 1.0
MATR 2
H1 1.0
FINISH
VOL 0.5
FINISH`;
    const ast = parseDocument(text, { uri: "vol-no-brg.mcu" });
    assert.strictEqual(analyzeBrgVolLength(ast).length, 0);
  });
});

describe("analyzeCrossModuleLinks + analyzeSemantics", () => {
  it("integrates codes into analyzeSemantics", () => {
    const text = `PIN 1 0
MATR 1
U235 1.0
MATR 2
H1 1.0
FINISH
HEAD 1 0
CONT T T
RPP A 0 1 0 1 0 1
Z1 A /1:1/1
END
FINISH
RGS
MNEN 3
FINISH
BRG 1 0
VOL 0.1
FINISH`;
    const ast = parseDocument(text, { uri: "xmod.mcu" });
    const viaModule = analyzeCrossModuleLinks(ast);
    const viaSemantic = analyzeSemantics(ast);
    assert.ok(viaModule.some((d) => d.code === "reg-mat-unknown"));
    assert.ok(viaModule.some((d) => d.code === "brg-vol-short"));
    assert.ok(viaSemantic.some((d) => d.code === "reg-mat-unknown"));
    assert.ok(viaSemantic.some((d) => d.code === "brg-vol-short"));
  });
});
