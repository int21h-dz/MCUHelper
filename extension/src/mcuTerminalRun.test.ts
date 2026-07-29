import { describe, it } from "node:test";
import assert from "node:assert";
import { buildMcuLaunchCommand } from "./mcuTerminalRun";

describe("mcuTerminalRun", () => {
  it("buildMcuLaunchCommand uses cmd.exe syntax on win32", () => {
    if (process.platform !== "win32") return;
    const cmd = buildMcuLaunchCommand(
      "C:\\MCU\\mcu_f.exe",
      "C:\\work\\RUNTEST\\.mcuhelper-runs\\burnup",
      "C:\\MCU"
    );
    assert.ok(cmd.includes("cd /d"));
    assert.ok(cmd.includes("set \"PATH=C:\\MCU;%PATH%\""));
    assert.ok(cmd.includes('"C:\\MCU\\mcu_f.exe"'));
    assert.ok(cmd.includes("EnableDelayedExpansion"));
    assert.ok(cmd.includes("exit /b !EC!"));
    assert.ok(cmd.includes("[MCU-NR] finished, exit code:"));
    assert.ok(!cmd.includes("Set-Location"));
    // Не должен заканчиваться голым echo без exit /b
    assert.ok(/exit \/b !EC!\s*$/.test(cmd.trim()));
  });

  it("buildMcuLaunchCommand preserves exit code on non-win32", () => {
    if (process.platform === "win32") return;
    const cmd = buildMcuLaunchCommand("/opt/mcu/mcu", "/tmp/run", "/opt/mcu");
    assert.ok(cmd.includes("EC=$?"));
    assert.ok(cmd.includes("exit $EC"));
  });
});
