import * as path from "path";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
  analyzeDocument,
  getDocumentIndex,
  buildSemanticTokenSpans,
  semanticKindToIndex,
  listVisibleConstants,
  resolveScopeAtLine,
  type DocumentIndex,
  type DiagnosticMessage,
} from "@mcuhelper/mcu-language";
import { buildScene, buildSliceGrid, queryPoint } from "@mcuhelper/mcu-geometry";
import type { SliceAxis } from "@mcuhelper/mcu-geometry";
import { SymbolInformation, SymbolKind, Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { getCachedSolverResult, runInputStep, setCachedSolverResult, type SolverResult } from "./solver";

export interface McuServerSettings {
  mcuNrPath: string;
  enableSolverValidation: boolean;
  variantName: string;
  enableIaeaNuclideHover: boolean;
}

export function uriToBaseDir(uri: string): string {
  return path.dirname(uri.replace(/^file:\/\//, "").replace(/^\//, "").replace(/^([A-Z]):/, "$1:"));
}

export function toLspDiagnostic(d: DiagnosticMessage): Diagnostic {
  return {
    severity:
      d.severity === "error"
        ? DiagnosticSeverity.Error
        : d.severity === "warning"
          ? DiagnosticSeverity.Warning
          : DiagnosticSeverity.Information,
    message: d.message,
    range: { start: d.range.start, end: d.range.end },
    code: d.code,
    source: "mcuhelper",
  };
}

const PROFILE_PARSE = process.env.MCUHELPER_PROFILE === "1";

/** Единая точка получения индекса: version-cache в analyzeDocument + проверка version. */
export function ensureDocumentIndex(doc: TextDocument): DocumentIndex {
  const uri = doc.uri;
  const cached = getDocumentIndex(uri);
  if (cached && cached.version === doc.version) {
    return cached;
  }
  const t0 = performance.now();
  const textLen = doc.getText().length;
  const baseDir = uriToBaseDir(uri);
  const index = analyzeDocument(uri, doc.getText(), doc.version, { baseDir, expandInclude: true });
  const ms = performance.now() - t0;
  if (PROFILE_PARSE) {
    console.error(`[mcuhelper] analyzeDocument ${ms.toFixed(1)}ms uri=${uri} v=${doc.version} len=${textLen}`);
  }
  return index;
}

export function collectDiagnostics(
  doc: TextDocument,
  extraSolverDiags: Diagnostic[] = []
): Diagnostic[] {
  const index = ensureDocumentIndex(doc);
  const diags = index.ast.diagnostics.map(toLspDiagnostic);
  const cached = getCachedSolverResult(index.hash);
  if (cached) {
    diags.push(...cached.diagnostics.map(toLspDiagnostic));
  }
  return [...diags, ...extraSolverDiags];
}

export function buildSemanticTokenData(doc: TextDocument): number[] {
  const index = ensureDocumentIndex(doc);
  return encodeSemanticTokenSpans(index.ast, doc.getText());
}

export function encodeSemanticTokenSpans(ast: import("@mcuhelper/mcu-language").DocumentIndex["ast"], text: string): number[] {
  const spans = buildSemanticTokenSpans(ast, text).sort((a, b) =>
    a.line !== b.line ? a.line - b.line : a.char - b.char
  );
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const span of spans) {
    const deltaLine = span.line - prevLine;
    const deltaChar = deltaLine === 0 ? span.char - prevChar : span.char;
    data.push(deltaLine, deltaChar, span.length, semanticKindToIndex(span.kind), 0);
    prevLine = span.line;
    prevChar = span.char;
  }
  return data;
}

export function encodeSemanticTokenSpansForRange(
  ast: import("@mcuhelper/mcu-language").DocumentIndex["ast"],
  text: string,
  startLine: number,
  endLine: number
): number[] {
  const spans = buildSemanticTokenSpans(ast, text)
    .filter((s) => s.line >= startLine && s.line <= endLine)
    .sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;
  for (const span of spans) {
    const deltaLine = span.line - prevLine;
    const deltaChar = deltaLine === 0 ? span.char - prevChar : span.char;
    data.push(deltaLine, deltaChar, span.length, semanticKindToIndex(span.kind), 0);
    prevLine = span.line;
    prevChar = span.char;
  }
  return data;
}

export function buildDocumentSymbols(index: DocumentIndex, uri: string): SymbolInformation[] {
  const symbols: SymbolInformation[] = [];
  for (const f of index.ast.fragments) {
    symbols.push({
      name: `Fragment: ${f.id}`,
      kind: SymbolKind.Namespace,
      location: {
        uri,
        range: { start: { line: f.startLine, character: 0 }, end: { line: f.endLine, character: 0 } },
      },
    });
  }
  for (const m of index.ast.materials) {
    symbols.push({
      name: `MATR ${m.number}`,
      kind: SymbolKind.Class,
      location: { uri, range: { start: m.range.start, end: m.range.end } },
    });
  }
  for (const b of index.ast.bodies) {
    symbols.push({
      name: `Body ${b.name} (${b.bodyType})`,
      kind: SymbolKind.Struct,
      location: { uri, range: { start: b.range.start, end: b.range.end } },
    });
  }
  for (const z of index.ast.zones) {
    symbols.push({
      name: `Zone ${z.name}`,
      kind: SymbolKind.Object,
      location: { uri, range: { start: z.range.start, end: z.range.end } },
    });
  }
  return symbols;
}

export function resolveDocumentIndex(
  uri: string,
  getDoc: (uri: string) => TextDocument | undefined
): DocumentIndex | undefined {
  const doc = getDoc(uri);
  if (!doc) return getDocumentIndex(uri);
  return ensureDocumentIndex(doc);
}

export function handleGetIndex(
  args: string | { uri: string; line?: number; character?: number },
  getDoc: (uri: string) => TextDocument | undefined
) {
  const uri = typeof args === "string" ? args : args.uri;
  const line = typeof args === "object" ? args.line : undefined;
  const character = typeof args === "object" ? args.character : undefined;
  const index = resolveDocumentIndex(uri, getDoc);
  if (!index) return null;

  const summaries = { ...index.summaries };
  let editorContext: { line: number; character: number; scope: string } | undefined;

  if (line != null && line >= 0) {
    const scope = resolveScopeAtLine(index.ast.statements, line);
    const char = character ?? Number.MAX_SAFE_INTEGER;
    editorContext = { line, character: char, scope };
    summaries.constants = listVisibleConstants(index.ast.constants, scope, line, char);
  }

  return { summaries, hash: index.hash, editorContext };
}

export function handleGetGeometry(uri: string, getDoc: (uri: string) => TextDocument | undefined) {
  const index = resolveDocumentIndex(uri, getDoc);
  if (!index) return null;
  return buildScene(index.ast);
}

export function handleQueryPoint(
  args: { uri: string; x: number; y: number; z: number },
  getDoc: (uri: string) => TextDocument | undefined
) {
  const index = resolveDocumentIndex(args.uri, getDoc);
  if (!index) return null;
  return queryPoint(index.ast, { x: args.x, y: args.y, z: args.z });
}

export function handleGetSlice(
  args: { uri: string; axis: SliceAxis; position: number; resolution?: number },
  getDoc: (uri: string) => TextDocument | undefined
) {
  const index = resolveDocumentIndex(args.uri, getDoc);
  if (!index) return null;
  const scene = buildScene(index.ast);
  return buildSliceGrid(index.ast, args.axis, args.position, args.resolution ?? 256, scene.bbox);
}

export async function handleValidateInput(
  args: { uri: string; mcuNrPath: string; variantName: string },
  settings: McuServerSettings,
  getDoc: (uri: string) => TextDocument | undefined,
  runSolver: typeof runInputStep = runInputStep
): Promise<{ ok: boolean; exitCode?: number | null; diagnosticCount?: number; message?: string; solverResult?: SolverResult }> {
  const doc = getDoc(args.uri);
  if (!doc) return { ok: false, message: "Document not open" };
  const index = getDocumentIndex(args.uri);
  const workDir = uriToBaseDir(args.uri);
  const result = await runSolver({
    mcuNrPath: args.mcuNrPath || settings.mcuNrPath,
    workingDir: workDir,
    variantName: args.variantName || settings.variantName,
  });
  if (index) setCachedSolverResult(index.hash, result);
  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    diagnosticCount: result.diagnostics.length,
    solverResult: result,
  };
}

export function applyServerSettings(
  target: McuServerSettings,
  cfg: Record<string, unknown>
): void {
  if (typeof cfg.mcuNrPath === "string") target.mcuNrPath = cfg.mcuNrPath;
  if (typeof cfg.enableSolverValidation === "boolean") {
    target.enableSolverValidation = cfg.enableSolverValidation;
  }
  if (typeof cfg.variantName === "string") target.variantName = cfg.variantName;
  if (typeof cfg.enableIaeaNuclideHover === "boolean") {
    target.enableIaeaNuclideHover = cfg.enableIaeaNuclideHover;
  }
}

export function syncSettingsFromInitialize(
  target: McuServerSettings,
  initializationOptions?: Record<string, unknown>
): void {
  if (initializationOptions && typeof initializationOptions === "object") {
    applyServerSettings(target, initializationOptions);
  }
}
