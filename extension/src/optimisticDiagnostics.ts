/**
 * Клиентский overlay. Патч строк держать рядом с packages/mcu-lsp/src/diagnosticPatch.ts.
 * mergeHost здесь намеренно ДРУГОЙ: keepOverlayExtras сохраняет онлайн-ошибки MATR.
 * Не «синхронизировать» с DiagnosticPublishPipeline.mergeHost — сотрётся conc-scan.
 */

export type DiagRange = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

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

function keepOverlayExtras<T extends { range: DiagRange; message?: string }>(
  hostOut: T[],
  prev: T[] | undefined,
  suppressed?: Set<string>
): T[] {
  if (!prev?.length) return hostOut;
  const keys = new Set(hostOut.map((d) => diagnosticKey(d)));
  const extra: T[] = [];
  for (const d of prev) {
    const k = diagnosticKey(d);
    if (keys.has(k) || suppressed?.has(k)) continue;
    extra.push(d);
    keys.add(k);
  }
  return extra.length ? [...hostOut, ...extra] : hostOut;
}

/**
 * Overlay панели диагностики: VS Code collection на full-core отстаёт на ~15с
 * (onDidChangeDiagnostics не приходит, пока LSP крутит validate).
 */
export class OptimisticDiagnosticStore<T extends { range: DiagRange; message?: string }> {
  private published = new Map<string, T[]>();
  private accumulated = new Map<string, LineChange[]>();
  private suppressed = new Map<string, Set<string>>();

  getPublished(uri: string): T[] | undefined {
    const cur = this.published.get(uri);
    return cur ? cur.slice() : undefined;
  }

  accumulatedCount(uri: string): number {
    return this.accumulated.get(uri)?.length ?? 0;
  }

  seed(uri: string, diags: readonly T[]): void {
    this.published.set(uri, diags.slice());
  }

  clear(uri: string): void {
    this.published.delete(uri);
    this.accumulated.delete(uri);
    this.suppressed.delete(uri);
  }

  clearAll(): void {
    this.published.clear();
    this.accumulated.clear();
    this.suppressed.clear();
  }

  applyEdit(uri: string, changes: readonly LineChange[], hostDiags?: readonly T[]): T[] {
    if (!this.published.has(uri) && hostDiags && hostDiags.length > 0) {
      this.seed(uri, hostDiags);
    }
    if (changes.length) {
      const prevAcc = this.accumulated.get(uri) ?? [];
      this.accumulated.set(uri, [...prevAcc, ...changes]);
    }
    const prev = this.published.get(uri);
    if (!prev?.length || changes.length === 0) {
      return prev?.slice() ?? hostDiags?.slice() ?? [];
    }
    const next = patchDiagnosticsForChanges(prev, changes);
    if (!next) return prev.slice();
    const gone = new Set(next.map((d) => diagnosticKey(d)));
    const sup = this.suppressed.get(uri) ?? new Set<string>();
    for (const d of prev) {
      const k = diagnosticKey(d);
      if (!gone.has(k)) sup.add(k);
    }
    this.suppressed.set(uri, sup);
    this.published.set(uri, next);
    return next;
  }

  mergeHost(uri: string, hostDiags: readonly T[]): T[] {
    const prev = this.published.get(uri);
    if (hostDiags.length === 0 && prev?.length) {
      return prev.slice();
    }
    const suppressed = this.suppressed.get(uri);
    if (!suppressed?.size) {
      const copy = keepOverlayExtras(hostDiags.slice(), prev, undefined);
      this.published.set(uri, copy);
      this.accumulated.delete(uri);
      return copy;
    }
    let out = hostDiags.filter((d) => !suppressed.has(diagnosticKey(d)));
    if (out.length === hostDiags.length) {
      this.accumulated.delete(uri);
      this.suppressed.delete(uri);
    }
    out = keepOverlayExtras(out, prev, suppressed);
    this.published.set(uri, out);
    return out;
  }

  /** Онлайн-скан: заменить диагностики указанных строк (без дублей на каждый символ). */
  replaceLineDiags(uri: string, line: number, diags: readonly T[]): T[] {
    const prev = this.published.get(uri) ?? [];
    const next = [...prev.filter((d) => d.range.start.line !== line), ...diags];
    this.published.set(uri, next);
    return next;
  }

  /** LSP publishDiagnostics — истина для squiggle и дерева. */
  commitFromLsp(uri: string, hostDiags: readonly T[]): T[] {
    this.accumulated.delete(uri);
    this.suppressed.delete(uri);
    const copy = hostDiags.slice();
    this.published.set(uri, copy);
    return copy;
  }
}

export function toLineChanges(
  changes: readonly { range?: DiagRange; text: string }[]
): LineChange[] {
  return changes.map((c) => ({
    range: c.range
      ? {
          start: { line: c.range.start.line, character: c.range.start.character },
          end: { line: c.range.end.line, character: c.range.end.character },
        }
      : undefined,
    text: c.text,
  }));
}
