export const LARGE_DOC_LINE_THRESHOLD = 20_000;

export function shouldDiscardStaleSidebarApply(opts: {
  requestGen: number;
  liveGen: number;
  requestUri: string;
  liveUri: string | undefined;
}): boolean {
  return opts.requestGen !== opts.liveGen || opts.liveUri !== opts.requestUri;
}

export type LargeDocumentEditPlan = {
  abortTreeRefresh: boolean;
  /** Не ждать onDidChangeDiagnostics — на full-core он может прийти через ~15с. */
  refreshDiagnosticsNow: boolean;
  skipFullIndexRefresh: boolean;
  /** getIndex отменили, пока дерево ещё не применялось — повторить после паузы. */
  retryTreePrimeAfterIdle: boolean;
};

/** Пауза после abort, чтобы не стартовать getIndex на каждый символ. */
export const TREE_PRIME_IDLE_MS = 2000;

export function largeDocumentEditPlan(
  lineCount: number,
  threshold = LARGE_DOC_LINE_THRESHOLD
): LargeDocumentEditPlan {
  if (lineCount <= threshold) {
    return {
      abortTreeRefresh: false,
      refreshDiagnosticsNow: false,
      skipFullIndexRefresh: false,
      retryTreePrimeAfterIdle: false,
    };
  }
  return {
    abortTreeRefresh: true,
    refreshDiagnosticsNow: true,
    skipFullIndexRefresh: true,
    retryTreePrimeAfterIdle: true,
  };
}

/** Дерево 3l ещё не apply — нельзя считать primed после первого onDidChangeDiagnostics. */
export function shouldScheduleTreePrime(
  appliedUri: string | undefined,
  liveUri: string,
  lineCount: number,
  threshold = LARGE_DOC_LINE_THRESHOLD
): boolean {
  return lineCount > threshold && appliedUri !== liveUri;
}

/** Пустой host до первого publishDiagnostics не должен затирать панель «чист». */
export function shouldApplyOptimisticOverlay(hostCount: number, overlayCount: number): boolean {
  return hostCount > 0 || overlayCount > 0;
}

/**
 * Дерево и squiggle красятся одним массивом.
 * LSP collection, отставшая на время sync-analyze, не источник.
 */
export function paintDiagnosticsFromOverlay<T>(overlay: readonly T[]): readonly T[] {
  return overlay;
}

/** getIndex уже есть, webview панели открылся позже — красить кэш, не второй fetch. */
export function shouldPaintCachedSidebarIndex(
  cacheUri: string | undefined,
  liveUri: string | undefined
): boolean {
  return Boolean(cacheUri && liveUri && cacheUri === liveUri);
}

/** Смена файла: старый in-flight getIndex не должен держать очередь. */
export function shouldSupersedeSidebarRefresh(startedEpoch: number, liveEpoch: number): boolean {
  return startedEpoch !== liveEpoch;
}

/** Панель диагностики на switch уже знает overlay — не затирать её «Загрузка индекса…». */
export function sidebarPanelModeOnEditorSwitch(
  panelId: string
): "keep-diagnostics" | "loading" {
  return panelId === "mcuhelper.lexerErrors" ? "keep-diagnostics" : "loading";
}
