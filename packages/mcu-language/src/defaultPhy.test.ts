import { describe, it } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as path from "path";
import {
  collectFieldOptions,
  createDefaultPhyRow,
  createMinimalDefaultPhyText,
  formatDefCards,
  listDataRows,
  parseDefaultPhy,
  serializeDefaultPhy,
  buildDefaultPhyTable,
  getDefaultPhyEntry,
  setDefaultPhyTable,
  clearDefaultPhyTable,
} from "./defaultPhy";

const fixturePath = path.join(__dirname, "../../../test/fixtures/default.phy");
const runtestPath = path.join(__dirname, "../../../RUNTEST/DEFAULT.PHY");

describe("defaultPhy", () => {
  it("parses fixture with mid-file comments and terminator", () => {
    const text = fs.readFileSync(fixturePath, "utf8");
    const doc = parseDefaultPhy(text);
    assert.strictEqual(doc.fatal, false);
    assert.strictEqual(doc.hasTerminator, true);
    const rows = listDataRows(doc);
    assert.strictEqual(rows.length, 6);
    assert.strictEqual(rows[0]!.name, "H");
    assert.strictEqual(rows[0]!.mods, "H2OK");
    assert.strictEqual(rows[4]!.name, "U235");
    assert.strictEqual(rows[5]!.ace, "AAA");
    const comments = doc.blocks.filter((b) => b.kind === "comment");
    assert.ok(comments.some((c) => c.kind === "comment" && c.text.includes("mid-file")));
  });

  it("round-trips field values through serialize", () => {
    const text = fs.readFileSync(fixturePath, "utf8");
    const doc = parseDefaultPhy(text);
    const again = parseDefaultPhy(serializeDefaultPhy(doc));
    const a = listDataRows(doc);
    const b = listDataRows(again);
    assert.strictEqual(b.length, a.length);
    for (let i = 0; i < a.length; i++) {
      assert.strictEqual(b[i]!.name, a[i]!.name);
      assert.strictEqual(b[i]!.ace, a[i]!.ace);
      assert.strictEqual(b[i]!.mods, a[i]!.mods);
      assert.strictEqual(b[i]!.dtem, a[i]!.dtem);
      assert.strictEqual(b[i]!.pht, a[i]!.pht);
      assert.strictEqual(b[i]!.index, i + 1);
    }
    assert.ok(again.hasTerminator);
    assert.ok(serializeDefaultPhy(again).includes("mid-file comment"));
  });

  it("renumbers after add/delete", () => {
    const doc = parseDefaultPhy(fs.readFileSync(fixturePath, "utf8"));
    const dataIdx = doc.blocks.findIndex((b) => b.kind === "data");
    doc.blocks.splice(dataIdx, 1);
    doc.blocks.push({ kind: "data", row: createDefaultPhyRow({ name: "ZZ99", ace: "E70", mods: "G" }) });
    const out = parseDefaultPhy(serializeDefaultPhy(doc));
    const rows = listDataRows(out);
    assert.strictEqual(rows[rows.length - 1]!.name, "ZZ99");
    rows.forEach((r, i) => assert.strictEqual(r.index, i + 1));
  });

  it("flags missing terminator as fatal", () => {
    const doc = parseDefaultPhy("* c\nH E70 G 0 .0 1.0 SVC TVC .0 .0 -1. -1. 1\n");
    assert.strictEqual(doc.fatal, true);
    assert.ok(doc.warnings.some((w) => w.severity === "error"));
  });

  it("warns on duplicate NAME and bad MODS", () => {
    const doc = parseDefaultPhy(
      "H E70 G 0 .0 1.0 SVC TVC .0 .0 -1. -1. 1\nH E70 BAD 0 .0 1.0 SVC TVC .0 .0 -1. -1. 2\n#\n"
    );
    assert.ok(doc.warnings.some((w) => /Дубликат/.test(w.message)));
    assert.ok(doc.warnings.some((w) => /MODS=BAD/.test(w.message)));
  });

  it("warns on data after hash", () => {
    const doc = parseDefaultPhy("H E70 G 0 .0 1.0 SVC TVC .0 .0 -1. -1. 1\n#\nX E70 G 0 .0 1.0 SVC TVC .0 .0 -1. -1. 2\n");
    assert.ok(doc.warnings.some((w) => /после строки/.test(w.message)));
    assert.strictEqual(listDataRows(doc).length, 1);
  });

  it("formats DEF cards from selected rows", () => {
    const text = formatDefCards([
      createDefaultPhyRow({ name: "H", ace: "E70", mods: "H2OK", dtem: "1.0", pht: "TVC" }),
      createDefaultPhyRow({ name: "U235", ace: "", mods: "T", dtem: "", pht: "" }),
    ]);
    assert.strictEqual(
      text,
      "DEF H ACE=E70 MODS=H2OK DTEM=1.0 PHT=TVC\nDEF U235 MODS=T"
    );
  });

  it("collectFieldOptions unions file values with MODS_VALUES", () => {
    const doc = parseDefaultPhy(fs.readFileSync(fixturePath, "utf8"));
    const opts = collectFieldOptions(doc);
    assert.ok(opts.ace.includes("E70"));
    assert.ok(opts.ace.includes("AAA"));
    assert.ok(opts.mods.includes("H2OK"));
    assert.ok(opts.mods.includes("BEOK"));
    assert.ok(opts.pht.includes("TVC"));
  });

  it("createMinimalDefaultPhyText is parseable", () => {
    const doc = parseDefaultPhy(createMinimalDefaultPhyText());
    assert.strictEqual(doc.fatal, false);
    assert.strictEqual(listDataRows(doc).length, 0);
  });

  it("buildDefaultPhyTable indexes by NAME case-insensitively", () => {
    clearDefaultPhyTable();
    const doc = parseDefaultPhy(fs.readFileSync(fixturePath, "utf8"));
    const table = buildDefaultPhyTable(doc, fixturePath);
    setDefaultPhyTable(table);
    try {
      assert.strictEqual(table.entryCount, 6);
      assert.ok(getDefaultPhyEntry("u235"));
      assert.strictEqual(getDefaultPhyEntry("U235")!.mods, "T");
      assert.strictEqual(getDefaultPhyEntry("ZZ99"), null);
    } finally {
      clearDefaultPhyTable();
    }
  });

  it("round-trips RUNTEST/DEFAULT.PHY when present", { skip: !fs.existsSync(runtestPath) }, () => {
    const text = fs.readFileSync(runtestPath, "utf8");
    const doc = parseDefaultPhy(text);
    assert.strictEqual(doc.fatal, false);
    assert.ok(listDataRows(doc).length > 300);
    const again = parseDefaultPhy(serializeDefaultPhy(doc));
    assert.strictEqual(listDataRows(again).length, listDataRows(doc).length);
    assert.strictEqual(listDataRows(again)[0]!.name, "H");
  });
});
