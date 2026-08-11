import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

/** `#include <path>` или `#include path` (с начала строки, допускаются пробелы). */
export const INCLUDE_LINE_RE = /^\s*#include\s+(?:<([^>]+)>|(\S+))/i;

export function parseIncludeLine(line: string): { path: string; pathStart: number; pathEnd: number } | null {
  const m = line.match(INCLUDE_LINE_RE);
  if (!m) return null;
  const incPath = (m[1] ?? m[2])?.trim();
  if (!incPath) return null;
  const pathStart = line.indexOf(incPath, m.index ?? 0);
  if (pathStart < 0) return null;
  return { path: incPath, pathStart, pathEnd: pathStart + incPath.length };
}

/**
 * Есть ли реальная директива `#include` (не CodeLens-маркер `** [mcuhelper] ▼ #include …`).
 * Regex `/#\s*include\b/` ложно срабатывает на маркерах inline-развёртки.
 */
export function textHasIncludeDirective(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    if (parseIncludeLine(line)) return true;
  }
  return false;
}

/** Кандидаты путей к включаемому файлу относительно каталога варианта. */
export function includePathCandidates(includePath: string): string[] {
  const trimmed = includePath.trim();
  if (!trimmed) return [];
  const out = [trimmed];
  if (!path.extname(trimmed)) {
    out.push(`${trimmed}.mcu`, `${trimmed}.mcunr`);
  }
  return out;
}

export function resolveIncludeFilePath(
  baseDir: string,
  includePath: string
): { fsPath: string; exists: boolean } {
  const candidates = includePathCandidates(includePath);
  for (const rel of candidates) {
    const full = path.isAbsolute(rel) ? rel : path.join(baseDir, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return { fsPath: full, exists: true };
    }
  }
  const fallback = candidates[0]!;
  const full = path.isAbsolute(fallback) ? fallback : path.join(baseDir, fallback);
  return { fsPath: full, exists: false };
}

export function resolveIncludeFileUri(baseDir: string, includePath: string): string {
  const { fsPath } = resolveIncludeFilePath(baseDir, includePath);
  return pathToFileURL(fsPath).href;
}

/** Ключ для сопоставления путей include (Windows: регистр/слэши). */
export function normalizeIncludeFsKey(fsPath: string): string {
  return path.resolve(fsPath).replace(/\\/g, "/").toLowerCase();
}

/** Диапазоны `#include` в исходном тексте (до expandIncludes). */
export interface IncludeSourceSpan {
  path: string;
  line: number;
  pathStart: number;
  pathEnd: number;
}

export function collectIncludesFromSource(text: string): IncludeSourceSpan[] {
  const lines = text.split(/\r?\n/);
  const spans: IncludeSourceSpan[] = [];
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const parsed = parseIncludeLine(lines[lineNo]!);
    if (parsed) {
      spans.push({
        path: parsed.path,
        line: lineNo,
        pathStart: parsed.pathStart,
        pathEnd: parsed.pathEnd,
      });
    }
  }
  return spans;
}
