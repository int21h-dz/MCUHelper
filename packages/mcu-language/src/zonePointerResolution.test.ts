import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "./parser";
import {
  cartogramValueAt,
  parseCartogramLabel,
  expandCartogramToken,
} from "./netCartogram";
import {
  computeNpmNom,
  resolvePointerSpecGlobal,
  resolveZoneAtLatticeElement,
  resolveZoneAtNetCell,
  zoneTailToPointerSpec,
} from "./zonePointerResolution";
import { buildZoneRegistrationMap, resolveZoneTail } from "./zoneRegistration";
import { analyzeSemantics, buildSummaries } from "./semantic";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("parseCartogramLabel", () => {
  it("parses Pkkjj / OkkALL / MkkLAY", () => {
    assert.deepEqual(parseCartogramLabel("P1105"), {
      kind: "reg",
      pointerIndex: 11,
      rowIndex: 5,
    });
    assert.deepEqual(parseCartogramLabel("P0101"), {
      kind: "reg",
      pointerIndex: 1,
      rowIndex: 1,
    });
    assert.deepEqual(parseCartogramLabel("O02ALL"), {
      kind: "obj",
      pointerIndex: 2,
      all: true,
    });
    assert.deepEqual(parseCartogramLabel("M01LAY"), {
      kind: "mat",
      pointerIndex: 1,
      layHeader: true,
    });
  });

  it("expands group repeat 2*(5,6,9)", () => {
    assert.deepEqual(expandCartogramToken("2*(5,6,9)"), ["5", "6", "9", "5", "6", "9"]);
  });
});

describe("parseZoneTail conditional slash/hash", () => {
  function tailOf(zoneLine: string) {
    const text = `HEAD 3 0
CONT T T
RPP A 0 1 0 1 0 1
END
${zoneLine}
END
FINISH`;
    const ast = parseDocument(text, { uri: "t.mcu" });
    return ast.zones[0]?.tail;
  }

  it("parses /-6:1/-2 as signed УРУ/УОУ", () => {
    const t = tailOf("ZPE A /-6:1/-2");
    assert.deepEqual(t, { kind: "legacy", reg: -6, mat: 1, obj: -2 });
  });

  it("parses /-1:1/-1", () => {
    const t = tailOf("ZNTE H /-1:1/-1");
    assert.deepEqual(t, { kind: "legacy", reg: -1, mat: 1, obj: -1 });
  });

  it("parses #im #iz #io", () => {
    const t = tailOf("Z1 A # im=3 iz=2 io=4");
    assert.equal(t?.kind, "hash");
    if (t?.kind === "hash") {
      assert.equal(t.im, 3);
      assert.equal(t.iz, 2);
      assert.equal(t.io, 4);
    }
  });

  it("still parses absolute /4:2/5", () => {
    const t = tailOf("ZN1 A /4:2/5");
    assert.deepEqual(t, { kind: "legacy", reg: 4, mat: 2, obj: 5 });
  });
});

describe("zonePointerResolution", () => {
  it("global resolve keeps conditional indices without absolute numbers", () => {
    const cache = new Map<number, number>();
    const spec = zoneTailToPointerSpec({ kind: "legacy", reg: -6, mat: 1, obj: -2 }, cache)!;
    const r = resolvePointerSpecGlobal(spec);
    assert.equal(r.regNum, undefined);
    assert.equal(r.objNum, undefined);
    assert.equal(r.materialNum, 1);
    assert.equal(r.regPointerIndex, 6);
    assert.equal(r.objPointerIndex, 2);
    assert.equal(r.hasConditionalPointers, true);
  });

  it("hash iz/io/im become conditional", () => {
    const cache = new Map<number, number>();
    const spec = zoneTailToPointerSpec({ kind: "hash", im: 1, iz: 2, io: 3 }, cache)!;
    assert.equal(spec.reg.kind, "conditional");
    assert.equal(spec.obj.kind, "conditional");
    assert.equal(spec.mat?.kind, "conditional");
    assert.equal(spec.reg.kind === "conditional" && spec.reg.index, 2);
  });

  it("resolveZoneAtNetCell looks up P/O by cell", () => {
    const cache = new Map<number, number>();
    const spec = zoneTailToPointerSpec({ kind: "legacy", reg: -1, mat: 1, obj: -1 }, cache)!;
    const net = {
      kind: "net" as const,
      name: "N1",
      root: "0 0 0",
      cols: 2,
      rows: 2,
      typeMap: [
        ["A", "A"],
        ["A", "A"],
      ],
      regCartogram: [
        { label: "P0101", pointerIndex: 1, rowIndex: 1, values: ["10", "11"] },
        { label: "P0102", pointerIndex: 1, rowIndex: 2, values: ["12", "13"] },
      ],
      objCartogram: [
        { label: "O0101", pointerIndex: 1, rowIndex: 1, values: ["20", "21"] },
        { label: "O0102", pointerIndex: 1, rowIndex: 2, values: ["22", "23"] },
      ],
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
        offset: 0,
        endOffset: 0,
      },
    };
    const r = resolveZoneAtNetCell(spec, net, [2, 1, 1], cache);
    assert.equal(r.regNum, 11);
    assert.equal(r.objNum, 21);
    assert.equal(r.materialNum, 1);
  });

  it("cartogramValueAt respects ALL", () => {
    const v = cartogramValueAt(
      [{ label: "O01ALL", pointerIndex: 1, all: true, values: ["9"] }],
      1,
      2,
      2,
      1,
      2
    );
    assert.equal(v, "9");
  });

  it("LATT Npm/Nom: УРУ 1 → npm+1", () => {
    const cache = new Map<number, number>();
    const spec = zoneTailToPointerSpec({ kind: "legacy", reg: -1, mat: 2 }, cache)!;
    const r = resolveZoneAtLatticeElement(spec, 8, 0, cache);
    assert.equal(r.regNum, 9);
    assert.equal(r.materialNum, 2);
    assert.equal(r.objNum, 1);
  });

  it("computeNpmNom from absolute zones", () => {
    const text = `HEAD 3 0
CONT T T
RCZ CNT 0 0 -10 20 10
END
Z0 CNT /8:8
END
FINISH`;
    const ast = parseDocument(text, { uri: "npm.mcu" });
    const { npm, nom } = computeNpmNom(ast.zones);
    assert.equal(npm, 8);
    assert.equal(nom, 1);
  });
});

describe("conditional_net fixture", () => {
  it("parses P/O cartograms and resolves summaries", () => {
    const path = join(__dirname, "../../../test/fixtures/conditional_net.mcu");
    const text = readFileSync(path, "utf8");
    const ast = parseDocument(text, { uri: "conditional_net.mcu" });
    assert.ok(ast.nets[0]?.regCartogram?.length === 2);
    assert.equal(ast.nets[0]!.regCartogram![0]!.pointerIndex, 1);
    assert.equal(ast.nets[0]!.regCartogram![0]!.rowIndex, 1);

    const znte = ast.zones.find((z) => z.name === "ZNTE");
    assert.ok(znte);
    const cache = new Map<number, number>();
    const resolved = resolveZoneTail(znte!.tail, cache)!;
    assert.equal(resolved.regPointerIndex, 1);
    assert.equal(resolved.objPointerIndex, 1);
    assert.equal(resolved.materialNum, 1);
    assert.equal(resolved.regNum, undefined);

    const sum = buildSummaries(ast);
    const s = sum.zones.find((z) => z.name === "ZNTE");
    assert.equal(s?.hasConditionalPointers, true);
    assert.equal(s?.regPointerIndex, 1);
    assert.ok((sum.nets[0]?.regCartogram?.length ?? 0) >= 2);
  });
});

describe("latt_example conditional L", () => {
  it("parses L /-1:2 as УРУ", () => {
    const path = join(__dirname, "../../../test/fixtures/latt_example.mcu");
    const text = readFileSync(path, "utf8");
    const ast = parseDocument(text, { uri: "latt_example.mcu" });
    const L = ast.zones.filter((z) => z.name === "L");
    assert.ok(L.length >= 1);
    const map = buildZoneRegistrationMap(ast.zones);
    for (const z of L) {
      const r = map.get(z.name);
      // last L in map wins by name — check tail directly
      const cache = new Map<number, number>();
      const spec = zoneTailToPointerSpec(z.tail, cache)!;
      assert.equal(spec.reg.kind, "conditional");
      assert.equal(spec.reg.kind === "conditional" && spec.reg.index, 1);
      assert.equal(spec.mat?.kind, "absolute");
      assert.equal(spec.mat?.kind === "absolute" && spec.mat.value, 2);
    }
    const { npm } = computeNpmNom(ast.zones.filter((z) => !z.scope || z.scope === "global"));
    assert.equal(npm, 8);
  });
});

describe("diagnostics conditional-pointer-missing", () => {
  it("warns when P cartogram present but УРУ index missing", () => {
    const text = `PIN 1 0
MATR 1
U235 1.E-3
HEAD 3 0
CONT T T
END
CELL A
RPP B 0 1 0 1 0 1
END
Z1 B /-2:1
END
NET N1 0 0 0 1 1
T01 A
P0101 5
END
FINISH`;
    const ast = parseDocument(text, { uri: "miss.mcu" });
    const d = analyzeSemantics(ast);
    assert.ok(d.some((x) => x.code === "conditional-pointer-missing" && x.message.includes("УРУ 2")));
  });

  it("does not warn NET about УРУ from unrelated LCELL/LATT", () => {
    const text = `PIN 1 0
MATR 1
U235 1.E-3
HEAD 3 0
CONT T T
RPP ROOT 0 2 0 2 0 1
END
Z0 ROOT /1:1
END
CELL A
RPP B 0 1 0 1 0 1
END
ZA B /1:1
END
NET N1 0 0 0 1 1
T01 A
P0101 5
END
LCELL L
RPP C 0 1 0 1 0 1
END
GROU C /-7:1
END
ENDL
LATT GLTL Z0
LISTEL L
PARM /1 0,0,0
FINISH`;
    const ast = parseDocument(text, { uri: "latt-uru.mcu" });
    const d = analyzeSemantics(ast);
    assert.ok(!d.some((x) => x.code === "conditional-pointer-missing" && x.message.includes("УРУ 7")), JSON.stringify(d.filter((x) => x.code === "conditional-pointer-missing")));
  });
});
