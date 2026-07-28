import * as path from "path";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
  analyzeDocument,
  getDocumentIndex,
  buildSemanticTokenSpans,
  semanticKindToIndex,
  listVisibleConstants,
  resolveScopeAtLine,
  resolveIncludeFilePath,
  resolveIncludeFileUri,
  type DocumentIndex,
  type DiagnosticMessage,
} from "@mcuhelper/mcu-language";
import { buildScene, buildSliceGrid, queryPoint } from "@mcuhelper/mcu-geometry";
import type { SliceAxis } from "@mcuhelper/mcu-geometry";
import { SymbolInformation, SymbolKind, Diagnostic, DiagnosticSeverity, FoldingRange, FoldingRangeKind, DocumentLink } from "vscode-languageserver";
import { getCachedSolverResult, runInputStep, setCachedSolverResult, type SolverResult } from "./solver";

export interface McuServerSettings {
  mcuNrPath: string;
  enableSolverValidation: boolean;
  variantName: string;
  enableIaeaNuclideHover: boolean;
}

export function uriToBaseDir(uri: string): string {
  try {
    const { pathname } = new URL(uri);
    let fsPath = decodeURIComponent(pathname);
    if (/^\/[A-Za-z]:/.test(fsPath)) {
      fsPath = fsPath.slice(1);
    }
    return path.dirname(fsPath);
  } catch {
    return path.dirname(
      uri.replace(/^file:\/\//, "").replace(/^\//, "").replace(/^([A-Z]):/, "$1:")
    );
  }
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
  const cached = getDocumentIndex(uri, true);
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
  const baseDir = uriToBaseDir(doc.uri);
  const index = analyzeDocument(doc.uri, doc.getText(), doc.version, { baseDir, expandInclude: false });
  const lineCount = doc.lineCount;
  const diags = index.ast.diagnostics
    .map(toLspDiagnostic)
    .filter((d) => d.range.start.line < lineCount);
  const cached = getCachedSolverResult(index.hash);
  if (cached) {
    diags.push(
      ...cached.diagnostics.map(toLspDiagnostic).filter((d) => d.range.start.line < lineCount)
    );
  }
  return [...diags, ...extraSolverDiags.filter((d) => d.range.start.line < lineCount)];
}

export interface McuDiagnosticPayload {
  severity: number;
  message: string;
  code?: string;
  source: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

function lspDiagnosticCode(code: Diagnostic["code"]): string | undefined {
  if (code == null) return undefined;
  if (typeof code === "string" || typeof code === "number") return String(code);
  const obj = code as { value?: string | number };
  return obj.value != null ? String(obj.value) : undefined;
}

/** Диагностики только по тексту открытого файла (без развёрнутого #include). */
export function handleGetDiagnostics(
  uri: string,
  getDoc: (uri: string) => TextDocument | undefined,
  extraSolverDiags: Diagnostic[] = []
): McuDiagnosticPayload[] {
  const doc = getDoc(uri);
  if (!doc) return [];
  return collectDiagnostics(doc, extraSolverDiags).map((d) => ({
    severity: d.severity ?? DiagnosticSeverity.Error,
    message: d.message,
    code: lspDiagnosticCode(d.code),
    source: d.source ?? "mcuhelper",
    range: d.range,
  }));
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

const MATERIAL_BLOCK_STOP_LABELS = new Set(["MATR", "END", "FINISH", "DEF", "TEMPR", "PIN"]);

/** Конец блока LATT (не LISTEL/PARM/LFIXSO и не строки /n картограммы). */
const LATT_BLOCK_STOP_LABELS = new Set([
  "FINISH",
  "LATT",
  "LCELL",
  "CELL",
  "NET",
  "HEAD",
  "CONT",
  "PIN",
  "SRCD",
  "SRC",
  "SPNT",
  "RGS",
  "REGD",
  "REG",
  "BRG",
  "BRGD",
  "NTOT",
  "NAMVAR",
  "NAMV",
  "BURN",
  "BURD",
  "V01",
  "SHOW",
  "STOP",
]);

function buildMaterialFoldingRanges(index: DocumentIndex): FoldingRange[] {
  const physicalStatements = index.ast.statements
    .filter((stmt) => stmt.fragment === "physical")
    .sort((a, b) => a.range.start.line - b.range.start.line);

  const ranges: FoldingRange[] = [];
  for (const mat of index.ast.materials) {
    const startLine = mat.range.start.line;
    const stmtIdx = physicalStatements.findIndex(
      (stmt) => stmt.range.start.line === startLine && stmt.label === "MATR"
    );
    if (stmtIdx < 0) continue;

    let endLine = physicalStatements[physicalStatements.length - 1]?.range.end.line ?? startLine;
    for (let i = stmtIdx + 1; i < physicalStatements.length; i++) {
      const next = physicalStatements[i]!;
      if (MATERIAL_BLOCK_STOP_LABELS.has(next.label.toUpperCase())) {
        endLine = next.range.start.line - 1;
        break;
      }
    }

    if (endLine > startLine) {
      ranges.push({ startLine, endLine, kind: FoldingRangeKind.Region });
    }
  }
  return ranges;
}

/** Сворачивание LCELL…ENDL и LATT…(LISTEL/PARM/LFIXSO/LBLACK). */
function buildLatticeFoldingRanges(index: DocumentIndex): FoldingRange[] {
  const stmts = index.ast.statements
    .filter((stmt) => stmt.fragment === "geometry")
    .sort((a, b) => a.range.start.line - b.range.start.line);

  const ranges: FoldingRange[] = [];

  for (let i = 0; i < stmts.length; i++) {
    const label = stmts[i]!.label.toUpperCase();
    const startLine = stmts[i]!.range.start.line;

    if (label === "LCELL") {
      let endLine = startLine;
      for (let j = i + 1; j < stmts.length; j++) {
        const nextLabel = stmts[j]!.label.toUpperCase();
        endLine = stmts[j]!.range.end.line;
        if (nextLabel === "ENDL") break;
        if (nextLabel === "LCELL" || nextLabel === "LATT" || nextLabel === "FINISH") {
          endLine = stmts[j]!.range.start.line - 1;
          break;
        }
      }
      if (endLine > startLine) {
        ranges.push({ startLine, endLine, kind: FoldingRangeKind.Region });
      }
      continue;
    }

    if (label === "LATT") {
      let endLine = startLine;
      for (let j = i + 1; j < stmts.length; j++) {
        const nextLabel = stmts[j]!.label.toUpperCase();
        if (LATT_BLOCK_STOP_LABELS.has(nextLabel)) {
          break;
        }
        endLine = stmts[j]!.range.end.line;
      }
      if (endLine > startLine) {
        ranges.push({ startLine, endLine, kind: FoldingRangeKind.Region });
      }
    }
  }

  return ranges;
}

export function buildFoldingRanges(index: DocumentIndex): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  for (const fragment of index.ast.fragments) {
    if (fragment.endLine <= fragment.startLine) continue;
    ranges.push({
      startLine: fragment.startLine,
      endLine: fragment.endLine,
      kind: FoldingRangeKind.Region,
    });
  }
  ranges.push(...buildMaterialFoldingRanges(index));
  ranges.push(...buildLatticeFoldingRanges(index));
  return ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}

export function buildDocumentLinks(index: DocumentIndex, documentUri: string): DocumentLink[] {
  const baseDir = uriToBaseDir(documentUri);
  return index.ast.includes.map((inc) => {
    const { fsPath, exists } = resolveIncludeFilePath(baseDir, inc.path);
    return {
      range: {
        start: { line: inc.range.start.line, character: inc.range.start.character },
        end: { line: inc.range.end.line, character: inc.range.end.character },
      },
      target: resolveIncludeFileUri(baseDir, inc.path),
      tooltip: exists ? fsPath : `Файл не найден: ${inc.path}`,
    };
  });
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

  const statements = index.ast.statements.map((stmt) => ({
    label: stmt.label,
    text: stmt.text,
    fragment: stmt.fragment,
    range: stmt.range,
  }));

  return { summaries, fragments: index.ast.fragments, statements, hash: index.hash, editorContext };
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
