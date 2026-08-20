import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  CompletionParams,
  HoverParams,
  SignatureHelpParams,
  DocumentSymbolParams,
  FoldingRangeParams,
  DocumentLinkParams,
  TextDocumentSyncKind,
  type Diagnostic,
  type TextDocumentContentChangeEvent,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "url";
import { getDocumentIndex, clearDocument, rebuildCachedSummaries } from "@mcuhelper/mcu-language";
import { getCompletions, getDefinition, getHoverContent } from "./completion";
import { findReferences, prepareRename, renameSymbol } from "./symbolRefs";
import { getSignatureHelp } from "./signatureHelp";
import { getNaturalIsotopeLines, warmupNaturalAbundanceIndex } from "./iaeaNds";
import {
  formatAwVerificationReport,
  getLastAwLibVerification,
  loadAwLibFromConstantsPath,
  verifyAwLibAgainstIaea,
} from "./awLibVerify";
import { loadDefaultPhyFromConstantsPath } from "./defaultPhyVerify";
import {
  formatParameteThrVerificationReport,
  getLastParameteThrVerification,
  loadParameteThrFromConstantsPath,
  verifyParameteThrAgainstIaea,
} from "./parameteThrVerify";
import { getLiveChartGroundStates, scheduleLiveChartCacheRefresh } from "./iaeaLiveChartCache";
import { getAwLibTable, getParameteThrTable, listAwLibCatalog } from "@mcuhelper/mcu-language";
import { warmupLanguageServer } from "./warmup";
import { setCachedSolverResult } from "./solver";
import {
  toLspDiagnostic,
  collectDiagnostics,
  collectDiagnosticsBundle,
  buildDocumentSymbols,
  buildFoldingRanges,
  buildDocumentLinks,
  ensureDocumentIndex,
  ensureSourceDocumentIndex,
  resolveHoverDocumentIndex,
  handleGetIndex,
  handleGetIsotopeMarks,
  handleGetIncludeGraph,
  handleGetGeometry,
  handleGetLiveZonePreview,
  handleQueryPoint,
  handleGetSlice,
  handleValidateInput,
  handleRunMcuStep,
  handleGetDiagnostics,
  dbgLsp,
  syncSettingsFromInitialize,
  applyServerSettings,
  setIncludeTextOverridesProvider,
  buildIncludeTextOverridesFromDocs,
  type McuServerSettings,
} from "./serverHandlers";
import { DiagnosticPublishPipeline, LARGE_DOC_LINE_THRESHOLD, shouldSkipBackgroundValidate, shouldChainValidateAgain, shouldScheduleValidateOnDidChange, shouldRescheduleAfterStale, shouldValidateOnActiveDocumentChange, decideStaleValidate } from "./diagnosticPipeline";

const connection = createConnection(ProposedFeatures.all);
const pendingContentChanges = new Map<string, TextDocumentContentChangeEvent[]>();
const diagPipeline = new DiagnosticPublishPipeline<Diagnostic>();
const documents = new TextDocuments({
  create: (uri, languageId, version, content) => TextDocument.create(uri, languageId, version, content),
  update: (document, changes, version) => {
    pendingContentChanges.set(document.uri, changes.slice());
    return TextDocument.update(document, changes, version);
  },
});

setIncludeTextOverridesProvider(() => buildIncludeTextOverridesFromDocs(documents.all()));

let globalSettings: McuServerSettings = {
  mcuNrPath: "",
  mcuConstantsLibPath: "",
  enableSolverValidation: false,
  variantName: "NAME",
};

/** Последний путь MDBNR, для которого уже загружали AW.LIB. */
let awLibSyncedPath: string | null = null;
/**
 * Сверка AW + T1/2 (локальный LiveChart) — для Output/диагностик.
 */
let libraryCoreGate: Promise<void> = Promise.resolve();

export type LibraryVerificationReports = {
  awStatus?: string;
  thrStatus?: string;
  awReport?: string;
  thrReport?: string;
  awMismatchCount?: number;
  thrMismatchCount?: number;
  maxAbsDelta?: number;
  maxRelDelta?: number;
};

let lastLibraryReports: LibraryVerificationReports = {};

const solverDiagnostics = new Map<string, import("vscode-languageserver").Diagnostic[]>();
const publishedIncludeUrisByParent = new Map<string, Set<string>>();
const parentUrisByInclude = new Map<string, Set<string>>();

function getDoc(uri: string): TextDocument | undefined {
  return documents.get(uri);
}

function snapshotLibraryReportsFromCache(): LibraryVerificationReports {
  const aw = getLastAwLibVerification();
  const thr = getLastParameteThrVerification();
  const out: LibraryVerificationReports = { ...lastLibraryReports };
  if (aw) {
    out.awReport = formatAwVerificationReport(aw);
    out.awMismatchCount = aw.mismatches.length;
    out.maxAbsDelta = aw.mismatches.reduce((m, x) => Math.max(m, Math.abs(x.delta)), 0);
  }
  if (thr) {
    out.thrReport = formatParameteThrVerificationReport(thr);
    out.thrMismatchCount = thr.mismatches.length;
    out.maxRelDelta = thr.mismatches.reduce((m, x) => Math.max(m, x.relDelta), 0);
  }
  return out;
}

async function syncAwLibFromSettings(): Promise<void> {
  const libPath = globalSettings.mcuConstantsLibPath ?? "";
  if (libPath === awLibSyncedPath) {
    await libraryCoreGate;
    return;
  }
  awLibSyncedPath = libPath;

  const awResult = await loadAwLibFromConstantsPath(libPath);
  connection.console.info(`[AW.LIB] ${awResult.message}`);

  const phyResult = await loadDefaultPhyFromConstantsPath(libPath);
  connection.console.info(`[DEFAULT.PHY] ${phyResult.message}`);

  const thrResult = await loadParameteThrFromConstantsPath(libPath);
  connection.console.info(`[PARAMETE.THR] ${thrResult.message}`);

  // ρ / a_m в summaries зависят от AW/THR: пересчёт без reparse, иначе CodeLens/sidebar
  // держат activityBqPerG=null после первого analyze до загрузки библиотек.
  // Только открытые документы — full-core кэш вне documents не трогаем.
  const openUris = documents.all().map((d) => d.uri);
  const rebuilt = rebuildCachedSummaries(openUris.length > 0 ? openUris : undefined);
  if (rebuilt > 0) {
    connection.console.info(`[summaries] rebuilt ${rebuilt} cached index(es) after library sync`);
  }

  connection.sendNotification("mcuhelper/awLibStatus", awResult);
  connection.sendNotification("mcuhelper/defaultPhyStatus", phyResult);
  connection.sendNotification("mcuhelper/parameteThrStatus", thrResult);
  connection.sendNotification("mcuhelper/librariesSynced", {
    rebuiltSummaries: rebuilt,
    awOk: awResult.ok,
    thrOk: thrResult.ok,
  });

  lastLibraryReports = {
    awStatus: awResult.message,
    thrStatus: thrResult.message,
  };

  if (!awResult.ok && !thrResult.ok) {
    for (const doc of documents.all()) {
      void validateTextDocument(doc);
    }
    return;
  }

  // AW + T1/2 (офлайн кэш LiveChart).
  libraryCoreGate = (async () => {
    const gs = await getLiveChartGroundStates({ allowNetwork: false });
    connection.console.info(
      `[LiveChart] кэш: ${gs.entryCount} нуклидов (${gs.source}${gs.fetchedAt ? `, ${gs.fetchedAt}` : ""})`
    );
    scheduleLiveChartCacheRefresh();

    if (awResult.ok && getAwLibTable()) {
      const r = await verifyAwLibAgainstIaea(getAwLibTable()!, gs.map);
      connection.console.info(`[AW.LIB] ${r.message}`);
      const maxAbsDelta = r.mismatches.reduce((m, x) => Math.max(m, Math.abs(x.delta)), 0);
      const report = formatAwVerificationReport(r);
      lastLibraryReports.awReport = report;
      lastLibraryReports.awMismatchCount = r.mismatches.length;
      lastLibraryReports.maxAbsDelta = maxAbsDelta;
      connection.sendNotification("mcuhelper/awLibVerification", {
        ok: r.ok,
        message: r.message,
        compared: r.compared,
        mismatchCount: r.mismatches.length,
        missingCount: r.missingInIaea.length,
        maxAbsDelta,
        awLibPath: r.awLibPath,
        report,
      });
    }
    if (thrResult.ok && getParameteThrTable()) {
      const r = await verifyParameteThrAgainstIaea(getParameteThrTable()!, gs.map);
      connection.console.info(`[PARAMETE.THR] ${r.message}`);
      const maxRel = r.mismatches.reduce((m, x) => Math.max(m, x.relDelta), 0);
      const report = formatParameteThrVerificationReport(r);
      lastLibraryReports.thrReport = report;
      lastLibraryReports.thrMismatchCount = r.mismatches.length;
      lastLibraryReports.maxRelDelta = maxRel;
      connection.sendNotification("mcuhelper/parameteThrVerification", {
        ok: r.ok,
        message: r.message,
        compared: r.compared,
        mismatchCount: r.mismatches.length,
        missingCount: r.missingInIaea.length,
        maxRelDelta: maxRel,
        thrPath: r.thrPath,
        report,
      });
    }
    for (const doc of documents.all()) {
      void validateTextDocument(doc);
    }
  })();

  await libraryCoreGate;
}

/** Клиент забирает отчёты AW/T1/2 в Output. */
async function getLibraryVerificationReports(): Promise<LibraryVerificationReports> {
  await readWorkspaceSettings();
  await libraryCoreGate;
  const snap = snapshotLibraryReportsFromCache();
  lastLibraryReports = { ...lastLibraryReports, ...snap };
  return lastLibraryReports;
}

connection.onInitialize((params: InitializeParams) => {
  syncSettingsFromInitialize(globalSettings, params.initializationOptions as Record<string, unknown> | undefined);
  void warmupNaturalAbundanceIndex();
  setImmediate(() => warmupLanguageServer());
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { resolveProvider: false, triggerCharacters: [" ", "#", "/", "=", "."] },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      documentLinkProvider: { resolveProvider: false },
      signatureHelpProvider: {
        triggerCharacters: [" ", ","],
        retriggerCharacters: [" ", ","],
      },
      /** semantic tokens отключены: VS Code блокировал UI ~25 с при первом вводе при применении decorations. */
    },
  };
});

connection.onInitialized(() => {
  void readWorkspaceSettings();
});

connection.onDidChangeConfiguration(() => {
  void readWorkspaceSettings().then(() => {
    documents.all().forEach(validateTextDocument);
  });
});

async function readWorkspaceSettings(): Promise<void> {
  try {
    const cfg = await connection.workspace.getConfiguration({ section: "mcuhelper" });
    if (Array.isArray(cfg)) {
      applyServerSettings(globalSettings, Object.assign({}, ...cfg));
    } else if (cfg && typeof cfg === "object") {
      applyServerSettings(globalSettings, cfg as Record<string, unknown>);
    }
  } catch {
    // ignore
  }
  await syncAwLibFromSettings();
}

const DIAGNOSTIC_DEBOUNCE_MS = 250;
/** Full-core: дать нескольким правкам пройти через optimistic patch, пока LSP свободен. */
const DIAGNOSTIC_DEBOUNCE_LARGE_MS = 4500;
/** Активный URI из клиента — не гонять 8с validate 3l, когда уже открыт 958. */
let activeDocumentUri: string | undefined;

const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>();
const validateInFlight = new Map<string, Promise<void>>();
const validateAgain = new Set<string>();

function clearDiagnosticTimer(uri: string): void {
  const t = diagnosticTimers.get(uri);
  if (t) {
    clearTimeout(t);
    diagnosticTimers.delete(uri);
  }
}

function diagnosticDebounceMs(doc: TextDocument): number {
  return doc.lineCount > LARGE_DOC_LINE_THRESHOLD ? DIAGNOSTIC_DEBOUNCE_LARGE_MS : DIAGNOSTIC_DEBOUNCE_MS;
}

/** Один yield: 16 тиков в логах давали 15–25с и успевали запустить ещё parse 3l. */
async function yieldIncomingLspOnce(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

type DiagPublishKind = "patch" | "validate";

function publishDiagnostics(uri: string, diagnostics: Diagnostic[], kind: DiagPublishKind): void {
  const version = documents.get(uri)?.version;
  connection.sendNotification("mcuhelper/diagEpoch", { uri, version: version ?? null, kind });
  const stamped =
    version == null
      ? diagnostics
      : diagnostics.map((d) => ({
          ...d,
          data: {
            ...(d.data && typeof d.data === "object" ? (d.data as Record<string, unknown>) : {}),
            v: version,
            k: kind,
          },
        }));
  connection.sendDiagnostics({ uri, diagnostics: stamped, version });
}

/** Сразу убрать squiggle только с изменённых строк; остальные не трогаем. */
function publishPatchedDiagnostics(uri: string, changes: readonly TextDocumentContentChangeEvent[]): void {
  const prev = diagPipeline.getPublished(uri);
  const next = diagPipeline.onIncrementalEdit(uri, changes);
  if (!next) return;
  publishDiagnostics(uri, next, "patch");
}

/** Смержить bundle с накопленным патчем и отдать один массив — без вспышки 8→7. */
function mergePatchedAfterValidate(uri: string, bundleDiags: Diagnostic[]): Diagnostic[] {
  const next = diagPipeline.afterValidate(uri, bundleDiags);
  return next;
}

function scheduleValidateTextDocument(doc: TextDocument): void {
  const uri = doc.uri;
  clearDiagnosticTimer(uri);
  diagnosticTimers.set(
    uri,
    setTimeout(() => {
      diagnosticTimers.delete(uri);
      const current = documents.get(uri);
      if (!current) return;
      if (shouldSkipBackgroundValidate(uri, activeDocumentUri, current.lineCount)) {
        return;
      }
      void validateTextDocument(current);
    }, diagnosticDebounceMs(doc))
  );
}

async function validateTextDocument(doc: TextDocument): Promise<void> {
  const uri = doc.uri;
  const existing = validateInFlight.get(uri);
  if (existing) {
    const current = documents.get(uri) ?? doc;
    if (!shouldChainValidateAgain(current.lineCount)) {
      return existing;
    }
    validateAgain.add(uri);
    return existing;
  }
  const run = (async () => {
    try {
      do {
        validateAgain.delete(uri);
        const current = documents.get(uri) ?? doc;
        if (shouldSkipBackgroundValidate(uri, activeDocumentUri, current.lineCount)) break;
        await validateTextDocumentOnce(current);
        await new Promise<void>((resolve) => setImmediate(resolve));
      } while (validateAgain.has(uri) && documents.get(uri));
    } finally {
      validateInFlight.delete(uri);
    }
  })();
  validateInFlight.set(uri, run);
  return run;
}

async function validateTextDocumentOnce(doc: TextDocument): Promise<void> {
  const uri = doc.uri;
  if (doc.lineCount > LARGE_DOC_LINE_THRESHOLD) {
    await yieldIncomingLspOnce();
  }
  const current = documents.get(uri) ?? doc;
  if (shouldSkipBackgroundValidate(uri, activeDocumentUri, current.lineCount)) {
    return;
  }
  // Уступаем очередь hover/completion — иначе тяжёлые diagnostics блокируют LSP на минуты.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const analyzing = documents.get(uri) ?? current;
  const versionAtStart = analyzing.version;
  const extra = solverDiagnostics.get(uri) ?? [];
  const bundle = collectDiagnosticsBundle(analyzing, extra);
  await yieldIncomingLspOnce();
  const liveVersion = documents.get(uri)?.version;
  if (liveVersion != null && decideStaleValidate(versionAtStart, liveVersion) === "schedule-debounce") {
    const current = documents.get(uri);
    if (
      current &&
      shouldRescheduleAfterStale(current.lineCount) &&
      !diagnosticTimers.has(uri) &&
      !shouldSkipBackgroundValidate(uri, activeDocumentUri, current.lineCount)
    ) {
      scheduleValidateTextDocument(current);
    }
    return;
  }
  const toSend = mergePatchedAfterValidate(uri, bundle.diagnostics);
  publishDiagnostics(uri, toSend, "validate");

  // Всегда регистрируем parent↔include из AST (даже без diagnostics в include),
  // чтобы правка/save include инвалидировала parent.
  const index = ensureDocumentIndex(analyzing);
  for (const inc of index.ast.includes) {
    if (!inc.uri) continue;
    let parents = parentUrisByInclude.get(inc.uri);
    if (!parents) {
      parents = new Set<string>();
      parentUrisByInclude.set(inc.uri, parents);
    }
    parents.add(uri);
  }

  const prevIncludeUris = publishedIncludeUrisByParent.get(uri) ?? new Set<string>();
  // Публикуем diagnostics на URI include только если файл открыт в LSP.
  // Иначе Problems по «закрытому» include URI даёт постоянное мигание UI.
  const nextPublished = new Set<string>();

  for (const group of bundle.includeGroups) {
    let parents = parentUrisByInclude.get(group.uri);
    if (!parents) {
      parents = new Set<string>();
      parentUrisByInclude.set(group.uri, parents);
    }
    parents.add(uri);

    if (!documents.get(group.uri)) continue;
    connection.sendDiagnostics({ uri: group.uri, diagnostics: group.diagnostics });
    nextPublished.add(group.uri);
  }

  for (const includeUri of prevIncludeUris) {
    if (nextPublished.has(includeUri)) continue;
    connection.sendDiagnostics({ uri: includeUri, diagnostics: [] });
    // Не снимаем parent-link: include всё ещё в AST родителя.
  }

  if (nextPublished.size > 0) {
    publishedIncludeUrisByParent.set(uri, nextPublished);
  } else {
    publishedIncludeUrisByParent.delete(uri);
  }
}

function sameFsPathLoose(a: string, b: string): boolean {
  try {
    return fileURLToPath(a).toLowerCase().replace(/\\/g, "/") === fileURLToPath(b).toLowerCase().replace(/\\/g, "/");
  } catch {
    return a === b;
  }
}

function refreshParentDocuments(includeUri: string): void {
  let parents = parentUrisByInclude.get(includeUri);
  if (!parents?.size) {
    // URI include из AST (pathToFileURL) может отличаться от LSP document.uri.
    for (const [key, set] of parentUrisByInclude) {
      if (sameFsPathLoose(key, includeUri)) {
        parents = set;
        break;
      }
    }
  }
  if (!parents?.size) return;
  for (const parentUri of [...parents]) {
    clearDocument(parentUri);
    clearDiagnosticTimer(parentUri);
    const parentDoc = documents.get(parentUri);
    if (parentDoc) void validateTextDocument(parentDoc);
  }
}

documents.onDidChangeContent((change) => {
  const uri = change.document.uri;
  const changes = pendingContentChanges.get(uri) ?? [];
  pendingContentChanges.delete(uri);
  publishPatchedDiagnostics(uri, changes);
  if (shouldScheduleValidateOnDidChange(uri, activeDocumentUri, change.document.lineCount)) {
    scheduleValidateTextDocument(change.document);
  }
  refreshParentDocuments(uri);
});

documents.onDidOpen((event) => {
  clearDiagnosticTimer(event.document.uri);
  void validateTextDocument(event.document);
  // Если открыли include — переопубликовать parent, чтобы diags попали на открытый URI.
  refreshParentDocuments(event.document.uri);
});

documents.onDidClose((event) => {
  const uri = event.document.uri;
  clearDiagnosticTimer(uri);
  diagPipeline.clear(uri);
  pendingContentChanges.delete(uri);
  // Не clearDocument: повторный parse 16MB+ (3l070626) — минуты. Кэш по version/hash.
  const includeUris = publishedIncludeUrisByParent.get(uri);
  if (includeUris) {
    for (const includeUri of includeUris) {
      connection.sendDiagnostics({ uri: includeUri, diagnostics: [] });
      const parents = parentUrisByInclude.get(includeUri);
      if (parents) {
        parents.delete(uri);
        if (parents.size === 0) parentUrisByInclude.delete(includeUri);
      }
    }
    publishedIncludeUrisByParent.delete(uri);
  }
});

documents.onDidSave((event) => {
  clearDiagnosticTimer(event.document.uri);
  void validateTextDocument(event.document);
  refreshParentDocuments(event.document.uri);
});

connection.onCompletion((params: CompletionParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return { items: [] };
  const index = getDocumentIndex(params.textDocument.uri);
  if (!index || index.version !== doc.version) {
    const fresh = ensureDocumentIndex(doc);
    return getCompletions(doc, params.position, fresh);
  }
  return getCompletions(doc, params.position, index);
});

connection.onSignatureHelp((params: SignatureHelpParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  return getSignatureHelp(doc, params.position);
});

connection.onHover((params: HoverParams) => {
  // Не await settings/library: блокировка даёт «мигание» hover (сверка есть, нуклид — нет).
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const index = resolveHoverDocumentIndex(doc, parentUrisByInclude, getDoc, documents.all());
  const content = getHoverContent(
    doc,
    params.position,
    index,
    { enableIaeaNuclide: true },
    params.textDocument.uri
  );
  if (!content) return null;
  return { contents: { kind: "markdown", value: content } };
});

connection.onDefinition((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const index = ensureDocumentIndex(doc);
  const def = getDefinition(doc, params.position, index);
  if (!def) return null;
  return {
    uri: def.uri,
    range: { start: def.range.start, end: def.range.end },
  };
});

connection.onReferences((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const index = ensureDocumentIndex(doc);
  return findReferences(doc, params.position, index);
});

connection.onPrepareRename((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const index = ensureDocumentIndex(doc);
  return prepareRename(doc, params.position, index);
});

connection.onRenameRequest((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const index = ensureDocumentIndex(doc);
  return renameSymbol(doc, params.position, index, params.newName);
});

connection.onDocumentSymbol((params: DocumentSymbolParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  // Source-only: expanded ranges после #include ломают outline и провоцируют перерисовку редактора.
  const index = ensureSourceDocumentIndex(doc);
  return buildDocumentSymbols(index, params.textDocument.uri);
});

connection.onFoldingRanges((params: FoldingRangeParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  // Source-only: expanded endLine > lineCount заставляет VS Code постоянно пересчитывать folds → мерцание раскраски.
  const index = ensureSourceDocumentIndex(doc);
  return buildFoldingRanges(index, doc.lineCount);
});

connection.onDocumentLinks((params: DocumentLinkParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const index = ensureDocumentIndex(doc);
  return buildDocumentLinks(index, params.textDocument.uri);
});

connection.onRequest("mcuhelper/getIndex", async (args) => {
  const uri = typeof args === "string" ? args : args?.uri ?? "";
  // Пока validate/edit в очереди — не занимать поток тяжёлым getIndex.
  for (let i = 0; i < 8; i++) {
    const hot =
      (uri && validateInFlight.has(uri)) ||
      (uri && diagnosticTimers.has(uri)) ||
      (uri && pendingContentChanges.has(uri));
    if (!hot) break;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  const result = handleGetIndex(args, getDoc);
  return result;
});

connection.onRequest("mcuhelper/getIsotopeMarks", (args: { uri: string; visibleStart?: number; visibleEnd?: number }) => {
  const result = handleGetIsotopeMarks(args, getDoc);
  return result;
});

connection.onRequest("mcuhelper/getIncludeGraph", (args: string | { uri: string }) =>
  handleGetIncludeGraph(args, getDoc)
);

connection.onRequest("mcuhelper/getNaturalIsotopeLines", async (args: { element: string; concentration: string }) => {
  return getNaturalIsotopeLines(args.element, args.concentration);
});

connection.onRequest("mcuhelper/getAwLibCatalog", () => listAwLibCatalog());

connection.onRequest("mcuhelper/getGeometry", (args: string | { uri: string; line?: number; character?: number }) =>
  handleGetGeometry(args, getDoc)
);

connection.onRequest("mcuhelper/queryPoint", (args) => handleQueryPoint(args, getDoc));

connection.onRequest("mcuhelper/getSlice", (args) => handleGetSlice(args, getDoc));

connection.onRequest("mcuhelper/getLiveZonePreview", (args) => handleGetLiveZonePreview(args, getDoc));

connection.onNotification("mcuhelper/activeDocument", (args: { uri?: string }) => {
  const nextUri = args?.uri;
  const shouldValidate = shouldValidateOnActiveDocumentChange(activeDocumentUri, nextUri);
  activeDocumentUri = nextUri;
  connection.sendNotification("mcuhelper/activeDocumentAck", {
    uri: activeDocumentUri,
  });
  for (const uri of [...validateAgain]) {
    if (uri !== activeDocumentUri) validateAgain.delete(uri);
  }
  for (const [uri, t] of diagnosticTimers) {
    if (uri === activeDocumentUri) continue;
    clearTimeout(t);
    diagnosticTimers.delete(uri);
  }
  if (!shouldValidate) return;
  const focused = activeDocumentUri ? documents.get(activeDocumentUri) : undefined;
  if (focused) {
    void validateTextDocument(focused);
  }
});

connection.onRequest("mcuhelper/getDiagnostics", (args: { uri: string }) => {
  const extra = solverDiagnostics.get(args.uri) ?? [];
  return handleGetDiagnostics(args.uri, getDoc, extra);
});

connection.onRequest("mcuhelper/revalidateAllOpen", async () => {
  let count = 0;
  const open = [...documents.all()];
  for (const doc of open) {
    // Не clearDocument: повторный parse 16MB+ блокирует hover/completion на секунды.
    // Диагностика пересчитывается из кэшированного AST; hash учитывает #include на диске.
    clearDiagnosticTimer(doc.uri);
  }
  for (const doc of open) {
    await validateTextDocument(doc);
    count++;
  }
  return count;
});

connection.onRequest("mcuhelper/getLibraryVerificationReports", () => getLibraryVerificationReports());

connection.onRequest("mcuhelper/validateInput", async (args) => {
  const result = await handleValidateInput(args, globalSettings, getDoc);
  if (result.message) return result;
  const doc = documents.get(args.uri);
  if (doc && result.solverResult) {
    const index = getDocumentIndex(args.uri);
    if (index) setCachedSolverResult(index.hash, result.solverResult);
    const lspDiags = result.solverResult.diagnostics.map((d) => toLspDiagnostic(d));
    solverDiagnostics.set(args.uri, lspDiags);
    await validateTextDocument(doc);
  }
  return { ok: result.ok, exitCode: result.exitCode, diagnosticCount: result.diagnosticCount };
});

connection.onRequest("mcuhelper/runMcuStep", async (args) => {
  const result = await handleRunMcuStep(args, globalSettings, getDoc);
  if (result.message) return result;
  const doc = documents.get(args.uri);
  if (doc && result.solverResult) {
    const index = getDocumentIndex(args.uri);
    if (index) setCachedSolverResult(index.hash, result.solverResult);
    const lspDiags = result.solverResult.diagnostics.map((d) => toLspDiagnostic(d));
    solverDiagnostics.set(args.uri, lspDiags);
    await validateTextDocument(doc);
  }
  const diagnostics = result.solverResult ? result.solverResult.diagnostics.map((d) => toLspDiagnostic(d)) : [];
  const firstError = diagnostics.find((d) => d.severity === 1 /* DiagnosticSeverity.Error */);
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    diagnosticCount: result.diagnosticCount,
    runDir: result.runDir,
    mcuNrPath: result.mcuNrPath,
    sourceFsPath: result.sourceFsPath,
    prepared: result.prepared,
    finCopiedPath: result.finCopiedPath,
    finOverwritten: result.finOverwritten,
    lstPath: result.lstPath,
    diagnostics,
    firstError: firstError
      ? {
          message: firstError.message,
          range: firstError.range,
          code: firstError.code,
        }
      : undefined,
  };
});

documents.listen(connection);
connection.listen();
