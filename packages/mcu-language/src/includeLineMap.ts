import type { IncludeLineMapEntry } from "./ast";

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

/** Range покрывает строку редактора (с учётом includeLineMap). */
export function rangeCoversEditorLine(
  range: { start: { line: number; character?: number }; end: { line: number; character?: number } },
  editorLine: number,
  lineMap: IncludeLineMapEntry[] | undefined
): boolean {
  const mapped = remapRangeToMainDocument(
    {
      start: { line: range.start.line, character: range.start.character ?? 0 },
      end: { line: range.end.line, character: range.end.character ?? 0 },
    },
    lineMap
  );
  return mapped != null && mapped.start.line <= editorLine && mapped.end.line >= editorLine;
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
