/** Маркеры inline-развёртки #include в main-файле (строки `**` — комментарии MCU). */
export const INCLUDE_BEGIN_RE = /^\*\*\s+\[mcuhelper\]\s+▼\s+(.+?)\s*$/;
export const INCLUDE_END_RE = /^\*\*\s+\[mcuhelper\]\s+▲\s+(.+?)\s*$/;
export const INCLUDE_DIRECTIVE_RE = /^\s*#include\s+(?:<([^>]+)>|(\S+))/i;

export interface ExpandedIncludeBlock {
  beginLine: number;
  endLine: number;
  directive: string;
}

export interface CollapsedIncludeSpan {
  line: number;
  path: string;
  directive: string;
}

export function parseIncludeDirective(line: string): { path: string; directive: string } | null {
  const m = line.match(INCLUDE_DIRECTIVE_RE);
  if (!m) return null;
  const path = (m[1] ?? m[2])?.trim();
  if (!path) return null;
  return { path, directive: line.trimEnd() };
}

export function parseExpandedBeginMarker(line: string): string | null {
  const m = line.match(INCLUDE_BEGIN_RE);
  return m?.[1]?.trim() ?? null;
}

export function parseExpandedEndMarker(line: string): string | null {
  const m = line.match(INCLUDE_END_RE);
  return m?.[1]?.trim() ?? null;
}

export function buildExpandedBlock(directive: string, content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const lines = body.length ? body.split("\n") : [];
  return [`** [mcuhelper] ▼ ${directive}`, ...lines, `** [mcuhelper] ▲ ${directive}`].join("\n");
}

export function findExpandedBlocks(text: string): ExpandedIncludeBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: ExpandedIncludeBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const directive = parseExpandedBeginMarker(lines[i]!);
    if (!directive) continue;
    const endLine = findMatchingEndLine(lines, i, directive);
    if (endLine >= 0) blocks.push({ beginLine: i, endLine, directive });
  }
  return blocks;
}

export function findMatchingEndLine(lines: string[], beginLine: number, directive: string): number {
  for (let i = beginLine + 1; i < lines.length; i++) {
    const endDir = parseExpandedEndMarker(lines[i]!);
    if (endDir === directive) return i;
  }
  return -1;
}

export function lineInExpandedBlock(blocks: ExpandedIncludeBlock[], line: number): boolean {
  return blocks.some((b) => line > b.beginLine && line < b.endLine);
}

export function collectCollapsedIncludes(text: string): CollapsedIncludeSpan[] {
  const lines = text.split(/\r?\n/);
  const blocks = findExpandedBlocks(text);
  const spans: CollapsedIncludeSpan[] = [];
  for (let line = 0; line < lines.length; line++) {
    if (lineInExpandedBlock(blocks, line)) continue;
    const parsed = parseIncludeDirective(lines[line]!);
    if (!parsed) continue;
    spans.push({ line, path: parsed.path, directive: parsed.directive });
  }
  return spans;
}

export function extractExpandedContent(lines: string[], beginLine: number, endLine: number): string {
  if (endLine <= beginLine + 1) return "";
  return lines.slice(beginLine + 1, endLine).join("\n");
}
