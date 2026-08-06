import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  State,
  TransportKind,
} from "vscode-languageclient/node";
import { GeometryPanel } from "./geometryPanel";
import { DefaultPhyPanel } from "./defaultPhyPanel";
import { maybeSetMcunrLanguage, scoreMcunrContent, isMcunrDocument } from "./contentDetect";
import { maybeFixDocumentEncoding, detectEncodingCommand } from "./encodingDetect";
import { registerExpandNaturalIsotope, hoverMiddleware } from "./expandNaturalIsotope";
import { registerAddToSumIsotope } from "./addToSumIsotope";
import { createSidebarProviders, refreshSidebarsCoalesced, setSidebarReadyHandler, setSumIsotopeDecorationHandler, type SidebarViewId, type SidebarViewProvider } from "./sidebarView";
import { registerTemplateInsert } from "./templateInsert";
import { buildCatalogPayload } from "./catalogBridge";
import { registerDiagnosticNavigation, fetchMcuDiagnostics } from "./diagnosticNavigation";
import { registerIncludePreview } from "./includePreview";
import { clearLanguageDetectState, scheduleLanguageDetectOnEdit } from "./languageDetectScheduler";
import { registerRunPanel, type RunPanelViewProvider } from "./runPanelView";
import { runMcuInTerminal } from "./mcuTerminalRun";
import { lstPathCandidates, resolvePostRunOpenTarget, shouldFocusDiagnosticsAfterRun } from "./runPanelHelpers";
import { checkForExtensionUpdates } from "./updateCheck";
import {
  applySumIsotopeDecorations,
  clearSumIsotopeDecorations,
  createSumIsotopeDecorationType,
} from "./sumIsotopeDecorations";
import {
  applyStableIsotopeDecorations,
  clearStableIsotopeDecorations,
  createStableIsotopeDecorationType,
} from "./stableIsotopeDecorations";

const REFRESH_DEBOUNCE_MS = 500;
const SELECTION_REFRESH_DEBOUNCE_MS = 300;
/** Не обновлять константы по selection сразу после правки (курсор двигается при вводе). */
const SELECTION_AFTER_EDIT_QUIET_MS = 600;

let lastDocChangeAt = 0;
/** Output «MCU-NR Helper» — отчёты сверки AW/THR. */
let helperOutput: vscode.OutputChannel | undefined;

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
let defaultPhyPanel: DefaultPhyPanel;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let selectionRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let runStatusItem: vscode.StatusBarItem | undefined;
let runPanel: RunPanelViewProvider | undefined;
let sumIsotopeDecorationType: vscode.TextEditorDecorationType | undefined;
let stableIsotopeDecorationType: vscode.TextEditorDecorationType | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("MCU-NR Helper");
  helperOutput = output;
  context.subscriptions.push(output);
  void checkForExtensionUpdates(context, output);
  sumIsotopeDecorationType = createSumIsotopeDecorationType();
  context.subscriptions.push(sumIsotopeDecorationType);
  stableIsotopeDecorationType = createStableIsotopeDecorationType();
  context.subscriptions.push(stableIsotopeDecorationType);

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
    const msg = `Не найден LSP server: ${serverModule}. Выполните npm run build в корне проекта.`;
    output.appendLine(msg);
    vscode.window.showErrorMessage(msg);
    return;
  }
  output.appendLine(`LSP server: ${serverModule}`);
  // #region agent log
  {
    let serverHasSumEmpty = false;
    try {
      serverHasSumEmpty = fs.readFileSync(serverModule, "utf8").includes("sumStatesByMat");
    } catch {
      /* ignore */
    }
    fetch("http://127.0.0.1:7911/ingest/3304a270-bbbf-4e90-96de-6ba27b8f72bf", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "fded15" },
      body: JSON.stringify({
        sessionId: "fded15",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "extension.ts:serverModule",
        message: "LSP server module selected",
        data: {
          serverModule,
          bundledExists: fs.existsSync(bundledServer),
          monorepoExists: fs.existsSync(monorepoServer),
          serverHasSumEmpty,
          serverMtime: fs.existsSync(serverModule) ? fs.statSync(serverModule).mtimeMs : null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }
  // #endregion

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
    output.appendLine(`LSP state: ${e.oldState} → ${e.newState} (Running=${State.Running})`);
    if (e.newState === State.Running) {
      scheduleRefresh();
      void warmupExtensionAfterLspReady(output);
    }
  });
  // До start(): сверка AW/THR/groups по локальному кэшу часто успевает до .then() и иначе теряется.
  registerLspOutputNotifications(client, output);
  client
    .start()
    .then(() => {
      output.appendLine("LSP client.start() resolved — запрос отчёта сверки…");
      void pullLibraryReportsToOutput(output);
    })
    .catch((err) => {
      const msg = `Не удалось запустить LSP MCU-NR: ${err}`;
      output.appendLine(msg);
      vscode.window.showErrorMessage(msg);
    });

  geometryPanel = new GeometryPanel(context, client);
  defaultPhyPanel = new DefaultPhyPanel(context);
  registerExpandNaturalIsotope(context, client);
  const lspClient = client;
  registerAddToSumIsotope(context, {
    revalidate: async () => {
      await lspClient.sendRequest<number>("mcuhelper/revalidateAllOpen");
    },
    refreshUi: () => scheduleRefresh("all"),
  });
  registerTemplateInsert(context);
  registerDiagnosticNavigation(context, () => client);
  registerIncludePreview(context);
  sidebarProviders = createSidebarProviders(context, client);
  setSidebarReadyHandler(() => scheduleRefresh());
  setSumIsotopeDecorationHandler((editor, index) => {
    if (!sumIsotopeDecorationType || !stableIsotopeDecorationType) return;
    if (!index) {
      clearSumIsotopeDecorations(editor, sumIsotopeDecorationType);
      clearStableIsotopeDecorations(editor, stableIsotopeDecorationType);
      return;
    }
    const fromMarks = index.sumIsotopeMarks;
    const nuclides =
      fromMarks && fromMarks.length > 0
        ? fromMarks.map((n) => ({
            name: n.name,
            range: n.range,
            reasons: n.reasons,
          }))
        : index.summaries.materials.flatMap((m) =>
            m.nuclides
              .filter((n) => n.sumIsotope)
              .map((n) => ({
                name: n.name,
                range: n.range,
                reasons: n.sumIsotope!.reasons,
              }))
          );
    applySumIsotopeDecorations(editor, sumIsotopeDecorationType, nuclides);
    const sumKeys = new Set(nuclides.map((n) => `${n.range.start.line}:${n.name.toUpperCase()}`));
    const stableNuclides = (index.stableIsotopeMarks ?? [])
      .filter((n) => !sumKeys.has(`${n.range.start.line}:${n.name.toUpperCase()}`))
      .map((n) => ({
        name: n.name,
        range: n.range,
      }));
    applyStableIsotopeDecorations(editor, stableIsotopeDecorationType, stableNuclides);
  });
  runPanel = registerRunPanel(context);
  runStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 30);
  runStatusItem.name = "MCU-NR Run Actions";
  runStatusItem.command = "mcuhelper.run.focus";
  runStatusItem.text = "$(play-circle) MCU-NR";
  updateConfiguredPathsTooltips();
  context.subscriptions.push(runStatusItem);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("mcuhelper.mcuNrPath") ||
        e.affectsConfiguration("mcuhelper.mcuConstantsLibPath")
      ) {
        updateConfiguredPathsTooltips();
        if (e.affectsConfiguration("mcuhelper.mcuConstantsLibPath") && helperOutput && client) {
          // Дать LSP применить settings, затем забрать свежий отчёт T1/2.
          setTimeout(() => {
            void pullLibraryReportsToOutput(helperOutput!);
          }, 800);
        }
      }
    })
  );

  try {
    buildCatalogPayload();
  } catch {
    // vendor может отсутствовать до сборки
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("mcuhelper.refreshIndex", () => scheduleRefresh()),
    vscode.commands.registerCommand("mcuhelper.configureSolver", () => configureSolverPaths()),
    vscode.commands.registerCommand("mcuhelper.openRunKeybindings", () => openRunKeybindings()),
    vscode.commands.registerCommand("mcuhelper.showRunActions", () => showRunActions()),
    vscode.commands.registerCommand("mcuhelper.showCatalog", () => vscode.commands.executeCommand("mcuhelper.catalog.focus")),
    vscode.commands.registerCommand("mcuhelper.showLexerErrors", () => vscode.commands.executeCommand("mcuhelper.lexerErrors.focus")),
    vscode.commands.registerCommand("mcuhelper.showFragments", () => vscode.commands.executeCommand("mcuhelper.fragments.focus")),
    vscode.commands.registerCommand("mcuhelper.showMaterials", () => vscode.commands.executeCommand("mcuhelper.materials.focus")),
    vscode.commands.registerCommand("mcuhelper.showZones", () => vscode.commands.executeCommand("mcuhelper.zones.focus")),
    vscode.commands.registerCommand("mcuhelper.showObjects", () => vscode.commands.executeCommand("mcuhelper.objects.focus")),
    vscode.commands.registerCommand("mcuhelper.showConstants", () => vscode.commands.executeCommand("mcuhelper.constants.focus")),
    vscode.commands.registerCommand("mcuhelper.showBodies", () => vscode.commands.executeCommand("mcuhelper.bodies.focus")),
    vscode.commands.registerCommand("mcuhelper.showNets", () => vscode.commands.executeCommand("mcuhelper.nets.focus")),
    vscode.commands.registerCommand("mcuhelper.showLattices", () => vscode.commands.executeCommand("mcuhelper.lattices.focus")),
    vscode.commands.registerCommand("mcuhelper.showGeometry", () => geometryPanel.show()),
    vscode.commands.registerCommand("mcuhelper.editDefaultPhy", () => defaultPhyPanel.show()),
    vscode.commands.registerCommand("mcuhelper.validateInput", () => validateInput()),
    vscode.commands.registerCommand("mcuhelper.debugInput", () => runMcuStepCommand("i")),
    vscode.commands.registerCommand("mcuhelper.runCalculation", () => runMcuStepCommand("c")),
    vscode.commands.registerCommand("mcuhelper.continueCalculation", () => runMcuStepCommand("continue")),
    vscode.commands.registerCommand("mcuhelper.finalOutput", () => runMcuStepCommand("f")),
    vscode.commands.registerCommand("mcuhelper.exportDiagnostics", () => exportDiagnostics(output)),
    vscode.commands.registerCommand("mcuhelper.showLibraryVerificationReport", async () => {
      output.show(true);
      output.appendLine("Ручной запрос отчёта сверки AW.LIB / PARAMETE.THR…");
      printedOutputChunks.clear();
      await pullLibraryReportsToOutput(output);
    }),
    vscode.commands.registerCommand("mcuhelper.detectLanguage", () => detectLanguage(output)),
    vscode.commands.registerCommand("mcuhelper.detectEncoding", () => detectEncodingCommand(output)),
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateRunUiVisibility();
      scheduleRefresh("all");
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      if (Date.now() - lastDocChangeAt < SELECTION_AFTER_EDIT_QUIET_MS) return;
      if (refreshTimer) return;
      scheduleRefresh("constants");
    })
  );

  updateRunUiVisibility();
  void scanAllDocuments(output);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      await maybeFixDocumentEncoding(doc, output);
      const langChanged = await maybeSetMcunrLanguage(doc, output);
      // #region agent log
      if (/958/i.test(doc.uri.fsPath) || /#\s*include\s+confpd/i.test(doc.getText().slice(0, 5000))) {
        fetch("http://127.0.0.1:7911/ingest/3304a270-bbbf-4e90-96de-6ba27b8f72bf", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "fded15" },
          body: JSON.stringify({
            sessionId: "fded15",
            runId: "pre-fix",
            hypothesisId: "D",
            location: "extension.ts:onDidOpenTextDocument",
            message: "opened candidate deck",
            data: {
              fsPath: doc.uri.fsPath,
              languageId: doc.languageId,
              langChanged,
              lineCount: doc.lineCount,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      }
      // #endregion
      // Только явный mcunr: isMcunrDocument(content) при language=ini раздувает refresh при автодетекте.
      if (langChanged || doc.languageId === "mcunr") scheduleRefresh();
    }),
    vscode.workspace.onDidSaveTextDocument(() => scheduleRefresh()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      geometryPanel.onDocumentChanged(e.document);
      scheduleLanguageDetectOnEdit(e.document, e.contentChanges, output);
      if (e.document.languageId === "mcunr") {
        lastDocChangeAt = Date.now();
        if (selectionRefreshTimer) {
          clearTimeout(selectionRefreshTimer);
          selectionRefreshTimer = undefined;
        }
        scheduleRefresh();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearLanguageDetectState(doc);
    }),
    vscode.languages.onDidChangeDiagnostics((e) => {
      const editor = vscode.window.activeTextEditor;
      // #region agent log
      for (const u of e.uris) {
        if (!/958/i.test(u.fsPath)) continue;
        const diags = vscode.languages.getDiagnostics(u);
        fetch("http://127.0.0.1:7911/ingest/3304a270-bbbf-4e90-96de-6ba27b8f72bf", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "fded15" },
          body: JSON.stringify({
            sessionId: "fded15",
            runId: "pre-fix",
            hypothesisId: "E",
            location: "extension.ts:onDidChangeDiagnostics",
            message: "client diagnostics changed for 958",
            data: {
              fsPath: u.fsPath,
              total: diags.length,
              matrEmpty: diags
                .filter((d) => String(d.code) === "matr-empty" || /пуст/i.test(d.message))
                .map((d) => ({ code: d.code, msg: d.message, line: d.range.start.line, source: d.source })),
              sources: [...new Set(diags.map((d) => d.source ?? ""))],
              activeLang: editor?.document.languageId ?? null,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
      }
      // #endregion
      if (!editor || editor.document.languageId !== "mcunr") return;
      const activeUri = editor.document.uri.toString();
      if (e.uris.some((u) => u.toString() === activeUri)) {
        sidebarProviders.get("mcuhelper.lexerErrors")?.applyLexerErrors();
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
    await maybeFixDocumentEncoding(doc, output);
    await maybeSetMcunrLanguage(doc, output);
  }
}

async function detectLanguage(output: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("Нет активного редактора");
    return;
  }
  const doc = editor.document;
  const result = scoreMcunrContent(doc.getText());
  if (!result.isMcunr) {
    vscode.window.showInformationMessage(
      `Похоже не на MCU-NR: score=${result.score}, нужно ≥4. Совпадения: ${result.hits.join(", ") || "—"}`
    );
    return;
  }
  if (doc.languageId !== "mcunr") {
    await vscode.languages.setTextDocumentLanguage(doc, "mcunr");
    output.appendLine(`Язык MCU-NR установлен вручную: ${doc.uri.fsPath} (${result.hits.join(", ")})`);
  }
  vscode.window.showInformationMessage(`MCU-NR распознан: score=${result.score} (${result.hits.join(", ")})`);
  scheduleRefresh();
}

async function validateInput(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) {
    vscode.window.showWarningMessage("Откройте файл MCU-NR");
    return;
  }
  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  const mcuNrPath = cfg.get<string>("mcuNrPath") ?? "";
  // Имя варианта берём из текущего открытого файла (без расширения).
  // Это совпадает с твоим батником/схемой, где имя варианта = базовое имя deck.
  const variantName = pathBasename(editor.document);
  if (!mcuNrPath) {
    const pick = await vscode.window.showErrorMessage(
      "Не задан путь к exe MCU-NR.",
      "Настроить сейчас"
    );
    if (pick) await configureSolverPaths();
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
        vscode.window.showWarningMessage(`INPUT завершён с ошибками. Найдено диагностик: ${result.diagnosticCount}`);
      }
    }
  );
}

async function configureSolverPaths(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  const currentExe = cfg.get<string>("mcuNrPath") ?? "";
  const currentLib = cfg.get<string>("mcuConstantsLibPath") ?? "";

  const scopeItems: vscode.QuickPickItem[] = [
    { label: "Workspace", description: "Сохранить в настройках текущего workspace" },
    { label: "User", description: "Сохранить в глобальных настройках пользователя" },
  ];
  const selectedScope = await vscode.window.showQuickPick(scopeItems, {
    placeHolder: `Пути: exe=${currentExe || "не задан"} · MDBNR=${currentLib || "не задан"}`,
    title: "MCU-NR: куда сохранить пути?",
    ignoreFocusOut: true,
  });
  if (!selectedScope) return;

  const target =
    selectedScope.label === "Workspace"
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;

  const exePick = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: true,
    canSelectFolders: false,
    openLabel: "Выбрать exe MCU-NR",
    title: currentExe ? `Выбрать exe MCU-NR (сейчас: ${currentExe})` : "Выбрать exe MCU-NR",
    filters: {
      Executables: ["exe"],
      All: ["*"],
    },
  });
  if (!exePick?.length) return;

  const libPick = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFiles: false,
    canSelectFolders: true,
    openLabel: "Выбрать папку MDBNR",
    title: currentLib ? `Выбрать папку MDBNR (сейчас: ${currentLib})` : "Выбрать папку MDBNR",
  });
  if (!libPick?.length) return;

  await cfg.update("mcuNrPath", exePick[0].fsPath, target);
  await cfg.update("mcuConstantsLibPath", libPick[0].fsPath, target);

  vscode.window.showInformationMessage(
    `Пути MCU-NR сохранены: exe = ${exePick[0].fsPath}, MDBNR = ${libPick[0].fsPath} (ожидается AW.LIB)`
  );
  updateConfiguredPathsTooltips();
}

async function openRunKeybindings(): Promise<void> {
  // Фильтр по id команд (в Shortcuts заголовок «MCU-NR» часто не находится).
  await vscode.commands.executeCommand("workbench.action.openGlobalKeybindings", "mcuhelper.");
}

async function showRunActions(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) {
    vscode.window.showWarningMessage("Откройте файл MCU-NR");
    return;
  }

  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  const exe = (cfg.get<string>("mcuNrPath") ?? "").trim() || "не задан";
  const lib = (cfg.get<string>("mcuConstantsLibPath") ?? "").trim() || "не задан";
  const action = await vscode.window.showQuickPick(
    [
      { label: "Debug (INPUT)", description: "Проверка входа и переход к первой ошибке", command: "mcuhelper.debugInput" },
      { label: "Run (CALCULATION)", description: "Запустить расчёт", command: "mcuhelper.runCalculation" },
      { label: "Continue (CALCULATION)", description: "Продолжить расчёт", command: "mcuhelper.continueCalculation" },
      { label: "Final (OUTPUT)", description: "Получить финальную выдачу", command: "mcuhelper.finalOutput" },
      {
        label: "Настроить пути запуска",
        description: `exe: ${exe}`,
        detail: `MDBNR: ${lib}`,
        command: "mcuhelper.configureSolver",
      },
    ],
    {
      placeHolder: `Действия MCU-NR для ${pathBasename(editor.document)}`,
      ignoreFocusOut: true,
    }
  );
  if (!action) return;
  await vscode.commands.executeCommand(action.command);
}

function updateRunUiVisibility(): void {
  const editor = vscode.window.activeTextEditor;
  if (editor && isMcunrDocument(editor.document)) {
    runStatusItem?.show();
  } else {
    runStatusItem?.hide();
  }
  updateConfiguredPathsTooltips();
}

async function focusDiagnosticsPanel(): Promise<void> {
  await vscode.commands.executeCommand("mcuhelper.lexerErrors.focus");
  await sidebarProviders.get("mcuhelper.lexerErrors")?.applyLexerErrors();
}

async function runMcuStepCommand(mode: "i" | "c" | "f" | "b" | "continue"): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) {
    vscode.window.showWarningMessage("Откройте файл MCU-NR");
    return;
  }
  if (!client) {
    vscode.window.showWarningMessage("LSP ещё не готов");
    return;
  }

  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  const mcuNrPath = cfg.get<string>("mcuNrPath") ?? "";
  const constantsLibPath = cfg.get<string>("mcuConstantsLibPath") ?? "";
  // Имя варианта берём из текущего открытого файла (без расширения).
  const variantName = pathBasename(editor.document);

  if (!mcuNrPath) {
    const pick = await vscode.window.showErrorMessage(
      "Не задан путь к exe MCU-NR.",
      "Настроить сейчас"
    );
    if (pick) await configureSolverPaths();
    return;
  }
  if (!constantsLibPath) {
    const pick = await vscode.window.showErrorMessage(
      "Не задан путь к библиотеке констант MDBNR.",
      "Настроить сейчас"
    );
    if (pick) await configureSolverPaths();
    return;
  }

  // MCU читает файл с диска по относительному пути из mcu5.ini — сохраняем перед запуском.
  if (editor.document.isUntitled) {
    vscode.window.showErrorMessage("Сохраните файл варианта на диск перед запуском MCU-NR");
    return;
  }
  if (editor.document.isDirty) {
    const ok = await editor.document.save();
    if (!ok) {
      vscode.window.showErrorMessage("Не удалось сохранить файл перед запуском MCU-NR");
      return;
    }
  }

  const stepTitle =
    mode === "i"
      ? "MCU-NR INPUT"
      : mode === "c"
        ? "MCU-NR CALCULATION"
        : mode === "continue"
          ? "MCU-NR continue CALCULATION"
          : mode === "f"
            ? "MCU-NR OUTPUT"
            : "MCU-NR BURNUP";

  type RunStepResponse = {
    ok: boolean;
    message?: string;
    exitCode?: number | null;
    diagnosticCount?: number;
    runDir?: string;
    mcuNrPath?: string;
    sourceFsPath?: string;
    prepared?: boolean;
    finCopiedPath?: string;
    finOverwritten?: boolean;
    lstPath?: string;
    firstError?: {
      message: string;
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
    };
  };

  const prepared = await client.sendRequest<RunStepResponse>("mcuhelper/runMcuStep", {
    uri: editor.document.uri.toString(),
    variantName,
    mode,
    mcuNrPath,
    constantsLibPath,
    prepareOnly: true,
  });

  if (prepared.message || !prepared.ok || !prepared.runDir || !prepared.mcuNrPath) {
    vscode.window.showErrorMessage(prepared.message ?? "Не удалось подготовить запуск MCU-NR");
    return;
  }

  vscode.window.showInformationMessage(`${stepTitle}: запуск в терминале…`);

  const exitCode = await runMcuInTerminal({
    mcuNrPath: prepared.mcuNrPath,
    runDir: prepared.runDir,
    title: `${stepTitle} (${variantName})`,
  });

  const result = await client.sendRequest<RunStepResponse>("mcuhelper/runMcuStep", {
    uri: editor.document.uri.toString(),
    variantName,
    mode,
    collectOnly: true,
    runDir: prepared.runDir,
    sourceFsPath: prepared.sourceFsPath,
    exitCode: exitCode ?? null,
  });


  if (result.message) {
    vscode.window.showErrorMessage(result.message);
    return;
  }

  const cnt = result.diagnosticCount ?? 0;

  // Сначала подсветить ошибку в исходнике — затем открыть LST/FIN (не ждать sidebar).
  if (result.firstError?.range?.start) {
    const start = result.firstError.range.start;
    const pos = new vscode.Position(start.line, start.character);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  // LST: путь из LSP + локальный fallback по runDir (на случай старого сервера / рассинхрона путей).
  const lstPath = resolveExistingLstOnDisk({
    lstPath: result.lstPath,
    runDir: result.runDir ?? prepared.runDir,
    variantName,
  });

  // Артефакт до refresh Диагностики — await applyLexerErrors раньше блокировал open (hang на LSP).
  const openTarget = resolvePostRunOpenTarget({
    mode,
    finCopiedPath: result.finCopiedPath && fs.existsSync(result.finCopiedPath) ? result.finCopiedPath : undefined,
    finOverwritten: result.finOverwritten,
    lstPath,
  });
  if (openTarget) {
    try {
      helperOutput?.appendLine(`Post-run open ${openTarget.kind}: ${openTarget.path}`);
      const uri = vscode.Uri.file(openTarget.path);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      });
      if (openTarget.kind === "fin") {
        const label = openTarget.overwritten
          ? `FIN скопирован (перезаписан): ${path.basename(openTarget.path)}`
          : `FIN скопирован: ${path.basename(openTarget.path)}`;
        vscode.window.showInformationMessage(label);
      } else if (openTarget.reason === "debug") {
        vscode.window.showInformationMessage(`Открыт LST: ${path.basename(openTarget.path)}`);
      } else {
        vscode.window.showWarningMessage(
          `${stepTitle}: ${variantName}.FIN не найден — открыт LST из каталога запуска.`
        );
      }
    } catch (e) {
      const kind = openTarget.kind === "fin" ? "FIN" : "LST";
      const msg = `${kind} найден, но не удалось открыть: ${e instanceof Error ? e.message : String(e)}`;
      helperOutput?.appendLine(msg);
      vscode.window.showWarningMessage(msg);
    }
  } else if (mode === "i") {
    const runDir = result.runDir ?? prepared.runDir ?? "?";
    const msg = `${stepTitle}: файл ${variantName}.LST не найден в каталоге запуска (${runDir}).`;
    helperOutput?.appendLine(msg);
    vscode.window.showWarningMessage(msg);
  } else if ((mode === "c" || mode === "f") && (exitCode ?? 0) === 0 && !result.firstError) {
    // Как isSuccessfulMcuCollect: exit 0 и нет error (warnings допускаются).
    vscode.window.showWarningMessage(
      `${stepTitle}: расчёт успешен, но файлы ${variantName}.FIN и ${variantName}.LST не найдены.`
    );
  }

  // Sidebar после open, без await — иначе applyLexerErrors/getDiagnostics может зависнуть и не дать открыть LST.
  void refreshSidebarsCoalesced(sidebarProviders, "all");
  void sidebarProviders.get("mcuhelper.lexerErrors")?.applyLexerErrors();

  // Диагностику фокусируем только если артефакт не открыли — иначе панель перебивает LST/FIN.
  if (
    !openTarget &&
    shouldFocusDiagnosticsAfterRun({
      diagnosticCount: cnt,
      hasFirstError: !!result.firstError,
    })
  ) {
    try {
      await focusDiagnosticsPanel();
    } catch (e) {
      helperOutput?.appendLine(
        `focusDiagnosticsPanel failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  if (exitCode === undefined) {
    vscode.window.showWarningMessage(
      `${stepTitle}: MCU завершился в терминале (код неизвестен). Диагностик из LST: ${cnt}`
    );
  } else if (result.ok === false || !!result.firstError) {
    const errHint = result.firstError?.message
      ? ` Первая: ${result.firstError.message}`
      : "";
    vscode.window.showWarningMessage(
      `${stepTitle}: ошибки в LST (${cnt}), код MCU ${exitCode}.${errHint}`
    );
  } else if ((exitCode ?? 0) === 0 && cnt === 0) {
    vscode.window.showInformationMessage(`${stepTitle} завершён успешно (код 0).`);
  } else if (cnt > 0) {
    vscode.window.showWarningMessage(
      `${stepTitle} завершён (код ${exitCode}). Предупреждений из LST: ${cnt}`
    );
  } else {
    vscode.window.showWarningMessage(
      `${stepTitle} завершён с кодом ${exitCode}, но явных ошибок в LST не найдено.`
    );
  }
}

/** Ищет NAME.LST на диске: ответ LSP, затем runDir (без учёта регистра). */
function resolveExistingLstOnDisk(opts: {
  lstPath?: string;
  runDir?: string;
  variantName: string;
}): string | undefined {
  for (const p of lstPathCandidates(opts)) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  const runDir = opts.runDir;
  if (!runDir || !opts.variantName) return undefined;
  try {
    const want = `${opts.variantName}.lst`.toLowerCase();
    for (const entry of fs.readdirSync(runDir)) {
      if (entry.toLowerCase() === want) return path.join(runDir, entry);
    }
  } catch {
    // ignore
  }
  return undefined;
}

function pathBasename(doc: vscode.TextDocument): string {
  const name = doc.fileName.split(/[/\\]/).pop() ?? "NAME";
  return name.replace(/\.[^.]+$/, "").slice(0, 8) || "NAME";
}

async function exportDiagnostics(output: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) {
    vscode.window.showWarningMessage("Откройте файл MCU-NR");
    return;
  }

  if (!client) {
    vscode.window.showWarningMessage("LSP ещё не готов");
    return;
  }

  const uri = editor.document.uri;
  let mcu: vscode.Diagnostic[];
  try {
    mcu = await fetchMcuDiagnostics(client, uri, "all", editor.document.lineCount);
  } catch {
    vscode.window.showWarningMessage("Не удалось получить диагностику из LSP");
    return;
  }

  const lines: string[] = [
    `# MCU-NR diagnostics: ${uri.fsPath}`,
    `# Всего: ${mcu.length}`,
    "",
  ];

  if (mcu.length === 0) {
    lines.push("(диагностик нет — файл чист или LSP ещё не завершил анализ)");
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
    `Диагностика скопирована в буфер (${mcu.length}). См. Output → MCU-NR Helper`
  );
}

export function deactivate(): Promise<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}

/** Дедуп строк в Output (push + pull могут прийти оба). */
const printedOutputChunks = new Set<string>();

function appendOutputOnce(output: vscode.OutputChannel, chunk: string): void {
  const key = chunk.length > 240 ? chunk.slice(0, 120) + "…" + chunk.slice(-120) + String(chunk.length) : chunk;
  if (printedOutputChunks.has(key)) return;
  printedOutputChunks.add(key);
  output.appendLine(chunk);
}

function printLibraryReportsToOutput(
  output: vscode.OutputChannel,
  r: {
    awStatus?: string;
    thrStatus?: string;
    awReport?: string;
    thrReport?: string;
  }
): void {
  output.appendLine("——— Сверка библиотек MDBNR (AW.LIB / PARAMETE.THR) ———");
  if (r.awStatus) appendOutputOnce(output, `[AW.LIB] ${r.awStatus}`);
  if (r.awReport) appendOutputOnce(output, r.awReport);
  if (r.thrStatus) appendOutputOnce(output, `[PARAMETE.THR] ${r.thrStatus}`);
  if (r.thrReport) appendOutputOnce(output, r.thrReport);
  if (!r.awReport && !r.thrReport) {
    output.appendLine(
      "(нет отчётов сверки — проверьте mcuhelper.mcuConstantsLibPath и наличие AW.LIB / BURN6/PARAMETE.THR)"
    );
  }
}

/** Подписка на уведомления сверки — до client.start(); полный T1/2 также тянем pull-ом после ready. */
function registerLspOutputNotifications(
  lsp: LanguageClient,
  output: vscode.OutputChannel
): void {
  lsp.onNotification(
    "mcuhelper/awLibStatus",
    (msg: { ok: boolean; message: string; entryCount?: number; path?: string }) => {
      appendOutputOnce(output, `[AW.LIB] ${msg.message}`);
    }
  );
  lsp.onNotification(
    "mcuhelper/awLibVerification",
    (msg: {
      ok: boolean;
      message: string;
      mismatchCount: number;
      compared: number;
      maxAbsDelta?: number;
      report: string;
    }) => {
      appendOutputOnce(output, `[AW.LIB verify] ${msg.message}`);
      if (msg.report) appendOutputOnce(output, msg.report);
      const maxAbs = msg.maxAbsDelta ?? 0;
      if (!msg.ok && msg.mismatchCount > 0 && maxAbs >= 0.01) {
        void vscode.window
          .showWarningMessage(
            `AW.LIB: ${msg.mismatchCount} расхождений атомных масс с IAEA (макс |Δ|=${maxAbs.toExponential(2)}). Подробности — Output «MCU-NR Helper».`,
            "Открыть Output"
          )
          .then((pick) => {
            if (pick === "Открыть Output") output.show(true);
          });
      }
    }
  );
  lsp.onNotification("mcuhelper/parameteThrStatus", (msg: { ok: boolean; message: string }) => {
    appendOutputOnce(output, `[PARAMETE.THR] ${msg.message}`);
  });
  lsp.onNotification(
    "mcuhelper/parameteThrVerification",
    (msg: {
      ok: boolean;
      message: string;
      mismatchCount: number;
      compared: number;
      maxRelDelta?: number;
      report: string;
    }) => {
      appendOutputOnce(output, `[PARAMETE.THR verify] ${msg.message}`);
      if (msg.report) appendOutputOnce(output, msg.report);
      const maxRel = msg.maxRelDelta ?? 0;
      if (!msg.ok && msg.mismatchCount > 0 && maxRel >= 0.2) {
        void vscode.window
          .showWarningMessage(
            `PARAMETE.THR: ${msg.mismatchCount} расхождений T1/2 с IAEA (макс Δrel=${(maxRel * 100).toFixed(0)}%). Подробности — Output «MCU-NR Helper».`,
            "Открыть Output"
          )
          .then((pick) => {
            if (pick === "Открыть Output") output.show(true);
          });
      }
    }
  );
}

async function pullLibraryReportsToOutput(output: vscode.OutputChannel): Promise<void> {
  if (!client) {
    output.appendLine("Сверка библиотек: LSP client ещё не создан");
    return;
  }
  output.appendLine("Сверка библиотек: запрос getLibraryVerificationReports…");
  try {
    const r = await Promise.race([
      client.sendRequest<{
        awStatus?: string;
        thrStatus?: string;
        awReport?: string;
        thrReport?: string;
        thrMismatchCount?: number;
        maxRelDelta?: number;
      }>("mcuhelper/getLibraryVerificationReports"),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), 20000);
      }),
    ]);
    if (r == null) {
      output.appendLine(
        "Сверка библиотек: таймаут 20с. Команда «MCU-NR: Отчёт сверки библиотек» — повторить."
      );
      return;
    }
    printLibraryReportsToOutput(output, r);
  } catch (e) {
    output.appendLine(
      `Сверка библиотек: не удалось получить отчёт (${e instanceof Error ? e.message : String(e)})`
    );
  }
}

function formatConfiguredPathsTooltip(): vscode.MarkdownString {
  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  const exe = (cfg.get<string>("mcuNrPath") ?? "").trim();
  const lib = (cfg.get<string>("mcuConstantsLibPath") ?? "").trim();
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = false;
  md.appendMarkdown("**Пути MCU-NR**\n\n");
  md.appendMarkdown(`- **exe:** \`${exe || "не задан"}\`\n`);
  md.appendMarkdown(`- **MDBNR:** \`${lib || "не задан"}\`\n`);
  md.appendMarkdown("\nНастройка: шестерёнка на панели Запуск или `Ctrl+Alt+P`");
  return md;
}

function updateConfiguredPathsTooltips(): void {
  if (runStatusItem) {
    const base = "Открыть панель запуска MCU-NR";
    const tip = formatConfiguredPathsTooltip();
    tip.appendMarkdown(`\n\n---\n\n${base}`);
    runStatusItem.tooltip = tip;
  }
  runPanel?.refresh();
}

async function warmupExtensionAfterLspReady(output?: vscode.OutputChannel): Promise<void> {
  if (!client) return;
  const out = output ?? helperOutput;
  // Полный отчёт T1/2 / AW в Output — pull, не push (уведомления часто теряются).
  if (out) {
    await pullLibraryReportsToOutput(out);
  }
  try {
    await client.sendRequest<number>("mcuhelper/revalidateAllOpen");
  } catch {
    // older server bundle without revalidate — ignore
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) return;
  const uri = editor.document.uri.toString();
  const pos = editor.selection.active;
  try {
    await client.sendRequest("mcuhelper/getIndex", { uri, line: pos.line, character: pos.character });
  } catch {
    // ignore warmup errors
  }
  sidebarProviders.get("mcuhelper.lexerErrors")?.applyLexerErrors();
}
