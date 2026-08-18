import { patchDiagnosticsForChanges, diagnosticKey, type DiagRange, type LineChange } from "./diagnosticPatch";

export const LARGE_DOC_LINE_THRESHOLD = 20_000;

/** Не гонять 8с validate 3l, когда уже открыт другой файл. */
export function shouldSkipBackgroundValidate(
  uri: string,
  activeUri: string | undefined,
  lineCount: number,
  threshold = LARGE_DOC_LINE_THRESHOLD
): boolean {
  return Boolean(activeUri && uri !== activeUri && lineCount > threshold);
}

/** Full-core: не крутить validateAgain сразу — иначе 8с×N и activeDocument/getIndex ждут минуту. */
export function shouldChainValidateAgain(
  lineCount: number,
  threshold = LARGE_DOC_LINE_THRESHOLD
): boolean {
  return lineCount <= threshold;
}

/**
 * didChange full-core не ставит новый 8с parse: overlay+patch уже закрывают правку,
 * а таймер во время drain/in-flight запускал 3l ещё раз после смены файла.
 */
export function shouldScheduleValidateOnDidChange(
  uri: string,
  activeUri: string | undefined,
  lineCount: number,
  threshold = LARGE_DOC_LINE_THRESHOLD
): boolean {
  if (lineCount > threshold) return false;
  return !shouldSkipBackgroundValidate(uri, activeUri, lineCount, threshold);
}

/** После stale-parse full-core не ставить debounce-rerun — иначе 4.5с таймер стартует до activeDocument. */
export function shouldRescheduleAfterStale(
  lineCount: number,
  threshold = LARGE_DOC_LINE_THRESHOLD
): boolean {
  return lineCount <= threshold;
}

/** Повторный activeDocument того же URI не должен заново крутить validate (save/refresh/ack-loop). */
export function shouldValidateOnActiveDocumentChange(
  previousUri: string | undefined,
  nextUri: string | undefined
): boolean {
  return Boolean(nextUri && nextUri !== previousUri);
}

/**
 * Optimistic diagnostics: точечный патч при didChange + merge до sendDiagnostics.
 * Один класс — и LSP, и клиентский overlay (копия в extension/optimisticDiagnostics).
 */
export class DiagnosticPublishPipeline<T extends { range: DiagRange; message?: string }> {
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

  /**
   * Накопить правку и сразу выкинуть squiggle с изменённых строк.
   * `undefined` — слать нечего (нет prev / патч ничего не меняет).
   */
  onIncrementalEdit(uri: string, changes: readonly LineChange[]): T[] | undefined {
    if (changes.length) {
      const prevAcc = this.accumulated.get(uri) ?? [];
      this.accumulated.set(uri, [...prevAcc, ...changes]);
    }
    const prev = this.published.get(uri);
    if (!prev?.length || changes.length === 0) return undefined;
    const next = patchDiagnosticsForChanges(prev, changes);
    if (!next) return undefined;
    if (next.length === prev.length && next.every((d, i) => d === prev[i])) return undefined;
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

  /**
   * Stale host: снять только suppressed (line+message).
   * Новую ошибку на той же строке не выкидываем.
   * Не путать с клиентским OptimisticDiagnosticStore.mergeHost (там keepOverlayExtras).
   */
  mergeHost(uri: string, hostDiags: readonly T[]): T[] {
    const prev = this.published.get(uri);
    if (hostDiags.length === 0 && prev?.length) {
      return prev.slice();
    }
    const suppressed = this.suppressed.get(uri);
    if (!suppressed?.size) {
      // Сервер: bundle/host — истина. Не keepOverlayExtras: это клиентский слой
      // (онлайн MATR). Слепо не копировать mergeHost из extension/optimisticDiagnostics.
      const copy = hostDiags.slice();
      this.published.set(uri, copy);
      this.accumulated.delete(uri);
      return copy;
    }
    const out = hostDiags.filter((d) => !suppressed.has(diagnosticKey(d)));
    if (out.length === hostDiags.length) {
      this.accumulated.delete(uri);
      this.suppressed.delete(uri);
    }
    this.published.set(uri, out);
    return out;
  }

  /**
   * Сервер: bundle текущей version — истина. Не режем edited lines:
   * иначе новая ошибка на той же строке никогда не появится.
   */
  afterValidate(uri: string, bundleDiags: readonly T[]): T[] {
    this.accumulated.delete(uri);
    this.suppressed.delete(uri);
    const copy = bundleDiags.slice();
    this.published.set(uri, copy);
    return copy;
  }

  /** Первый edit, если ещё не было seed: берём host и патчим. */
  applyEdit(uri: string, changes: readonly LineChange[], hostDiags?: readonly T[]): T[] {
    if (!this.published.has(uri) && hostDiags && hostDiags.length > 0) {
      this.seed(uri, hostDiags);
    }
    const sent = this.onIncrementalEdit(uri, changes);
    return sent ?? this.published.get(uri) ?? hostDiags?.slice() ?? [];
  }
}

/** Пока version уехала — не слать и не крутить parse сразу. Ждём debounce didChange. */
export type StaleValidateDecision = "send" | "schedule-debounce";

export function decideStaleValidate(analyzedVersion: number, liveVersion: number): StaleValidateDecision {
  return liveVersion === analyzedVersion ? "send" : "schedule-debounce";
}
