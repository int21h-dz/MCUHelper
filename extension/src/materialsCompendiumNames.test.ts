import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { describe, it } from "node:test";
import { diffNameTranslations, loadCatalogJson } from "@mcuhelper/mcu-language";

describe("bundled materials compendium translations", () => {
  it("names.ru.json covers every catalog Name", () => {
    const dir = path.join(__dirname, "..", "media", "materialsCompendium");
    const gz = fs.readFileSync(path.join(dir, "catalog.json.gz"));
    const cat = loadCatalogJson(JSON.parse(zlib.gunzipSync(gz).toString("utf8")));
    const dict = JSON.parse(fs.readFileSync(path.join(dir, "names.ru.json"), "utf8")) as Record<string, string>;
    const diff = diffNameTranslations(cat.materials.map((m) => m.name), dict);
    assert.equal(diff.missing.length, 0, `missing: ${diff.missing.slice(0, 8).join("; ")}`);
    assert.ok(cat.materialCount >= 400);
    assert.ok(dict["Water, Liquid"]?.includes("Вода"));
  });
});
