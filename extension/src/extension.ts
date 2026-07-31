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
import { maybeFixDocumentEncoding, detectEncodingCommand } from "./encodingDetect";
import { registerExpandNaturalIsotope, hoverMiddleware } from "./expandNaturalIsotope";
import { createSidebarProviders, refreshSidebarsCoalesced, setSidebarReadyHandler, setSumIsotopeDecorationHandler, type SidebarViewId, type SidebarViewProvider } from "./sidebarView";
import { registerTemplateInsert } from "./templateInsert";
import { buildCatalogPayload } from "./catalogBridge";
import { registerDiagnosticNavigation, fetchMcuDiagnostics } from "./diagnosticNavigation";
import { clearLanguageDetectState, scheduleLanguageDetectOnEdit } from "./languageDetectScheduler";
import { registerRunPanel, type RunPanelViewProvider } from "./runPanelView";
import { runMcuInTerminal } from "./mcuTerminalRun";
import { shouldFocusDiagnosticsAfterRun } from "./runPanelHelpers";
import {
  applySumIsotopeDecorations,
  clearSumIsotopeDecorations,
  createSumIsotopeDecorationType,
} from "./sumIsotopeDecorations";

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
let runStatusItem: vscode.StatusBarItem | undefined;
let runPanel: RunPanelViewProvider | undefined;
let sumIsotopeDecorationType: vscode.TextEditorDecorationType | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("MCU-NR Helper");
  context.subscriptions.push(output);
  sumIsotopeDecorationType = createSumIsotopeDecorationType();
  context.subscriptions.push(sumIsotopeDecorationType);

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
    const msg = `Не удалось запустить LSP MCU-NR: ${err}`;
    output.appendLine(msg);
    vscode.window.showErrorMessage(msg);
  });

  geometryPanel = new GeometryPanel(context, client);
  registerExpandNaturalIsotope(context, client);
  registerTemplateInsert(context);
  registerDiagnosticNavigation(context, () => client);
  sidebarProviders = createSidebarProviders(context, client);
  setSidebarReadyHandler(() => scheduleRefresh());
  setSumIsotopeDecorationHandler((editor, index) => {
    if (!sumIsotopeDecorationType) return;
    if (!index) {
      clearSumIsotopeDecorations(editor, sumIsotopeDecorationType);
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
  });
  runPanel = registerRunPanel(context);
  runStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 30);
  runStatusItem.name = "MCU-NR Run Actions";
  runStatusItem.command = "mcuhelper.run.focus";
  runStatusItem.text = "$(play-circle) MCU-NR";
  runStatusItem.tooltip = "Открыть панель запуска MCU-NR";
  context.subscriptions.push(runStatusItem);

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
    vscode.commands.registerCommand("mcuhelper.validateInput", () => validateInput()),
    vscode.commands.registerCommand("mcuhelper.debugInput", () => runMcuStepCommand("i")),
    vscode.commands.registerCommand("mcuhelper.runCalculation", () => runMcuStepCommand("c")),
    vscode.commands.registerCommand("mcuhelper.continueCalculation", () => runMcuStepCommand("continue")),
    vscode.commands.registerCommand("mcuhelper.finalOutput", () => runMcuStepCommand("f")),
    vscode.commands.registerCommand("mcuhelper.exportDiagnostics", () => exportDiagnostics(output)),
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
      if (langChanged) scheduleRefresh();
      else if (isMcunrDocument(doc)) scheduleRefresh();
    }),
    vscode.workspace.onDidSaveTextDocument(() => scheduleRefresh()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      geometryPanel.onDocumentChanged(e.document);
      scheduleLanguageDetectOnEdit(e.document, e.contentChanges, output);
      if (isMcunrDocument(e.document)) {
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
      if (!editor || !isMcunrDocument(editor.document)) return;
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
    placeHolder: "Куда сохранить пути MCU-NR?",
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
    `Пути MCU-NR сохранены: exe = ${exePick[0].fsPath}, MDBNR = ${libPick[0].fsPath}`
  );
  runPanel?.refresh();
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

  const action = await vscode.window.showQuickPick(
    [
      { label: "Debug (INPUT)", description: "Проверка входа и переход к первой ошибке", command: "mcuhelper.debugInput" },
      { label: "Run (CALCULATION)", description: "Запустить расчёт", command: "mcuhelper.runCalculation" },
      { label: "Continue (CALCULATION)", description: "Продолжить расчёт", command: "mcuhelper.continueCalculation" },
      { label: "Final (OUTPUT)", description: "Получить финальную выдачу", command: "mcuhelper.finalOutput" },
      { label: "Настроить пути запуска", description: "Выбрать exe MCU-NR и папку MDBNR", command: "mcuhelper.configureSolver" },
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
  runPanel?.refresh();
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
  void refreshSidebarsCoalesced(sidebarProviders, "all");
  await sidebarProviders.get("mcuhelper.lexerErrors")?.applyLexerErrors();

  if (
    shouldFocusDiagnosticsAfterRun({
      diagnosticCount: cnt,
      hasFirstError: !!result.firstError,
    })
  ) {
    await focusDiagnosticsPanel();
  }

  if (exitCode === undefined) {
    vscode.window.showWarningMessage(
      `${stepTitle}: MCU завершился в терминале (код неизвестен). Диагностик из LST: ${cnt}`
    );
  } else if ((exitCode ?? 0) === 0 && cnt === 0) {
    vscode.window.showInformationMessage(`${stepTitle} завершён успешно (код 0).`);
  } else if (cnt > 0) {
    vscode.window.showWarningMessage(
      `${stepTitle} завершён (код ${exitCode}). Ошибок/предупреждений из LST: ${cnt}`
    );
  } else {
    vscode.window.showWarningMessage(
      `${stepTitle} завершён с кодом ${exitCode}, но явных ошибок в LST не найдено.`
    );
  }

  // Переход к первой ошибке из LST (любой режим).
  if (result.firstError?.range?.start) {
    const start = result.firstError.range.start;
    const pos = new vscode.Position(start.line, start.character);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  // Успешный Run/Final: открыть скопированный NAME.FIN рядом с вариантом.
  if (result.finCopiedPath) {
    try {
      const finUri = vscode.Uri.file(result.finCopiedPath);
      const finDoc = await vscode.workspace.openTextDocument(finUri);
      await vscode.window.showTextDocument(finDoc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
      const label = result.finOverwritten
        ? `FIN скопирован (перезаписан): ${path.basename(result.finCopiedPath)}`
        : `FIN скопирован: ${path.basename(result.finCopiedPath)}`;
      vscode.window.showInformationMessage(label);
    } catch (e) {
      vscode.window.showWarningMessage(
        `FIN скопирован, но не удалось открыть: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  } else if ((mode === "c" || mode === "f") && (exitCode ?? 0) === 0 && !result.firstError) {
    // Как isSuccessfulMcuCollect: exit 0 и нет error (warnings допускаются).
    vscode.window.showWarningMessage(
      `${stepTitle}: расчёт успешен, но файл ${variantName}.FIN в каталоге запуска не найден.`
    );
  }
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

async function warmupExtensionAfterLspReady(): Promise<void> {
  if (!client) return;
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
