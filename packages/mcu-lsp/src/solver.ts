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

/** Итог MCU: `WARNINGS/ERRORS in initial data of MCU: 0` — не диагностика. */
const LST_SUMMARY_RE = /\b(ERRORS?|WARNINGS?)\s+in\s+/i;
/** Реальная ошибка: `error :22 in card MATR`. */
const ERROR_LINE_RE = /\berror\s*:\s*(\d+)\b/i;
const ERROR_COLON_RE = /^\s*ERROR\s*:/i;
const ERROR_RU_RE = /ОШИБКА/i;
const LST_INCLUDE_ABSENT_RE = /Include file is absent/i;
/** Узкий шаблон: «unable to» слишком широко для LST. */
const LST_UNABLE_RE = /\bunable to (?:read|open)\b/i;
const LST_USER_FILE_RE = /USER input file not exist/i;
const WARN_COLON_RE = /^\s*WARNING\s*:/i;
const WARN_WORD_RE = /^\s*WARNING\b(?!S\b)/i;
const WARN_RU_RE = /ПРЕДУПР/i;
const INCLUDE_LINE_RE = /^\s*#include\s+(?:<([^>]+)>|(\S+))/i;
const INCLUDE_ABSENT_NAME_RE = /Include file is absent:\s*'([^']+)'/i;

function isLstSummaryLine(line: string): boolean {
  return LST_SUMMARY_RE.test(line);
}

function isLstErrorLine(line: string): boolean {
  if (isLstSummaryLine(line)) return false;
  return (
    ERROR_LINE_RE.test(line) ||
    ERROR_COLON_RE.test(line) ||
    ERROR_RU_RE.test(line) ||
    LST_INCLUDE_ABSENT_RE.test(line) ||
    LST_UNABLE_RE.test(line) ||
    LST_USER_FILE_RE.test(line)
  );
}

function isLstWarningLine(line: string): boolean {
  if (isLstSummaryLine(line) || isLstErrorLine(line)) return false;
  return WARN_COLON_RE.test(line) || WARN_WORD_RE.test(line) || WARN_RU_RE.test(line);
}

export function parseLstFile(lstText: string, lstPath: string): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  const lines = lstText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (LST_USER_FILE_RE.test(line) && !/filename:\s*\S/i.test(line)) {
      const next = lines[i + 1]?.trim();
      if (next) {
        line = `${line.trim()} ${next}`;
        i++;
      }
    }
    if (isLstErrorLine(line)) {
      const mLine = line.match(ERROR_LINE_RE);
      const extractedLineNo = mLine ? Number(mLine[1]) : null;
      diags.push({
        severity: "error",
        message: line.trim(),
        code: "mcu-solver",
        range: {
          // Для debug хотим переход в исходник `.mcu`, а не в LST.
          // В ваших примерах число после `error :<N>` выглядит как номер строки исходного файла (1-based).
          start: {
            line: extractedLineNo != null && extractedLineNo > 0 ? extractedLineNo - 1 : 0,
            character: 0,
          },
          end: {
            line: extractedLineNo != null && extractedLineNo > 0 ? extractedLineNo - 1 : 0,
            character: line.length,
          },
          offset: i,
          endOffset: i + line.length,
        },
      });
    } else if (isLstWarningLine(line)) {
      diags.push({
        severity: "warning",
        message: line.trim(),
        code: "mcu-solver-warn",
        range: {
          // Индекс строки LST ≠ строка исходника — вешаем на начало документа.
          start: { line: 0, character: 0 },
          end: { line: 0, character: Math.max(1, line.trim().length) },
          offset: i,
          endOffset: i + line.length,
        },
      });
    }
  }
  return diags;
}

/** Привязка ошибок LST к строкам исходного `.mcu` (include, error :N). */
export function remapSolverDiagnosticsToSource(
  diagnostics: DiagnosticMessage[],
  sourceFsPath: string
): DiagnosticMessage[] {
  if (!fs.existsSync(sourceFsPath)) return diagnostics;
  const sourceText = fs.readFileSync(sourceFsPath, "utf8");
  return diagnostics.map((d) => {
    const includeMatch = d.message.match(INCLUDE_ABSENT_NAME_RE);
    if (includeMatch) {
      const line = findIncludeLineInSource(sourceText, includeMatch[1]);
      if (line != null) {
        return {
          ...d,
          range: {
            ...d.range,
            start: { line, character: 0 },
            end: { line, character: Math.max(1, sourceText.split(/\r?\n/)[line]?.length ?? 1) },
          },
        };
      }
    }
    if (LST_USER_FILE_RE.test(d.message)) {
      const line = findUrbmkLineInSource(sourceText);
      if (line != null) {
        return {
          ...d,
          range: {
            ...d.range,
            start: { line, character: 0 },
            end: { line, character: Math.max(1, sourceText.split(/\r?\n/)[line]?.length ?? 1) },
          },
        };
      }
    }
    return d;
  });
}

function findUrbmkLineInSource(sourceText: string): number | null {
  const lines = sourceText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*URBMK\b/i.test(lines[i])) return i;
  }
  return null;
}

function findIncludeLineInSource(sourceText: string, includeName: string): number | null {
  const needle = includeName.trim().toLowerCase();
  const lines = sourceText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(INCLUDE_LINE_RE);
    if (!m) continue;
    const incPath = (m[1] ?? m[2])?.trim().toLowerCase();
    if (!incPath) continue;
    if (incPath === needle || incPath.startsWith(`${needle}.`)) return i;
  }
  return null;
}

export function runInputStep(options: SolverOptions): Promise<SolverResult> {
  return new Promise((resolve) => {
    const exe = options.mcuNrPath;
    const args = [options.variantName, "INPUT"];
    const child = spawn(exe, args, { cwd: options.workingDir });
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

export type McuStepKey = "a" | "i" | "c" | "f" | "b";
export type McuMode = "i" | "c" | "f" | "b" | "continue";

/** Ключ 3-й строки mcu5.ini для режима запуска extension/LSP. */
export function mcuModeToStepKey(mode: McuMode): McuStepKey {
  switch (mode) {
    case "i":
      return "i";
    case "c":
      return "a"; // Run (CALCULATION) — полный расчёт
    case "continue":
      return "c"; // Continue (CALCULATION)
    case "f":
      return "f";
    case "b":
      return "b";
    default:
      return "i";
  }
}

export interface RunMcuStepOptions {
  mcuNrPath: string;
  workingDir: string;
  variantName: string;
  constantsLibPath: string;
  /** Абсолютный путь к исходному файлу варианта (копируется в workingDir). */
  sourceFsPath: string;
  stepKey: McuStepKey;
}

function mcuStepKeyToCliMode(stepKey: McuStepKey): string {
  // Поддержка старого варианта запуска (как в текущем `runInputStep`).
  // Если используемый exe игнорирует CLI args и работает от `mcu5.ini`, значения не важны.
  if (stepKey === "i") return "INPUT";
  if (stepKey === "c") return "CALCULATION";
  if (stepKey === "f") return "OUTPUT";
  if (stepKey === "b") return "BURNUP";
  return "ALL";
}

function deleteFileIfExists(p: string): void {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

/**
 * Копирует вариант в runDir под именем variantName.
 * MCU читает файл из cwd и пишет *.LST/*.DAT рядом — так артефакты не засоряют папку исходника.
 * @returns имя файла для 1-й строки mcu5.ini (обычно variantName)
 */
export function copyVariantIntoRunDir(runDir: string, sourceFsPath: string, variantName: string): string {
  const dest = path.join(runDir, variantName);
  if (path.resolve(sourceFsPath) !== path.resolve(dest)) {
    fs.copyFileSync(sourceFsPath, dest);
  }
  return variantName;
}

/**
 * @deprecated Для запуска вариант копируется в runDir; в ini — локальное имя.
 * Оставлено для тестов относительных путей.
 */
export function buildMcuIniVariantPath(runDir: string, sourceFsPath: string): string {
  const rel = path.relative(runDir, sourceFsPath);
  if (!rel || rel === ".") return path.basename(sourceFsPath);
  return rel;
}

export function findVariantArtifactInDir(
  dir: string,
  variantName: string,
  ext: string
): string | undefined {
  const want = `${variantName}.${ext}`.toLowerCase();
  const extDot = `.${ext.toLowerCase()}`;
  try {
    if (!fs.existsSync(dir)) return undefined;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (entry.toLowerCase() === want) return path.join(dir, entry);
    }
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      if (lower.endsWith(extDot) && lower.startsWith(variantName.toLowerCase() + ".")) {
        return path.join(dir, entry);
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

/** Удаляет NAME.ext в dir без учёта регистра имени файла. */
export function deleteVariantArtifact(dir: string, variantName: string, ext: string): void {
  const found = findVariantArtifactInDir(dir, variantName, ext);
  if (!found) return;
  try {
    fs.unlinkSync(found);
  } catch {
    // ignore
  }
}

/** Успешный collect: exit 0 и нет error-severity из LST. */
export function isSuccessfulMcuCollect(
  exitCode: number | null | undefined,
  diagnostics: readonly { severity: string }[]
): boolean {
  return (exitCode ?? 0) === 0 && !diagnostics.some((d) => d.severity === "error");
}

export interface CopyFinResult {
  path: string;
  overwritten: boolean;
}

export function findLstPath(workingDir: string, variantName: string, sourceFsPath: string): string | undefined {
  const fromDir = (dir: string): string | undefined =>
    findVariantArtifactInDir(dir, variantName, "lst");

  // Главное место: каталог запуска (.mcuhelper-runs/<variant>)
  const inRun = fromDir(workingDir);
  if (inRun) return inRun;

  // Иногда MCU пишет LST рядом с исходником
  const nearSource = fromDir(path.dirname(sourceFsPath));
  if (nearSource) return nearSource;

  // Прямые кандидаты (на случай, если readdir недоступен)
  const candidates = [
    path.join(workingDir, `${variantName}.LST`),
    path.join(workingDir, `${variantName}.lst`),
    `${sourceFsPath}.LST`,
    `${sourceFsPath}.lst`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/** Ищет NAME.FIN / NAME.fin в каталоге запуска (без учёта регистра). */
export function findFinPath(workingDir: string, variantName: string): string | undefined {
  return findVariantArtifactInDir(workingDir, variantName, "fin");
}

/**
 * После успешного CALCULATION/OUTPUT: копирует NAME.FIN рядом с исходным вариантом.
 * @returns путь и флаг перезаписи, или undefined если FIN не найден.
 */
export function copyFinBesideSource(
  workingDir: string,
  variantName: string,
  sourceFsPath: string
): CopyFinResult | undefined {
  const finSrc = findFinPath(workingDir, variantName);
  if (!finSrc) return undefined;
  const dest = path.join(path.dirname(sourceFsPath), `${variantName}.FIN`);
  const overwritten = fs.existsSync(dest) && path.resolve(finSrc) !== path.resolve(dest);
  if (path.resolve(finSrc) !== path.resolve(dest)) {
    fs.copyFileSync(finSrc, dest);
  }
  return { path: dest, overwritten };
}

/**
 * MCU требует закрывающий слэш в пути к MDBNR во 2-й строке mcu5.ini.
 * Сохраняем стиль пути (\ или /), не дублируем, если слэш уже есть.
 */
export function ensureTrailingPathSep(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return trimmed;
  const last = trimmed.charAt(trimmed.length - 1);
  if (last === "\\" || last === "/") return trimmed;
  const sep = trimmed.includes("\\") ? "\\" : trimmed.includes("/") ? "/" : path.sep;
  return trimmed + sep;
}

/** Запись mcu5.ini и копия варианта в runDir (без spawn / без mcu5.sys). */
export function prepareMcuRunFiles(options: {
  workingDir: string;
  variantName: string;
  constantsLibPath: string;
  sourceFsPath: string;
  stepKey: McuStepKey;
}): string {
  const { workingDir, variantName, constantsLibPath, sourceFsPath, stepKey } = options;
  const variantIniPath = copyVariantIntoRunDir(workingDir, sourceFsPath, variantName);
  const libPath = ensureTrailingPathSep(constantsLibPath);
  const iniText = `${variantIniPath}\n${libPath}\n${stepKey}\n`;
  fs.writeFileSync(path.join(workingDir, "mcu5.ini"), iniText, "utf8");
  fs.writeFileSync(path.join(workingDir, "MCU5.INI"), iniText, "utf8");
  deleteFileIfExists(path.join(workingDir, "mcu5.sys"));
  deleteFileIfExists(path.join(workingDir, "MCU5.SYS"));
  for (const p of [
    path.join(workingDir, `${variantName}.LST`),
    path.join(workingDir, `${variantName}.lst`),
  ]) {
    deleteFileIfExists(p);
  }
  return variantIniPath;
}

function formatMcuExitHint(exitCode: number): string {
  const u = exitCode >>> 0;
  if (u === 0xc0000135) {
    return `${exitCode} (0xC0000135 STATUS_DLL_NOT_FOUND — не подхватились DLL; проверьте, что рядом с exe есть нужные библиотеки и PATH)`;
  }
  if (u === 0xc0000005) {
    return `${exitCode} (0xC0000005 ACCESS_VIOLATION)`;
  }
  if (u > 0x80000000) {
    return `${exitCode} (0x${u.toString(16).toUpperCase()})`;
  }
  return String(exitCode);
}

/** Разбор NAME.LST после завершения MCU в терминале. */
export function collectMcuRunResult(options: {
  workingDir: string;
  variantName: string;
  sourceFsPath: string;
  exitCode: number | null;
}): SolverResult {
  const { workingDir, variantName, sourceFsPath, exitCode } = options;
  const lstPath = findLstPath(workingDir, variantName, sourceFsPath);
  let diagnostics: DiagnosticMessage[] = [];
  if (lstPath) {
    diagnostics = remapSolverDiagnosticsToSource(
      parseLstFile(fs.readFileSync(lstPath, "utf8"), lstPath),
      sourceFsPath
    );
  } else if (exitCode != null && exitCode !== 0) {
    const expectedLst = path.join(workingDir, `${variantName}.lst`);
    diagnostics.push({
      severity: "error",
      message: `MCU-NR завершился с кодом ${formatMcuExitHint(exitCode)}. LST не найден (искали: ${expectedLst}).`,
      code: "mcu-exit",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, offset: 0, endOffset: 0 },
    });
  }
  return { diagnostics, lstPath, exitCode, stdout: "", stderr: "" };
}

export async function runMcuStep(options: RunMcuStepOptions): Promise<SolverResult> {
  const { mcuNrPath, workingDir, variantName, constantsLibPath, sourceFsPath, stepKey } = options;

  prepareMcuRunFiles({
    workingDir,
    variantName,
    constantsLibPath,
    sourceFsPath,
    stepKey,
  });

  const attempt = (args: string[]): Promise<SolverResult> =>
    new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(mcuNrPath, args, { cwd: workingDir });
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => {
        const collected = collectMcuRunResult({
          workingDir,
          variantName,
          sourceFsPath,
          exitCode: code,
        });
        resolve({ ...collected, stdout, stderr });
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

  // Сначала bat-style: exe читает `mcu5.ini` (путь к варианту на диске).
  let result = await attempt([]);
  if (result.lstPath) return result;

  // Если LST не появился — пробуем совместимость со старым CLI-вызовом (как `runInputStep`).
  result = await attempt([variantName, mcuStepKeyToCliMode(stepKey)]);
  return result;
}

const solverCache = new Map<string, SolverResult>();

export function getCachedSolverResult(hash: string): SolverResult | undefined {
  return solverCache.get(hash);
}

export function setCachedSolverResult(hash: string, result: SolverResult): void {
  solverCache.set(hash, result);
}
