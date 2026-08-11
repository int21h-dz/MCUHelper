/** Чистые хелперы batch INPUT: агрегация сводки, concurrency, форматирование Output. */

export interface BatchValidateItem {
  /** Абсолютный путь к .mcu/.mcunr */
  filePath: string;
  /** Имя варианта (basename без расширения, ≤8) */
  variantName: string;
  ok: boolean;
  /** Текст первой ошибки из LST / prepare, если есть */
  firstError?: string;
  warningCount: number;
  /** Путь к NAME.LST в temp-run, если найден */
  lstPath?: string;
  /** Сообщение сбоя prepare/runtime (без LST) */
  message?: string;
}

export interface BatchValidateSummary {
  total: number;
  okCount: number;
  failCount: number;
  warningTotal: number;
  items: BatchValidateItem[];
}

/** LSP DiagnosticSeverity.Error = 1, Warning = 2 */
export const LSP_SEVERITY_ERROR = 1;
export const LSP_SEVERITY_WARNING = 2;

export function clampBatchConcurrency(value: unknown): 1 | 2 {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 1.5) return 1;
  return 2;
}

/** Нормализует ответ одного INPUT-прогона в строку сводки. */
export function buildBatchItem(opts: {
  filePath: string;
  variantName: string;
  ok: boolean;
  firstErrorMessage?: string;
  warningCount?: number;
  lstPath?: string;
  message?: string;
}): BatchValidateItem {
  const warningCount = Math.max(0, Math.floor(opts.warningCount ?? 0));
  return {
    filePath: opts.filePath,
    variantName: opts.variantName,
    ok: opts.ok,
    firstError: opts.firstErrorMessage || undefined,
    warningCount,
    lstPath: opts.lstPath || undefined,
    message: opts.message || undefined,
  };
}

/** Считает warning из LSP diagnostics (severity === Warning). */
export function countLspWarnings(
  diagnostics: Array<{ severity?: number }> | undefined
): number {
  if (!diagnostics?.length) return 0;
  let n = 0;
  for (const d of diagnostics) {
    if (d.severity === LSP_SEVERITY_WARNING) n++;
  }
  return n;
}

export function aggregateBatchSummary(items: BatchValidateItem[]): BatchValidateSummary {
  let okCount = 0;
  let failCount = 0;
  let warningTotal = 0;
  for (const item of items) {
    if (item.ok) okCount++;
    else failCount++;
    warningTotal += item.warningCount;
  }
  return {
    total: items.length,
    okCount,
    failCount,
    warningTotal,
    items,
  };
}

/** Одна строка таблицы: file → ok/fail → firstError → warningCount → lstPath */
export function formatBatchItemLine(item: BatchValidateItem): string {
  const status = item.ok ? "ok" : "fail";
  const err = item.firstError ?? item.message ?? "—";
  const lst = item.lstPath ?? "—";
  return `${item.filePath}\t${status}\t${err}\twarnings=${item.warningCount}\tlst=${lst}`;
}

export function formatBatchSummaryText(summary: BatchValidateSummary): string {
  const lines: string[] = [
    `MCU-NR batch INPUT: всего ${summary.total}, ok ${summary.okCount}, fail ${summary.failCount}, warnings ${summary.warningTotal}`,
    "file\tstatus\tfirstError\twarningCount\tlstPath",
  ];
  for (const item of summary.items) {
    lines.push(formatBatchItemLine(item));
  }
  return lines.join("\n");
}

/**
 * Пул с ограниченной параллельностью (1–2 для batch INPUT).
 * Сохраняет порядок результатов как у входного массива.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length || 1));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!, i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}
