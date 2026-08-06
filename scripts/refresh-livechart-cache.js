/**
 * Обновляет бандл packages/mcu-lsp/src/data/livechart-ground-states.json
 * из IAEA LiveChart (для packing в VSIX).
 *
 * Usage: node scripts/refresh-livechart-cache.js
 */
const fs = require("fs");
const path = require("path");

const URL = "https://nds.iaea.org/relnsd/v1/data?fields=ground_states&nuclides=all";
const OUT = path.join(__dirname, "../packages/mcu-lsp/src/data/livechart-ground-states.json");

async function main() {
  const res = await fetch(URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; McuHelper/cache-refresh)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csv = await res.text();
  const lines = csv.split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const iZ = header.indexOf("z");
  const iN = header.indexOf("n");
  const iSym = header.indexOf("symbol");
  const iMass = header.indexOf("atomic_mass");
  const iHlSec = header.indexOf("half_life_sec");
  const iHl = header.indexOf("half_life");
  const e = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length <= Math.max(iZ, iN, iMass)) continue;
    const z = parseInt(cols[iZ], 10);
    const n = parseInt(cols[iN], 10);
    const micro = parseFloat(cols[iMass]);
    if (!Number.isFinite(z) || !Number.isFinite(n) || !Number.isFinite(micro) || micro <= 0) continue;
    const a = z + n;
    const row = { z, a, m: micro / 1e6 };
    const sym = iSym >= 0 ? cols[iSym]?.trim() : "";
    if (sym) row.s = sym;
    if (iHl >= 0 && /^stable$/i.test(cols[iHl]?.trim() || "")) row.st = true;
    if (iHlSec >= 0) {
      const sec = parseFloat(cols[iHlSec]);
      if (Number.isFinite(sec) && sec > 0) row.h = sec;
    }
    e.push(row);
  }
  const payload = {
    v: 1,
    fetchedAt: new Date().toISOString(),
    source: "IAEA LiveChart ground_states",
    n: e.length,
    e,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload));
  console.log(`Wrote ${e.length} entries → ${OUT} (${fs.statSync(OUT).size} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
