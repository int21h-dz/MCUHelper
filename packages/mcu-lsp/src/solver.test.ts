import { describe, it } from "node:test";
import assert from "node:assert";
import {
  parseLstFile,
  remapSolverDiagnosticsToSource,
  getCachedSolverResult,
  setCachedSolverResult,
  runInputStep,
  buildMcuIniVariantPath,
  findLstPath,
  copyVariantIntoRunDir,
  copyIncludesIntoRunDir,
  prepareMcuRunFiles,
  ensureTrailingPathSep,
  mcuModeToStepKey,
  findFinPath,
  copyFinBesideSource,
  isSuccessfulMcuCollect,
  deleteVariantArtifact,
} from "./solver";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

describe("solver", () => {
  it("parseLstFile finds ERROR and WARNING", () => {
    const text = "Line 1\nERROR: bad input\nWARNING: check zones\nOK line";
    const diags = parseLstFile(text, "test.lst");
    assert.ok(diags.some((d) => d.severity === "error"));
    assert.ok(diags.some((d) => d.severity === "warning"));
    assert.strictEqual(diags[0].code, "mcu-solver");
  });

  it("parseLstFile handles Russian messages", () => {
    const diags = parseLstFile("ОШИБКА в данных\nПРЕДУПРеждение", "r.lst");
    assert.ok(diags.length >= 1);
  });

  it("parseLstFile maps `error :N` to deck line (1-based)", () => {
    const lst = [
      "BEGIN OF PIN MODULE.",
      " error  : 2",
      " unable to read default.phy (begda3.sys).",
      " error :22 in card MATR",
      " error :51 in card MATR expecting a concentration.",
      " END OF PIN MODULE.",
    ].join("\n");
    const diags = parseLstFile(lst, "test.lst");
    const byMsg = new Map(diags.map((d) => [d.message, d]));
    const e2 = [...byMsg.values()].find((d) => d.message.includes("error  : 2"));
    const e22 = [...byMsg.values()].find((d) => d.message.includes("error :22 in card MATR"));
    const e51 = [...byMsg.values()].find((d) => d.message.includes("error :51 in card MATR"));
    assert.ok(e2);
    assert.strictEqual(e2!.range.start.line, 1); // 2-1
    assert.ok(e22);
    assert.strictEqual(e22!.range.start.line, 21); // 22-1
    assert.ok(e51);
    assert.strictEqual(e51!.range.start.line, 50); // 51-1
  });

  it("parseLstFile maps error :58/:55 material to nuclide/material (not error code as line)", () => {
    const lst = [
      " BEGIN OF PIN MODULE.",
      " error  :58 in card   MATR material           15",
      " the following nuclides are not found in default.phy:",
      " HF81",
      " error  :55 in card MATR   material           25",
      " material is empty (check SI, SINOT, SIDEN, if any).",
      " error  :55 in card END    material           34",
      " material is empty (check SI, SINOT, SIDEN, if any).",
      " END OF PIN MODULE.",
      " ERRORS FOUND. PHYSICAL MODULE INPUT IS STOPPED.",
    ].join("\n");
    const diags = parseLstFile(lst, "t.lst");
    assert.strictEqual(diags.length, 3);
    assert.ok(diags.every((d) => d.severity === "error"));
    assert.ok(diags.every((d) => d.range.start.line === 0)); // код ≠ строка
    const e58 = diags.find((d) => d.code === "mcu-error-58");
    assert.ok(e58);
    assert.match(e58!.message, /material 15/i);
    assert.match(e58!.message, /HF81/);
    const e55 = diags.filter((d) => d.code === "mcu-error-55");
    assert.strictEqual(e55.length, 2);
    assert.ok(e55.some((d) => /material 25/i.test(d.message) && /empty/i.test(d.message)));
    assert.ok(e55.some((d) => /material 34/i.test(d.message) && /empty/i.test(d.message)));
  });

  it("remapSolverDiagnosticsToSource maps material/nuclide LST errors onto MATR deck", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-lst-mat-"));
    try {
      const source = path.join(dir, "deck");
      fs.writeFileSync(
        source,
        [
          "PIN",
          "MATR 15 T=1000",
          "U235 1.0E-2",
          "HF81  1.05E-4",
          "O 1.0",
          "MATR 25 T=300",
          "O 1E-10",
          "MATR 34",
          "O 1.0E-10",
          "END",
          "FINISH",
        ].join("\n"),
        "utf8"
      );
      const raw = parseLstFile(
        [
          " error  :58 in card   MATR material           15",
          " the following nuclides are not found in default.phy:",
          " HF81",
          " error  :55 in card MATR   material           25",
          " material is empty (check SI, SINOT, SIDEN, if any).",
          " error  :55 in card END    material           34",
          " material is empty (check SI, SINOT, SIDEN, if any).",
        ].join("\n"),
        "x.lst"
      );
      const diags = remapSolverDiagnosticsToSource(raw, source);
      const e58 = diags.find((d) => d.code === "mcu-error-58")!;
      assert.strictEqual(e58.range.start.line, 3); // HF81 line
      assert.ok(e58.range.start.character >= 0);
      const e25 = diags.find((d) => /material 25/i.test(d.message))!;
      assert.strictEqual(e25.range.start.line, 5); // MATR 25 header
      const e34 = diags.find((d) => /material 34/i.test(d.message))!;
      assert.strictEqual(e34.range.start.line, 7); // MATR 34 header
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parseLstFile keeps range at 0 for errors without line number", () => {
    const lst = ["ERROR: invalid energy 0.34652E+00"].join("\n");
    const diags = parseLstFile(lst, "test.lst");
    assert.ok(diags.length >= 1);
    assert.strictEqual(diags[0].range.start.line, 0);
  });

  it("parseLstFile ignores MCU summary lines with zero error/warning counts", () => {
    const lst = [
      "BEGIN OF PIN MODULE.",
      "WARNINGS in initial data of MCU:             0",
      "ERRORS   in initial data of MCU:             0",
      " END OF PIN MODULE.",
    ].join("\n");
    const diags = parseLstFile(lst, "test.lst");
    assert.strictEqual(diags.length, 0);
  });

  it("parseLstFile ignores summary lines even when counts are non-zero", () => {
    const lst = [
      "WARNINGS in initial data of MCU:             3",
      "ERRORS   in initial data of MCU:             1",
      " error :22 in card MATR",
    ].join("\n");
    const diags = parseLstFile(lst, "test.lst");
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].severity, "error");
    assert.ok(diags[0].message.includes("error :22"));
  });

  it("parseLstFile puts WARNING diagnostics on source line 0", () => {
    const pad = Array.from({ length: 500 }, () => "ok").join("\n");
    const lst = `${pad}\nWARNING: late warning`;
    const diags = parseLstFile(lst, "test.lst");
    const w = diags.find((d) => d.severity === "warning");
    assert.ok(w);
    assert.strictEqual(w!.range.start.line, 0);
  });

  it("parseLstFile matches unable to read/open but not bare unable to", () => {
    const ok = parseLstFile(" unable to read default.phy\n", "t.lst");
    assert.ok(ok.some((d) => d.message.includes("unable to read")));
    const open = parseLstFile("unable to open file X\n", "t.lst");
    assert.ok(open.some((d) => d.message.includes("unable to open")));
    const noise = parseLstFile("system unable to continue normally\n", "t.lst");
    assert.strictEqual(noise.length, 0);
  });

  it("isSuccessfulMcuCollect requires exit 0 and no error severity", () => {
    assert.ok(isSuccessfulMcuCollect(0, []));
    assert.ok(isSuccessfulMcuCollect(0, [{ severity: "warning" }]));
    assert.ok(!isSuccessfulMcuCollect(1, []));
    assert.ok(!isSuccessfulMcuCollect(0, [{ severity: "error" }]));
  });

  it("parseLstFile detects missing include file messages", () => {
    const lst = ["BEGIN OF PIN MODULE.", "  Include file is absent:'confpd'", " END OF PIN MODULE."].join("\n");
    const diags = parseLstFile(lst, "test.lst");
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].severity, "error");
    assert.ok(diags[0].message.includes("confpd"));
  });

  it("parseLstFile treats any 'absent' line as error", () => {
    const diags = parseLstFile("  Some data file is absent on disk\n", "t.lst");
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].severity, "error");
    assert.ok(diags[0].message.includes("absent"));
  });

  it("parseLstFile detects VESTA MODS absent in library", () => {
    const lst = [
      "BEGIN of FIMTOEN Submodule",
      "Attempting to open temporary file:",
      "y:\\MDB650/TMPDAT/OQQQHYH_100.VSM",
      "VST_GOVESTM. Element O    with MODS HYH_ is absent in library",
      "END   of FIMTOEN Submodule",
    ].join("\n");
    const diags = parseLstFile(lst, "test.lst");
    assert.strictEqual(diags.length, 1);
    assert.strictEqual(diags[0].severity, "error");
    assert.ok(diags[0].message.includes("absent in library"));
    assert.ok(diags[0].message.includes("Element O"));
  });

  it("remapSolverDiagnosticsToSource maps absent-library to DEF line", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-mods-"));
    try {
      const source = path.join(tmp, "v.mcu");
      fs.writeFileSync(
        source,
        [
          "PIN 1 0",
          "DEF H1 ACE=E70 MODS=HYH DTEM=1.0 PHT=TVC",
          "DEF O  ACE=E70 MODS=HYH DTEM=1.0 PHT=TVC",
          "MATR 1",
          "O 4.3760E-02",
          "FINISH",
        ].join("\n"),
        "utf8"
      );
      const diags = remapSolverDiagnosticsToSource(
        [
          {
            severity: "error",
            message: "VST_GOVESTM. Element O    with MODS HYH_ is absent in library",
            code: "mcu-solver",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
              offset: 0,
              endOffset: 1,
            },
          },
        ],
        source
      );
      assert.strictEqual(diags[0].range.start.line, 2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("remapSolverDiagnosticsToSource maps absent-library to nuclide line without DEF", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-mods2-"));
    try {
      const source = path.join(tmp, "v.mcu");
      fs.writeFileSync(source, ["PIN 1 0", "MATR 1", "O 4.3760E-02 MODS=HYH", "FINISH"].join("\n"), "utf8");
      const diags = remapSolverDiagnosticsToSource(
        [
          {
            severity: "error",
            message: "Element O with MODS HYH_ is absent in library",
            code: "mcu-solver",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
              offset: 0,
              endOffset: 1,
            },
          },
        ],
        source
      );
      assert.strictEqual(diags[0].range.start.line, 2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("remapSolverDiagnosticsToSource maps include errors to #include line", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-"));
    try {
      const source = path.join(tmp, "958.mcu");
      fs.writeFileSync(
        source,
        ["PIN 1", "#include confpd", "FINISH"].join("\n"),
        "utf8"
      );
      const diags = remapSolverDiagnosticsToSource(
        [
          {
            severity: "error",
            message: "Include file is absent:'confpd'",
            code: "mcu-solver",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
              offset: 0,
              endOffset: 1,
            },
          },
        ],
        source
      );
      assert.strictEqual(diags[0].range.start.line, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("parseLstFile detects USER input file missing for URBMK", () => {
    const lst = [
      "USER key: URBMK",
      "USER input filename: userf",
      "USER input file not exist, filename:",
      "userf",
    ].join("\n");
    const diags = parseLstFile(lst, "test.lst");
    assert.ok(diags.some((d) => d.message.includes("USER input file not exist") && d.message.includes("userf")));
  });

  it("remapSolverDiagnosticsToSource maps USER file error to URBMK line", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-urb-"));
    try {
      const source = path.join(tmp, "v.mcu");
      fs.writeFileSync(source, ["RGS", "URBMK userf", "FINISH"].join("\n"), "utf8");
      const diags = remapSolverDiagnosticsToSource(
        [
          {
            severity: "error",
            message: "USER input file not exist, filename: userf",
            code: "mcu-solver",
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
              offset: 0,
              endOffset: 1,
            },
          },
        ],
        source
      );
      assert.strictEqual(diags[0].range.start.line, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("mcuModeToStepKey maps extension modes to mcu5.ini step keys", () => {
    assert.strictEqual(mcuModeToStepKey("i"), "i");
    assert.strictEqual(mcuModeToStepKey("c"), "a");
    assert.strictEqual(mcuModeToStepKey("continue"), "c");
    assert.strictEqual(mcuModeToStepKey("f"), "f");
    assert.strictEqual(mcuModeToStepKey("b"), "b");
  });

  it("caches solver results by hash", () => {
    setCachedSolverResult("abc", {
      diagnostics: [],
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    const cached = getCachedSolverResult("abc");
    assert.ok(cached);
    assert.strictEqual(cached!.exitCode, 0);
  });

  it("runInputStep resolves with mock spawn via nonexistent exe", async () => {
    const result = await runInputStep({
      mcuNrPath: "__nonexistent_mcu_exe__",
      workingDir: process.cwd(),
      variantName: "TESTVAR",
    });
    assert.ok(result.exitCode === null || result.exitCode !== 0);
    assert.ok(result.diagnostics.length > 0 || result.stderr.length >= 0);
  });

  it("buildMcuIniVariantPath is relative to runDir (cross-platform)", () => {
    // runDir = <base>/.mcuhelper-runs/<variant> → до файла <base>/<variant> нужно ../../
    const root = path.resolve("/work/RUNTEST");
    const runDir = path.join(root, ".mcuhelper-runs", "burnup");
    const source = path.join(root, "burnup");
    const rel = buildMcuIniVariantPath(runDir, source);
    assert.strictEqual(rel, path.join("..", "..", "burnup"));
    assert.ok(!path.isAbsolute(rel));
    assert.strictEqual(path.resolve(runDir, rel), path.resolve(source));
  });

  it("buildMcuIniVariantPath keeps nested relative depth", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-rel-"));
    try {
      const runDir = path.join(tmp, ".mcuhelper-runs", "burnup");
      const source = path.join(tmp, "burnup");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(source, "PIN\nFINISH\n", "utf8");
      const rel = buildMcuIniVariantPath(runDir, source);
      assert.strictEqual(path.resolve(runDir, rel), path.resolve(source));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("findLstPath finds burnup.lst in runDir case-insensitively", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-lst-"));
    try {
      const runDir = path.join(tmp, ".mcuhelper-runs", "burnup");
      const source = path.join(tmp, "burnup");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(source, "PIN\nFINISH\n", "utf8");
      const lst = path.join(runDir, "burnup.lst");
      fs.writeFileSync(lst, "ERROR: sample\n", "utf8");
      const found = findLstPath(runDir, "burnup", source);
      assert.ok(found);
      assert.strictEqual(path.resolve(found!), path.resolve(lst));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("prepareMcuRunFiles copies variant into runDir and writes local name in mcu5.ini", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-copy-"));
    try {
      const runDir = path.join(tmp, ".mcuhelper-runs", "burnup");
      const source = path.join(tmp, "burnup");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(source, "PIN 1\nFINISH\n", "utf8");
      const iniName = prepareMcuRunFiles({
        workingDir: runDir,
        variantName: "burnup",
        constantsLibPath: "Y:\\MDB650",
        sourceFsPath: source,
        stepKey: "i",
      });
      assert.strictEqual(iniName, "burnup");
      assert.ok(fs.existsSync(path.join(runDir, "burnup")));
      assert.strictEqual(fs.readFileSync(path.join(runDir, "burnup"), "utf8"), "PIN 1\nFINISH\n");
      const ini = fs.readFileSync(path.join(runDir, "mcu5.ini"), "utf8").split(/\r?\n/);
      assert.strictEqual(ini[0], "burnup");
      assert.strictEqual(ini[1], "Y:\\MDB650\\");
      assert.strictEqual(ini[2], "i");
      // исходник на месте — артефакты MCU пойдут в runDir, не рядом с source
      assert.ok(fs.existsSync(source));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("prepareMcuRunFiles copies #include files into runDir", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-copy-"));
    try {
      const runDir = path.join(tmp, ".mcuhelper-runs", "958");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(tmp, "confpd"), "SI N, O\nSIDEN 1.0E-4\n", "utf8");
      fs.mkdirSync(path.join(tmp, "frag"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "frag", "geo.mcu"), "RCZ FU 0 0 0 1 10\n", "utf8");
      const source = path.join(tmp, "958");
      fs.writeFileSync(
        source,
        ["PIN", "#include confpd", "#include frag/geo.mcu", "FINISH"].join("\n"),
        "utf8"
      );
      prepareMcuRunFiles({
        workingDir: runDir,
        variantName: "958",
        constantsLibPath: "Y:\\MDB650",
        sourceFsPath: source,
        stepKey: "a",
      });
      assert.ok(fs.existsSync(path.join(runDir, "958")));
      assert.strictEqual(
        fs.readFileSync(path.join(runDir, "confpd"), "utf8"),
        "SI N, O\nSIDEN 1.0E-4\n"
      );
      assert.strictEqual(
        fs.readFileSync(path.join(runDir, "frag", "geo.mcu"), "utf8"),
        "RCZ FU 0 0 0 1 10\n"
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("copyIncludesIntoRunDir also copies under bare directive name when resolved via .mcu", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-inc-ext-"));
    try {
      const runDir = path.join(tmp, "run");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(tmp, "confpd.mcu"), "SI N\n", "utf8");
      const source = path.join(tmp, "main.mcu");
      fs.writeFileSync(source, "#include confpd\nFINISH\n", "utf8");
      const copied = copyIncludesIntoRunDir(runDir, source);
      assert.ok(copied.some((p) => /confpd/i.test(p)));
      assert.ok(fs.existsSync(path.join(runDir, "confpd.mcu")));
      assert.ok(fs.existsSync(path.join(runDir, "confpd")));
      assert.strictEqual(fs.readFileSync(path.join(runDir, "confpd"), "utf8"), "SI N\n");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ensureTrailingPathSep adds closing slash without duplicating", () => {
    assert.strictEqual(ensureTrailingPathSep("Y:\\MDB650"), "Y:\\MDB650\\");
    assert.strictEqual(ensureTrailingPathSep("Y:\\MDB650\\"), "Y:\\MDB650\\");
    assert.strictEqual(ensureTrailingPathSep("/opt/mdbnr"), "/opt/mdbnr/");
    assert.strictEqual(ensureTrailingPathSep("/opt/mdbnr/"), "/opt/mdbnr/");
  });

  it("copyFinBesideSource copies NAME.FIN next to source variant", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-fin-"));
    try {
      const runDir = path.join(tmp, ".mcuhelper-runs", "burnup");
      const source = path.join(tmp, "burnup");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(source, "PIN\nFINISH\n", "utf8");
      fs.writeFileSync(path.join(runDir, "burnup.fin"), "FIN OUTPUT\n", "utf8");
      const found = findFinPath(runDir, "burnup");
      assert.ok(found);
      const copied = copyFinBesideSource(runDir, "burnup", source);
      assert.ok(copied);
      assert.strictEqual(path.resolve(copied!.path), path.resolve(path.join(tmp, "burnup.FIN")));
      assert.strictEqual(copied!.overwritten, false);
      assert.strictEqual(fs.readFileSync(copied!.path, "utf8"), "FIN OUTPUT\n");
      fs.writeFileSync(path.join(runDir, "burnup.fin"), "FIN2\n", "utf8");
      const again = copyFinBesideSource(runDir, "burnup", source);
      assert.ok(again?.overwritten);
      assert.strictEqual(fs.readFileSync(again!.path, "utf8"), "FIN2\n");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("deleteVariantArtifact removes fin case-insensitively", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-delfin-"));
    try {
      fs.writeFileSync(path.join(tmp, "burnup.fin"), "x", "utf8");
      deleteVariantArtifact(tmp, "burnup", "fin");
      assert.ok(!fs.existsSync(path.join(tmp, "burnup.fin")));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("copyVariantIntoRunDir overwrites previous copy", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcu-ovw-"));
    try {
      const runDir = path.join(tmp, "run");
      const source = path.join(tmp, "burnup");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(source, "v2\n", "utf8");
      fs.writeFileSync(path.join(runDir, "burnup"), "v1\n", "utf8");
      copyVariantIntoRunDir(runDir, source, "burnup");
      assert.strictEqual(fs.readFileSync(path.join(runDir, "burnup"), "utf8"), "v2\n");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
