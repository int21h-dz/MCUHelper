#!/usr/bin/env node
/**
 * Регрессионный гейт покрытия по coverage/lcov.info.
 * Пороги — полы (не цель 95%): не дать просесть ниже снимка.
 * --suggest  печатает JSON полов Math.floor(факт) по пакетам.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const lcovPath = path.join(root, "coverage", "lcov.info");
const floorsPath = path.join(__dirname, "coverage-floors.json");
const suggest = process.argv.includes("--suggest");

function pct(hit, found) {
  return found ? (100 * hit) / found : 100;
}

function pkgOf(file) {
  const f = file.replace(/\\/g, "/");
  if (f.includes("packages/mcu-schema/")) return "mcu-schema";
  if (f.includes("packages/mcu-language/")) return "mcu-language";
  if (f.includes("packages/mcu-geometry/")) return "mcu-geometry";
  if (f.includes("packages/mcu-lsp/")) return "mcu-lsp";
  if (f.includes("extension/")) return "extension";
  return "other";
}

function parseLcov(text) {
  const recs = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      cur = { file: line.slice(3), lf: 0, lh: 0, fnf: 0, fnh: 0, brf: 0, brh: 0 };
      recs.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith("LF:")) cur.lf = +line.slice(3);
    else if (line.startsWith("LH:")) cur.lh = +line.slice(3);
    else if (line.startsWith("FNF:")) cur.fnf = +line.slice(4);
    else if (line.startsWith("FNH:")) cur.fnh = +line.slice(4);
    else if (line.startsWith("BRF:")) cur.brf = +line.slice(4);
    else if (line.startsWith("BRH:")) cur.brh = +line.slice(4);
  }
  return recs;
}

function summarize(recs) {
  const empty = () => ({ files: 0, lf: 0, lh: 0, fnf: 0, fnh: 0, brf: 0, brh: 0 });
  const by = { global: empty() };
  for (const r of recs) {
    const p = pkgOf(r.file);
    if (!by[p]) by[p] = empty();
    for (const key of ["global", p]) {
      const b = by[key];
      b.files += 1;
      b.lf += r.lf;
      b.lh += r.lh;
      b.fnf += r.fnf;
      b.fnh += r.fnh;
      b.brf += r.brf;
      b.brh += r.brh;
    }
  }
  const metrics = {};
  for (const [name, b] of Object.entries(by)) {
    metrics[name] = {
      files: b.files,
      lines: +pct(b.lh, b.lf).toFixed(2),
      statements: +pct(b.lh, b.lf).toFixed(2),
      branches: +pct(b.brh, b.brf).toFixed(2),
      functions: +pct(b.fnh, b.fnf).toFixed(2),
      lh: b.lh,
      lf: b.lf,
    };
  }
  return metrics;
}

function suggestedFloors(metrics) {
  const out = {};
  for (const [name, m] of Object.entries(metrics)) {
    out[name] = {
      lines: Math.floor(m.lines),
      statements: Math.floor(m.statements),
      branches: Math.floor(m.branches),
      functions: Math.floor(m.functions),
    };
  }
  return out;
}

if (!fs.existsSync(lcovPath)) {
  console.error("Нет coverage/lcov.info — сначала: npm run test:coverage");
  process.exit(1);
}

const metrics = summarize(parseLcov(fs.readFileSync(lcovPath, "utf8")));
const order = ["global", "mcu-schema", "mcu-language", "mcu-geometry", "mcu-lsp", "extension", "other"];

if (suggest) {
  console.log(JSON.stringify(suggestedFloors(metrics), null, 2));
  process.exit(0);
}

if (!fs.existsSync(floorsPath)) {
  console.error("Нет scripts/coverage-floors.json");
  process.exit(1);
}

const floors = JSON.parse(fs.readFileSync(floorsPath, "utf8"));
const keys = ["lines", "statements", "branches", "functions"];
let failed = 0;

console.log("Покрытие vs регрессионные полы (не цель 95%):\n");
console.log(
  "package".padEnd(16),
  "lines".padStart(8),
  "branch".padStart(8),
  "funcs".padStart(8),
  "status"
);

for (const name of order) {
  if (!metrics[name] || !floors[name]) continue;
  const m = metrics[name];
  const f = floors[name];
  const misses = keys.filter((k) => typeof f[k] === "number" && m[k] + 1e-9 < f[k]);
  const ok = misses.length === 0;
  if (!ok) failed += 1;
  const mark = ok ? "ok" : "FAIL " + misses.map((k) => `${k} ${m[k]}<${f[k]}`).join(", ");
  console.log(
    name.padEnd(16),
    String(m.lines).padStart(8),
    String(m.branches).padStart(8),
    String(m.functions).padStart(8),
    mark
  );
}

if (failed) {
  console.error(`\ncoverage:check: ${failed} пакет(ов) ниже пола. Снимок: npm run test:coverage`);
  process.exit(1);
}
console.log("\ncoverage:check: полы держатся.");
