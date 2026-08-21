import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { isDbmBasename, isDbmInLibRoot } from "./dbmLibWatch";

describe("dbmLibWatch helpers", () => {
  it("detects .DBM basename case-insensitively", () => {
    assert.equal(isDbmBasename("MYMAT.DBM"), true);
    assert.equal(isDbmBasename("mymat.dbm"), true);
    assert.equal(isDbmBasename("AW.LIB"), false);
  });

  it("accepts only files in lib root, not nested", () => {
    const root = path.join("C:", "MDB650");
    assert.equal(isDbmInLibRoot(path.join(root, "MYMAT.DBM"), root), true);
    assert.equal(isDbmInLibRoot(path.join(root, "sub", "MYMAT.DBM"), root), false);
    assert.equal(isDbmInLibRoot(path.join(root, "AW.LIB"), root), false);
  });
});
