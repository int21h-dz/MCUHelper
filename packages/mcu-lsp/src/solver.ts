import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import {
  collectIncludesFromSource,
  resolveIncludeFilePath,
  type DiagnosticMessage,
} from "@mcuhelper/mcu-language";

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
/** Реальная ошибка: `error :22 in card MATR`. Число — код MCU или (иногда) строка исходника. */
const ERROR_LINE_RE = /\berror\s*:\s*(\d+)\b/i;
/** `error :58 in card MATR material 15` — код MCU + номер материала (не строка файла). */
const ERROR_MATERIAL_RE = /\berror\s*:\s*(\d+)\s+in\s+card\s+(\S+)\s+material\s+(\d+)/i;
const NUCLIDES_NOT_IN_PHY_RE = /nuclides are not found in default\.phy/i;
const MATERIAL_EMPTY_RE = /material is empty/i;
const ERROR_COLON_RE = /^\s*ERROR\s*:/i;
const ERROR_RU_RE = /ОШИБКА/i;
const LST_INCLUDE_ABSENT_RE = /Include file is absent/i;
/** Узкий шаблон: «unable to» слишком широко для LST. */
const LST_UNABLE_RE = /\bunable to (?:read|open)\b/i;
const LST_USER_FILE_RE = /USER input file not exist/i;
/** VESTA / include / library: любое `absent` в LST — обычно фатал. */
const LST_ABSENT_RE = /\babsent\b/i;
const LST_ELEMENT_MODS_RE = /\bElement\s+(\S+)\s+with\s+MODS\b/i;
const WARN_COLON_RE = /^\s*WARNING\s*:/i;
const WARN_WORD_RE = /^\s*WARNING\b(?!S\b)/i;
const WARN_RU_RE = /ПРЕДУПР/i;
const INCLUDE_LINE_RE = /^\s*#include\s+(?:<([^>]+)>|(\S+))/i;
const INCLUDE_ABSENT_NAME_RE = /Include file is absent:\s*'([^']+)'/i;
const MATR_HEADER_RE = /^\s*MATR\s+(\d+)\b/i;
const MATR_BLOCK_STOP_RE = /^\s*(MATR|END|FINISH|DEF|TEMPR|PIN|HEAD|NEUT|CONT)\b/i;
/** Имя нуклида / токен состава в хвосте error :58. */
const NUCLIDE_NAME_LINE_RE = /^\s*([A-Za-z][A-Za-z0-9]*)\s*$/;

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
    LST_USER_FILE_RE.test(line) ||
    LST_ABSENT_RE.test(line)
  );
}

function isLstWarningLine(line: string): boolean {
  if (isLstSummaryLine(line) || isLstErrorLine(line)) return false;
  return WARN_COLON_RE.test(line) || WARN_WORD_RE.test(line) || WARN_RU_RE.test(line);
}

function makeDiagRange(
  line: number,
  character: number,
  endCharacter: number,
  offset: number,
  endOffset: number
): DiagnosticMessage["range"] {
  return {
    start: { line, character },
    end: { line, character: Math.max(character + 1, endCharacter) },
    offset,
    endOffset,
  };
}

/**
 * Для `error :N in card … material M` читает следующие строки:
 * список нуклидов после «not found in default.phy» или «material is empty».
 */
function readMaterialErrorFollowup(
  lines: string[],
  startIdx: number
): { nuclides: string[]; empty: boolean; detail: string; consumed: number } {
  const nuclides: string[] = [];
  let empty = false;
  const details: string[] = [];
  let i = startIdx + 1;
  let sawNuclideHeader = false;
  while (i < lines.length) {
    const raw = lines[i]!;
    const t = raw.trim();
    if (!t) {
      i++;
      continue;
    }
    if (isLstErrorLine(raw) || /^\s*END OF\b/i.test(t) || /^\s*BEGIN OF\b/i.test(t)) break;
    if (NUCLIDES_NOT_IN_PHY_RE.test(t)) {
      sawNuclideHeader = true;
      details.push(t);
      i++;
      continue;
    }
    if (MATERIAL_EMPTY_RE.test(t)) {
      empty = true;
      details.push(t);
      i++;
      break;
    }
    if (sawNuclideHeader) {
      const m = t.match(NUCLIDE_NAME_LINE_RE);
      if (m) {
        nuclides.push(m[1]!);
        i++;
        continue;
      }
      // Список нуклидов через запятую на одной строке
      if (/^[A-Za-z0-9,\s]+$/.test(t) && /[A-Za-z]/.test(t)) {
        for (const part of t.split(/[,\s]+/)) {
          if (/^[A-Za-z][A-Za-z0-9]*$/.test(part)) nuclides.push(part);
        }
        i++;
        continue;
      }
    }
    break;
  }
  return { nuclides, empty, detail: details.join(" "), consumed: i - startIdx - 1 };
}

export function parseLstFile(lstText: string, lstPath: string): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  const lines = lstText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;
    if (LST_USER_FILE_RE.test(line) && !/filename:\s*\S/i.test(line)) {
      const next = lines[i + 1]?.trim();
      if (next) {
        line = `${line.trim()} ${next}`;
        i++;
      }
    }
    if (isLstErrorLine(line)) {
      const matErr = line.match(ERROR_MATERIAL_RE);
      if (matErr) {
        const errCode = matErr[1]!;
        const card = matErr[2]!;
        const matNum = matErr[3]!;
        const follow = readMaterialErrorFollowup(lines, i);
        i += follow.consumed;
        const base = `error :${errCode} in card ${card} material ${matNum}`;
        if (follow.nuclides.length > 0) {
          for (const nuc of follow.nuclides) {
            diags.push({
              severity: "error",
              message: `${base}: nuclide ${nuc} not found in default.phy`,
              code: `mcu-error-${errCode}`,
              range: makeDiagRange(0, 0, 1, i, i + line.length),
            });
          }
        } else if (follow.empty || follow.detail) {
          diags.push({
            severity: "error",
            message: follow.detail ? `${base}: ${follow.detail}` : base,
            code: `mcu-error-${errCode}`,
            range: makeDiagRange(0, 0, 1, i, i + line.length),
          });
        } else {
          diags.push({
            severity: "error",
            message: line.trim(),
            code: `mcu-error-${errCode}`,
            range: makeDiagRange(0, 0, 1, i, i + line.length),
          });
        }
        continue;
      }

      const mLine = line.match(ERROR_LINE_RE);
      const extractedLineNo = mLine ? Number(mLine[1]) : null;
      // Без «material N» исторически трактуем число как 1-based строку исходника.
      const srcLine =
        extractedLineNo != null && extractedLineNo > 0 ? extractedLineNo - 1 : 0;
      diags.push({
        severity: "error",
        message: line.trim(),
        code: "mcu-solver",
        range: makeDiagRange(srcLine, 0, line.length, i, i + line.length),
      });
    } else if (isLstWarningLine(line)) {
      diags.push({
        severity: "warning",
        message: line.trim(),
        code: "mcu-solver-warn",
        range: makeDiagRange(0, 0, Math.max(1, line.trim().length), i, i + line.length),
      });
    }
  }
  return diags;
}

/** Привязка ошибок LST к строкам исходного `.mcu` (include, error :N, DEF/нуклид, MATR material). */
export function remapSolverDiagnosticsToSource(
  diagnostics: DiagnosticMessage[],
  sourceFsPath: string
): DiagnosticMessage[] {
  if (!fs.existsSync(sourceFsPath)) return diagnostics;
  const sourceText = fs.readFileSync(sourceFsPath, "utf8");
  const sourceLines = sourceText.split(/\r?\n/);
  return diagnostics.map((d) => {
    const includeMatch = d.message.match(INCLUDE_ABSENT_NAME_RE);
    if (includeMatch) {
      const line = findIncludeLineInSource(sourceText, includeMatch[1]!);
      if (line != null) {
        return {
          ...d,
          range: {
            ...d.range,
            start: { line, character: 0 },
            end: { line, character: Math.max(1, sourceLines[line]?.length ?? 1) },
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
            end: { line, character: Math.max(1, sourceLines[line]?.length ?? 1) },
          },
        };
      }
    }
    if (LST_ABSENT_RE.test(d.message)) {
      const el = d.message.match(LST_ELEMENT_MODS_RE)?.[1];
      const line = el ? findNuclideOrDefLineInSource(sourceText, el) : null;
      if (line != null) {
        return {
          ...d,
          range: {
            ...d.range,
            start: { line, character: 0 },
            end: { line, character: Math.max(1, sourceLines[line]?.length ?? 1) },
          },
        };
      }
    }
    const matNumMatch = d.message.match(/\bmaterial\s+(\d+)\b/i);
    const nucMatch = d.message.match(/\bnuclide\s+(\S+)\s+not found/i);
    if (matNumMatch) {
      const matNum = Number(matNumMatch[1]);
      if (Number.isFinite(matNum)) {
        if (nucMatch) {
          const hit = findNuclideInMaterialBlock(sourceLines, matNum, nucMatch[1]!);
          if (hit) {
            return {
              ...d,
              range: {
                ...d.range,
                start: { line: hit.line, character: hit.start },
                end: { line: hit.line, character: hit.end },
              },
            };
          }
        }
        const header = findMatrHeaderLine(sourceLines, matNum);
        if (header != null) {
          const len = sourceLines[header]?.length ?? 1;
          return {
            ...d,
            range: {
              ...d.range,
              start: { line: header, character: 0 },
              end: { line: header, character: Math.max(1, len) },
            },
          };
        }
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

/** Предпочитает `DEF name`, иначе строку состава `name dens` в MATR. */
function findNuclideOrDefLineInSource(sourceText: string, elementName: string): number | null {
  const name = elementName.trim().replace(/_+$/, "");
  if (!name) return null;
  const lines = sourceText.split(/\r?\n/);
  const defRe = new RegExp(`^\\s*DEF\\s+${escapeRegExp(name)}\\b`, "i");
  for (let i = 0; i < lines.length; i++) {
    if (defRe.test(lines[i]!)) return i;
  }
  const nuclRe = new RegExp(`^\\s*${escapeRegExp(name)}\\s+[\\d.Ee+-]`, "i");
  for (let i = 0; i < lines.length; i++) {
    if (nuclRe.test(lines[i]!)) return i;
  }
  return null;
}

/** Строка заголовка `MATR N` (0-based). */
export function findMatrHeaderLine(sourceLines: string[], matNum: number): number | null {
  const want = String(matNum);
  for (let i = 0; i < sourceLines.length; i++) {
    const m = sourceLines[i]!.match(MATR_HEADER_RE);
    if (m && m[1] === want) return i;
  }
  return null;
}

/** Конец блока MATR: следующий MATR/END/FINISH/… */
function findMatrBlockEnd(sourceLines: string[], headerLine: number): number {
  for (let i = headerLine + 1; i < sourceLines.length; i++) {
    const t = sourceLines[i]!;
    if (MATR_HEADER_RE.test(t)) return i;
    if (i > headerLine && MATR_BLOCK_STOP_RE.test(t) && !/^\s*MATR\b/i.test(t)) return i;
  }
  return sourceLines.length;
}

/** Нуклид внутри блока MATR N — range имени на строке состава. */
export function findNuclideInMaterialBlock(
  sourceLines: string[],
  matNum: number,
  nuclideName: string
): { line: number; start: number; end: number } | null {
  const header = findMatrHeaderLine(sourceLines, matNum);
  if (header == null) return null;
  const end = findMatrBlockEnd(sourceLines, header);
  const name = nuclideName.trim();
  if (!name) return null;
  const nuclRe = new RegExp(`^(\\s*)(${escapeRegExp(name)})\\b`, "i");
  for (let i = header + 1; i < end; i++) {
    const line = sourceLines[i]!;
    if (/^\s*(\*\*|C=)/i.test(line)) continue;
    const m = line.match(nuclRe);
    if (!m) continue;
    const start = m[1]!.length;
    return { line: i, start, end: start + m[2]!.length };
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
 * Вместе с вариантом копируются все `#include` (относительные пути сохраняются).
 * @returns имя файла для 1-й строки mcu5.ini (обычно variantName)
 */
export function copyVariantIntoRunDir(runDir: string, sourceFsPath: string, variantName: string): string {
  const dest = path.join(runDir, variantName);
  if (path.resolve(sourceFsPath) !== path.resolve(dest)) {
    fs.copyFileSync(sourceFsPath, dest);
  }
  copyIncludesIntoRunDir(runDir, sourceFsPath);
  return variantName;
}

/**
 * Копирует файлы `#include` из каталога варианта в runDir.
 * Путь назначения — relative к каталогу исходника; если файл найден как `confpd.mcu`
 * при директиве `#include confpd`, копируется и под именем директивы (как ищет MCU).
 * @returns относительные пути скопированных файлов в runDir
 */
export function copyIncludesIntoRunDir(runDir: string, sourceFsPath: string): string[] {
  const sourceDir = path.dirname(sourceFsPath);
  let text: string;
  try {
    text = fs.readFileSync(sourceFsPath, "utf8");
  } catch {
    return [];
  }
  if (!/#\s*include\b/i.test(text)) return [];

  const copied: string[] = [];
  const seenDest = new Set<string>();

  for (const span of collectIncludesFromSource(text)) {
    const { fsPath, exists } = resolveIncludeFilePath(sourceDir, span.path);
    if (!exists) continue;

    const destRels = destRelPathsForInclude(sourceDir, span.path, fsPath);
    for (const destRel of destRels) {
      const destAbs = path.join(runDir, destRel);
      const key = path.resolve(destAbs).toLowerCase();
      if (seenDest.has(key)) continue;
      seenDest.add(key);
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      if (path.resolve(fsPath) !== path.resolve(destAbs)) {
        fs.copyFileSync(fsPath, destAbs);
      }
      copied.push(destRel);
    }
  }
  return copied;
}

/** Относительные имена в runDir для одного include (resolved + при необходимости имя из директивы). */
export function destRelPathsForInclude(
  sourceDir: string,
  includePath: string,
  resolvedFsPath: string
): string[] {
  const normalizedDirective = includePath.replace(/[/\\]+/g, path.sep);
  let fromSource = path.relative(sourceDir, resolvedFsPath);
  if (!fromSource || fromSource.startsWith("..") || path.isAbsolute(fromSource)) {
    fromSource = path.basename(resolvedFsPath);
  }
  fromSource = fromSource.split(/[/\\]/).join(path.sep);

  const out = [fromSource];
  if (
    normalizedDirective &&
    !path.isAbsolute(normalizedDirective) &&
    !normalizedDirective.split(path.sep).includes("..") &&
    path.normalize(normalizedDirective).toLowerCase() !== path.normalize(fromSource).toLowerCase()
  ) {
    out.push(normalizedDirective);
  }
  return out;
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
