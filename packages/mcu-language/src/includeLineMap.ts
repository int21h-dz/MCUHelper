import { fileURLToPath } from "url";
import type { IncludeLineMapEntry } from "./ast";
import { normalizeIncludeFsKey } from "./includeResolve";

/** Expanded-строка → номер строки в main-редакторе; include-only → null. */
export function mapExpandedLineToMain(
  lineMap: IncludeLineMapEntry[] | undefined,
  expandedLine: number
): number | null {
  if (!lineMap?.length) return expandedLine;
  const entry = lineMap[expandedLine];
  if (!entry) return null;
  if (entry.source === "main") return entry.mainLine;
  // Маркер include — визуально на строке #include в main.
  if (entry.source === "marker") return entry.mainIncludeLine ?? entry.mainLine;
  return null;
}

/** Сопоставление file: URI / путей include (Windows: регистр и слэши). */
export function sameIncludeFileUri(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    return normalizeIncludeFsKey(fileURLToPath(a)) === normalizeIncludeFsKey(fileURLToPath(b));
  } catch {
    try {
      return normalizeIncludeFsKey(a) === normalizeIncludeFsKey(b);
    } catch {
      return false;
    }
  }
}

function entryMatchesEditorUri(entry: IncludeLineMapEntry, editorUri: string): boolean {
  if (entry.includeUri && sameIncludeFileUri(entry.includeUri, editorUri)) return true;
  if (entry.includeFsPath) {
    try {
      return normalizeIncludeFsKey(entry.includeFsPath) === normalizeIncludeFsKey(fileURLToPath(editorUri));
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Expanded-строка → номер строки в открытом include-файле; иначе null.
 * Нужен для hover/definition, когда редактор — тело `#include`, а AST — expanded parent.
 */
export function mapExpandedLineToIncludeEditor(
  lineMap: IncludeLineMapEntry[] | undefined,
  expandedLine: number,
  editorUri: string
): number | null {
  if (!lineMap?.length) return null;
  const entry = lineMap[expandedLine];
  if (!entry || entry.source !== "include" || entry.includeLine == null) return null;
  if (!entryMatchesEditorUri(entry, editorUri)) return null;
  return entry.includeLine;
}

/**
 * Строка main-редактора → индекс в expanded-тексте.
 * Для строки `#include` возвращает маркер начала вставки (не тело include).
 */
export function mapMainLineToExpanded(
  lineMap: IncludeLineMapEntry[] | undefined,
  mainLine: number
): number {
  if (!lineMap?.length) return mainLine;
  for (let i = 0; i < lineMap.length; i++) {
    const e = lineMap[i]!;
    if (e.source === "main" && e.mainLine === mainLine) return i;
  }
  for (let i = 0; i < lineMap.length; i++) {
    const e = lineMap[i]!;
    if (e.source === "marker" && (e.mainIncludeLine ?? e.mainLine) === mainLine) return i;
  }
  return mainLine;
}

/** Перенос range из expanded-координат в main; null — узел только из include. */
export function remapRangeToMainDocument<
  T extends { start: { line: number; character: number }; end: { line: number; character: number } },
>(range: T, lineMap: IncludeLineMapEntry[] | undefined): T | null {
  if (!lineMap?.length) return range;
  const startLine = mapExpandedLineToMain(lineMap, range.start.line);
  const endLine = mapExpandedLineToMain(lineMap, range.end.line);
  if (startLine == null || endLine == null) return null;
  return {
    ...range,
    start: { ...range.start, line: startLine },
    end: { ...range.end, line: endLine },
  };
}

/**
 * Range покрывает строку редактора (с учётом includeLineMap).
 * @param editorUri — URI открытого документа: для main — remap в main-строки;
 *   для include-файла — match include-only ranges по `includeLine` (как diagnostics).
 */
export function rangeCoversEditorLine(
  range: { start: { line: number; character?: number }; end: { line: number; character?: number } },
  editorLine: number,
  lineMap: IncludeLineMapEntry[] | undefined,
  editorUri?: string
): boolean {
  const mapped = remapRangeToMainDocument(
    {
      start: { line: range.start.line, character: range.start.character ?? 0 },
      end: { line: range.end.line, character: range.end.character ?? 0 },
    },
    lineMap
  );
  if (mapped != null) {
    return mapped.start.line <= editorLine && mapped.end.line >= editorLine;
  }
  if (!editorUri || !lineMap?.length) return false;
  const startInc = mapExpandedLineToIncludeEditor(lineMap, range.start.line, editorUri);
  const endInc = mapExpandedLineToIncludeEditor(lineMap, range.end.line, editorUri);
  if (startInc == null || endInc == null) return false;
  return startInc <= editorLine && endInc >= editorLine;
}

/** Где лежит expanded-строка с точки зрения редактора / файла include. */
export type ExpandedLineLocation =
  | { kind: "main"; line: number }
  | {
      kind: "include";
      path: string;
      line: number;
      mainIncludeLine: number;
      uri?: string;
    }
  | { kind: "unknown"; line: number };

export function resolveExpandedLineLocation(
  lineMap: IncludeLineMapEntry[] | undefined,
  expandedLine: number
): ExpandedLineLocation {
  if (!lineMap?.length) return { kind: "main", line: expandedLine };
  const entry = lineMap[expandedLine];
  if (!entry) return { kind: "unknown", line: expandedLine };
  if (entry.source === "main") return { kind: "main", line: entry.mainLine };
  if (entry.source === "marker") {
    return { kind: "main", line: entry.mainIncludeLine ?? entry.mainLine };
  }
  if (entry.source === "include" && entry.includePath != null && entry.includeLine != null) {
    return {
      kind: "include",
      path: entry.includePath,
      line: entry.includeLine,
      mainIncludeLine: entry.mainIncludeLine ?? entry.mainLine,
      uri: entry.includeUri,
    };
  }
  return { kind: "unknown", line: expandedLine };
}

/**
 * Человекочитаемая ссылка на место в варианте:
 * строка main-редактора или `файл:строка` внутри `#include` (свёрнутый CodeLens).
 */
export function formatExpandedLineRef(
  lineMap: IncludeLineMapEntry[] | undefined,
  expandedLine: number
): string {
  const loc = resolveExpandedLineLocation(lineMap, expandedLine);
  if (loc.kind === "main") return `строке ${loc.line + 1}`;
  if (loc.kind === "include") return `${loc.path}:${loc.line + 1}`;
  return `строке ${loc.line + 1}`;
}
