import * as vscode from "vscode";
import { isMcunrDocument } from "./contentDetect";

export const RUN_PANEL_VIEW_ID = "mcuhelper.run";

function pathBasename(doc: vscode.TextDocument): string {
  const name = doc.fileName.split(/[/\\]/).pop() ?? "NAME";
  return name.replace(/\.[^.]+$/, "").slice(0, 8) || "NAME";
}

function runPanelHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sidebar", "sidebar.css"));
  const icons = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sidebar", "sidebarIcons.js"));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sidebar", "runPanel.js"));
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

export class RunPanelViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

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
    webviewView.webview.html = runPanelHtml(webviewView.webview, this.context.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "ready") {
        this.refresh();
        return;
      }
      if (msg.type === "run" && typeof msg.command === "string") {
        await vscode.commands.executeCommand(msg.command);
        this.refresh();
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.refresh();
    });
  }

  refresh(): void {
    if (!this.view) return;
    const cfg = vscode.workspace.getConfiguration("mcuhelper");
    const mcuNrPath = cfg.get<string>("mcuNrPath") ?? "";
    const constantsLibPath = cfg.get<string>("mcuConstantsLibPath") ?? "";
    const editor = vscode.window.activeTextEditor;
    const hasDoc = !!editor && isMcunrDocument(editor.document);

    this.view.webview.postMessage({
      type: "status",
      hasDoc,
      variantName: hasDoc && editor ? pathBasename(editor.document) : "",
      mcuNrPath,
      constantsLibPath,
      pathsReady: Boolean(mcuNrPath && constantsLibPath),
    });
  }
}

export function registerRunPanel(context: vscode.ExtensionContext): RunPanelViewProvider {
  const provider = new RunPanelViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RUN_PANEL_VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("mcuhelper.mcuNrPath") ||
        e.affectsConfiguration("mcuhelper.mcuConstantsLibPath")
      ) {
        provider.refresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => provider.refresh())
  );
  return provider;
}
