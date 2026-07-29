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
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getDocumentIndex, clearDocument } from "@mcuhelper/mcu-language";
import { getCompletions, getDefinition, getHoverContent } from "./completion";
import { getSignatureHelp } from "./signatureHelp";
import { getNaturalIsotopeLines, warmupNaturalAbundanceIndex } from "./iaeaNds";
import { warmupLanguageServer } from "./warmup";
import { setCachedSolverResult } from "./solver";
import {
  toLspDiagnostic,
  collectDiagnostics,
  buildDocumentSymbols,
  buildFoldingRanges,
  buildDocumentLinks,
  ensureDocumentIndex,
  handleGetIndex,
  handleGetGeometry,
  handleQueryPoint,
  handleGetSlice,
  handleValidateInput,
  handleRunMcuStep,
  handleGetDiagnostics,
  syncSettingsFromInitialize,
  applyServerSettings,
  type McuServerSettings,
} from "./serverHandlers";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let globalSettings: McuServerSettings = {
  mcuNrPath: "",
  mcuConstantsLibPath: "",
  enableSolverValidation: false,
  variantName: "NAME",
  enableIaeaNuclideHover: true,
};

const solverDiagnostics = new Map<string, import("vscode-languageserver").Diagnostic[]>();

function getDoc(uri: string): TextDocument | undefined {
  return documents.get(uri);
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
}

const DIAGNOSTIC_DEBOUNCE_MS = 250;

const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearDiagnosticTimer(uri: string): void {
  const t = diagnosticTimers.get(uri);
  if (t) {
    clearTimeout(t);
    diagnosticTimers.delete(uri);
  }
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
      void validateTextDocument(current);
    }, DIAGNOSTIC_DEBOUNCE_MS)
  );
}

async function validateTextDocument(doc: TextDocument): Promise<void> {
  const uri = doc.uri;
  const extra = solverDiagnostics.get(uri) ?? [];
  const diagnostics = collectDiagnostics(doc, extra);
  connection.sendDiagnostics({ uri, diagnostics });
}

documents.onDidChangeContent((change) => {
  scheduleValidateTextDocument(change.document);
});

documents.onDidOpen((event) => {
  clearDiagnosticTimer(event.document.uri);
  void validateTextDocument(event.document);
});

documents.onDidClose((event) => {
  clearDiagnosticTimer(event.document.uri);
  clearDocument(event.document.uri);
});

documents.onDidSave((event) => {
  clearDiagnosticTimer(event.document.uri);
  void validateTextDocument(event.document);
});

connection.onCompletion((params: CompletionParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
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

connection.onHover(async (params: HoverParams) => {
  await readWorkspaceSettings();
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const index = ensureDocumentIndex(doc);
  const content = getHoverContent(
    doc,
    params.position,
    index,
    { enableIaeaNuclide: globalSettings.enableIaeaNuclideHover },
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

connection.onDocumentSymbol((params: DocumentSymbolParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const index = ensureDocumentIndex(doc);
  return buildDocumentSymbols(index, params.textDocument.uri);
});

connection.onFoldingRanges((params: FoldingRangeParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const index = ensureDocumentIndex(doc);
  return buildFoldingRanges(index);
});

connection.onDocumentLinks((params: DocumentLinkParams) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const index = ensureDocumentIndex(doc);
  return buildDocumentLinks(index, params.textDocument.uri);
});

connection.onRequest("mcuhelper/getIndex", (args) => handleGetIndex(args, getDoc));

connection.onRequest("mcuhelper/getNaturalIsotopeLines", async (args: { element: string; concentration: string }) => {
  return getNaturalIsotopeLines(args.element, args.concentration);
});

connection.onRequest("mcuhelper/getGeometry", (uri: string) => handleGetGeometry(uri, getDoc));

connection.onRequest("mcuhelper/queryPoint", (args) => handleQueryPoint(args, getDoc));

connection.onRequest("mcuhelper/getSlice", (args) => handleGetSlice(args, getDoc));

connection.onRequest("mcuhelper/getDiagnostics", (args: { uri: string }) => {
  const extra = solverDiagnostics.get(args.uri) ?? [];
  return handleGetDiagnostics(args.uri, getDoc, extra);
});

connection.onRequest("mcuhelper/revalidateAllOpen", () => {
  let count = 0;
  for (const doc of documents.all()) {
    void validateTextDocument(doc);
    count++;
  }
  return count;
});

connection.onRequest("mcuhelper/validateInput", async (args) => {
  const result = await handleValidateInput(args, globalSettings, getDoc);
  if (result.message) return result;
  const doc = documents.get(args.uri);
  if (doc && result.solverResult) {
    const index = getDocumentIndex(args.uri);
    if (index) setCachedSolverResult(index.hash, result.solverResult);
    const lspDiags = result.solverResult.diagnostics.map(toLspDiagnostic);
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
    const lspDiags = result.solverResult.diagnostics.map(toLspDiagnostic);
    solverDiagnostics.set(args.uri, lspDiags);
    await validateTextDocument(doc);
  }
  const diagnostics = result.solverResult ? result.solverResult.diagnostics.map(toLspDiagnostic) : [];
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
