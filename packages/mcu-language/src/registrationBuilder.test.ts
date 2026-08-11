import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRegistrationSection, findRegistrationInsertLine } from "./registrationBuilder";

describe("registrationBuilder", () => {
  it("builds PTYPE section with MFLU and ENERGY", () => {
    const r = buildRegistrationSection({
      ptype: 1,
      materials: [1, 3, 2],
      energy: [0, 1e-5, 1],
    });
    assert.match(r.text, /PTYPE 1/);
    assert.match(r.text, /MFLU 1, 2, 3/);
    assert.match(r.text, /ENERGY 0, 0\.00001, 1/);
    assert.match(r.text, /END\n$/);
    assert.equal(r.warnings.length, 0);
  });

  it("findRegistrationInsertLine returns FINISH line of RGS", () => {
    const text = ["PIN", "FINISH", "RGS", "KEFF", "FINISH", "BURN"].join("\n");
    assert.equal(findRegistrationInsertLine(text), 4);
  });
});
