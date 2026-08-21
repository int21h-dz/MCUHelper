import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildMatrDbmInsertPlain,
  buildMatrDbmInsertSnippet,
  clearDbmCache,
  listDbmCatalog,
  setDbmLibRoot,
} from "./dbmLib";

describe("DBM catalog for sidebar insert", () => {
  let tmp: string;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-dbm-cat-"));
    fs.writeFileSync(
      path.join(tmp, "GRAPHI.DBM"),
      ["CARB17 2 2", "C12 0.9893 A", "C13 0.0107 A", "#", ""].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tmp, "FUEL.DBM"),
      ["UO2 1 1", "U235 0.05 A", "UOX 2 1", "U238 0.9 A", "O16 0.1 A", "#", ""].join("\n"),
      "utf8"
    );
    setDbmLibRoot(tmp);
    clearDbmCache();
  });

  after(() => {
    setDbmLibRoot(null);
    clearDbmCache();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("lists materials from all *.DBM in MDBNR root", () => {
    const cat = listDbmCatalog(tmp);
    assert.equal(cat.length, 2);
    assert.equal(cat[0]!.library, "FUEL");
    assert.equal(cat[1]!.library, "GRAPHI");
    assert.deepEqual(
      cat[0]!.materials.map((m) => m.code),
      ["UO2", "UOX"]
    );
    assert.equal(cat[1]!.materials[0]!.code, "CARB17");
    assert.equal(cat[1]!.materials[0]!.densType, 2);
    assert.match(cat[1]!.materials[0]!.nuclidesPreview, /C12/);
  });

  it("builds snippet and plain insert text with DBM syntax", () => {
    const snip = buildMatrDbmInsertSnippet("GRAPHI", "CARB17", 3);
    assert.equal(snip, "MATR ${1:3} NAME=GRAPHI\nCARB17\nEND\n");
    const plain = buildMatrDbmInsertPlain("GRAPHI", "CARB17", 3);
    assert.equal(plain, "MATR 3 NAME=GRAPHI\nCARB17\nEND\n");
  });
});
