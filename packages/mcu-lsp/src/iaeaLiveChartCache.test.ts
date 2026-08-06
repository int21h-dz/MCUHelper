import { describe, it, after } from "node:test";
import assert from "node:assert";
import {
  clearLiveChartMemoryCache,
  getLiveChartGroundStates,
  parseLiveChartAtomicMasses,
  parseLiveChartCacheFile,
  liveChartMapToCacheFile,
  LIVECHART_USER_CACHE_TTL_MS,
} from "./iaeaLiveChartCache";

describe("iaeaLiveChartCache", () => {
  after(() => clearLiveChartMemoryCache());

  it("loads bundled ground states without network", async () => {
    clearLiveChartMemoryCache();
    const t0 = performance.now();
    const gs = await getLiveChartGroundStates({ allowNetwork: false });
    const ms = performance.now() - t0;
    assert.ok(gs.entryCount > 1000, `expected bundled entries, got ${gs.entryCount}`);
    assert.strictEqual(gs.usedNetwork, false);
    assert.ok(gs.source === "bundled" || gs.source === "merged");
    assert.ok(ms < 2000, `bundled load too slow: ${ms}ms`);
    const cs133 = gs.map.get("55:133");
    assert.ok(cs133);
    assert.ok(cs133!.mass > 132.9 && cs133!.mass < 133);
  });

  it("parseLiveChartAtomicMasses reads CSV", () => {
    const csv = [
      "z,n,symbol,half_life,half_life_sec,atomic_mass",
      "55,78,Cs,STABLE,,132905451.958",
      "55,82,Cs,30.08,949232333.3,136907089.296",
    ].join("\n");
    const map = parseLiveChartAtomicMasses(csv);
    assert.ok(map.get("55:133")?.halfLifeStable);
    assert.ok(map.get("55:137")!.halfLifeSec! > 1e8);
    assert.ok(map.get("55:137")!.mass > 136.9);
  });

  it("round-trips compact cache file", () => {
    const map = new Map([
      [
        "92:235",
        {
          z: 92,
          a: 235,
          mass: 235.0439,
          symbol: "U",
          halfLifeSec: 2e17,
          halfLifeStable: false,
        },
      ],
    ]);
    const file = liveChartMapToCacheFile(map, "2026-01-01T00:00:00.000Z");
    const back = parseLiveChartCacheFile(file);
    assert.strictEqual(back.get("92:235")!.mass, 235.0439);
    assert.ok(LIVECHART_USER_CACHE_TTL_MS > 0);
  });
});
