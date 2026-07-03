import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { GeometryPanel } from "./geometryPanel";
import { maybeSetMcunrLanguage, scoreMcunrContent, isMcunrDocument } from "./contentDetect";
import { registerExpandNaturalIsotope, hoverMiddleware } from "./expandNaturalIsotope";
import { createSidebarProviders, refreshSidebarsCoalesced, setSidebarReadyHandler, type SidebarViewId, type SidebarViewProvider } from "./sidebarView";
import { registerTemplateInsert } from "./templateInsert";
import { buildCatalogPayload } from "./catalogBridge";

const REFRESH_DEBOUNCE_MS = 500;
const SELECTION_REFRESH_DEBOUNCE_MS = 300;
/** Не обновлять константы по selection сразу после правки (курсор двигается при вводе). */
const SELECTION_AFTER_EDIT_QUIET_MS = 600;

let lastDocChangeAt = 0;
/** esbuild-бандл: предпочитаем более свежий из extension/server и packages/mcu-lsp/dist. */
function pickNewerServerModule(bundled: string, monorepo: string): string {
  const hasBundled = fs.existsSync(bundled);
  const hasMonorepo = fs.existsSync(monorepo);
  if (hasBundled && hasMonorepo) {
    return fs.statSync(monorepo).mtimeMs > fs.statSync(bundled).mtimeMs ? monorepo : bundled;
  }
  if (hasBundled) return bundled;
  return monorepo;
}

let client: LanguageClient | undefined;
let sidebarProviders: Map<SidebarViewId, SidebarViewProvider>;
let geometryPanel: GeometryPanel;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let selectionRefreshTimer: ReturnType<typeof setTimeout> | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("MCU-NR Helper");
  context.subscriptions.push(output);

  const bundledServer = path.join(context.extensionPath, "server", "server.js");
  const monorepoServer = path.join(
    context.extensionPath,
    "..",
    "packages",
    "mcu-lsp",
    "dist",
    "server.js"
  );
  const serverModule = pickNewerServerModule(bundledServer, monorepoServer);
  const serverDir = path.dirname(serverModule);

  if (!fs.existsSync(serverModule)) {
    const msg = `LSP server не найден: ${serverModule}. Выполните npm run build в корне проекта.`;
    output.appendLine(msg);
    vscode.window.showErrorMessage(msg);
    return;
  }

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc, options: { cwd: serverDir } },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { cwd: serverDir },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ language: "mcunr" }],
    synchronize: {
      configurationSection: "mcuhelper",
    },
    middleware: {
      ...hoverMiddleware(),
    },
  };

  client = new LanguageClient("mcuhelper", "MCU-NR Language Server", serverOptions, clientOptions);
  client.onDidChangeState((e) => {
    output.appendLine(`LSP state: ${e.newState}`);
    if (e.newState === 2) {
      scheduleRefresh();
      void warmupExtensionAfterLspReady();
    }
  });
  client.start().catch((err) => {
    const msg = `Не удалось запустить MCU-NR LSP: ${err}`;
    output.appendLine(msg);
    vscode.window.showErrorMessage(msg);
  });

  geometryPanel = new GeometryPanel(context, client);
  registerExpandNaturalIsotope(context, client);
  registerTemplateInsert(context);
  sidebarProviders = createSidebarProviders(context, client);
  setSidebarReadyHandler(() => scheduleRefresh());

  try {
    buildCatalogPayload();
  } catch {
    // vendor может отсутствовать до сборки
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("mcuhelper.refreshIndex", () => scheduleRefresh()),
    vscode.commands.registerCommand("mcuhelper.showCatalog", () => vscode.commands.executeCommand("mcuhelper.catalog.focus")),
    vscode.commands.registerCommand("mcuhelper.showMaterials", () => vscode.commands.executeCommand("mcuhelper.materials.focus")),
    vscode.commands.registerCommand("mcuhelper.showZones", () => vscode.commands.executeCommand("mcuhelper.zones.focus")),
    vscode.commands.registerCommand("mcuhelper.showObjects", () => vscode.commands.executeCommand("mcuhelper.objects.focus")),
    vscode.commands.registerCommand("mcuhelper.showConstants", () => vscode.commands.executeCommand("mcuhelper.constants.focus")),
    vscode.commands.registerCommand("mcuhelper.showBodies", () => vscode.commands.executeCommand("mcuhelper.bodies.focus")),
    vscode.commands.registerCommand("mcuhelper.showNets", () => vscode.commands.executeCommand("mcuhelper.nets.focus")),
    vscode.commands.registerCommand("mcuhelper.showLattices", () => vscode.commands.executeCommand("mcuhelper.lattices.focus")),
    vscode.commands.registerCommand("mcuhelper.showGeometry", () => geometryPanel.show()),
    vscode.commands.registerCommand("mcuhelper.validateInput", () => validateInput()),
    vscode.commands.registerCommand("mcuhelper.exportDiagnostics", () => exportDiagnostics(output)),
    vscode.commands.registerCommand("mcuhelper.detectLanguage", () => detectLanguage(output)),
    vscode.window.onDidChangeActiveTextEditor(() => scheduleRefresh("all")),
    vscode.window.onDidChangeTextEditorSelection(() => {
      if (Date.now() - lastDocChangeAt < SELECTION_AFTER_EDIT_QUIET_MS) return;
      if (refreshTimer) return;
      scheduleRefresh("constants");
    })
  );

  void scanAllDocuments(output);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (await maybeSetMcunrLanguage(doc, output)) scheduleRefresh();
      else if (isMcunrDocument(doc)) scheduleRefresh();
    }),
    vscode.workspace.onDidSaveTextDocument(() => scheduleRefresh()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      geometryPanel.onDocumentChanged(e.document);
      if (isMcunrDocument(e.document)) {
        lastDocChangeAt = Date.now();
        if (selectionRefreshTimer) {
          clearTimeout(selectionRefreshTimer);
          selectionRefreshTimer = undefined;
        }
        scheduleRefresh();
      }
    })
  );
}

function scheduleRefresh(scope: "all" | "constants" = "all"): void {
  if (scope === "constants") {
    if (refreshTimer) return;
    if (Date.now() - lastDocChangeAt < SELECTION_AFTER_EDIT_QUIET_MS) return;
    if (selectionRefreshTimer) clearTimeout(selectionRefreshTimer);
    selectionRefreshTimer = setTimeout(() => {
      selectionRefreshTimer = undefined;
      void refreshSidebarsCoalesced(sidebarProviders, "constants");
    }, SELECTION_REFRESH_DEBOUNCE_MS);
    return;
  }

  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    void refreshSidebarsCoalesced(sidebarProviders, "all");
  }, REFRESH_DEBOUNCE_MS);
}

async function scanAllDocuments(output: vscode.OutputChannel): Promise<void> {
  for (const doc of vscode.workspace.textDocuments) {
    await maybeSetMcunrLanguage(doc, output);
  }
}

async function detectLanguage(output: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Нет открытого редактора");
    return;
  }
  const doc = editor.document;
  const result = scoreMcunrContent(doc.getText());
  if (!result.isMcunr) {
    vscode.window.showInformationMessage(
      `Не похоже на MCU-NR (score=${result.score}, нужно ≥4). Найдено: ${result.hits.join(", ") || "—"}`
    );
    return;
  }
  if (doc.languageId !== "mcunr") {
    await vscode.languages.setTextDocumentLanguage(doc, "mcunr");
    output.appendLine(`Язык MCU-NR установлен вручную: ${doc.uri.fsPath} (${result.hits.join(", ")})`);
  }
  vscode.window.showInformationMessage(`MCU-NR: score=${result.score} (${result.hits.join(", ")})`);
  scheduleRefresh();
}

async function validateInput(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) {
    vscode.window.showWarningMessage("Откройте файл варианта MCU-NR");
    return;
  }
  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  const mcuNrPath = cfg.get<string>("mcuNrPath") ?? "";
  const variantName = cfg.get<string>("variantName") ?? pathBasename(editor.document);
  if (!mcuNrPath) {
    vscode.window.showErrorMessage("Укажите mcuhelper.mcuNrPath в настройках");
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "MCU-NR INPUT…", cancellable: false },
    async () => {
      const result = await client!.sendRequest<{ ok: boolean; diagnosticCount: number }>("mcuhelper/validateInput", {
        uri: editor.document.uri.toString(),
        mcuNrPath,
        variantName,
      });
      if (result.ok) {
        vscode.window.showInformationMessage(`INPUT завершён. Диагностик из LST: ${result.diagnosticCount}`);
      } else {
        vscode.window.showWarningMessage(`INPUT завершён с ошибками. Диагностик: ${result.diagnosticCount}`);
      }
    }
  );
}

function pathBasename(doc: vscode.TextDocument): string {
  const name = doc.fileName.split(/[/\\]/).pop() ?? "NAME";
  return name.replace(/\.[^.]+$/, "").slice(0, 8) || "NAME";
}

async function exportDiagnostics(output: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) {
    vscode.window.showWarningMessage("Откройте файл варианта MCU-NR");
    return;
  }

  const uri = editor.document.uri;
  const mcu = vscode.languages.getDiagnostics(uri).filter((d) => d.source === "mcuhelper");

  const lines: string[] = [
    `# MCU-NR diagnostics: ${uri.fsPath}`,
    `# Всего: ${mcu.length}`,
    "",
  ];

  if (mcu.length === 0) {
    lines.push("(нет диагностик — файл чист или LSP ещё не отработал)");
  } else {
    const sev = (s: vscode.DiagnosticSeverity) =>
      s === vscode.DiagnosticSeverity.Error ? "error" : s === vscode.DiagnosticSeverity.Warning ? "warning" : "info";
    for (const d of mcu.sort((a, b) => a.range.start.line - b.range.start.line)) {
      const code = d.code != null ? ` [${d.code}]` : "";
      const src = d.source ? ` (${d.source})` : "";
      lines.push(
        `${sev(d.severity)} L${d.range.start.line + 1}:${d.range.start.character + 1}${code}${src}: ${d.message}`
      );
    }
  }

  const text = lines.join("\n");
  output.clear();
  output.show(true);
  output.appendLine(text);
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage(
    `Диагностики скопированы в буфер (${mcu.length}). См. Output → MCU-NR Helper`
  );
}

export function deactivate(): Promise<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}

async function warmupExtensionAfterLspReady(): Promise<void> {
  if (!client) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) return;
  const uri = editor.document.uri.toString();
  const pos = editor.selection.active;
  try {
    await client.sendRequest("mcuhelper/getIndex", { uri, line: pos.line, character: pos.character });
  } catch {
    // ignore warmup errors
  }
}
