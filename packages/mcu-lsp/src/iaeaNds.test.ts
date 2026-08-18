import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  enrichNuclideHoverWithIaea,
  formatNaturalInsertHoverButton,
  getCachedNuclideIaeaMarkdown,
  getNaturalIsotopeLines,
  prefetchNaturalAbundance,
  prefetchNuclideIaeaHover,
  resetIaeaNdsStateForTest,
  warmupNaturalAbundanceIndex,
} from "./iaeaNds";

function jsonRes(obj: unknown, ok = true): Response {
  return new Response(JSON.stringify(obj), {
    status: ok ? 200 : 404,
    headers: { "Content-Type": "application/json" },
  });
}

function mockIaeaFetch(url: string | URL | Request): Promise<Response> {
  const u = String(url);
  if (u.includes("fields=ground_states")) {
    const csv = [
      "z,n,symbol,radius,iso,abundance",
      "13,14,Al,0,0,100",
      "99,1,Xx,0,0,40",
      "99,2,Xx,0,0,60",
      "bad",
      "1,0,NoAbund,0,0,",
    ].join("\n");
    return Promise.resolve(new Response(csv, { status: 200 }));
  }
  if (u.includes("Reaction=decay") && u.includes("e4list")) {
    if (u.includes("Target=H-1")) {
      return Promise.resolve(jsonRes({ sections: [] }));
    }
    return Promise.resolve(
      jsonRes({
        sections: [
          { SectID: 9, LibName: "OTHER" },
          { SectID: 1, LibName: "ENDF/B-VIII.1", PenSectID: 11 },
        ],
      })
    );
  }
  if (u.includes("e4decay")) {
    if (u.includes("SectID=9")) {
      return Promise.resolve(jsonRes(null, false));
    }
    return Promise.resolve(
      jsonRes({
        Nucleus: "U-235",
        Library: "ENDF/B-VIII.1",
        AUTH: "X|Y",
        T12: 7.04e8,
        uT12: "y",
        dT12: 1e6,
        Spin: 3.5,
        Parity: "minus",
        DecayModes: [
          { txRTYP: "A", Branching: 1, DecayQ: 4678, uDecayQ: "keV" },
          { txRTYP: "SF", Branching: 1e-12 },
          { txRTYP: "?", Branching: 0.01 },
        ],
        Ealpha: 4395,
        uEalpha: "keV",
        Ebeta: 0,
      })
    );
  }
  if (u.includes("e4list") && u.includes("Quantity=SIG")) {
    if (u.includes("n%2C3n") || u.includes("Reaction=n,3n")) {
      return Promise.resolve(jsonRes({ sections: [] }));
    }
    if (u.includes("Target=H-1")) {
      return Promise.resolve(
        jsonRes({
          sections: [{ SectID: 2, PenSectID: 0, LibName: "JEFF-3.3" }],
        })
      );
    }
    return Promise.resolve(
      jsonRes({
        sections: [{ SectID: 2, PenSectID: 20, LibName: "JEFF-3.3" }],
      })
    );
  }
  if (u.includes("e4sig") && u.includes("PenSectID")) {
    return Promise.resolve(new Response('prefix {"E":0.0253,"Sig":583.12} tail', { status: 200 }));
  }
  if (u.includes("e4sig") && u.includes("SectID")) {
    return Promise.resolve(
      jsonRes({
        datasets: [
          {
            pts: [
              { E: 0.0253, Sig: 99, dSig: 1 },
              { E: 1e6, Sig: 1.2, dSig: 0.1 },
              { E: 14e6, Sig: 0.5 },
              { E: 2, Sig: -1 },
            ],
          },
        ],
      })
    );
  }
  return Promise.resolve(jsonRes({}, false));
}

describe("iaeaNds", () => {
  it("formatNaturalInsertHoverButton includes command link", () => {
    const md = formatNaturalInsertHoverButton({
      uri: "file:///t.mcu",
      line: 5,
      character: 10,
      nuclideName: "U",
      concentration: "1.E-3",
    });
    assert.ok(md.includes("mcuhelper.expandNaturalIsotope"));
    assert.ok(md.includes("U"));
  });

  it("getNaturalIsotopeLines returns bundled U isotopes without blocking on network", async () => {
    const t0 = performance.now();
    const lines = await getNaturalIsotopeLines("U", "0.1");
    const ms = performance.now() - t0;
    assert.ok(lines && lines.length >= 2);
    assert.ok(ms < 500, `expected instant bundled path, took ${ms.toFixed(0)}ms`);
    assert.ok(lines.some((l) => l.mcuName.startsWith("U2")));
  });

  it("getNaturalIsotopeLines returns bundled Hf isotopes without network", async () => {
    const t0 = performance.now();
    const lines = await getNaturalIsotopeLines("Hf", "1.0E-6");
    const ms = performance.now() - t0;
    assert.ok(lines && lines.length >= 2);
    assert.ok(ms < 500, `expected instant bundled path, took ${ms.toFixed(0)}ms`);
    assert.ok(lines.some((l) => l.mcuName === "HF74"));
    assert.ok(lines.some((l) => l.mcuName === "HF80"));
  });
});

describe("iaeaNds mocked network", () => {
  let tmp = "";

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iaea-nds-"));
    resetIaeaNdsStateForTest({
      cacheFile: path.join(tmp, "iaea-nds-cache.json"),
      abundanceFile: path.join(tmp, "natural-abundance-index.json"),
      fetchImpl: mockIaeaFetch as typeof fetch,
      persistDelayMs: 5,
      abundancePersistDelayMs: 5,
    });
  });

  after(() => {
    resetIaeaNdsStateForTest();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetIaeaNdsStateForTest({
      cacheFile: path.join(tmp, "iaea-nds-cache.json"),
      abundanceFile: path.join(tmp, "natural-abundance-index.json"),
      fetchImpl: mockIaeaFetch as typeof fetch,
      persistDelayMs: 5,
      abundancePersistDelayMs: 5,
    });
  });

  it("enrichNuclideHoverWithIaea builds decay + sigma tables", async () => {
    const md = await enrichNuclideHoverWithIaea("U235");
    assert.ok(md);
    assert.ok(md.includes("IAEA NDS"));
    assert.ok(md.includes("T1/2"));
    assert.ok(md.includes("Jpi"));
    assert.ok(md.includes("Распад"));
    assert.ok(md.includes("Сечения ENDF"));
    assert.ok(md.includes("(n,g)"));
    assert.ok(md.includes("X\\|Y") || md.includes("X|Y") || md.includes("X\\|Y"));
  });

  it("enrichNuclideHoverWithIaea hits in-memory cache and inFlight", async () => {
    const a = enrichNuclideHoverWithIaea("U238");
    const b = enrichNuclideHoverWithIaea("U238");
    const [x, y] = await Promise.all([a, b]);
    assert.strictEqual(x, y);
    const cached = await enrichNuclideHoverWithIaea("U238");
    assert.strictEqual(cached, x);
  });

  it("sigma-only hover when decay list is empty", async () => {
    const md = await enrichNuclideHoverWithIaea("H1");
    assert.ok(md);
    assert.ok(md.includes("IAEA NDS"));
    assert.ok(md.includes("Сечения ENDF"));
  });

  it("returns null for names that are not nuclide or element", async () => {
    assert.strictEqual(await enrichNuclideHoverWithIaea("???"), null);
    assert.strictEqual(getCachedNuclideIaeaMarkdown("???"), null);
    prefetchNuclideIaeaHover("???");
  });

  it("prefetch + getCached for isotope and natural with insert button", async () => {
    prefetchNuclideIaeaHover("U235");
    const iso = await enrichNuclideHoverWithIaea("U235");
    assert.ok(iso);
    assert.ok(getCachedNuclideIaeaMarkdown("U235")?.includes("IAEA NDS"));

    prefetchNaturalAbundance("U");
    warmupNaturalAbundanceIndex();
    const insert = {
      uri: "file:///a.mcu",
      line: 1,
      character: 0,
      nuclideName: "U",
      concentration: "1e-3",
    };
    prefetchNuclideIaeaHover("U", insert);
    await new Promise((r) => setTimeout(r, 40));
    const nat = getCachedNuclideIaeaMarkdown("U", insert);
    assert.ok(nat);
    assert.ok(nat.includes("природный"));
    assert.ok(nat.includes("mcuhelper.expandNaturalIsotope"));
  });

  it("getNaturalIsotopeLines rejects bad concentration and unknown element until CSV", async () => {
    assert.strictEqual(await getNaturalIsotopeLines("U", "nope"), null);
    const xx = await getNaturalIsotopeLines("Xx", "1.0");
    assert.ok(xx && xx.length >= 2);
  });

  it("persists hover cache to the test temp file", async () => {
    await enrichNuclideHoverWithIaea("C12");
    await new Promise((r) => setTimeout(r, 40));
    const cachePath = path.join(tmp, "iaea-nds-cache.json");
    const raw = fs.readFileSync(cachePath, "utf8");
    assert.ok(raw.includes("iso:") || raw.includes("C-12"));
  });

  it("network failure yields null markdown", async () => {
    resetIaeaNdsStateForTest({
      cacheFile: path.join(tmp, "iaea-nds-cache.json"),
      abundanceFile: path.join(tmp, "natural-abundance-index.json"),
      persistDelayMs: 5,
      abundancePersistDelayMs: 5,
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    const md = await enrichNuclideHoverWithIaea("O16");
    assert.strictEqual(md, null);
  });

  it("HTTP error and missing body are treated as empty", async () => {
    resetIaeaNdsStateForTest({
      cacheFile: path.join(tmp, "bad-cache.json"),
      abundanceFile: path.join(tmp, "bad-abund.json"),
      persistDelayMs: 5,
      abundancePersistDelayMs: 5,
      fetchImpl: (async () =>
        new Response("nope", { status: 500 })) as typeof fetch,
    });
    const md = await enrichNuclideHoverWithIaea("N14");
    assert.strictEqual(md, null);
  });
});
