export type DiagRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

/** Инкрементальная правка. Полный sync — без `range`. */
export type LineChange = {
  range?: DiagRange;
  text: string;
};

function overlapsLines(range: DiagRange, fromLine: number, toLine: number): boolean {
  return range.start.line <= toLine && range.end.line >= fromLine;
}

function shiftRange(range: DiagRange, afterLine: number, delta: number): DiagRange {
  if (delta === 0 || range.start.line <= afterLine) return range;
  return {
    start: { line: range.start.line + delta, character: range.start.character },
    end: { line: range.end.line + delta, character: range.end.character },
  };
}

export function diagnosticKey(d: { message?: string; range: DiagRange }): string {
  return `${d.range.start.line}:${d.message ?? ""}`;
}

/**
 * Сдвинуть/выбросить диагностики после инкрементального edit.
 * `null` — полный sync (нет range), fast-path невозможен.
 */
export function patchDiagnosticsForChanges<T extends { range: DiagRange }>(
  prev: readonly T[],
  changes: readonly LineChange[]
): T[] | null {
  if (changes.length === 0) return prev.slice();
  if (changes.some((c) => !c.range)) return null;

  let out = prev.slice();
  for (const ch of changes) {
    if (!ch.range) return null;
    const range = ch.range;
    const start = range.start.line;
    const end = range.end.line;
    const inserted = ch.text.split(/\r?\n/).length;
    const oldSpan = Math.max(1, end - start + 1);
    const delta = inserted - oldSpan;
    out = out.filter((d) => !overlapsLines(d.range, start, end));
    if (delta !== 0) {
      out = out.map((d) => {
        const next = shiftRange(d.range, end, delta);
        return next === d.range ? d : { ...d, range: next };
      });
    }
  }
  return out;
}
