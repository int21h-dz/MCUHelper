import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGithubFileMeta, pickCatalogSource, USER_CATALOG_FILENAME } from "./materialsCompendiumStore";

describe("materialsCompendiumStore", () => {
  it("keeps user bank filename next to cache, not in the VSIX media tree", () => {
    assert.equal(USER_CATALOG_FILENAME, "userCatalog.json");
  });

  it("parses GitHub contents SHA and download URL", () => {
    const meta = parseGithubFileMeta({
      sha: "abc123",
      download_url: "https://example.com/file.json",
    });
    assert.deepEqual(meta, { sha: "abc123", downloadUrl: "https://example.com/file.json" });
    assert.equal(parseGithubFileMeta({}), null);
  });

  it("prefers bundled when SHA matches or bundled is newer", () => {
    const bundled = { sourceSha: "aaa", generatedAt: "2026-08-13T12:00:00.000Z" };
    assert.equal(pickCatalogSource(bundled, null), "bundled");
    assert.equal(pickCatalogSource(bundled, { sourceSha: "aaa", generatedAt: "2026-08-01T00:00:00.000Z" }), "bundled");
    assert.equal(
      pickCatalogSource(
        { sourceSha: "aaa", generatedAt: "2026-08-01T00:00:00.000Z" },
        { sourceSha: "bbb", generatedAt: "2026-08-13T00:00:00.000Z" }
      ),
      "cache"
    );
    assert.equal(
      pickCatalogSource(bundled, { sourceSha: "bbb", generatedAt: "2026-08-01T00:00:00.000Z" }),
      "bundled"
    );
  });
});
