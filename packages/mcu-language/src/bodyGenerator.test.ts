import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateBodyName,
  buildBodyStatement,
  collectContinuedStatement,
  constantsToVarMap,
  getBodyGeneratorType,
  isValidBodyName,
  listBodyGeneratorTypes,
  parseBodySourceStatement,
  resolveBodyParamNumbers,
  sanitizeBodyName,
} from "./bodyGenerator";

describe("bodyGenerator", () => {
  it("lists supported body types with fields", () => {
    const types = listBodyGeneratorTypes();
    assert.ok(types.length >= 16);
    const keys = new Set(types.map((t) => t.key));
    for (const k of ["SPH", "RCZ", "HEX", "HEXG", "ARB", "QUAD", "TRANSF", "ELL", "WED", "UCX", "SLA", "TRC", "REC"]) {
      assert.ok(keys.has(k), "missing " + k);
    }
    const rcz = getBodyGeneratorType("RCZ");
    assert.ok(rcz);
    assert.equal(rcz!.fields.length, 5);
  });

  it("attaches UserGuide hints to body parameter fields", () => {
    const rcz = getBodyGeneratorType("RCZ");
    assert.ok(rcz);
    assert.equal(rcz!.fields[0].hint, "Центр нижнего основания");
    assert.equal(rcz!.fields[1].hint, "Центр нижнего основания");
    assert.equal(rcz!.fields[2].hint, "Центр нижнего основания");
    assert.equal(rcz!.fields[3].hint, "Высота вдоль OZ");
    assert.equal(rcz!.fields[4].hint, "Радиус");
    for (const t of listBodyGeneratorTypes()) {
      for (const f of t.fields) {
        assert.ok(f.hint && f.hint.length > 0, `${t.key}.${f.id} без hint`);
      }
      for (const group of t.formatGroups) {
        const hints = group.map((i) => t.fields[i]?.hint);
        assert.ok(
          hints.every((h) => h && h === hints[0]),
          `${t.key} группа ${group.join(",")} с разными hint`
        );
      }
    }
    const tr = getBodyGeneratorType("TRANSF");
    assert.ok(tr);
    assert.match(tr!.fields[1].hint ?? "", /отражен/i);
    assert.match(tr!.fields[2].hint ?? "", /\(A,\s*B,\s*0\)/);
    assert.match(tr!.fields[4].hint ?? "", /M/);
  });

  it("refuses insert when a middle parameter is empty", () => {
    const { warnings, okToInsert } = buildBodyStatement({
      bodyType: "RCZ",
      name: "Z1",
      params: ["0", "0", "0", "", "1"],
    });
    assert.equal(okToInsert, false);
    assert.ok(warnings.some((w) => /пустой/i.test(w)));
    const ok = buildBodyStatement({
      bodyType: "RCZ",
      name: "Z1",
      params: ["0", "0", "0", "1", "1"],
    });
    assert.equal(ok.okToInsert, true);
    assert.equal(ok.warnings.length, 0);
  });

  it("builds RCZ statement with grouped params", () => {
    const { text, warnings } = buildBodyStatement({
      bodyType: "RCZ",
      name: "fuel",
      params: ["0", "0", "0", "H", "R"],
    });
    assert.equal(text.trim(), "RCZ fuel 0,0,0 H R");
    assert.equal(warnings.length, 0);
  });

  it("builds ELL and WED grouped statements", () => {
    const ell = buildBodyStatement({
      bodyType: "ELL",
      name: "E1",
      params: ["0", "0", "0", "0", "0", "2", "1"],
    });
    assert.equal(ell.text.trim(), "ELL E1 0,0,0 0,0,2 1");
    const wed = buildBodyStatement({
      bodyType: "WED",
      name: "W1",
      params: ["0", "0", "0", "2", "0", "0", "0", "2", "0", "0", "0", "3"],
    });
    assert.equal(wed.text.trim(), "WED W1 0,0,0 2,0,0 0,2,0 0,0,3");
  });

  it("allocates unique auto-name from type letter", () => {
    assert.equal(allocateBodyName("HEX", []), "H");
    assert.equal(allocateBodyName("HEX", ["H", "C"]), "H1");
    assert.equal(allocateBodyName("RCZ", ["Z", "Z1", "FU"]), "Z2");
    assert.equal(allocateBodyName("HEX", ["h", "H1"]), "H2");
    assert.equal(allocateBodyName("TRC", []), "T1");
    assert.equal(allocateBodyName("TRANSF", ["T1"]), "T2");
    assert.equal(allocateBodyName("TRC", ["T", "T1"]), "T2");
  });

  it("sanitizes and rejects invalid body names", () => {
    assert.equal(sanitizeBodyName(" fuel 1"), "fuel1");
    assert.equal(sanitizeBodyName("1fuel"), "fuel");
    assert.equal(sanitizeBodyName("abcdefg"), "abcdef");
    assert.equal(sanitizeBodyName("*"), "*");
    assert.ok(isValidBodyName("fuel"));
    assert.ok(!isValidBodyName("1fuel"));
    assert.ok(!isValidBodyName("tooLong"));
    assert.ok(!isValidBodyName("T"));
    assert.ok(!isValidBodyName("u"));
    assert.ok(isValidBodyName("T1"));
    const { warnings } = buildBodyStatement({
      bodyType: "SPH",
      name: "123",
      params: ["0", "0", "0", "1"],
    });
    assert.ok(warnings.some((w) => /имя/i.test(w)));
  });

  it("resolves constants and expressions", () => {
    const vars = constantsToVarMap([
      { name: "R", value: 2 },
      { name: "H", value: 10 },
    ]);
    const { nums, warnings } = resolveBodyParamNumbers(["0", "0", "0", "H", "R*0.5"], vars);
    assert.deepEqual(nums, [0, 0, 0, 10, 1]);
    assert.equal(warnings.length, 0);
  });

  it("evaluates 12.5+LG2 with visible EQU", () => {
    const vars = constantsToVarMap([{ name: "LG2", value: 6.25 }]);
    const { nums, warnings } = resolveBodyParamNumbers(["12.5+LG2", "0", "8"], vars);
    assert.equal(warnings.length, 0);
    assert.equal(nums[0], 18.75);
  });

  it("evaluates EQU chain from expressions when value is missing", () => {
    const vars = constantsToVarMap([
      { name: "LG", expression: "25" },
      { name: "LG2", expression: "12.5-LG/2" },
    ]);
    const { nums, warnings } = resolveBodyParamNumbers(["12.5+LG2"], vars);
    assert.equal(warnings.length, 0);
    assert.equal(nums[0], 12.5);
  });

  it("parses body source lines and continuations", () => {
    const rcz = parseBodySourceStatement("RCZ fuel 0,0,0 H R");
    assert.ok(rcz);
    assert.equal(rcz!.bodyType, "RCZ");
    assert.equal(rcz!.name, "fuel");
    assert.deepEqual(rcz!.params, ["0", "0", "0", "H", "R"]);
    const commented = parseBodySourceStatement("RCZ fuel 0,0,0 1 1 ; note");
    assert.deepEqual(commented?.params, ["0", "0", "0", "1", "1"]);
    assert.equal(parseBodySourceStatement("* RCZ x 0,0,0 1 1"), null);
    assert.equal(parseBodySourceStatement("MATR 1"), null);
    const tr = parseBodySourceStatement("TRANSF CYLFT CYLRG M 10.5, 0 90");
    assert.equal(tr?.bodyType, "TRANSF");
    assert.equal(tr?.name, "CYLFT");
    assert.deepEqual(tr?.params, ["CYLRG", "M", "10.5", "0", "90"]);
    const arb = parseBodySourceStatement("ARB N1 -1,-1,0 1,-1,0 / 1234");
    assert.equal(arb?.bodyType, "ARB");
    assert.ok(arb!.params[0]?.includes("/"));
    const joined = collectContinuedStatement(["RCZ A 0,0,0", " 1 2"], 1);
    assert.ok(joined);
    assert.equal(joined!.startLine, 0);
    assert.equal(joined!.endLine, 1);
    const parsed = parseBodySourceStatement(joined!.text);
    assert.deepEqual(parsed?.params, ["0", "0", "0", "1", "2"]);
    assert.equal(collectContinuedStatement(["* comment", " RCZ A 0"], 0), null);
  });
});
