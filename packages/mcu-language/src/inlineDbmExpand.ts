/**
 * Маркеры inline-развёртки .DBM в варианте (`** [mcuhelper] ▼ DBM LIB/CODE`).
 * Синхрон с extension/src/dbmPreviewCore.ts.
 */

export const DBM_BEGIN_RE = /^\*\*\s+\[mcuhelper\]\s+▼\s+(DBM\s+\S+\/\S+)\s*$/i;
export const DBM_END_RE = /^\*\*\s+\[mcuhelper\]\s+▲\s+(DBM\s+\S+\/\S+)\s*$/i;

export interface InlineDbmBlock {
  beginLine: number;
  endLine: number;
  library: string;
  code: string;
}

export function parseDbmBeginMarker(line: string): string | null {
  const m = line.match(DBM_BEGIN_RE);
  return m?.[1]?.trim() ?? null;
}

export function parseDbmEndMarker(line: string): string | null {
  const m = line.match(DBM_END_RE);
  return m?.[1]?.trim() ?? null;
}

export function parseDbmExpandDirective(
  directive: string
): { library: string; code: string } | null {
  const m = directive.trim().match(/^DBM\s+([A-Za-z][A-Za-z0-9]{0,5})\/([A-Za-z][A-Za-z0-9]{0,5})$/i);
  if (!m) return null;
  return { library: m[1]!.toUpperCase(), code: m[2]!.toUpperCase() };
}

export function findInlineDbmBlocks(text: string): InlineDbmBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: InlineDbmBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const directive = parseDbmBeginMarker(lines[i]!);
    if (!directive) continue;
    const parsed = parseDbmExpandDirective(directive);
    if (!parsed) continue;
    const want = directive.trim().toUpperCase();
    let endLine = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const endDir = parseDbmEndMarker(lines[j]!);
      if (endDir && endDir.trim().toUpperCase() === want) {
        endLine = j;
        break;
      }
    }
    if (endLine < 0) continue;
    blocks.push({
      beginLine: i,
      endLine,
      library: parsed.library,
      code: parsed.code,
    });
  }
  return blocks;
}

/** Строка внутри блока (включая маркеры ▼/▲). */
export function lineInInlineDbmBlock(blocks: InlineDbmBlock[], line: number): boolean {
  return blocks.some((b) => line >= b.beginLine && line <= b.endLine);
}

/** Диагностики на строках развёрнутого .DBM — ложные (синтаксис DBM ≠ MATR). */
export function filterDiagnosticsOutsideInlineDbm<T extends { range: { start: { line: number } } }>(
  text: string,
  diagnostics: T[]
): T[] {
  const blocks = findInlineDbmBlocks(text);
  if (!blocks.length) return diagnostics;
  return diagnostics.filter((d) => !lineInInlineDbmBlock(blocks, d.range.start.line));
}
