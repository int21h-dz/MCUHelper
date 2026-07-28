import { describe, it } from "node:test";
import assert from "node:assert";
import iconv from "iconv-lite";
import {
  decodeBuffer,
  detectEncodingFromBuffer,
  diskTextMatchesEditor,
  readTextFileWithDetectedEncoding,
} from "./encodingDetect";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SAMPLE = "PIN 1 0\n** Топливная зона\nMATR 1\nU235 1.E-3\nFINISH";

describe("encodingDetect", () => {
  it("detects utf8 for ASCII-only MCU", () => {
    const buf = Buffer.from("PIN 1 0\nMATR 1\nFINISH", "utf8");
    const r = detectEncodingFromBuffer(buf);
    assert.strictEqual(r.encoding, "utf8");
    assert.strictEqual(r.shouldReopen, false);
  });

  it("detects windows-1251 for Cyrillic comments", () => {
    const buf = iconv.encode(SAMPLE, "win1251");
    const r = detectEncodingFromBuffer(buf);
    assert.strictEqual(r.encoding, "win1251");
    assert.strictEqual(r.vscodeEncoding, "windows1251");
    assert.ok(r.shouldReopen);
    assert.strictEqual(decodeBuffer(buf, r.encoding), SAMPLE);
  });

  it("detects cp866 for DOS Cyrillic", () => {
    const buf = iconv.encode(SAMPLE, "cp866");
    const r = detectEncodingFromBuffer(buf);
    assert.strictEqual(r.encoding, "cp866");
    assert.ok(r.shouldReopen);
  });

  it("prefers utf8 when file is valid UTF-8 with Cyrillic", () => {
    const buf = Buffer.from(SAMPLE, "utf8");
    const r = detectEncodingFromBuffer(buf);
    assert.strictEqual(r.encoding, "utf8");
    assert.strictEqual(r.shouldReopen, false);
  });

  it("readTextFileWithDetectedEncoding reads cp1251 include", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-enc-"));
    const file = path.join(dir, "frag.mcu");
    fs.writeFileSync(file, iconv.encode("MATR 1\n** материал\nU235 1.E-3", "win1251"));
    const text = readTextFileWithDetectedEncoding(file);
    assert.ok(text.includes("материал"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("diskTextMatchesEditor true when editor has correct decode", () => {
    const buf = iconv.encode(SAMPLE, "win1251");
    assert.ok(diskTextMatchesEditor(buf, SAMPLE));
  });

  it("diskTextMatchesEditor false when editor mis-decoded as utf8", () => {
    const buf = iconv.encode(SAMPLE, "win1251");
    const wrong = buf.toString("utf8");
    assert.ok(!diskTextMatchesEditor(buf, wrong));
  });
});
