import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "./parser";
import { analyzeSemantics } from "./semantic";
import {
  analyzeBurnupSemantics,
  expandMaterialIntervals,
  parseBurTagsFromMatrStatements,
  validateBurnupStepOption,
} from "./burnupSemantics";

function burnDiags(text: string, uri = "burn.mcu") {
  const ast = parseDocument(text, { uri });
  return analyzeBurnupSemantics(ast);
}

function codes(diags: { code?: string }[]): string[] {
  return diags.map((d) => d.code ?? "").sort();
}

describe("expandMaterialIntervals", () => {
  it("expands single number as singleton", () => {
    assert.deepStrictEqual(expandMaterialIntervals([3]), [3]);
  });

  it("expands closed pair 3 3", () => {
    assert.deepStrictEqual(expandMaterialIntervals([3, 3]), [3]);
  });

  it("expands UserGuide example 3 3, 5 8, 15", () => {
    assert.deepStrictEqual(expandMaterialIntervals([3, 3, 5, 8, 15]), [3, 5, 6, 7, 8, 15]);
  });

  it("expands FISZON 1 1 5 7", () => {
    assert.deepStrictEqual(expandMaterialIntervals([1, 1, 5, 7]), [1, 5, 6, 7]);
  });
});

describe("parseBurTagsFromMatrStatements", () => {
  it("reads BUR= from MATR lines", () => {
    const ast = parseDocument(
      `PIN 1 0
MATR 1 BUR=F
U235 1e-3
MATR 2 BUR=A
H 1
MATR 3 BUR=N
AL 1
END
FINISH`,
      { uri: "bur.mcu" }
    );
    const map = parseBurTagsFromMatrStatements(ast.statements);
    assert.strictEqual(map.get(1)?.bur, "F");
    assert.strictEqual(map.get(2)?.bur, "A");
    assert.strictEqual(map.get(3)?.bur, "N");
  });
});

describe("validateBurnupStepOption", () => {
  const base = {
    code: "RSTP" as string | null,
    hasFinish: true,
    hasPowe: true,
    hasDpow: false,
    hasFlux: false,
    hasStep: true,
    hasDstp: false,
    hasFisz: true,
    hasAbsz: false,
    hasPowz: false,
    fiszMats: [1],
    abszMats: [] as number[],
    powzMats: [] as number[],
    knownMats: new Set([1, 2]),
    burByMat: new Map<number, string>(),
    stepValues: [20, 2],
    dstpValues: [] as number[],
    poweValues: [0.146],
    dpowValues: [] as number[],
    fluxValues: [] as number[],
    pbur: null as string | null,
    stepOptionActive: true,
  };

  it("accepts minimal valid STEP option", () => {
    assert.strictEqual(validateBurnupStepOption(base).length, 0);
  });

  it("reports missing CODE / FINISH / power / step / fisz-absz", () => {
    const issues = validateBurnupStepOption({
      ...base,
      code: null,
      hasFinish: false,
      hasPowe: false,
      hasStep: false,
      hasFisz: false,
    });
    const c = new Set(issues.map((i) => i.code));
    assert.ok(c.has("burnup-missing-code"));
    assert.ok(c.has("burnup-missing-finish"));
    assert.ok(c.has("burnup-missing-power"));
    assert.ok(c.has("burnup-missing-step"));
    assert.ok(c.has("burnup-missing-fisz-absz"));
  });

  it("reports mutual exclusion conflicts", () => {
    const issues = validateBurnupStepOption({
      ...base,
      hasDpow: true,
      hasDstp: true,
    });
    assert.ok(issues.some((i) => i.code === "burnup-powe-dpow-conflict"));
    assert.ok(issues.some((i) => i.code === "burnup-step-dstp-conflict"));
  });

  it("reports unknown materials and invalid CODE/PBUR", () => {
    const issues = validateBurnupStepOption({
      ...base,
      code: "NOPE",
      pbur: "XYZ",
      fiszMats: [99],
      abszMats: [88],
      powzMats: [77],
      hasAbsz: true,
      hasPowz: true,
    });
    assert.ok(issues.some((i) => i.code === "burnup-code-invalid"));
    assert.ok(issues.some((i) => i.code === "burnup-pbur-invalid"));
    assert.ok(issues.some((i) => i.code === "burnup-fisz-unknown"));
    assert.ok(issues.some((i) => i.code === "burnup-absz-unknown"));
    assert.ok(issues.some((i) => i.code === "burnup-powz-unknown"));
  });

  it("reports dT too small and non-monotonic STEP times", () => {
    const small = validateBurnupStepOption({
      ...base,
      stepValues: [0.01, 1],
    });
    assert.ok(small.some((i) => i.code === "burnup-dt-small"));

    const order = validateBurnupStepOption({
      ...base,
      stepValues: [100, 2, 50, 1],
    });
    // 100 then 50 looks incremental (DSTP-style) — dt of second segment 50/1 ok; first 100/2 ok
    // use strictly non-monotonic cumulative that isIncremental detects as false:
    const order2 = validateBurnupStepOption({
      ...base,
      stepValues: [100, 2, 100, 1],
    });
    assert.ok(order2.some((i) => i.code === "burnup-time-order"), codes(order2).join(","));
    void order;
  });

  it("skips STEP required cards when CODE is RFNL without step-style", () => {
    const issues = validateBurnupStepOption({
      ...base,
      code: "RFNL",
      stepOptionActive: false,
      hasPowe: false,
      hasStep: false,
      hasFisz: false,
    });
    assert.ok(!issues.some((i) => i.code === "burnup-missing-power"));
    assert.ok(!issues.some((i) => i.code === "burnup-missing-step"));
    assert.ok(!issues.some((i) => i.code === "burnup-missing-fisz-absz"));
  });

  it("checks BUR= consistency with FISZ/ABSZ/POWZ", () => {
    const issues = validateBurnupStepOption({
      ...base,
      hasAbsz: true,
      hasPowz: true,
      fiszMats: [1],
      abszMats: [2],
      powzMats: [3],
      knownMats: new Set([1, 2, 3, 4]),
      burByMat: new Map([
        [1, "A"],
        [2, "F"],
        [4, "F"],
        [3, "N"],
      ]),
    });
    assert.ok(issues.some((i) => i.code === "burnup-bur-mismatch"));
    assert.ok(issues.filter((i) => i.code === "burnup-bur-mismatch").length >= 3);
  });
});

describe("analyzeBurnupSemantics", () => {
  it("reports missing CODE and FINISH for bare BURN", () => {
    const diags = burnDiags(`BURN\nPOWER 1\nSTEP 10\nFISZ 1`);
    assert.ok(diags.some((d) => d.code === "burnup-missing-code"));
    assert.ok(diags.some((d) => d.code === "burnup-missing-finish"));
  });

  it("accepts catalog-style RSTP block with materials", () => {
    const text = `PIN 1 0
MATR 1
U235 1e-3
MATR 2
H 1
END
FINISH
BURN
CODE RSTP
FISZON 1 1
POWER 0.146
STEP 20 2
FINISH`;
    const diags = burnDiags(text);
    assert.strictEqual(diags.length, 0, diags.map((d) => `${d.code}:${d.message}`).join("; "));
  });

  it("flags unknown FISZ material", () => {
    const text = `PIN 1 0
MATR 1
U235 1e-3
END
FINISH
BURN
CODE RSTP
FISZ 9
POWER 1
STEP 10
FINISH`;
    const diags = burnDiags(text);
    assert.ok(diags.some((d) => d.code === "burnup-fisz-unknown"));
  });

  it("flags POWE+DPOW and STEP+DSTP conflicts", () => {
    const text = `PIN 1 0
MATR 1
U235 1e-3
END
FINISH
BURN
CODE RSTP
FISZ 1
POWE 1
DPOW 1
STEP 10
DSTP 10
FINISH`;
    const diags = burnDiags(text);
    assert.ok(diags.some((d) => d.code === "burnup-powe-dpow-conflict"));
    assert.ok(diags.some((d) => d.code === "burnup-step-dstp-conflict"));
  });

  it("flags invalid PBUR and CODE", () => {
    const text = `BURN
CODE XXXX
PBUR BAD
FINISH`;
    const diags = burnDiags(text);
    assert.ok(diags.some((d) => d.code === "burnup-code-invalid"));
    assert.ok(diags.some((d) => d.code === "burnup-pbur-invalid"));
  });

  it("flags small dT on STEP", () => {
    const text = `PIN 1 0
MATR 1
U235 1e-3
END
FINISH
BURN
CODE RSTP
FISZ 1
POWER 1
STEP 0.01 1
FINISH`;
    const diags = burnDiags(text);
    assert.ok(diags.some((d) => d.code === "burnup-dt-small"));
  });

  it("flags non-monotonic POWE times", () => {
    const text = `PIN 1 0
MATR 1
U235 1e-3
END
FINISH
BURN
CODE RSTP
FISZ 1
POWE 0.2 500, 0.1 400
STEP 1000 1
FINISH`;
    const diags = burnDiags(text);
    assert.ok(diags.some((d) => d.code === "burnup-time-order"));
  });

  it("defers BRG VOL length to crossModuleAudit (brg-vol-short)", () => {
    const text = `PIN 1 0
MATR 1
U235 1e-3
MATR 2
H 1
MATR 3
AL 1
END
FINISH
BRG 1 0
VOL 0.5 0.2
FINISH
BURN
CODE RSTP
FISZ 1
POWER 1
STEP 10
FINISH`;
    const ast = parseDocument(text, { uri: "vol.mcu" });
    const burn = analyzeBurnupSemantics(ast);
    assert.ok(!burn.some((d) => d.code === "burnup-vol-short" || d.code === "brg-vol-short"));
    const all = analyzeSemantics(ast);
    assert.ok(all.some((d) => d.code === "brg-vol-short" && d.severity === "warning"));
  });

  it("checks BUR= vs FISZ mismatch", () => {
    const text = `PIN 1 0
MATR 1 BUR=F
U235 1e-3
MATR 2 BUR=A
H 1
END
FINISH
BURN
CODE RSTP
FISZ 2
POWER 1
STEP 10
FINISH`;
    const diags = burnDiags(text);
    assert.ok(diags.some((d) => d.code === "burnup-bur-mismatch"));
  });

  it("does not require STEP cards for RFNL-only BURN", () => {
    const text = `BURN
CODE RFNL
TIMP 100 1
FINISH`;
    const diags = burnDiags(text);
    assert.ok(!diags.some((d) => d.code === "burnup-missing-power"));
    assert.ok(!diags.some((d) => d.code === "burnup-missing-step"));
    assert.ok(!diags.some((d) => d.code === "burnup-missing-fisz-absz"));
  });

  it("integrates into analyzeSemantics", () => {
    const text = `BURN
FINISH`;
    const ast = parseDocument(text, { uri: "sem.mcu" });
    const diags = analyzeSemantics(ast).filter((d) => d.code?.startsWith("burnup-"));
    assert.ok(diags.some((d) => d.code === "burnup-missing-code"));
  });

  it("RUNTEST burnup has no burnup-* errors", () => {
    const burnPath = path.join(__dirname, "../../../RUNTEST/BURNUPR/burnup");
    if (!fs.existsSync(burnPath)) return;
    const text = fs.readFileSync(burnPath, "utf8");
    const ast = parseDocument(text, { uri: "burnup" });
    const diags = analyzeBurnupSemantics(ast);
    assert.strictEqual(diags.length, 0, diags.map((d) => `${d.code}:${d.message}`).join("; "));
  });
});
