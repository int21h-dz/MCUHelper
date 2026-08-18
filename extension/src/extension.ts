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
import { createSidebarProviders, refreshDiagnosticsSidebar, refreshSidebarsCoalesced, invalidateSidebarsOnEditorSwitch, abortSidebarRefreshQueue, applyOptimisticDiagnosticsOnEdit, getAppliedSidebarUri, mergeOptimisticFromLsp, commitOptimisticFromLsp, initOverlaySquiggles, setSidebarReadyHandler, paintCachedSidebarIndex, setSumIsotopeDecorationHandler, visibleLineSpan, clearOptimisticForDocument, type SidebarViewId, type SidebarViewProvider } from "./sidebarView";
import { registerTemplateInsert } from "./templateInsert";
import { buildCatalogPayload } from "./catalogBridge";
import { registerDiagnosticNavigation, fetchMcuDiagnostics } from "./diagnosticNavigation";
import { registerIncludePreview, setIncludeDocumentOpenedHandler } from "./includePreview";
import { registerMatrCodeLens, updateMatrCodeLensIndex, sameDocumentUri } from "./matrCodeLens";
import { clearLanguageDetectState, scheduleLanguageDetectOnEdit } from "./languageDetectScheduler";
import { registerRunPanel, type RunPanelViewProvider } from "./runPanelView";
import { runMcuInTerminal } from "./mcuTerminalRun";
import { runMcuStepFlow } from "./mcuStepRunner";
import { batchValidateInput } from "./batchValidateCommand";
import { resolvePostRunOpenTarget, shouldFocusDiagnosticsAfterRun } from "./runPanelHelpers";
import { runRegistrationBuilder } from "./registrationBuilderCommand";
import { runBodyGenerator } from "./bodyGeneratorCommand";
import { runWaterSteam } from "./waterSteamCommand";
import { runMaterialsBuilder } from "./materialsBuilderCommand";
import { registerWaterSteamFocusTracker } from "./waterSteamPanel";
import { checkForExtensionUpdates } from "./updateCheck";
import { checkMaterialsCompendiumUpdate } from "./materialsCompendiumStore";
import { showIncludeGraph } from "./includeGraphCommand";
import { compareResults } from "./compareResultsCommand";
import { registerMcuCodeActions } from "./codeActions";
import {
  applySumIsotopeDecorations,
  clearSumIsotopeDecorations,
  createMissingAwLibSumIsotopeDecorationType,
  createSumIsotopeDecorationType,
} from "./sumIsotopeDecorations";
import {
  applyStableIsotopeDecorations,
  clearStableIsotopeDecorations,
  createStableIsotopeDecorationType,
} from "./stableIsotopeDecorations";
import { largeDocumentEditPlan, LARGE_DOC_LINE_THRESHOLD, TREE_PRIME_IDLE_MS, shouldScheduleTreePrime } from "./sidebarFreshness";
import {
  SIDEBAR_ACK_TIMEOUT_MS,
  shouldAcceptActiveDocumentAck,
  shouldFallbackRefreshAfterAckTimeout,
  shouldHandshakeBeforeSidebarRefresh,
  shouldNotifyActiveDocument,
  type SidebarRefreshTrigger,
} from "./sidebarAck";

const REFRESH_DEBOUNCE_MS = 500;
const SELECTION_REFRESH_DEBOUNCE_MS = 300;
/** Не обновлять константы по selection сразу после правки (курсор двигается при вводе). */
const SELECTION_AFTER_EDIT_QUIET_MS = 600;

let lastDocChangeAt = 0;
let treePrimeTimer: ReturnType<typeof setTimeout> | undefined;
/** Output «MCU-NR Helper» — отчёты сверки AW/THR. */
let helperOutput: vscode.OutputChannel | undefined;

/** Последний epoch с сервера: kind+version, чтобы не коммитить stale validate в overlay. */
const lastDiagEpoch = new Map<string, { version: number | null; kind: string }>();


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
let sidebarProviders: Map<SidebarViewId, SidebarViewProvider> | undefined;
let geometryPanel: GeometryPanel;
let defaultPhyPanel: DefaultPhyPanel;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let selectionRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let pendingSidebarAckUri: string | undefined;
let sidebarAckTimer: ReturnType<typeof setTimeout> | undefined;
let runStatusItem: vscode.StatusBarItem | undefined;
let runPanel: RunPanelViewProvider | undefined;
let sumIsotopeDecorationType: vscode.TextEditorDecorationType | undefined;
let missingAwLibSumIsotopeDecorationType: vscode.TextEditorDecorationType | undefined;
let stableIsotopeDecorationType: vscode.TextEditorDecorationType | undefined;
let isotopeMarksTimer: ReturnType<typeof setTimeout> | undefined;

type IsoMark = {
  name: string;
  uri?: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  reasons?: string[];
  inAwLib?: boolean;
};

function paintIsotopeMarks(editor: vscode.TextEditor, sumMarks: IsoMark[], stableMarks: IsoMark[]): void {
  if (!sumIsotopeDecorationType || !missingAwLibSumIsotopeDecorationType || !stableIsotopeDecorationType) return;
  const docUri = editor.document.uri.toString();
  const markInEditor = (uri?: string) => !uri || sameDocumentUri(uri, docUri);
  const nuclides = sumMarks.filter((n) => markInEditor(n.uri)).map((n) => ({
    name: n.name,
    range: n.range,
    reasons: n.reasons,
    inAwLib: n.inAwLib,
  }));
  const missingAwNuclides = nuclides.filter((n) => n.inAwLib === false);
  const regularSumNuclides = nuclides.filter((n) => n.inAwLib !== false);
  applySumIsotopeDecorations(editor, sumIsotopeDecorationType, regularSumNuclides);
  applySumIsotopeDecorations(editor, missingAwLibSumIsotopeDecorationType, missingAwNuclides);
  const sumKeys = new Set(nuclides.map((n) => `${n.range.start.line}:${n.name.toUpperCase()}`));
  const stableNuclides = stableMarks
    .filter((n) => markInEditor(n.uri) && !sumKeys.has(`${n.range.start.line}:${n.name.toUpperCase()}`))
    .map((n) => ({ name: n.name, range: n.range }));
  applyStableIsotopeDecorations(editor, stableIsotopeDecorationType, stableNuclides);
}

async function refreshViewportIsotopeMarks(editor: vscode.TextEditor): Promise<void> {
  if (!client || !isMcunrDocument(editor.document)) return;
  const vis = visibleLineSpan(editor);
  try {
    const marks = await client.sendRequest<{
      sumIsotopeMarks: IsoMark[];
      stableIsotopeMarks: IsoMark[];
    } | null>("mcuhelper/getIsotopeMarks", {
      uri: editor.document.uri.toString(),
      visibleStart: vis.start,
      visibleEnd: vis.end,
    });
    if (!marks) return;
    paintIsotopeMarks(editor, marks.sumIsotopeMarks ?? [], marks.stableIsotopeMarks ?? []);
  } catch {
    /* LSP ещё не готов */
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("MCU-NR Helper");
  helperOutput = output;
  context.subscriptions.push(output);
  void checkForExtensionUpdates(context, output);
  void checkMaterialsCompendiumUpdate(context, output);
  initOverlaySquiggles(context);
  sumIsotopeDecorationType = createSumIsotopeDecorationType();
  context.subscriptions.push(sumIsotopeDecorationType);
  missingAwLibSumIsotopeDecorationType = createMissingAwLibSumIsotopeDecorationType();
  context.subscriptions.push(missingAwLibSumIsotopeDecorationType);
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
      handleDiagnostics(uri, diagnostics, next) {
        const key = uri.toString();
        const live = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key)?.version;
        const data = (diagnostics[0] as { data?: { v?: number; k?: string } } | undefined)?.data;
        const epoch = lastDiagEpoch.get(key);
        const stamped = data?.v ?? epoch?.version;
        const kind = data?.k ?? epoch?.kind;
        const freshValidate = kind === "validate" && typeof stamped === "number" && live === stamped;
        const shown = freshValidate
          ? commitOptimisticFromLsp(key, diagnostics)
          : mergeOptimisticFromLsp(key, diagnostics);
        next(uri, []);
        sidebarProviders?.get("mcuhelper.lexerErrors")?.applyLexerErrors({
          immediate: true,
          diagnostics: shown,
        });
      },
    },
  };

  client = new LanguageClient("mcuhelper", "MCU-NR Language Server", serverOptions, clientOptions);
  client.onDidChangeState((e) => {
    output.appendLine(`LSP state: ${e.oldState} → ${e.newState} (Running=${State.Running})`);
    if (e.newState === State.Running) {
      notifyActiveDocument("lsp-ready");
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
  registerMatrCodeLens(context);
  registerWaterSteamFocusTracker(context);
  sidebarProviders = createSidebarProviders(context, client);
  setIncludeDocumentOpenedHandler(() => {
    if (sidebarProviders) refreshDiagnosticsSidebar(sidebarProviders);
  });
  setSidebarReadyHandler(() => {
    if (sidebarProviders && paintCachedSidebarIndex(sidebarProviders)) return;
    scheduleInitialSidebarRefresh();
  });
  scheduleInitialSidebarRefresh();
  setSumIsotopeDecorationHandler((editor, index) => {
    updateMatrCodeLensIndex(editor.document.uri.toString(), index);
    if (!index) {
      paintIsotopeMarks(editor, [], []);
      return;
    }
    let sum = index.sumIsotopeMarks ?? [];
    if (sum.length === 0) {
      const docUri = editor.document.uri.toString();
      const markInEditor = (uri?: string) => !uri || sameDocumentUri(uri, docUri);
      sum = index.summaries.materials.filter((m) => markInEditor(m.uri)).flatMap((m) =>
        m.nuclides
          .filter((n) => n.sumIsotope)
          .map((n) => ({
            name: n.name,
            range: n.range,
            reasons: n.sumIsotope!.reasons,
          }))
      );
    }
    paintIsotopeMarks(editor, sum, index.stableIsotopeMarks ?? []);
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
    vscode.commands.registerCommand("mcuhelper.showGeometry3d", () => geometryPanel.show3d()),
    vscode.commands.registerCommand("mcuhelper.editDefaultPhy", () => defaultPhyPanel.show()),
    vscode.commands.registerCommand("mcuhelper.validateInput", () => validateInput()),
    vscode.commands.registerCommand("mcuhelper.batchValidateInput", () => runBatchValidateInputCommand()),
    vscode.commands.registerCommand("mcuhelper.debugInput", () => runMcuStepCommand("i")),
    vscode.commands.registerCommand("mcuhelper.runCalculation", () => runMcuStepCommand("c")),
    vscode.commands.registerCommand("mcuhelper.continueCalculation", () => runMcuStepCommand("continue")),
    vscode.commands.registerCommand("mcuhelper.finalOutput", () => runMcuStepCommand("f")),
    vscode.commands.registerCommand("mcuhelper.burnup", () => runMcuStepCommand("b")),
    vscode.commands.registerCommand("mcuhelper.registrationBuilder", () => runRegistrationBuilder(context, client)),
    vscode.commands.registerCommand("mcuhelper.bodyGenerator", () => runBodyGenerator(context, client)),
    vscode.commands.registerCommand("mcuhelper.waterSteam", () => runWaterSteam(context, client)),
    vscode.commands.registerCommand("mcuhelper.materialsBuilder", () => runMaterialsBuilder(context, client)),
    vscode.commands.registerCommand("mcuhelper.showIncludeGraph", () => showIncludeGraph(client)),
    vscode.commands.registerCommand("mcuhelper.compareResults", () => compareResults()),
    registerMcuCodeActions(),
    vscode.commands.registerCommand("mcuhelper.exportDiagnostics", () => exportDiagnostics(output)),
    vscode.commands.registerCommand("mcuhelper.showLibraryVerificationReport", async () => {
      output.show(true);
      output.appendLine("Ручной запрос отчёта сверки AW.LIB / PARAMETE.THR…");
      printedOutputChunks.clear();
      await pullLibraryReportsToOutput(output);
    }),
    vscode.commands.registerCommand("mcuhelper.detectLanguage", () => detectLanguage(output)),
    vscode.commands.registerCommand("mcuhelper.detectEncoding", () => detectEncodingCommand(output)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateRunUiVisibility();
      if (!sidebarProviders) return;
      if (!editor || editor.document.languageId !== "mcunr") {
        clearSidebarAckWait();
        return;
      }
      invalidateSidebarsOnEditorSwitch(sidebarProviders);
      requestSidebarRefresh("editor-switch");
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      if (Date.now() - lastDocChangeAt < SELECTION_AFTER_EDIT_QUIET_MS) return;
      if (refreshTimer) return;
      const editor = vscode.window.activeTextEditor;
      // Full-core: getIndex constants на каждый курсор блокирует LSP (validate+parse) и откладывает patch diags.
      if (editor && editor.document.lineCount > LARGE_DOC_LINE_THRESHOLD) return;
      scheduleRefresh("constants");
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.languageId !== "mcunr") return;
      if (isotopeMarksTimer) clearTimeout(isotopeMarksTimer);
      isotopeMarksTimer = setTimeout(() => {
        isotopeMarksTimer = undefined;
        void refreshViewportIsotopeMarks(e.textEditor);
      }, 120);
    })
  );

  updateRunUiVisibility();
  void scanAllDocuments(output);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      await maybeFixDocumentEncoding(doc, output);
      const langChanged = await maybeSetMcunrLanguage(doc, output);
      // Только явный mcunr: isMcunrDocument(content) при language=ini раздувает refresh при автодетекте.
      if (langChanged || doc.languageId === "mcunr") {
        if (doc.lineCount > LARGE_DOC_LINE_THRESHOLD) {
          if (sidebarProviders) refreshDiagnosticsSidebar(sidebarProviders);
        } else {
          scheduleRefresh();
        }
      }
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
        const plan = largeDocumentEditPlan(e.document.lineCount);
        if (plan.abortTreeRefresh) {
          abortSidebarRefreshQueue();
          if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = undefined;
          }
          if (selectionRefreshTimer) {
            clearTimeout(selectionRefreshTimer);
            selectionRefreshTimer = undefined;
          }
          if (plan.retryTreePrimeAfterIdle) {
            scheduleIdleTreePrime(e.document.uri.toString(), e.document.lineCount);
          }
        }
        if (plan.refreshDiagnosticsNow && sidebarProviders) {
          applyOptimisticDiagnosticsOnEdit(
            sidebarProviders,
            e.document.uri.toString(),
            e.contentChanges,
            vscode.languages.getDiagnostics(e.document.uri),
            e.document
          );
        }
        if (plan.skipFullIndexRefresh) return;
        scheduleRefresh();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearLanguageDetectState(doc);
      clearOptimisticForDocument(doc.uri.toString());
    }),
    vscode.languages.onDidChangeDiagnostics(() => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "mcunr") return;
      if (!sidebarProviders) return;
      refreshDiagnosticsSidebar(sidebarProviders);
      const uri = editor.document.uri.toString();
      if (shouldScheduleTreePrime(getAppliedSidebarUri(), uri, editor.document.lineCount)) {
        scheduleRefresh("all");
        return;
      }
      if (editor.document.lineCount > LARGE_DOC_LINE_THRESHOLD) return;
      scheduleRefresh("all");
    })
  );
}

function scheduleInitialSidebarRefresh(): void {
  const editor = vscode.window.activeTextEditor;
  if (
    editor?.document.languageId === "mcunr" &&
    editor.document.lineCount > LARGE_DOC_LINE_THRESHOLD
  ) {
    // Дерево после первого validate — не параллельный getIndex (блокирует LSP 10–20 с).
    if (sidebarProviders) refreshDiagnosticsSidebar(sidebarProviders);
    return;
  }
  scheduleRefresh("all");
}

function clearSidebarAckWait(): void {
  pendingSidebarAckUri = undefined;
  if (sidebarAckTimer) {
    clearTimeout(sidebarAckTimer);
    sidebarAckTimer = undefined;
  }
}

function notifyActiveDocument(trigger: SidebarRefreshTrigger): void {
  if (!shouldNotifyActiveDocument(trigger) || !client) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "mcunr") return;
  void client.sendNotification("mcuhelper/activeDocument", {
    uri: editor.document.uri.toString(),
  });
}

function completeSidebarRefreshAfterAck(): void {
  if (!sidebarProviders) return;
  clearSidebarAckWait();
  void refreshSidebarsCoalesced(sidebarProviders, "all");
}

function requestSidebarRefresh(trigger: SidebarRefreshTrigger): void {
  if (!sidebarProviders) return;
  const editor = vscode.window.activeTextEditor;
  if (!client || !editor || editor.document.languageId !== "mcunr") {
    clearSidebarAckWait();
    void refreshSidebarsCoalesced(sidebarProviders, "all");
    return;
  }
  if (!shouldHandshakeBeforeSidebarRefresh(trigger)) {
    void refreshSidebarsCoalesced(sidebarProviders, "all");
    return;
  }
  const uri = editor.document.uri.toString();
  pendingSidebarAckUri = uri;
  if (sidebarAckTimer) clearTimeout(sidebarAckTimer);
  notifyActiveDocument(trigger);
  sidebarAckTimer = setTimeout(() => {
    sidebarAckTimer = undefined;
    const liveUri = vscode.window.activeTextEditor?.document.uri.toString();
    if (!shouldFallbackRefreshAfterAckTimeout({ pendingUri: pendingSidebarAckUri, liveUri })) {
      return;
    }
    completeSidebarRefreshAfterAck();
  }, SIDEBAR_ACK_TIMEOUT_MS);
}

function scheduleIdleTreePrime(uri: string, lineCount: number): void {
  if (!shouldScheduleTreePrime(getAppliedSidebarUri(), uri, lineCount)) return;
  if (treePrimeTimer) clearTimeout(treePrimeTimer);
  treePrimeTimer = setTimeout(() => {
    treePrimeTimer = undefined;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== uri) return;
    if (!shouldScheduleTreePrime(getAppliedSidebarUri(), uri, editor.document.lineCount)) return;
    scheduleRefresh("all");
  }, TREE_PRIME_IDLE_MS);
}

function scheduleRefresh(scope: "all" | "constants" = "all"): void {
  // providers ещё не созданы (ранний librariesSynced / State.Running) — пропуск.
  if (!sidebarProviders) return;

  if (scope === "constants") {
    if (refreshTimer) return;
    if (Date.now() - lastDocChangeAt < SELECTION_AFTER_EDIT_QUIET_MS) return;
    if (selectionRefreshTimer) clearTimeout(selectionRefreshTimer);
    selectionRefreshTimer = setTimeout(() => {
      selectionRefreshTimer = undefined;
      if (!sidebarProviders) return;
      void refreshSidebarsCoalesced(sidebarProviders, "constants");
    }, SELECTION_REFRESH_DEBOUNCE_MS);
    return;
  }

  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    if (!sidebarProviders) return;
    requestSidebarRefresh("schedule-refresh");
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
      {
        label: "Проверить варианты (INPUT)",
        description: "Batch INPUT для нескольких .mcu/.mcunr",
        command: "mcuhelper.batchValidateInput",
      },
      { label: "Run (CALCULATION)", description: "Запустить расчёт", command: "mcuhelper.runCalculation" },
      { label: "Continue (CALCULATION)", description: "Продолжить расчёт", command: "mcuhelper.continueCalculation" },
      { label: "Final (OUTPUT)", description: "Получить финальную выдачу", command: "mcuhelper.finalOutput" },
      { label: "Burnup (BURNUP)", description: "Шаг выгорания после OUTPUT", command: "mcuhelper.burnup" },
      { label: "Проверить варианты (INPUT)", description: "Пакетный INPUT", command: "mcuhelper.batchValidateInput" },
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
  await sidebarProviders?.get("mcuhelper.lexerErrors")?.applyLexerErrors();
}

async function ensureSolverPathsConfigured(): Promise<
  { mcuNrPath: string; constantsLibPath: string } | undefined
> {
  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  const mcuNrPath = cfg.get<string>("mcuNrPath") ?? "";
  const constantsLibPath = cfg.get<string>("mcuConstantsLibPath") ?? "";
  if (!mcuNrPath) {
    const pick = await vscode.window.showErrorMessage(
      "Не задан путь к exe MCU-NR.",
      "Настроить сейчас"
    );
    if (pick) await configureSolverPaths();
    return undefined;
  }
  if (!constantsLibPath) {
    const pick = await vscode.window.showErrorMessage(
      "Не задан путь к библиотеке констант MDBNR.",
      "Настроить сейчас"
    );
    if (pick) await configureSolverPaths();
    return undefined;
  }
  return { mcuNrPath, constantsLibPath };
}

async function runBatchValidateInputCommand(): Promise<void> {
  if (!client) {
    vscode.window.showWarningMessage("LSP ещё не готов");
    return;
  }
  const output = helperOutput ?? vscode.window.createOutputChannel("MCU-NR Helper");
  helperOutput = output;
  await batchValidateInput({
    client,
    output,
    ensureSolverPaths: ensureSolverPathsConfigured,
  });
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

  const paths = await ensureSolverPathsConfigured();
  if (!paths) return;

  // Имя варианта берём из текущего открытого файла (без расширения).
  const variantName = pathBasename(editor.document);

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

  vscode.window.showInformationMessage(`${stepTitle}: запуск в терминале…`);

  const flow = await runMcuStepFlow({
    sendRequest: (method, params) => client!.sendRequest(method, params),
    uri: editor.document.uri.toString(),
    variantName,
    mode,
    mcuNrPath: paths.mcuNrPath,
    constantsLibPath: paths.constantsLibPath,
    stepTitle,
    runInTerminal: runMcuInTerminal,
  });

  if (flow.message && !flow.collect) {
    vscode.window.showErrorMessage(flow.message);
    return;
  }
  if (flow.message) {
    vscode.window.showErrorMessage(flow.message);
    return;
  }

  const result = flow.collect!;
  const exitCode = flow.exitCode;
  const cnt = flow.diagnosticCount;

  // Сначала подсветить ошибку в исходнике — затем открыть LST/FIN (не ждать sidebar).
  if (flow.firstError?.range?.start) {
    const start = flow.firstError.range.start;
    const pos = new vscode.Position(start.line, start.character);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  const lstPath = flow.lstPath;

  // Артефакт до refresh Диагностики — await applyLexerErrors раньше блокировал open (hang на LSP).
  const openTarget = resolvePostRunOpenTarget({
    mode,
    finCopiedPath: flow.finCopiedPath && fs.existsSync(flow.finCopiedPath) ? flow.finCopiedPath : undefined,
    finOverwritten: flow.finOverwritten,
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
  } else if (mode === "i" || mode === "b") {
    const runDir = flow.runDir ?? "?";
    const msg = `${stepTitle}: файл ${variantName}.LST не найден в каталоге запуска (${runDir}).`;
    helperOutput?.appendLine(msg);
    vscode.window.showWarningMessage(msg);
  } else if ((mode === "c" || mode === "f") && (exitCode ?? 0) === 0 && !flow.firstError) {
    // Как isSuccessfulMcuCollect: exit 0 и нет error (warnings допускаются).
    vscode.window.showWarningMessage(
      `${stepTitle}: расчёт успешен, но файлы ${variantName}.FIN и ${variantName}.LST не найдены.`
    );
  }

  // Sidebar после open, без await — иначе applyLexerErrors/getDiagnostics может зависнуть и не дать открыть LST.
  if (sidebarProviders) {
    void refreshSidebarsCoalesced(sidebarProviders, "all");
    void sidebarProviders.get("mcuhelper.lexerErrors")?.applyLexerErrors();
  }

  // Диагностику фокусируем только если артефакт не открыли — иначе панель перебивает LST/FIN.
  if (
    !openTarget &&
    shouldFocusDiagnosticsAfterRun({
      diagnosticCount: cnt,
      hasFirstError: !!flow.firstError,
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
  } else if (result.ok === false || !!flow.firstError) {
    const errHint = flow.firstError?.message
      ? ` Первая: ${flow.firstError.message}`
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
    "mcuhelper/librariesSynced",
    (_msg: { rebuiltSummaries?: number; awOk?: boolean; thrOk?: boolean }) => {
      // После rebuild summaries на сервере — обновить CodeLens MATR / sidebar.
      scheduleRefresh("all");
    }
  );
  lsp.onNotification(
    "mcuhelper/diagEpoch",
    (msg: { uri: string; version: number | null; kind: string }) => {
      lastDiagEpoch.set(msg.uri, { version: msg.version, kind: msg.kind });
    }
  );
  lsp.onNotification("mcuhelper/activeDocumentAck", (msg: { uri?: string }) => {
    const liveUri = vscode.window.activeTextEditor?.document.uri.toString();
    if (
      !sidebarProviders ||
      !shouldAcceptActiveDocumentAck({
        ackUri: msg.uri,
        liveUri,
        pendingUri: pendingSidebarAckUri,
      })
    ) {
      return;
    }
    completeSidebarRefreshAfterAck();
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
  sidebarProviders?.get("mcuhelper.lexerErrors")?.applyLexerErrors();
}
