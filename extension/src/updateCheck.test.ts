import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareNormalizedVersions,
  isNewerRelease,
  normalizeVersionString,
  parseLatestReleaseInfo,
} from "./updateCheck";

describe("updateCheck", () => {
  it("normalizes release titles and semver strings", () => {
    assert.equal(normalizeVersionString("V 0.9"), "0.9.0");
    assert.equal(normalizeVersionString("0.9.1"), "0.9.1");
    assert.equal(normalizeVersionString("MCU6_0.10"), "0.10.0");
  });

  it("compares normalized versions numerically", () => {
    assert.equal(compareNormalizedVersions("0.9.0", "0.9.0"), 0);
    assert.equal(compareNormalizedVersions("0.10.0", "0.9.5"), 1);
    assert.equal(compareNormalizedVersions("0.9.0", "0.10.0"), -1);
  });

  it("parses GitHub latest release payload using release name first", () => {
    const release = parseLatestReleaseInfo({
      name: "V 0.10",
      tag_name: "MCU6_0.10",
      html_url: "https://github.com/int21h-dz/MCUHelper/releases/tag/MCU6_0.10",
    });
    assert.deepEqual(release, {
      version: "0.10.0",
      url: "https://github.com/int21h-dz/MCUHelper/releases/tag/MCU6_0.10",
      label: "V 0.10",
    });
  });

  it("detects only newer releases", () => {
    assert.equal(isNewerRelease("0.9.0", "0.10.0"), true);
    assert.equal(isNewerRelease("0.9.0", "0.9.0"), false);
    assert.equal(isNewerRelease("0.10.0", "0.9.0"), false);
  });
});
