import * as vscode from "vscode";
import { buildCatalogPayload } from "./catalogBridge";
import { LanguageClient } from "vscode-languageclient/node";
import { isMcunrDocument } from "./contentDetect";
import { buildNavTree, type IndexPayload, type NavViewId } from "./navData";
import { goToSymbol, insertTemplate } from "./templateInsert";
import { applyDiagnosticsToSidebar } from "./diagnosticNavigation";

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

export function setSidebarReadyHandler(handler: () => void): void {
  sidebarReadyHandler = handler;
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

  applyLexerErrors(): Promise<void> {
    if (!this.view || !this.isLexerErrors) return Promise.resolve();
    return applyDiagnosticsToSidebar(
      this.view.webview,
      this.viewId,
      vscode.window.activeTextEditor?.document,
      this.client
    );
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

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "ready") {
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
      if (msg.type === "copyText" && typeof msg.text === "string") {
        await vscode.env.clipboard.writeText(msg.text);
      }
    });
  }

  refresh(): void {
    void this.pushState();
  }

  async fetchIndex(uri: string, line: number, character: number): Promise<IndexPayload | null> {
    return this.client.sendRequest<IndexPayload | null>("mcuhelper/getIndex", {
      uri,
      line,
      character,
    });
  }

  /** Обновить дерево из уже загруженного индекса (без LSP-запроса). */
  applyIndex(index: IndexPayload | null, emptyMessage?: string): void {
    if (!this.view) return;
    const webview = this.view.webview;

    if (this.isCatalog) {
      webview.postMessage({ type: "catalog", panel: this.viewId, modules: buildCatalogPayload() });
      return;
    }

    if (this.isLexerErrors) {
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
    const nodes = buildNavTree(navId, index, uri);
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
      const index = await this.client.sendRequest<IndexPayload | null>("mcuhelper/getIndex", {
        uri,
        line: pos.line,
        character: pos.character,
      });
      this.applyIndex(index, "Не удалось получить индекс");
    } catch {
      this.applyIndex(null, "Не удалось получить индекс");
    }
  }
}

export function createSidebarProviders(
  context: vscode.ExtensionContext,
  client: LanguageClient
): Map<SidebarViewId, SidebarViewProvider> {
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
let pendingRefreshScope: SidebarRefreshScope | null = null;

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

  refreshInFlight = refreshSidebarsOnce(providers, scope).finally(() => {
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
  const catalog = providers.get("mcuhelper.catalog");
  if (scope === "all" && catalog) {
    catalog.applyIndex(null);
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) {
    for (const id of NAV_PANELS) {
      if (scope === "constants" && id !== "mcuhelper.constants" && id !== "mcuhelper.lexerErrors") continue;
      if (id === "mcuhelper.lexerErrors") {
        providers.get(id)?.applyLexerErrors();
      } else {
        providers.get(id)?.applyIndex(null);
      }
    }
    return;
  }

  const navProvider = providers.get("mcuhelper.materials");
  if (!navProvider) return;

  const uri = editor.document.uri.toString();
  const pos = editor.selection.active;

  let index: IndexPayload | null = null;
  let errorMsg: string | undefined;
  try {
    index = await navProvider.fetchIndex(uri, pos.line, pos.character);
  } catch {
    errorMsg = "Не удалось получить индекс";
  }

  for (const id of NAV_PANELS) {
    if (scope === "constants" && id !== "mcuhelper.constants" && id !== "mcuhelper.lexerErrors") continue;
    if (id === "mcuhelper.lexerErrors") {
      providers.get(id)?.applyLexerErrors();
      continue;
    }
    providers.get(id)?.applyIndex(index, errorMsg);
  }
}
