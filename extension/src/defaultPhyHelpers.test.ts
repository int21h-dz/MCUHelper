import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  defaultPhyTargetPath,
  listLibraryExtensions,
  loadDefaultPhyBytes,
  mergeOptionLists,
  resolveDefaultPhyPath,
  writeDefaultPhyAtomic,
} from "./defaultPhyHelpers";

describe("defaultPhyHelpers", () => {
  it("resolveDefaultPhyPath finds case-insensitive name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-phy-"));
    try {
      const phy = path.join(dir, "default.phy");
      fs.writeFileSync(phy, "* c\n#\n", "utf8");
      const resolved = resolveDefaultPhyPath(dir);
      assert.ok(resolved);
      assert.strictEqual(path.basename(resolved!).toUpperCase(), "DEFAULT.PHY");
      assert.strictEqual(defaultPhyTargetPath(dir), resolved);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaultPhyTargetPath falls back to DEFAULT.PHY when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-phy-"));
    try {
      assert.strictEqual(resolveDefaultPhyPath(dir), undefined);
      assert.strictEqual(defaultPhyTargetPath(dir), path.join(dir, "DEFAULT.PHY"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("listLibraryExtensions reads ACE and GAMTRA file extensions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-phy-"));
    try {
      fs.mkdirSync(path.join(dir, "ACE"));
      fs.mkdirSync(path.join(dir, "GAMTRA"));
      fs.writeFileSync(path.join(dir, "ACE", "H.E70"), "x");
      fs.writeFileSync(path.join(dir, "ACE", "U.j32"), "x");
      fs.writeFileSync(path.join(dir, "GAMTRA", "G.TVC"), "x");
      const opts = listLibraryExtensions(dir);
      assert.deepStrictEqual(opts.ace, ["E70", "j32"].sort((a, b) => a.localeCompare(b)));
      assert.deepStrictEqual(opts.pht, ["TVC"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mergeOptionLists dedupes", () => {
    assert.deepStrictEqual(mergeOptionLists(["E70", "AAA"], ["E70", "RF"]), ["AAA", "E70", "RF"]);
  });

  it("writeDefaultPhyAtomic creates bak and round-trips utf8", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-phy-"));
    try {
      const file = path.join(dir, "DEFAULT.PHY");
      fs.writeFileSync(file, "* old\n#\n", "utf8");
      writeDefaultPhyAtomic(file, "* new\nH E70 G 0 .0 1.0 SVC TVC .0 .0 -1. -1. 1\n#\n", "utf8", {
        backup: true,
      });
      assert.ok(fs.existsSync(file + ".bak"));
      assert.ok(fs.readFileSync(file + ".bak", "utf8").includes("old"));
      const loaded = loadDefaultPhyBytes(file);
      assert.strictEqual(loaded.encoding, "utf8");
      assert.ok(loaded.text.includes("* new"));
      assert.ok(loaded.text.includes("H E70"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
