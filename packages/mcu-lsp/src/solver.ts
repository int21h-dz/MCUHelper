import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import type { DiagnosticMessage } from "@mcuhelper/mcu-language";

export interface SolverOptions {
  mcuNrPath: string;
  workingDir: string;
  variantName: string;
}

export interface SolverResult {
  diagnostics: DiagnosticMessage[];
  lstPath?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const ERROR_RE = /ERROR|ОШИБКА/i;
const WARN_RE = /WARNING|ПРЕДУПР/i;

export function parseLstFile(lstText: string, lstPath: string): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  const lines = lstText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ERROR_RE.test(line)) {
      diags.push({
        severity: "error",
        message: line.trim(),
        code: "mcu-solver",
        range: {
          start: { line: Math.max(0, i), character: 0 },
          end: { line: i, character: line.length },
          offset: i,
          endOffset: i + line.length,
        },
      });
    } else if (WARN_RE.test(line)) {
      diags.push({
        severity: "warning",
        message: line.trim(),
        code: "mcu-solver-warn",
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: line.length },
          offset: i,
          endOffset: i + line.length,
        },
      });
    }
  }
  return diags;
}

export function runInputStep(options: SolverOptions): Promise<SolverResult> {
  return new Promise((resolve) => {
    const exe = options.mcuNrPath;
    const args = [options.variantName, "INPUT"];
    const child = spawn(exe, args, { cwd: options.workingDir, shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      const lstPath = path.join(options.workingDir, `${options.variantName}.LST`);
      let diagnostics: DiagnosticMessage[] = [];
      if (fs.existsSync(lstPath)) {
        diagnostics = parseLstFile(fs.readFileSync(lstPath, "utf8"), lstPath);
      } else if (code !== 0) {
        diagnostics.push({
          severity: "error",
          message: `MCU-NR завершился с кодом ${code}. LST не найден.`,
          code: "mcu-exit",
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, offset: 0, endOffset: 0 },
        });
      }
      resolve({ diagnostics, lstPath: fs.existsSync(lstPath) ? lstPath : undefined, exitCode: code, stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({
        diagnostics: [{
          severity: "error",
          message: `Не удалось запустить MCU-NR: ${err.message}`,
          code: "mcu-spawn",
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, offset: 0, endOffset: 0 },
        }],
        exitCode: null,
        stdout,
        stderr,
      });
    });
  });
}

const solverCache = new Map<string, SolverResult>();

export function getCachedSolverResult(hash: string): SolverResult | undefined {
  return solverCache.get(hash);
}

export function setCachedSolverResult(hash: string, result: SolverResult): void {
  solverCache.set(hash, result);
}
