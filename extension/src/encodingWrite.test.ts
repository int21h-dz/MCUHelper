import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeTextFilePreservingEncoding } from "./encodingDetect";

describe("writeTextFilePreservingEncoding", () => {
  it("creates and rewrites include content as utf8 by default", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-enc-write-"));
    try {
      const fp = path.join(dir, "sub", "frag.mcu");
      writeTextFilePreservingEncoding(fp, "SI N\n");
      assert.strictEqual(fs.readFileSync(fp, "utf8"), "SI N\n");
      writeTextFilePreservingEncoding(fp, "SI N, O\n");
      assert.strictEqual(fs.readFileSync(fp, "utf8"), "SI N, O\n");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
