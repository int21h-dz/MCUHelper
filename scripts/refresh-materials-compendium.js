/**
 * Качает PNNL MaterialsCompendium.json, зачищает и пишет бандл в extension/media.
 * names.ru.json не перезаписывает — только отчёт missing/orphan.
 *
 * Usage: node scripts/refresh-materials-compendium.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const https = require("https");

const CONTENTS_URL =
  "https://api.github.com/repos/pyne/materials-compendium/contents/src/materials_compendium/MaterialsCompendium.json?ref=develop";
const RAW_URL =
  "https://raw.githubusercontent.com/pyne/materials-compendium/develop/src/materials_compendium/MaterialsCompendium.json";

const OUT_DIR = path.join(__dirname, "../extension/media/materialsCompendium");
const OUT_GZ = path.join(OUT_DIR, "catalog.json.gz");
const OUT_META = path.join(OUT_DIR, "meta.json");
const NAMES_RU = path.join(OUT_DIR, "names.ru.json");

function loadSlim() {
  const candidates = [
    path.join(__dirname, "../packages/mcu-language/dist/materialsCompendium.js"),
    path.join(__dirname, "../extension/vendor/mcu-language/materialsCompendium.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("Соберите packages/mcu-language (нет dist/materialsCompendium.js)");
}

function fetchBuffer(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: headers || {} }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        fetchBuffer(res.headers.location, headers, timeoutMs).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status} ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs || 120000, () => {
      req.destroy(new Error("timeout"));
    });
  });
}

async function main() {
  const api = loadSlim();
  const ua = { "User-Agent": "MCU-NR-Helper-materials-refresh", Accept: "application/vnd.github+json" };
  console.log("GitHub contents: SHA…");
  const infoBuf = await fetchBuffer(CONTENTS_URL, ua, 20000);
  const info = JSON.parse(infoBuf.toString("utf8"));
  const sourceSha = typeof info.sha === "string" ? info.sha : "";
  const downloadUrl = typeof info.download_url === "string" ? info.download_url : RAW_URL;
  console.log(`  sha=${sourceSha} size=${info.size}`);

  console.log("Download raw JSON…");
  const rawBuf = await fetchBuffer(downloadUrl, { "User-Agent": "MCU-NR-Helper-materials-refresh" }, 180000);
  const raw = JSON.parse(rawBuf.toString("utf8"));
  const catalog = api.slimMaterialsCompendium(raw, {
    sourceSha,
    generatedAt: new Date().toISOString(),
  });
  catalog.sourceSha = sourceSha;

  const json = JSON.stringify(catalog);
  const gz = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_GZ, gz);

  const meta = {
    sourceSha,
    siteVersion: catalog.siteVersion,
    generatedAt: catalog.generatedAt,
    materialCount: catalog.materialCount,
    source: "PNNL Compendium Rev. 2 via pyne/materials-compendium (BSD-2-Clause)",
    rawBytes: rawBuf.length,
    slimBytes: json.length,
    gzipBytes: gz.length,
  };
  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + "\n");

  let missing = [];
  let orphan = [];
  if (fs.existsSync(NAMES_RU)) {
    const dict = JSON.parse(fs.readFileSync(NAMES_RU, "utf8"));
    const names = catalog.materials.map((m) => m.name);
    const diff = api.diffNameTranslations(names, dict);
    missing = diff.missing;
    orphan = diff.orphan;
  } else {
    missing = catalog.materials.map((m) => m.name);
  }

  console.log(`Wrote ${catalog.materialCount} materials → ${OUT_GZ} (${gz.length} bytes gzip, ${json.length} slim)`);
  console.log(`missing translations: ${missing.length}`);
  console.log(`orphan translations: ${orphan.length}`);
  if (missing.length && missing.length <= 40) {
    for (const n of missing) console.log(`  missing: ${n}`);
  } else if (missing.length) {
    for (const n of missing.slice(0, 15)) console.log(`  missing: ${n}`);
    console.log(`  … and ${missing.length - 15} more`);
  }
  if (orphan.length && orphan.length <= 20) {
    for (const n of orphan) console.log(`  orphan: ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
