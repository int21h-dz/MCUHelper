import { describe, it } from "node:test";
import assert from "node:assert";
import { parseDocument } from "./parser";
import {
  isIceExpandBlocked,
  isIceExpandBlockedForMaterial,
  resolveIceDecompositionStateAt,
} from "./iceDecomposition";

describe("iceDecomposition", () => {
  it("ICENOT list blocks listed natural elements only", () => {
    const text = ["PIN", "ICENOT Fe O", "MATR 1", "Fe 1e-2", "U 1e-3", "O 1e-2", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "icenot.mcu" });
    const mat = ast.materials[0]!;
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat, "Fe"), true);
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat, "O"), true);
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat, "U"), false);
  });

  it("empty ICENOT disables decomposition for everyone", () => {
    const text = ["PIN", "ICENOT", "MATR 1", "Fe 1e-2", "U 1e-3", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "icenot-empty.mcu" });
    const mat = ast.materials[0]!;
    const state = resolveIceDecompositionStateAt(ast.statements, mat.range.offset);
    assert.strictEqual(state.listMode, "off");
    assert.strictEqual(isIceExpandBlocked("Fe", state), true);
    assert.strictEqual(isIceExpandBlocked("U", state), true);
  });

  it("ICENOT AAAA blocks all elements", () => {
    const text = ["PIN", "ICENOT AAAA", "MATR 1", "N 1e-5", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "icenot-aaaa.mcu" });
    const mat = ast.materials[0]!;
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat, "N"), true);
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat, "U"), true);
  });

  it("later ICE restores expand for listed elements after ICENOT", () => {
    const text = [
      "PIN",
      "ICENOT Fe",
      "MATR 1",
      "Fe 1e-2",
      "ICE Fe U",
      "MATR 2",
      "Fe 1e-2",
      "FINISH",
    ].join("\n");
    const ast = parseDocument(text, { uri: "ice-after.mcu" });
    const mat1 = ast.materials[0]!;
    const mat2 = ast.materials[1]!;
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat1, "Fe"), true);
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat2, "Fe"), false);
  });

  it("ICE allowlist blocks elements not in the list", () => {
    const text = ["PIN", "ICE Fe U", "MATR 1", "Fe 1e-2", "N 1e-5", "O 1e-2", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "ice-allow.mcu" });
    const mat = ast.materials[0]!;
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat, "Fe"), false);
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat, "U"), false);
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat, "N"), true);
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat, "O"), true);
  });

  it("empty ICE disables decomposition for everyone", () => {
    const text = ["PIN", "ICE", "MATR 1", "Fe 1e-2", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "ice-empty.mcu" });
    const mat = ast.materials[0]!;
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat, "Fe"), true);
  });

  it("without ICE/ICENOT expand is not blocked", () => {
    const text = ["PIN", "MATR 1", "N 1e-5", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "no-ice.mcu" });
    const mat = ast.materials[0]!;
    assert.strictEqual(isIceExpandBlockedForMaterial(ast, mat, "N"), false);
  });

  it("ICE/ICENOT/SI list/SINOT after MATR are cards, not nuclides", () => {
    for (const card of ["ICE Fe O", "ICENOT N", "SI FP1", "SINOT U235"]) {
      const text = ["PIN", "MATR 1", "Fe 1e-2", card, "FINISH"].join("\n");
      const ast = parseDocument(text, { uri: "after-matr.mcu" });
      assert.deepStrictEqual(
        ast.materials[0]!.nuclides.map((n) => n.name.toUpperCase()),
        ["FE"],
        card
      );
      assert.ok(
        !ast.diagnostics.some((d) => d.code === "matr-nuclide-conc"),
        card + " " + ast.diagnostics.map((d) => d.message).join("; ")
      );
    }
  });

  it("SI dens after MATR remains silicon nuclide", () => {
    const text = ["PIN", "MATR 1", "SI 1.1E-2", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "si-dens.mcu" });
    assert.strictEqual(ast.materials[0]!.nuclides[0]!.name.toUpperCase(), "SI");
    assert.strictEqual(ast.materials[0]!.nuclides[0]!.density, "1.1E-2");
  });

  it("SI/SINOT/ICE/ICENOT outside physical get card-wrong-fragment", () => {
    const text = ["HEAD", "SI FP1", "SINOT U235", "ICE Fe", "ICENOT N", "FINISH"].join("\n");
    const ast = parseDocument(text, { uri: "geo-ice.mcu" });
    const wrong = ast.diagnostics.filter((d) => d.code === "card-wrong-fragment");
    const labels = wrong.map((d) => d.message.match(/Карта (\w+)/)?.[1]).sort();
    assert.deepStrictEqual(labels, ["ICE", "ICENOT", "SI", "SINOT"]);
  });
});
