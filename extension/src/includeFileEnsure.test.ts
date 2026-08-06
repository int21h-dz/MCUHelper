import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ensureIncludeFileExists } from "./includeFileEnsure";

describe("includeFileEnsure", () => {
  it("creates missing file and parent directories", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-create-"));
    const fsPath = path.join(root, "frag", "confpd");
    assert.strictEqual(await ensureIncludeFileExists(fsPath), true);
    assert.ok(fs.existsSync(fsPath));
    assert.strictEqual(fs.readFileSync(fsPath, "utf8"), "");
  });

  it("returns true when file already exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-exist-"));
    const fsPath = path.join(root, "confpd.mcu");
    fs.writeFileSync(fsPath, "PIN 1 0\n", "utf8");
    assert.strictEqual(await ensureIncludeFileExists(fsPath), true);
    assert.strictEqual(fs.readFileSync(fsPath, "utf8"), "PIN 1 0\n");
  });

  it("returns false when path is an existing directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-dir-"));
    const fsPath = path.join(root, "confpd");
    fs.mkdirSync(fsPath);
    assert.strictEqual(await ensureIncludeFileExists(fsPath), false);
  });
});
