import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDocument } from "./parser";
import { analyzeSemantics } from "./semantic";
import {
  analyzeContCards,
  parseContCard,
  CONTAINER_FACE_COUNT,
  findContainerBody,
} from "./contValidation";
import { looksLikeZoneStatement } from "./zoneStatement";

describe("contValidation parseContCard", () => {
  it("parses BC with probabilities and S/PRS", () => {
    const p = parseContCard("CONT T T W(0.5) PRS60");
    assert.deepStrictEqual(
      p.bc.map((b) => ({ code: b.code, probability: b.probability })),
      [
        { code: "T", probability: undefined },
        { code: "T", probability: undefined },
        { code: "W", probability: 0.5 },
      ]
    );
    assert.equal(p.symmetries.length, 1);
    assert.equal(p.symmetries[0]!.kind, "PRS");
    assert.equal(p.symmetries[0]!.angle, 60);
  });

  it("parses S90 with rotation angle", () => {
    const p = parseContCard("CONT T T C S90 45");
    assert.equal(p.bc.map((b) => b.code).join(""), "TTC");
    assert.equal(p.symmetries[0]!.kind, "S");
    assert.equal(p.symmetries[0]!.angle, 90);
    assert.equal(p.symmetries[0]!.rotate, 45);
  });

  it("accepts bracket probability forms", () => {
    const p = parseContCard("CONT M[0.8] C(0.2) B");
    assert.equal(p.bc[0]!.probability, 0.8);
    assert.equal(p.bc[1]!.probability, 0.2);
    assert.equal(p.bc[2]!.code, "B");
  });
});

describe("contValidation diagnostics", () => {
  it("warns when BC count mismatches RCZ faces", () => {
    const text = ["HEAD 3 0", "CONT T T", "RCZ C 0 0 0 10 5", "END", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "cont-count.mcu" });
    const diags = analyzeContCards(ast);
    assert.ok(diags.some((d) => d.code === "cont-bc-count" && d.message.includes("3")));
    assert.equal(CONTAINER_FACE_COUNT.RCZ, 3);
    assert.equal(findContainerBody(ast)?.bodyType, "RCZ");
  });

  it("accepts HEX with 8 BC", () => {
    const text = [
      "HEAD 3 0",
      "CONT T T M M M M M M",
      "HEX C 0,0,0 1.806,0,100",
      "END",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "cont-hex.mcu" });
    const diags = analyzeContCards(ast).filter((d) => d.code === "cont-bc-count" || d.code === "cont-token");
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });

  it("errors on invalid BC token and probability", () => {
    const text = ["HEAD 3 0", "CONT X W(1.5) B", "SPH S 0 0 0 1", "END", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "cont-bad.mcu" });
    const diags = analyzeContCards(ast);
    assert.ok(diags.some((d) => d.code === "cont-token" && d.message.includes("X")));
    assert.ok(diags.some((d) => d.code === "cont-prob"));
  });

  it("warns on unpaired T on RPP", () => {
    const text = [
      "HEAD 3 0",
      "CONT T B B B B B",
      "RPP A 0 1 0 1 0 1",
      "END",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "cont-tpair.mcu" });
    const diags = analyzeContCards(ast);
    assert.ok(diags.some((d) => d.code === "cont-t-pair"));
  });

  it("validates CNTAND arg and order", () => {
    const text = [
      "HEAD 3 0",
      "CONT B",
      "CNTAND 2",
      "SPH S 0 0 0 1",
      "END",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "cntand.mcu" });
    const diags = analyzeContCards(ast);
    assert.ok(diags.some((d) => d.code === "cntand-arg"));
    assert.ok(diags.some((d) => d.code === "cntand-order"));
  });

  it("accepts CNTAND 1 before CONT", () => {
    const text = [
      "HEAD 3 0",
      "CNTAND 1",
      "CONT B",
      "SPH S 0 0 0 1",
      "END",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "cntand-ok.mcu" });
    const diags = analyzeContCards(ast).filter((d) => d.code?.startsWith("cntand"));
    assert.strictEqual(diags.length, 0, diags.map((d) => d.message).join("; "));
  });

  it("wires into analyzeSemantics", () => {
    const text = ["HEAD 3 0", "CONT Q", "SPH S 0 0 0 1", "END", "FINISH"].join("\n");
    const diags = analyzeSemantics(parseDocument(text, { uri: "cont-sem.mcu" }));
    assert.ok(diags.some((d) => d.code === "cont-token"));
  });
});

describe("CNTAND is not a zone", () => {
  it("looksLikeZoneStatement rejects CNTAND 0/1", () => {
    assert.ok(!looksLikeZoneStatement("CNTAND 1"));
    assert.ok(!looksLikeZoneStatement("CNTAND 0"));
    assert.ok(!looksLikeZoneStatement("CONT B B B"));
  });

  it("parseDocument does not create zone CNTAND", () => {
    const text = [
      "HEAD 3 0",
      "CNTAND 1",
      "CONT B B B",
      "RCZ C 0 0 0 10 5",
      "END",
      "Z1 C :1",
      "END",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "cntand-zone.mcu" });
    assert.ok(!ast.zones.some((z) => z.name === "CNTAND"));
    assert.ok(ast.statements.some((s) => s.label === "CNTAND"));
    assert.ok(!analyzeSemantics(ast).some((d) => d.code === "zone-body" && d.message.includes("CNTAND")));
  });
});
