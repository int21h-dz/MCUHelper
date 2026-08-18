import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { buildCatalogPayload } from "./catalogBridge";
import { LanguageClient } from "vscode-languageclient/node";
import { isMcunrDocument } from "./contentDetect";
import { buildNavTree, type IndexPayload, type NavViewId } from "./navData";
import { goToSymbol, insertTemplate } from "./templateInsert";
import { applyDiagnosticsToSidebar, extractIsotopeNameFromDiag, MCUHELPER_DIAG_SOURCE } from "./diagnosticNavigation";
import { ADD_TO_SUM_ISOTOPE_DIAG_CODES } from "./addToSumIsotope";
import { OptimisticDiagnosticStore, toLineChanges } from "./optimisticDiagnostics";
import { scanNuclideConcentrationLine } from "./nuclideConcScan";
import { shouldDiscardStaleSidebarApply, shouldApplyOptimisticOverlay, paintDiagnosticsFromOverlay, shouldPaintCachedSidebarIndex, shouldSupersedeSidebarRefresh, sidebarPanelModeOnEditorSwitch } from "./sidebarFreshness";

function diagnosticCodeOf(d: vscode.Diagnostic): string | undefined {
  if (typeof d.code === "string") return d.code;
  if (d.code && typeof d.code === "object" && "value" in d.code) {
    return String(d.code.value);
  }
  return undefined;
}

/** Ключи `line:NAME` для нуклидов с рекомендацией «добавить в SI». */
function collectSumIsotopeSuggestions(uri: vscode.Uri): Set<string> {
  const out = new Set<string>();
  for (const d of vscode.languages.getDiagnostics(uri)) {
    const code = diagnosticCodeOf(d);
    if (!code || !ADD_TO_SUM_ISOTOPE_DIAG_CODES.has(code)) continue;
    const name = extractIsotopeNameFromDiag(d);
    if (!name) continue;
    out.add(`${d.range.start.line}:${name.toUpperCase()}`);
  }
  return out;
}


export type SidebarViewId =
  | "mcuhelper.catalog"
  | "mcuhelper.lexerErrors"
  | "mcuhelper.fragments"
  | "mcuhelper.materials"
  | "mcuhelper.constants"
  | "mcuhelper.bodies"
  | "mcuhelper.nets"
  | "mcuhelper.lattices"
  | "mcuhelper.zones"
  | "mcuhelper.objects";

const NAV_VIEW_MAP: Record<string, NavViewId> = {
  "mcuhelper.fragments": "fragments",
  "mcuhelper.materials": "materials",
  "mcuhelper.constants": "constants",
  "mcuhelper.bodies": "bodies",
  "mcuhelper.nets": "nets",
  "mcuhelper.lattices": "lattices",
  "mcuhelper.zones": "zones",
  "mcuhelper.objects": "objects",
};

let sidebarReadyHandler: (() => void) | undefined;
let sumIsotopeDecorationHandler:
  | ((editor: vscode.TextEditor, index: IndexPayload | null) => void)
  | undefined;

export function visibleLineSpan(editor: vscode.TextEditor): { start: number; end: number } {
  const ranges = editor.visibleRanges;
  if (!ranges.length) {
    const line = editor.selection.active.line;
    return { start: line, end: line };
  }
  let start = ranges[0]!.start.line;
  let end = ranges[0]!.end.line;
  for (const r of ranges) {
    if (r.start.line < start) start = r.start.line;
    if (r.end.line > end) end = r.end.line;
  }
  return { start, end };
}

export function setSidebarReadyHandler(handler: () => void): void {
  sidebarReadyHandler = handler;
}

export function setSumIsotopeDecorationHandler(
  handler: (editor: vscode.TextEditor, index: IndexPayload | null) => void
): void {
  sumIsotopeDecorationHandler = handler;
}

function sidebarHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sidebar", "sidebar.css"));
  const icons = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sidebar", "sidebarIcons.js"));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sidebar", "sidebarShell.js"));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src ${webview.cspSource}`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${css}">
</head>
<body>
  <div id="root"></div>
  <script src="${icons}"></script>
  <script src="${js}"></script>
</body>
</html>`;
}

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private lexerErrorsTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly viewId: SidebarViewId,
    private readonly context: vscode.ExtensionContext,
    private readonly client: LanguageClient
  ) {}

  get isCatalog(): boolean {
    return this.viewId === "mcuhelper.catalog";
  }

  get isLexerErrors(): boolean {
    return this.viewId === "mcuhelper.lexerErrors";
  }

  hasView(): boolean {
    return Boolean(this.view);
  }

  private paintFromCacheOrStatic(): void {
    if (this.isCatalog) {
      this.applyIndex(null);
      return;
    }
    if (this.isLexerErrors) {
      void this.applyLexerErrors();
      return;
    }
    if (!cachedSidebarIndex) return;
    const editor = vscode.window.activeTextEditor;
    if (!shouldPaintCachedSidebarIndex(cachedSidebarIndex.uri, editor?.document.uri.toString())) return;
    this.applyIndex(cachedSidebarIndex.index, cachedSidebarIndex.errorMsg);
  }

  applyLexerErrors(options?: { immediate?: boolean; diagnostics?: readonly vscode.Diagnostic[] }): Promise<void> {
    if (!this.view || !this.isLexerErrors) return Promise.resolve();
    if (this.lexerErrorsTimer) clearTimeout(this.lexerErrorsTimer);
    const run = (): Promise<void> => {
      this.lexerErrorsTimer = undefined;
      const editor = vscode.window.activeTextEditor;
      let overlay = options?.diagnostics;
      if (!overlay && editor) {
        const uri = editor.document.uri.toString();
        const published = optimisticDiags.getPublished(uri);
        if (published) {
          overlay = published;
        } else {
          const host = vscode.languages.getDiagnostics(editor.document.uri);
          overlay = optimisticDiags.mergeHost(uri, host);
        }
      }
      return applyDiagnosticsToSidebar(
        this.view!.webview,
        this.viewId,
        editor?.document,
        this.client,
        overlay
      ).finally(() => {
      });
    };
    if (options?.immediate) return run();
    return new Promise((resolve) => {
      this.lexerErrorsTimer = setTimeout(() => {
        void run().finally(resolve);
      }, 200);
    });
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webviewView.webview.html = sidebarHtml(webviewView.webview, this.context.extensionUri);
    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) return;
      this.paintFromCacheOrStatic();
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "ready") {
        this.paintFromCacheOrStatic();
        sidebarReadyHandler?.();
        return;
      }
      if (msg.type === "insert" && typeof msg.text === "string") {
        await insertTemplate(msg.text, msg.format === "snippet" ? "snippet" : "plain");
        return;
      }
      if (msg.type === "goTo" && msg.uri && msg.range) {
        await goToSymbol(msg.uri, msg.range);
        return;
      }
      if (msg.type === "runCommand" && typeof msg.command === "string") {
        if (msg.args == null) {
          await vscode.commands.executeCommand(msg.command);
        } else {
          await vscode.commands.executeCommand(msg.command, msg.args);
        }
        return;
      }
      if (msg.type === "copyText" && typeof msg.text === "string") {
        await vscode.env.clipboard.writeText(msg.text);
        if (typeof msg.notify === "string" && msg.notify.trim()) {
          vscode.window.showInformationMessage(msg.notify);
        }
      }
    });
  }

  refresh(): void {
    void this.pushState();
  }

  async fetchIndex(
    uri: string,
    line: number,
    character: number,
    mode: "full" | "constants" = "full",
    visible?: { start: number; end: number },
    cancel?: vscode.CancellationToken
  ): Promise<IndexPayload | null> {
    return this.client.sendRequest<IndexPayload | null>(
      "mcuhelper/getIndex",
      {
        uri,
        line,
        character,
        mode,
        visibleStart: visible?.start,
        visibleEnd: visible?.end,
      },
      cancel
    );
  }

  /** Обновить дерево из уже загруженного индекса (без LSP-запроса). */
  applyIndex(index: IndexPayload | null, emptyMessage?: string): void {
    if (!this.view) {
      return;
    }
    const webview = this.view.webview;

    if (this.isCatalog) {
      webview.postMessage({ type: "catalog", panel: this.viewId, modules: buildCatalogPayload() });
      return;
    }

    if (this.isLexerErrors) {
      if (emptyMessage) {
        webview.postMessage({ type: "empty", panel: this.viewId, message: emptyMessage });
        return;
      }
      this.applyLexerErrors();
      return;
    }

    const navId = NAV_VIEW_MAP[this.viewId];
    if (!navId) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor || !isMcunrDocument(editor.document)) {
      webview.postMessage({
        type: "empty",
        panel: this.viewId,
        message: "Откройте файл MCU-NR для навигации",
      });
      return;
    }

    const uri = editor.document.uri.toString();
    if (!index) {
      webview.postMessage({
        type: "empty",
        panel: this.viewId,
        message: emptyMessage ?? "Индекс пока недоступен — дождитесь анализа LSP",
      });
      return;
    }
    const suggestSumIsotope =
      navId === "materials" ? collectSumIsotopeSuggestions(editor.document.uri) : undefined;
    const nodes = buildNavTree(navId, index, uri, suggestSumIsotope);
    webview.postMessage({ type: "tree", panel: this.viewId, nodes });
  }

  private async pushState(): Promise<void> {
    if (!this.view) return;

    if (this.isCatalog) {
      this.applyIndex(null);
      return;
    }

    if (this.isLexerErrors) {
      this.applyLexerErrors();
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || !isMcunrDocument(editor.document)) {
      this.applyIndex(null);
      return;
    }

    const uri = editor.document.uri.toString();
    const pos = editor.selection.active;
    try {
      const vis = visibleLineSpan(editor);
      const index = await this.client.sendRequest<IndexPayload | null>("mcuhelper/getIndex", {
        uri,
        line: pos.line,
        character: pos.character,
        mode: "full",
        visibleStart: vis.start,
        visibleEnd: vis.end,
      });
      this.applyIndex(index, "Не удалось получить индекс");
    } catch {
      this.applyIndex(null, "Не удалось получить индекс");
    }
  }
}

export function initOverlaySquiggles(context: vscode.ExtensionContext): void {
  if (overlaySquiggles) return;
  overlaySquiggles = vscode.languages.createDiagnosticCollection("mcuhelper.overlay");
  context.subscriptions.push(overlaySquiggles);
}

export function createSidebarProviders(
  context: vscode.ExtensionContext,
  client: LanguageClient
): Map<SidebarViewId, SidebarViewProvider> {
  initOverlaySquiggles(context);
  const ids: SidebarViewId[] = [
    "mcuhelper.catalog",
    "mcuhelper.lexerErrors",
    "mcuhelper.fragments",
    "mcuhelper.materials",
    "mcuhelper.constants",
    "mcuhelper.bodies",
    "mcuhelper.nets",
    "mcuhelper.lattices",
    "mcuhelper.zones",
    "mcuhelper.objects",
  ];
  const map = new Map<SidebarViewId, SidebarViewProvider>();
  for (const id of ids) {
    const provider = new SidebarViewProvider(id, context, client);
    map.set(
      id,
      provider
    );
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(id, provider, {
        webviewOptions: { retainContextWhenHidden: true },
      })
    );
  }
  return map;
}

export function refreshAllSidebars(providers: Map<SidebarViewId, SidebarViewProvider>): void {
  void refreshSidebarsCoalesced(providers, "all");
}

const NAV_PANELS: SidebarViewId[] = [
  "mcuhelper.lexerErrors",
  "mcuhelper.fragments",
  "mcuhelper.materials",
  "mcuhelper.constants",
  "mcuhelper.bodies",
  "mcuhelper.nets",
  "mcuhelper.lattices",
  "mcuhelper.zones",
  "mcuhelper.objects",
];

export type SidebarRefreshScope = "all" | "constants";

let refreshInFlight: Promise<void> | null = null;
let refreshEpoch = 0;
let pendingRefreshScope: SidebarRefreshScope | null = null;
let diagnosticsFollowUpTimer: ReturnType<typeof setTimeout> | undefined;
let refreshGeneration = 0;
let sidebarFetchCancel: vscode.CancellationTokenSource | undefined;
const optimisticDiags = new OptimisticDiagnosticStore<vscode.Diagnostic>();
let overlaySquiggles: vscode.DiagnosticCollection | undefined;
const knownEquNames = new Map<string, Set<string>>();
let lastAppliedSidebarUri: string | undefined;
let cachedSidebarIndex:
  | { uri: string; index: IndexPayload | null; errorMsg?: string }
  | undefined;

export function getAppliedSidebarUri(): string | undefined {
  return lastAppliedSidebarUri;
}

export function paintCachedSidebarIndex(
  providers: Map<SidebarViewId, SidebarViewProvider>
): boolean {
  const editor = vscode.window.activeTextEditor;
  const liveUri = editor?.document.uri.toString();
  if (!shouldPaintCachedSidebarIndex(cachedSidebarIndex?.uri, liveUri)) return false;
  const cached = cachedSidebarIndex!;
  let painted = 0;
  for (const id of NAV_PANELS) {
    if (id === "mcuhelper.lexerErrors") continue;
    const p = providers.get(id);
    if (!p?.hasView()) continue;
    p.applyIndex(cached.index, cached.errorMsg);
    painted++;
  }
  return painted > 0;
}

export function rememberEquNames(uri: string, names: readonly string[]): void {
  const set = knownEquNames.get(uri) ?? new Set<string>();
  for (const n of names) {
    const key = n.trim().toUpperCase();
    if (key) set.add(key);
  }
  knownEquNames.set(uri, set);
}

export function getKnownEquNames(uri: string): ReadonlySet<string> {
  return knownEquNames.get(uri) ?? new Set();
}

/** Squiggle = дерево. LSP collection при next([]) не красит — иначе второй варнинг висит 50с. */
export function publishOverlaySquiggles(uri: string | vscode.Uri, diags: readonly vscode.Diagnostic[]): void {
  const painted = paintDiagnosticsFromOverlay(diags);
  const key = typeof uri === "string" ? vscode.Uri.parse(uri) : uri;
  overlaySquiggles?.set(key, painted.slice());
}

/** Stale publishDiagnostics: не затираем overlay. Только filter suppressed. */
export function mergeOptimisticFromLsp(uri: string, diags: readonly vscode.Diagnostic[]): vscode.Diagnostic[] {
  const shown = optimisticDiags.mergeHost(uri, diags);
  publishOverlaySquiggles(uri, shown);
  return shown;
}

/** Свежий validate той же version — дерево = squiggle, новая ошибка доезжает. */
export function commitOptimisticFromLsp(uri: string, diags: readonly vscode.Diagnostic[]): vscode.Diagnostic[] {
  const shown = optimisticDiags.commitFromLsp(uri, diags);
  publishOverlaySquiggles(uri, shown);
  return shown;
}

function cancelSidebarFetch(): void {
  if (sidebarFetchCancel) {
    sidebarFetchCancel.cancel();
    sidebarFetchCancel = undefined;
  }
}

/** Сбросить отложенный refresh и отменить in-flight getIndex (перед patch на full-core). */
export function abortSidebarRefreshQueue(): void {
  cancelSidebarFetch();
  pendingRefreshScope = null;
  refreshEpoch++;
  refreshInFlight = null;
}

export function clearOptimisticForDocument(uri: string): void {
  optimisticDiags.clear(uri);
  knownEquNames.delete(uri);
  try {
    overlaySquiggles?.delete(vscode.Uri.parse(uri));
  } catch {
    // invalid uri
  }
}

/** Панель диагностики сразу, не дожидаясь onDidChangeDiagnostics (~15с на full-core). */
export function applyOptimisticDiagnosticsOnEdit(
  providers: Map<SidebarViewId, SidebarViewProvider>,
  uri: string,
  changes: readonly { range?: { start: { line: number; character: number }; end: { line: number; character: number } }; text: string }[],
  hostDiags: readonly vscode.Diagnostic[],
  doc?: vscode.TextDocument
): void {
  const overlayCount = optimisticDiags.getPublished(uri)?.length ?? 0;
  const canPatch = shouldApplyOptimisticOverlay(hostDiags.length, overlayCount);
  let shown = canPatch
    ? optimisticDiags.applyEdit(uri, toLineChanges(changes), hostDiags)
    : optimisticDiags.getPublished(uri) ?? [];
  const online = doc ? collectOnlineMatrConcDiags(uri, changes, doc) : { issues: [] as vscode.Diagnostic[], lines: [] as number[] };
  if (online.lines.length) {
    let next = shown;
    for (const line of online.lines) {
      next = optimisticDiags.replaceLineDiags(
        uri,
        line,
        online.issues.filter((d) => d.range.start.line === line)
      );
    }
    shown = next;
  }
  if (!canPatch && !online.lines.length) {
    return;
  }
  publishOverlaySquiggles(uri, shown);
  providers.get("mcuhelper.lexerErrors")?.applyLexerErrors({ immediate: true, diagnostics: shown });
}

function collectOnlineMatrConcDiags(
  uri: string,
  changes: readonly { range?: { start: { line: number; character: number }; end: { line: number; character: number } }; text: string }[],
  doc: vscode.TextDocument
): { issues: vscode.Diagnostic[]; lines: number[] } {
  const equ = getKnownEquNames(uri);
  const issues: vscode.Diagnostic[] = [];
  const seenLines = new Set<number>();
  for (const ch of changes) {
    if (!ch.range) continue;
    const inserted = ch.text.split(/\r?\n/).length;
    const from = ch.range.start.line;
    const to = Math.min(doc.lineCount - 1, from + Math.max(0, inserted - 1));
    for (let line = from; line <= to; line++) {
      if (seenLines.has(line)) continue;
      seenLines.add(line);
      for (const issue of scanNuclideConcentrationLine(doc.lineAt(line).text, line, equ)) {
        const d = new vscode.Diagnostic(
          new vscode.Range(issue.line, issue.character, issue.line, issue.endCharacter),
          issue.message,
          vscode.DiagnosticSeverity.Warning
        );
        d.code = issue.code;
        d.source = MCUHELPER_DIAG_SOURCE;
        issues.push(d);
      }
    }
  }
  return { issues, lines: [...seenLines] };
}

/** Сразу убрать дерево предыдущего файла при смене редактора. */
export function invalidateSidebarsOnEditorSwitch(
  providers: Map<SidebarViewId, SidebarViewProvider>
): void {
  abortSidebarRefreshQueue();
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "mcunr") {
    return;
  }
  refreshGeneration++;
  lastAppliedSidebarUri = undefined;
  cachedSidebarIndex = undefined;
  const uri = editor.document.uri.toString();
  const kept = optimisticDiags.getPublished(uri) ?? [];
  publishOverlaySquiggles(uri, kept);
  for (const id of NAV_PANELS) {
    if (sidebarPanelModeOnEditorSwitch(id) === "keep-diagnostics") {
      providers.get(id)?.applyLexerErrors({ immediate: true, diagnostics: kept });
      continue;
    }
    providers.get(id)?.applyIndex(null, "Загрузка индекса…");
  }
}

/** Обновить панель «Диагностика»; повтор через ~450 ms — после async revalidate parent при открытии #include. */
export function refreshDiagnosticsSidebar(
  providers: Map<SidebarViewId, SidebarViewProvider>,
  options?: { followUp?: boolean }
): void {
  providers.get("mcuhelper.lexerErrors")?.applyLexerErrors();
  if (options?.followUp === false) return;
  if (diagnosticsFollowUpTimer) clearTimeout(diagnosticsFollowUpTimer);
  diagnosticsFollowUpTimer = setTimeout(() => {
    diagnosticsFollowUpTimer = undefined;
    providers.get("mcuhelper.lexerErrors")?.applyLexerErrors();
  }, 450);
}

function mergeRefreshScope(
  current: SidebarRefreshScope | null,
  next: SidebarRefreshScope
): SidebarRefreshScope {
  if (current === "all" || next === "all") return "all";
  return "constants";
}

export async function refreshSidebarsCoalesced(
  providers: Map<SidebarViewId, SidebarViewProvider>,
  scope: SidebarRefreshScope
): Promise<void> {
  if (refreshInFlight) {
    pendingRefreshScope = mergeRefreshScope(pendingRefreshScope, scope);
    return refreshInFlight;
  }

  const epoch = refreshEpoch;
  refreshInFlight = refreshSidebarsOnce(providers, scope).finally(() => {
    if (shouldSupersedeSidebarRefresh(epoch, refreshEpoch)) return;
    refreshInFlight = null;
    if (pendingRefreshScope) {
      const nextScope = pendingRefreshScope;
      pendingRefreshScope = null;
      void refreshSidebarsCoalesced(providers, nextScope);
    }
  });
  return refreshInFlight;
}

async function refreshSidebarsOnce(
  providers: Map<SidebarViewId, SidebarViewProvider>,
  scope: SidebarRefreshScope
): Promise<void> {
  const gen = refreshGeneration;
  const catalog = providers.get("mcuhelper.catalog");
  if (scope === "all" && catalog) {
    catalog.applyIndex(null);
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) {
    for (const id of NAV_PANELS) {
      if (scope === "constants" && id !== "mcuhelper.constants" && id !== "mcuhelper.lexerErrors") continue;
      if (id === "mcuhelper.lexerErrors") {
        if (scope !== "constants") providers.get(id)?.applyLexerErrors();
      } else {
        providers.get(id)?.applyIndex(null);
      }
    }
    if (editor && sumIsotopeDecorationHandler) {
      sumIsotopeDecorationHandler(editor, null);
    }
    return;
  }

  const navProvider = providers.get("mcuhelper.materials");
  if (!navProvider) return;

  const uri = editor.document.uri.toString();
  const pos = editor.selection.active;

  // Диагностика не ждёт getIndex: иначе список ошибок «отстаёт» на десятки секунд.
  if (scope !== "constants") {
    providers.get("mcuhelper.lexerErrors")?.applyLexerErrors();
  }

  // Не очищаем панели до ответа: иначе debounce после правок мигает и сбрасывает дерево.
  // Пока идёт fetch, остаётся предыдущий индекс.

  let index: IndexPayload | null = null;
  let errorMsg: string | undefined;
  cancelSidebarFetch();
  sidebarFetchCancel = new vscode.CancellationTokenSource();
  const fetchToken = sidebarFetchCancel.token;
  try {
    index = await new Promise<IndexPayload | null>((resolve, reject) => {
      let settled = false;
      const finish = (value: IndexPayload | null): void => {
        if (settled) return;
        settled = true;
        sub.dispose();
        resolve(value);
      };
      const sub = fetchToken.onCancellationRequested(() => finish(null));
      if (fetchToken.isCancellationRequested) {
        finish(null);
        return;
      }
      void navProvider
        .fetchIndex(
          uri,
          pos.line,
          pos.character,
          scope === "constants" ? "constants" : "full",
          visibleLineSpan(editor),
          fetchToken
        )
        .then(
          (value) => finish(value),
          (err: unknown) => {
            if (fetchToken.isCancellationRequested) finish(null);
            else reject(err);
          }
        );
    });
    if (fetchToken.isCancellationRequested) {
      return;
    }
  } catch {
    if (fetchToken.isCancellationRequested) {
      return;
    }
    errorMsg = "Не удалось получить индекс";
  } finally {
    if (sidebarFetchCancel?.token === fetchToken) {
      sidebarFetchCancel = undefined;
    }
  }

  const liveUri = vscode.window.activeTextEditor?.document.uri.toString();
  if (
    shouldDiscardStaleSidebarApply({
      requestGen: gen,
      liveGen: refreshGeneration,
      requestUri: uri,
      liveUri,
    })
  ) {
    return;
  }

  cachedSidebarIndex = { uri, index, errorMsg };
  if (index?.summaries?.constants?.length) {
    rememberEquNames(
      uri,
      index.summaries.constants.map((c) => c.name)
    );
  }
  for (const id of NAV_PANELS) {
    if (scope === "constants" && id !== "mcuhelper.constants") continue;
    if (id === "mcuhelper.lexerErrors") continue;
    providers.get(id)?.applyIndex(index, errorMsg);
  }
  if (scope === "all") {
    lastAppliedSidebarUri = uri;
  }


  if (scope === "all" && sumIsotopeDecorationHandler) {
    sumIsotopeDecorationHandler(editor, index);
  }
}