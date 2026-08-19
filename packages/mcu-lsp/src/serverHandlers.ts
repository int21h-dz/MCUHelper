import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
  analyzeDocument,
  getDocumentIndex,
  getDocumentIndexForVersion,
  getLastAnalyzeTimings,
  buildSummaries,
  buildSemanticTokenSpans,
  semanticKindToIndex,
  listVisibleConstants,
  resolveScopeAtLine,
  resolveIncludeFilePath,
  resolveIncludeFileUri,
  collectSumIsotopeMarks,
  getParameteThrForMcuNuclide,
  expandIncludes,
  mapExpandedLineToMain,
  mapMainLineToExpanded,
  remapRangeToMainDocument,
  resolveExpandedLineLocation,
  normalizeIncludeFsKey,
  buildIncludeGraph,
  detectEncodingFromBuffer,
  textHasIncludeDirective,
  sameIncludeFileUri,
  type DocumentIndex,
  type DiagnosticMessage,
  type IncludeLineMapEntry,
  type IncludeTextOverrides,
  type IncludeGraphNode,
  type SourceRange,
} from "@mcuhelper/mcu-language";
import { fileURLToPath } from "url";
import { isGeoBodyLabel } from "@mcuhelper/mcu-schema";
import { buildScene, buildSliceGrid, queryPoint } from "@mcuhelper/mcu-geometry";
import type { SliceAxis } from "@mcuhelper/mcu-geometry";
import { SymbolInformation, SymbolKind, Diagnostic, DiagnosticSeverity, FoldingRange, FoldingRangeKind, DocumentLink } from "vscode-languageserver";
import { collectAwLibMassDiagnostics, collectAwLibMissingDiagnostics } from "./awLibVerify";
import { collectDefaultPhyMissingDiagnostics } from "./defaultPhyVerify";
import { collectHalfLifeMismatchDiagnostics } from "./parameteThrVerify";
import {
  collectMcuRunResult,
  getCachedSolverResult,
  prepareMcuRunFiles,
  runInputStep,
  runMcuStep,
  setCachedSolverResult,
  mcuModeToStepKey,
  copyFinBesideSource,
  isSuccessfulMcuCollect,
  deleteVariantArtifact,
  findVariantArtifactInDir,
  type SolverResult,
  type McuMode,
} from "./solver";
import { applyEditorLocation, applyOptionalEditorLocation, rangeToEditorLocation } from "./symbolRefs";

export interface McuServerSettings {
  mcuNrPath: string;
  mcuConstantsLibPath: string;
  enableSolverValidation: boolean;
  variantName: string;
}

/** Провайдер текстов открытых include-буферов для expandIncludes (ключ normalizeIncludeFsKey). */
let includeTextOverridesProvider: (() => IncludeTextOverrides | undefined) | undefined;

export function setIncludeTextOverridesProvider(
  provider: (() => IncludeTextOverrides | undefined) | undefined
): void {
  includeTextOverridesProvider = provider;
}

/** Собрать overrides из открытых TextDocument (file: URI). */
export function buildIncludeTextOverridesFromDocs(
  docs: Iterable<{ uri: string; getText: () => string }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const doc of docs) {
    if (!doc.uri.startsWith("file:")) continue;
    try {
      const fsPath = fileURLToPath(doc.uri);
      map.set(normalizeIncludeFsKey(fsPath), doc.getText());
    } catch {
      /* ignore non-file */
    }
  }
  return map;
}

function currentIncludeTextOverrides(): IncludeTextOverrides | undefined {
  return includeTextOverridesProvider?.();
}

export function uriToFsPath(uri: string): string {
  try {
    const { pathname } = new URL(uri);
    let fsPath = decodeURIComponent(pathname);
    if (/^\/[A-Za-z]:/.test(fsPath)) {
      fsPath = fsPath.slice(1);
    }
    return fsPath;
  } catch {
    return uri.replace(/^file:\/\//, "").replace(/^\//, "").replace(/^([A-Z]):/, "$1:");
  }
}

export function uriToBaseDir(uri: string): string {
  return path.dirname(uriToFsPath(uri));
}

export function toLspDiagnostic(d: DiagnosticMessage, documentUri?: string): Diagnostic {
  const relatedInformation =
    d.related && documentUri
      ? d.related.map((r) => ({
          message: r.message,
          location: {
            uri: documentUri,
            range: { start: r.range.start, end: r.range.end },
          },
        }))
      : undefined;
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
    relatedInformation,
  };
}

const PROFILE_PARSE = process.env.MCUHELPER_PROFILE === "1";


const MATR_BLOCK_STOP_LABELS = new Set(["MATR", "END", "FINISH", "DEF", "TEMPR", "PIN"]);

function isDataRowLabel(label: string): boolean {
  return (
    /^T\d+/i.test(label) ||
    /^P\d+/i.test(label) ||
    /^O\d+/i.test(label) ||
    /^M\d+/i.test(label) ||
    /^E-?\d+/i.test(label) ||
    /^I-?\d+/i.test(label) ||
    /^F-?\d+/i.test(label)
  );
}

export type NavStatementPayload = {
  label: string;
  text: string;
  fragment: DocumentIndex["ast"]["statements"][number]["fragment"];
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

export type NavIncludePayload = {
  path: string;
  uri?: string;
  exists?: boolean;
  fragment: DocumentIndex["ast"]["statements"][number]["fragment"];
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

/** Statements для панели «Навигация» — без тел/зон/нуклидов MATR/CONT/EQU (иначе JSON сотни МБ). */
export function selectNavStatements(index: DocumentIndex): Array<{
  label: string;
  text: string;
  fragment: DocumentIndex["ast"]["statements"][number]["fragment"];
  range: DocumentIndex["ast"]["statements"][number]["range"];
}> {
  const zoneAtLine = new Set(
    index.summaries.zones.map((z) => `${z.name.toUpperCase()}@${z.range.start.line}`)
  );
  const out: Array<{
    label: string;
    text: string;
    fragment: DocumentIndex["ast"]["statements"][number]["fragment"];
    range: DocumentIndex["ast"]["statements"][number]["range"];
  }> = [];
  let inMatrBlock = false;
  for (const stmt of index.ast.statements) {
    const label = stmt.label.toUpperCase();
    let keep = false;
    if (label && /^[A-Za-z]/.test(label) && label !== "FINISH" && label !== "CONT" && label !== "EQU" && label !== "SET") {
      if (!isGeoBodyLabel(label) && !zoneAtLine.has(`${label}@${stmt.range.start.line}`) && !isDataRowLabel(label)) {
        if (!(inMatrBlock && !MATR_BLOCK_STOP_LABELS.has(label))) {
          keep = true;
        }
      }
    }
    if (label === "MATR") inMatrBlock = true;
    else if (MATR_BLOCK_STOP_LABELS.has(label)) inMatrBlock = false;
    if (!keep) continue;
    const text = stmt.text.length > 120 ? `${stmt.text.slice(0, 119)}…` : stmt.text;
    out.push({ label: stmt.label, text, fragment: stmt.fragment, range: stmt.range });
  }
  return out;
}

function fragmentIdAtExpandedLine(
  index: DocumentIndex,
  expandedLine: number
): DocumentIndex["ast"]["statements"][number]["fragment"] {
  for (const f of index.ast.fragments) {
    if (expandedLine >= f.startLine && expandedLine <= f.endLine) return f.id;
  }
  let best: DocumentIndex["ast"]["statements"][number]["fragment"] = "physical";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const stmt of index.ast.statements) {
    const dist = Math.abs(stmt.range.start.line - expandedLine);
    if (dist < bestDist) {
      bestDist = dist;
      best = stmt.fragment;
    }
  }
  return best;
}

/** Перенос span фрагмента из expanded в строки main-редактора. */
export function remapFragmentSpanForEditor(
  fragment: DocumentIndex["ast"]["fragments"][number],
  lineMap: IncludeLineMapEntry[] | undefined
): DocumentIndex["ast"]["fragments"][number] {
  if (!lineMap?.length) return fragment;
  const startLine = mapExpandedLineToMain(lineMap, fragment.startLine);
  let endLine: number | null = null;
  for (let line = fragment.endLine; line >= fragment.startLine; line--) {
    const mapped = mapExpandedLineToMain(lineMap, line);
    if (mapped != null) {
      endLine = mapped;
      break;
    }
  }
  if (startLine == null || endLine == null) return fragment;
  return { ...fragment, startLine, endLine: Math.max(startLine, endLine) };
}

/**
 * Карты навигации только из main (не из тела `#include`), в координатах редактора.
 * Содержимое include в панели не показываем — только директивы через `projectNavIncludes`.
 */
export function projectNavStatements(index: DocumentIndex): NavStatementPayload[] {
  const lineMap = index.ast.includeLineMap;
  const out: NavStatementPayload[] = [];
  for (const stmt of selectNavStatements(index)) {
    const loc = resolveExpandedLineLocation(lineMap, stmt.range.start.line);
    if (loc.kind !== "main") continue;
    const range = remapRangeToMainDocument(stmt.range, lineMap) ?? {
      start: { line: loc.line, character: stmt.range.start.character },
      end: { line: loc.line, character: stmt.range.end.character },
    };
    out.push({
      label: stmt.label,
      text: stmt.text,
      fragment: stmt.fragment,
      range: {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
      },
    });
  }
  return out;
}

/**
 * EQU/SET для панели «Константы»: range/uri в координатах редактора
 * (main после свёртки `#include`, либо файл include).
 */
export function projectNavConstants(
  index: DocumentIndex,
  constants: DocumentIndex["summaries"]["constants"]
): DocumentIndex["summaries"]["constants"] {
  const out: DocumentIndex["summaries"]["constants"] = [];
  for (const c of constants) {
    const loc = rangeToEditorLocation(index, c.range);
    if (!loc) continue;
    out.push({
      ...c,
      uri: loc.uri,
      range: {
        ...c.range,
        start: loc.range.start,
        end: loc.range.end,
      },
    });
  }
  return out;
}

/**
 * MATR в summaries: range/uri в координатах редактора
 * (main после свёртки `#include`, либо файл include).
 */
export function projectNavMaterials(
  index: DocumentIndex,
  materials: DocumentIndex["summaries"]["materials"]
): DocumentIndex["summaries"]["materials"] {
  const out: DocumentIndex["summaries"]["materials"] = [];
  for (const m of materials) {
    const mapped = applyEditorLocation(index, m);
    if (!mapped) continue;
    const nuclides = m.nuclides.map((n) => {
      const nloc = rangeToEditorLocation(index, n.range);
      if (!nloc) return n;
      return {
        ...n,
        uri: nloc.uri,
        range: {
          ...n.range,
          start: nloc.range.start,
          end: nloc.range.end,
        },
      };
    });
    out.push({ ...mapped, nuclides });
  }
  return out;
}

function projectRangedList<T extends { range: SourceRange }>(
  index: DocumentIndex,
  items: readonly T[]
): Array<T & { uri?: string }> {
  const out: Array<T & { uri?: string }> = [];
  for (const item of items) {
    out.push(applyEditorLocation(index, item) ?? item);
  }
  return out;
}

/** Зоны: range/uri в координатах редактора (main или `#include`). */
export function projectNavZones(
  index: DocumentIndex,
  zones: DocumentIndex["summaries"]["zones"]
): DocumentIndex["summaries"]["zones"] {
  return projectRangedList(index, zones);
}

/** Тела: range/uri в координатах редактора (main или `#include`). */
export function projectNavBodies(
  index: DocumentIndex,
  bodies: DocumentIndex["summaries"]["bodies"]
): DocumentIndex["summaries"]["bodies"] {
  return projectRangedList(index, bodies);
}

/** NET: карточка и вложенные прототипы/носители — editor coords. */
export function projectNavNets(
  index: DocumentIndex,
  nets: DocumentIndex["summaries"]["nets"]
): DocumentIndex["summaries"]["nets"] {
  const out: DocumentIndex["summaries"]["nets"] = [];
  for (const net of nets) {
    const mapped = applyEditorLocation(index, net);
    const base = mapped ?? net;
    out.push({
      ...base,
      carrierZones: net.carrierZones.map((z) => applyEditorLocation(index, z) ?? z),
      prototypes: net.prototypes.map((p) => applyOptionalEditorLocation(index, p)),
    });
  }
  return out;
}

/** LATT: карточка и LISTEL — editor coords. */
export function projectNavLattices(
  index: DocumentIndex,
  lattices: DocumentIndex["summaries"]["lattices"]
): DocumentIndex["summaries"]["lattices"] {
  const out: DocumentIndex["summaries"]["lattices"] = [];
  for (const lat of lattices) {
    const mapped = applyEditorLocation(index, lat);
    const base = mapped ?? lat;
    out.push({
      ...base,
      elements: lat.elements.map((el) => applyOptionalEditorLocation(index, el)),
    });
  }
  return out;
}

/** `#include` для панели «Навигация» — директива в main + fragment. */
export function projectNavIncludes(index: DocumentIndex): NavIncludePayload[] {
  const lineMap = index.ast.includeLineMap;
  return index.ast.includes.map((inc) => {
    const expanded = mapMainLineToExpanded(lineMap, inc.range.start.line);
    return {
      path: inc.path,
      uri: inc.uri,
      exists: inc.exists,
      fragment: fragmentIdAtExpandedLine(index, expanded),
      range: {
        start: { line: inc.range.start.line, character: inc.range.start.character },
        end: { line: inc.range.end.line, character: inc.range.end.character },
      },
    };
  });
}

/** Счёт диагностик AST по URI/пути include (без повторного полного collectDiagnostics). */
function countDiagnosticsPerInclude(index: DocumentIndex): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  const lineMap = index.ast.includeLineMap;
  for (const d of index.ast.diagnostics) {
    if (d.code === "include") {
      const inc = index.ast.includes.find((i) => i.range.start.line === d.range.start.line);
      if (inc?.uri) bump(inc.uri);
      else if (inc) bump(inc.path);
      continue;
    }
    const loc = resolveExpandedLineLocation(lineMap, d.range.start.line);
    if (loc.kind === "include") {
      if (loc.uri) bump(loc.uri);
      else bump(loc.path);
    }
  }
  return counts;
}

function detectIncludeFileEncoding(fsPath: string | undefined, exists: boolean | undefined): string | undefined {
  if (!exists || !fsPath) return undefined;
  try {
    const buf = fs.readFileSync(fsPath);
    return detectEncodingFromBuffer(buf).encoding;
  } catch {
    return undefined;
  }
}

/**
 * Граф main → `#include` для getIndex / mcuhelper/getIncludeGraph.
 * encoding и diagCount — обогащение; вложенность — из диагностик expand.
 */
export function projectIncludeGraph(index: DocumentIndex): IncludeGraphNode[] {
  const diagCounts = countDiagnosticsPerInclude(index);
  return buildIncludeGraph(
    index.ast.includes.map((inc) => {
      const nestedInclude = index.ast.diagnostics.some(
        (d) =>
          d.code === "include" &&
          d.range.start.line === inc.range.start.line &&
          /вложенн/i.test(d.message)
      );
      const keyUri = inc.uri;
      const diagCount = keyUri
        ? diagCounts.get(keyUri) ?? diagCounts.get(inc.path) ?? 0
        : diagCounts.get(inc.path) ?? 0;
      return {
        path: inc.path,
        uri: inc.uri,
        fsPath: inc.fsPath,
        exists: inc.exists,
        mainLine: inc.range.start.line,
        encoding: detectIncludeFileEncoding(inc.fsPath, inc.exists),
        diagCount,
        nestedInclude: nestedInclude || undefined,
      };
    })
  );
}

export { mapExpandedLineToMain, remapRangeToMainDocument };

function clampFoldingRangesToDocument(ranges: FoldingRange[], lineCount: number): FoldingRange[] {
  if (lineCount <= 0) return [];
  const last = lineCount - 1;
  return ranges
    .map((r) => ({
      ...r,
      startLine: Math.max(0, Math.min(r.startLine, last)),
      endLine: Math.max(0, Math.min(r.endLine, last)),
    }))
    .filter((r) => r.endLine > r.startLine);
}

/** Единая точка получения индекса: version-cache в analyzeDocument + отпечаток include-файлов. */
export function ensureDocumentIndex(doc: TextDocument): DocumentIndex {
  const uri = doc.uri;
  const t0 = performance.now();
  // Same LSP version + нет #include → expanded≡source. Не getText/sha256 16MB (3l070626).
  const cachedAny = getDocumentIndexForVersion(uri, doc.version);
  if (cachedAny && (cachedAny.ast.includes?.length ?? 0) === 0) {
    return cachedAny;
  }

  const cachedExpanded = getDocumentIndex(uri, true);
  if (cachedExpanded && cachedExpanded.version === doc.version && cachedExpanded.includeFp === "") {
    return cachedExpanded;
  }

  const text = doc.getText();
  const expandInclude = textHasIncludeDirective(text);
  const textLen = text.length;
  const baseDir = uriToBaseDir(uri);
  const includeTextOverrides = expandInclude ? currentIncludeTextOverrides() : undefined;
  const haveCache = Boolean(getDocumentIndex(uri) ?? getDocumentIndex(uri, false));
  const skipSummaries = doc.lineCount > SOURCE_REPARSE_LINE_THRESHOLD && haveCache;
  const index = analyzeDocument(uri, text, doc.version, {
    baseDir,
    expandInclude,
    includeTextOverrides,
    skipSummaries,
  });
  const ms = performance.now() - t0;

  if (PROFILE_PARSE) {
    console.error(`[mcuhelper] analyzeDocument ${ms.toFixed(1)}ms uri=${uri} v=${doc.version} len=${textLen}`);
  }
  return index;
}

/**
 * Индекс для hover: если редактор — файл `#include`, берём expanded AST родителя
 * (MATR в main + состав в include), hit-test — через includeUri в lineMap.
 */
export function resolveHoverDocumentIndex(
  doc: TextDocument,
  parentUrisByInclude: ReadonlyMap<string, ReadonlySet<string>>,
  getDoc: (uri: string) => TextDocument | undefined,
  openDocs?: Iterable<TextDocument>
): DocumentIndex {
  const self = ensureDocumentIndex(doc);
  const parentUris = lookupParentUrisForInclude(doc.uri, parentUrisByInclude, openDocs);

  for (const parentUri of parentUris) {
    const parentDoc = getDoc(parentUri);
    if (!parentDoc) continue;
    const parentIndex = ensureDocumentIndex(parentDoc);
    const lineMap = parentIndex.ast.includeLineMap;
    if (!lineMap?.length) continue;
    const covers = lineMap.some(
      (e) =>
        e.source === "include" &&
        (sameIncludeFileUri(e.includeUri, doc.uri) ||
          (e.includeFsPath != null &&
            (() => {
              try {
                return normalizeIncludeFsKey(e.includeFsPath) === normalizeIncludeFsKey(fileURLToPath(doc.uri));
              } catch {
                return false;
              }
            })()))
    );
    if (covers) {
      return parentIndex;
    }
  }

  return self;
}

function lookupParentUrisForInclude(
  includeUri: string,
  parentUrisByInclude: ReadonlyMap<string, ReadonlySet<string>>,
  openDocs: Iterable<TextDocument> | undefined
): string[] {
  const out = new Set<string>();
  const direct = parentUrisByInclude.get(includeUri);
  if (direct) {
    for (const u of direct) out.add(u);
  } else {
    for (const [key, set] of parentUrisByInclude) {
      if (sameIncludeFileUri(key, includeUri)) {
        for (const u of set) out.add(u);
        break;
      }
    }
  }
  if (out.size > 0 || !openDocs) return [...out];

  // Parent ещё не валидировали — ищем среди открытых документов с #include.
  for (const candidate of openDocs) {
    if (sameIncludeFileUri(candidate.uri, includeUri)) continue;
    if (!textHasIncludeDirective(candidate.getText())) continue;
    const idx = ensureDocumentIndex(candidate);
    const hit = idx.ast.includes.some((inc) => inc.uri && sameIncludeFileUri(inc.uri, includeUri));
    if (hit) out.add(candidate.uri);
  }
  return [...out];
}

/** Folding/outline: на колодах > этого порога не парсим 16MB раньше diagnostics. */
export const SOURCE_REPARSE_LINE_THRESHOLD = 20_000;

/** Индекс в координатах редактора (без expand) — folding/symbols, чтобы не мигала подсветка. */
export function ensureSourceDocumentIndex(doc: TextDocument): DocumentIndex {
  const current = getDocumentIndexForVersion(doc.uri, doc.version);
  if (current) return current;
  if (doc.lineCount > SOURCE_REPARSE_LINE_THRESHOLD) {
    const stale = getDocumentIndex(doc.uri, false) ?? getDocumentIndex(doc.uri, true);
    if (stale) {
      return stale;
    }
  }
  const baseDir = uriToBaseDir(doc.uri);
  return analyzeDocument(doc.uri, doc.getText(), doc.version, { baseDir, expandInclude: false });
}

export function collectDiagnostics(
  doc: TextDocument,
  extraSolverDiags: Diagnostic[] = []
): Diagnostic[] {
  return collectDiagnosticsBundle(doc, extraSolverDiags).diagnostics;
}

export interface McuIncludeDiagnosticGroup {
  path: string;
  uri: string;
  mainIncludeLine: number;
  diagnostics: Diagnostic[];
}

export interface McuDiagnosticsBundle {
  diagnostics: Diagnostic[];
  includeGroups: McuIncludeDiagnosticGroup[];
}

function mapLineMapRange(
  lineMap: IncludeLineMapEntry[] | undefined,
  startLine: number,
  endLine: number
): { uri: string; startLine: number; endLine: number; mainIncludeLine: number; path: string } | null {
  if (!lineMap?.length) return null;
  const start = lineMap[startLine];
  const end = lineMap[endLine];
  if (!start || !end) return null;
  if (start.source !== "include" || end.source !== "include") return null;
  if (!start.includeUri || !start.includePath || start.includeLine == null) return null;
  if (start.includeUri !== end.includeUri) return null;
  return {
    uri: start.includeUri,
    path: start.includePath,
    startLine: start.includeLine,
    endLine: end.includeLine ?? start.includeLine,
    mainIncludeLine: start.mainIncludeLine ?? start.mainLine,
  };
}

function groupIncludeDiagnostics(groups: McuIncludeDiagnosticGroup[]): McuIncludeDiagnosticGroup[] {
  const byUri = new Map<string, McuIncludeDiagnosticGroup>();
  for (const group of groups) {
    const existing = byUri.get(group.uri);
    if (existing) {
      existing.diagnostics.push(...group.diagnostics);
      continue;
    }
    byUri.set(group.uri, {
      path: group.path,
      uri: group.uri,
      mainIncludeLine: group.mainIncludeLine,
      diagnostics: [...group.diagnostics],
    });
  }
  for (const group of byUri.values()) {
    group.diagnostics.sort((a, b) =>
      a.range.start.line !== b.range.start.line
        ? a.range.start.line - b.range.start.line
        : a.range.start.character - b.range.start.character
    );
  }
  return [...byUri.values()].sort((a, b) =>
    a.mainIncludeLine !== b.mainIncludeLine ? a.mainIncludeLine - b.mainIncludeLine : a.path.localeCompare(b.path)
  );
}

/**
 * Документ-обёртка над expanded-текстом: collect* читают строки по expanded line numbers,
 * затем routeExpandedDiagnostic раскладывает ranges в main / includeGroups.
 */
export function makeExpandedDocView(
  doc: TextDocument,
  index: DocumentIndex
): {
  getText: (r: { start: { line: number; character: number }; end: { line: number; character: number } }) => string;
  lineCount: number;
} {
  const lineMap = index.ast.includeLineMap;
  if (!lineMap?.length) return doc;
  const baseDir = uriToBaseDir(doc.uri);
  const { text } = expandIncludes(doc.getText(), baseDir, currentIncludeTextOverrides());
  const lines = text.split(/\r?\n/);
  return {
    lineCount: lines.length,
    getText(r) {
      const line = lines[r.start.line] ?? "";
      const end = Math.min(r.end.character, line.length);
      return line.slice(r.start.character, end);
    },
  };
}

/**
 * Раскладка диагностики из единого expanded-AST:
 * main-строки → Problems основного файла; include-строки → includeGroups.
 * relatedInformation переводится в URI/строки редактора или файла include.
 */
function routeExpandedDiagnostic(
  diagnostic: Diagnostic,
  lineMap: IncludeLineMapEntry[] | undefined,
  lineCount: number,
  out: Diagnostic[],
  includeGroups: McuIncludeDiagnosticGroup[],
  documentUri?: string
): void {
  const startLine = diagnostic.range.start.line;
  const endLine = diagnostic.range.end.line;

  // Ошибки препроцессора #include уже в координатах main.
  if (diagnostic.code === "include") {
    if (startLine >= 0 && startLine < lineCount) out.push(diagnostic);
    return;
  }

  const relatedInformation = remapRelatedInformation(
    diagnostic.relatedInformation,
    lineMap,
    documentUri
  );

  const includeMapped = mapLineMapRange(lineMap, startLine, endLine);
  if (includeMapped) {
    includeGroups.push({
      path: includeMapped.path,
      uri: includeMapped.uri,
      mainIncludeLine: includeMapped.mainIncludeLine,
      diagnostics: [
        {
          ...diagnostic,
          relatedInformation,
          range: {
            start: { line: includeMapped.startLine, character: diagnostic.range.start.character },
            end: { line: includeMapped.endLine, character: diagnostic.range.end.character },
          },
        },
      ],
    });
    return;
  }

  const mainRange = remapRangeToMainDocument(diagnostic.range, lineMap);
  if (!mainRange) return;
  if (mainRange.start.line < 0 || mainRange.start.line >= lineCount) return;
  out.push({
    ...diagnostic,
    relatedInformation,
    range: { start: mainRange.start, end: mainRange.end },
  });
}

function remapRelatedInformation(
  related: Diagnostic["relatedInformation"],
  lineMap: IncludeLineMapEntry[] | undefined,
  documentUri?: string
): Diagnostic["relatedInformation"] {
  if (!related?.length) return related;
  const out: NonNullable<Diagnostic["relatedInformation"]> = [];
  for (const item of related) {
    const expandedLine = item.location.range.start.line;
    const loc = resolveExpandedLineLocation(lineMap, expandedLine);
    if (loc.kind === "include" && loc.uri) {
      out.push({
        message: item.message,
        location: {
          uri: loc.uri,
          range: {
            start: { line: loc.line, character: item.location.range.start.character },
            end: { line: loc.line, character: item.location.range.end.character },
          },
        },
      });
      continue;
    }
    if (loc.kind === "main" && documentUri) {
      out.push({
        message: item.message,
        location: {
          uri: documentUri,
          range: {
            start: { line: loc.line, character: item.location.range.start.character },
            end: { line: loc.line, character: item.location.range.end.character },
          },
        },
      });
      continue;
    }
    const mainRange = remapRangeToMainDocument(item.location.range, lineMap);
    if (mainRange && documentUri) {
      out.push({
        message: item.message,
        location: { uri: documentUri, range: { start: mainRange.start, end: mainRange.end } },
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

let diagBundleCache:
  | { key: string; bundle: McuDiagnosticsBundle }
  | undefined;

export function collectDiagnosticsBundle(
  doc: TextDocument,
  extraSolverDiags: Diagnostic[] = []
): McuDiagnosticsBundle {
  // Единый разбор варианта: #include встраивается, семантика как у MCU после препроцессора.
  // Координаты редактора — через includeLineMap (main vs файл include).
  const index = ensureDocumentIndex(doc);
  const solverFp =
    extraSolverDiags.length > 0 ? `e${extraSolverDiags.length}` : getCachedSolverResult(index.hash) ? "s" : "0";
  const cacheKey = `${doc.uri}|${doc.version}|${solverFp}`;
  if (diagBundleCache?.key === cacheKey) {
    return diagBundleCache.bundle;
  }
  const lineMap = index.ast.includeLineMap;
  const lineCount = doc.lineCount;
  const out: Diagnostic[] = [];
  const includeGroups: McuIncludeDiagnosticGroup[] = [];
  const astDiagCount = index.ast.diagnostics.length;

  for (const diagMsg of index.ast.diagnostics) {
    routeExpandedDiagnostic(toLspDiagnostic(diagMsg, doc.uri), lineMap, lineCount, out, includeGroups, doc.uri);
  }

  // Solver-диагностики уже в координатах main (remap из LST).
  const solverFromExtra = extraSolverDiags.filter((d) => d.range.start.line < lineCount);
  if (solverFromExtra.length > 0) {
    out.push(...solverFromExtra);
  } else {
    const cached = getCachedSolverResult(index.hash);
    if (cached) {
      out.push(
        ...cached.diagnostics.map((d) => toLspDiagnostic(d)).filter((d) => d.range.start.line < lineCount)
      );
    }
  }

  // AW/THR: полный expanded AST + чтение строк из expanded view; routing через lineMap.
  const expandedView = makeExpandedDocView(doc, index);
  for (const d of collectAwLibMissingDiagnostics(expandedView, index.ast)) {
    routeExpandedDiagnostic(d, lineMap, lineCount, out, includeGroups, doc.uri);
  }
  for (const d of collectDefaultPhyMissingDiagnostics(expandedView, index.ast)) {
    routeExpandedDiagnostic(d, lineMap, lineCount, out, includeGroups, doc.uri);
  }
  for (const d of collectAwLibMassDiagnostics(expandedView, index.ast.materials)) {
    routeExpandedDiagnostic(d, lineMap, lineCount, out, includeGroups, doc.uri);
  }
  for (const d of collectHalfLifeMismatchDiagnostics(expandedView, index.ast.materials)) {
    routeExpandedDiagnostic(d, lineMap, lineCount, out, includeGroups, doc.uri);
  }

  const grouped = groupIncludeDiagnostics(includeGroups);
  for (const group of grouped) {
    if (group.diagnostics.length === 0) continue;
    const errCount = group.diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error).length;
    const warnCount = group.diagnostics.length - errCount;
    const parts: string[] = [];
    if (errCount > 0) parts.push(`${errCount} ошибок`);
    if (warnCount > 0) parts.push(`${warnCount} предупреждений`);
    const includeNode = index.ast.includes.find((inc) => inc.range.start.line === group.mainIncludeLine);
    const range = includeNode
      ? {
          start: { line: includeNode.range.start.line, character: includeNode.range.start.character },
          end: { line: includeNode.range.end.line, character: includeNode.range.end.character },
        }
      : {
          start: { line: group.mainIncludeLine, character: 0 },
          end: { line: group.mainIncludeLine, character: 1 },
        };
    out.push({
      severity: errCount > 0 ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      message: `В ${group.path}: ${parts.join(", ") || `${group.diagnostics.length} диагностик`}`,
      code: "include-diag",
      source: "mcuhelper",
      range,
      relatedInformation: group.diagnostics.slice(0, 20).map((d) => ({
        location: { uri: group.uri, range: d.range },
        message: d.message,
      })),
    });
  }
  out.sort((a, b) =>
    a.range.start.line !== b.range.start.line
      ? a.range.start.line - b.range.start.line
      : a.range.start.character - b.range.start.character
  );
  const bundle = { diagnostics: out, includeGroups: grouped };
  diagBundleCache = { key: cacheKey, bundle };
  return bundle;
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

export interface McuIncludeDiagnosticPayload {
  path: string;
  uri: string;
  mainIncludeLine: number;
  diagnostics: McuDiagnosticPayload[];
}

export interface McuDiagnosticsResponse {
  diagnostics: McuDiagnosticPayload[];
  includeGroups: McuIncludeDiagnosticPayload[];
}

function lspDiagnosticCode(code: Diagnostic["code"]): string | undefined {
  if (code == null) return undefined;
  if (typeof code === "string" || typeof code === "number") return String(code);
  const obj = code as { value?: string | number };
  return obj.value != null ? String(obj.value) : undefined;
}

/** Диагностики единого варианта (#include развёрнут); include → отдельная группа. */
export function handleGetDiagnostics(
  uri: string,
  getDoc: (uri: string) => TextDocument | undefined,
  extraSolverDiags: Diagnostic[] = []
): McuDiagnosticsResponse {
  const doc = getDoc(uri);
  if (!doc) return { diagnostics: [], includeGroups: [] };
  const bundle = collectDiagnosticsBundle(doc, extraSolverDiags);
  const mapped = {
    diagnostics: bundle.diagnostics.map((d) => ({
      severity: d.severity ?? DiagnosticSeverity.Error,
      message: d.message,
      code: lspDiagnosticCode(d.code),
      source: d.source ?? "mcuhelper",
      range: d.range,
    })),
    includeGroups: bundle.includeGroups.map((group) => ({
      path: group.path,
      uri: group.uri,
      mainIncludeLine: group.mainIncludeLine,
      diagnostics: group.diagnostics.map((d) => ({
        severity: d.severity ?? DiagnosticSeverity.Error,
        message: d.message,
        code: lspDiagnosticCode(d.code),
        source: d.source ?? "mcuhelper",
        range: d.range,
      })),
    })),
  };
  return mapped;
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

export function buildFoldingRanges(index: DocumentIndex, documentLineCount?: number): FoldingRange[] {
  const lineMap = index.ast.includeLineMap;
  const ranges: FoldingRange[] = [];
  for (const fragment of index.ast.fragments) {
    const startLine = mapExpandedLineToMain(lineMap, fragment.startLine);
    const endLine = mapExpandedLineToMain(lineMap, fragment.endLine);
    if (startLine == null || endLine == null || endLine <= startLine) continue;
    ranges.push({
      startLine,
      endLine,
      kind: FoldingRangeKind.Region,
    });
  }
  for (const r of buildMaterialFoldingRanges(index)) {
    const startLine = mapExpandedLineToMain(lineMap, r.startLine);
    const endLine = mapExpandedLineToMain(lineMap, r.endLine);
    if (startLine == null || endLine == null || endLine <= startLine) continue;
    ranges.push({ ...r, startLine, endLine });
  }
  for (const r of buildLatticeFoldingRanges(index)) {
    const startLine = mapExpandedLineToMain(lineMap, r.startLine);
    const endLine = mapExpandedLineToMain(lineMap, r.endLine);
    if (startLine == null || endLine == null || endLine <= startLine) continue;
    ranges.push({ ...r, startLine, endLine });
  }
  const sorted = ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  return documentLineCount != null ? clampFoldingRangesToDocument(sorted, documentLineCount) : sorted;
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

/** Порог children в summaries: выше — только счётчики (без списка нуклидов). */
export const INDEX_NUCLIDE_SOFT_LIMIT = 2_000;
/**
 * Порог decoration-марок в getIndex. Выше — пустой массив (не режем «первые N»:
 * иначе full-core всё равно гоняет remap×N и раздувает IPC).
 * 8k > типичный 958 (~3k SI), << full-core (~268k).
 */
export const INDEX_MARKS_HARD_LIMIT = 8_000;

/** На full-core нуклиды в summaries раздувают JSON — для UI оставляем счётчики.
 * Раньше оставляли только SI — на SIDEN/полном SI list это = почти все нуклиды (3l070626 ≈ 268k). */
export function slimSummariesForIndex<T extends DocumentIndex["summaries"]>(summaries: T): T {
  const nuc = summaries.materials.reduce((n, m) => n + m.nuclides.length, 0);
  if (nuc <= INDEX_NUCLIDE_SOFT_LIMIT) return summaries;
  return {
    ...summaries,
    materials: summaries.materials.map((m) => ({
      ...m,
      nuclides: [] as typeof m.nuclides,
    })),
  };
}

/** Если марок больше лимита — не отдаём ни одной (sidebar/IPC не должны тащить full-core SI). */
export function capIndexMarksForPayload<T>(marks: readonly T[]): T[] {
  if (marks.length > INDEX_MARKS_HARD_LIMIT) return [];
  return marks.slice();
}

function collectStableIsotopeMarks(
  index: DocumentIndex,
  maxMarks?: number,
  lineFrom?: number,
  lineTo?: number
) {
  const out: Array<{
    name: string;
    concentration: string;
    range: DocumentIndex["ast"]["materials"][number]["nuclides"][number]["range"];
  }> = [];
  for (const mat of index.ast.materials) {
    if (
      lineFrom != null &&
      lineTo != null &&
      !mat.nuclides.some((n) => n.range.start.line >= lineFrom && n.range.start.line <= lineTo)
    ) {
      continue;
    }
    for (const n of mat.nuclides) {
      if (lineFrom != null && n.range.start.line < lineFrom) continue;
      if (lineTo != null && n.range.start.line > lineTo) continue;
      const thr = getParameteThrForMcuNuclide(n.name);
      if (!thr || thr.hasHalfLife) continue;
      out.push({
        name: n.name,
        concentration: n.density,
        range: n.range,
      });
      if (maxMarks != null && out.length > maxMarks) return out;
    }
  }
  return out;
}

type EditorMark = {
  name: string;
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  reasons?: string[];
  inAwLib?: boolean;
};

function projectMarksToEditor(
  index: DocumentIndex,
  marks: ReadonlyArray<{
    name: string;
    range: DocumentIndex["ast"]["materials"][number]["nuclides"][number]["range"];
    reasons?: string[];
    inAwLib?: boolean;
  }>
): EditorMark[] {
  const out: EditorMark[] = [];
  for (const m of marks) {
    const loc = rangeToEditorLocation(index, m.range);
    if (!loc) continue;
    out.push({
      name: m.name,
      uri: loc.uri,
      reasons: m.reasons,
      inAwLib: m.inAwLib,
      range: {
        start: { line: loc.range.start.line, character: loc.range.start.character },
        end: { line: loc.range.end.line, character: loc.range.end.character },
      },
    });
  }
  return out;
}

export function collectEditorIsotopeMarks(
  index: DocumentIndex,
  visibleStart?: number,
  visibleEnd?: number
): { sumIsotopeMarks: EditorMark[]; stableIsotopeMarks: EditorMark[]; skipFullScan: boolean } {
  const nucCount = index.summaries.materials.reduce((n, m) => n + (m.nuclideCount ?? 0), 0);
  const hasViewport = visibleStart != null && visibleEnd != null && visibleEnd >= visibleStart;
  const lineFrom = hasViewport ? Math.max(0, visibleStart - 20) : undefined;
  const lineTo = hasViewport ? visibleEnd + 40 : undefined;
  const skipFullScan = !hasViewport && nucCount > 100_000;
  if (skipFullScan) {
    return { sumIsotopeMarks: [], stableIsotopeMarks: [], skipFullScan: true };
  }
  const rawSum = collectSumIsotopeMarks(index.ast, {
    maxMarks: INDEX_MARKS_HARD_LIMIT,
    lineFrom,
    lineTo,
  });
  const rawStable = collectStableIsotopeMarks(index, INDEX_MARKS_HARD_LIMIT, lineFrom, lineTo);
  const sumIsotopeMarks = projectMarksToEditor(index, rawSum.slice(0, INDEX_MARKS_HARD_LIMIT));
  const stableIsotopeMarks = projectMarksToEditor(index, rawStable.slice(0, INDEX_MARKS_HARD_LIMIT));
  return {
    sumIsotopeMarks,
    stableIsotopeMarks,
    skipFullScan: false,
  };
}

/** Марки SI: на full-core не парсим 16MB — это очередь validate/линтера. */
function resolveIndexForViewportMarks(
  uri: string,
  getDoc: (uri: string) => TextDocument | undefined
): { index: DocumentIndex | undefined; usedStale: boolean; docVersion: number | null; cacheVersion: number | null; lineCount: number | null } {
  const doc = getDoc(uri);
  const cached = getDocumentIndex(uri);
  if (!doc) {
    return {
      index: cached,
      usedStale: false,
      docVersion: null,
      cacheVersion: cached?.version ?? null,
      lineCount: null,
    };
  }
  const current = getDocumentIndexForVersion(uri, doc.version);
  if (current) {
    return {
      index: current,
      usedStale: false,
      docVersion: doc.version,
      cacheVersion: current.version,
      lineCount: doc.lineCount,
    };
  }
  if (doc.lineCount > SOURCE_REPARSE_LINE_THRESHOLD && cached) {
    return {
      index: cached,
      usedStale: true,
      docVersion: doc.version,
      cacheVersion: cached.version,
      lineCount: doc.lineCount,
    };
  }
  return {
    index: ensureDocumentIndex(doc),
    usedStale: false,
    docVersion: doc.version,
    cacheVersion: doc.version,
    lineCount: doc.lineCount,
  };
}

export function handleGetIsotopeMarks(
  args: { uri: string; visibleStart?: number; visibleEnd?: number },
  getDoc: (uri: string) => TextDocument | undefined
): { sumIsotopeMarks: EditorMark[]; stableIsotopeMarks: EditorMark[] } | null {
  const resolved = resolveIndexForViewportMarks(args.uri, getDoc);
  if (!resolved.index) return null;
  const marks = collectEditorIsotopeMarks(resolved.index, args.visibleStart, args.visibleEnd);
  return { sumIsotopeMarks: marks.sumIsotopeMarks, stableIsotopeMarks: marks.stableIsotopeMarks };
}

const navStatementsByHash = new Map<string, NavStatementPayload[]>();

function cachedProjectNavStatements(index: DocumentIndex): NavStatementPayload[] {
  const hit = navStatementsByHash.get(index.hash);
  if (hit) return hit;
  const out = projectNavStatements(index);
  navStatementsByHash.set(index.hash, out);
  if (navStatementsByHash.size > 8) {
    const oldest = navStatementsByHash.keys().next().value;
    if (oldest != null) navStatementsByHash.delete(oldest);
  }
  return out;
}

export function handleGetIndex(
  args:
    | string
    | {
        uri: string;
        line?: number;
        character?: number;
        mode?: "full" | "constants";
        visibleStart?: number;
        visibleEnd?: number;
      },
  getDoc: (uri: string) => TextDocument | undefined
) {
  const uri = typeof args === "string" ? args : args.uri;
  const line = typeof args === "object" ? args.line : undefined;
  const character = typeof args === "object" ? args.character : undefined;
  const mode = typeof args === "object" ? args.mode ?? "full" : "full";
  const visibleStart = typeof args === "object" ? args.visibleStart : undefined;
  const visibleEnd = typeof args === "object" ? args.visibleEnd : undefined;
  const index = resolveDocumentIndex(uri, getDoc);
  if (!index) return null;
  if (index.summariesSourceHash !== index.hash) {
    index.summaries = buildSummaries(index.ast);
    index.summariesSourceHash = index.hash;
  }

  let summaries = { ...index.summaries };
  let editorContext: { line: number; character: number; scope: string } | undefined;

  if (line != null && line >= 0) {
    const expandedLine = mapMainLineToExpanded(index.ast.includeLineMap, line);
    const scope = resolveScopeAtLine(index.ast.statements, expandedLine);
    const char = character ?? Number.MAX_SAFE_INTEGER;
    editorContext = { line, character: char, scope };
    summaries.constants = listVisibleConstants(index.ast.constants, scope, expandedLine, char);
  }
  summaries.constants = projectNavConstants(index, summaries.constants);
  if (mode === "constants") {
    return {
      summaries: {
        ...summaries,
        materials: [],
        zones: [],
        objects: [],
        bodies: [],
        nets: [],
        lattices: [],
      },
      fragments: [],
      statements: [],
      includes: [],
      includeGraph: [],
      hash: index.hash,
      editorContext,
      sumIsotopeMarks: [],
      stableIsotopeMarks: [],
    };
  }
  /** Slim до projectNavMaterials: иначе full-core гоняет remap по всем нуклидам, потом выкидывает. */
  summaries = slimSummariesForIndex(summaries);
  summaries.materials = projectNavMaterials(index, summaries.materials);
  summaries.zones = projectNavZones(index, summaries.zones);
  summaries.bodies = projectNavBodies(index, summaries.bodies);
  summaries.nets = projectNavNets(index, summaries.nets);
  summaries.lattices = projectNavLattices(index, summaries.lattices);

  const nucCount = summaries.materials.reduce((n, m) => n + (m.nuclideCount ?? 0), 0);
  const viewportMarks = collectEditorIsotopeMarks(index, visibleStart, visibleEnd);
  const sumIsotopeMarks = viewportMarks.sumIsotopeMarks;
  const stableIsotopeMarks = viewportMarks.stableIsotopeMarks;
  const skipMarksScan = viewportMarks.skipFullScan;
  const statementsCached = navStatementsByHash.has(index.hash);
  const statements = cachedProjectNavStatements(index);
  const includes = projectNavIncludes(index);
  const includeGraph = projectIncludeGraph(index);
  const lineMap = index.ast.includeLineMap;
  const fragments = index.ast.fragments.map((f) => remapFragmentSpanForEditor(f, lineMap));

  return {
    summaries,
    fragments,
    statements,
    includes,
    includeGraph,
    hash: index.hash,
    editorContext,
    sumIsotopeMarks,
    stableIsotopeMarks,
  };
}

/** Только граф `#include` (без полного payload getIndex). */
export function handleGetIncludeGraph(
  args: string | { uri: string },
  getDoc: (uri: string) => TextDocument | undefined
): IncludeGraphNode[] | null {
  const uri = typeof args === "string" ? args : args.uri;
  const index = resolveDocumentIndex(uri, getDoc);
  if (!index) return null;
  return projectIncludeGraph(index);
}

export function handleGetGeometry(
  args: string | { uri: string; line?: number; character?: number },
  getDoc: (uri: string) => TextDocument | undefined
) {
  const uri = typeof args === "string" ? args : args?.uri;
  if (!uri) return null;
  const index = resolveDocumentIndex(uri, getDoc);
  if (!index) return null;
  let scope: string | undefined;
  if (typeof args === "object" && args && args.line != null && args.line >= 0) {
    const expandedLine = mapMainLineToExpanded(index.ast.includeLineMap, args.line);
    scope = resolveScopeAtLine(index.ast.statements, expandedLine);
  }
  return buildScene(index.ast, { scope });
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

export interface RunMcuStepArgs {
  uri: string;
  variantName: string;
  mode: McuMode;
  mcuNrPath?: string;
  constantsLibPath?: string;
  /** true = только подготовить runDir/mcu5.ini (запуск в терминале делает extension). */
  prepareOnly?: boolean;
  /** После terminal-run: собрать diagnostics из LST без повторной подготовки. */
  collectOnly?: boolean;
  runDir?: string;
  sourceFsPath?: string;
  exitCode?: number | null;
}

interface RunSession {
  runDir: string;
  deckHash: string;
  variantName: string;
  lastMode: McuMode;
  createdAt: number;
}

const runSessions = new Map<string, RunSession>();

const SESSION_FILE = ".mcuhelper-session.json";

function runsRootDir(baseDir: string): string {
  return path.join(baseDir, ".mcuhelper-runs");
}

function ensureDir(p: string): void {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
    // ignore
  }
}

function sessionFilePath(runDir: string): string {
  return path.join(runDir, SESSION_FILE);
}

function writeRunSessionFile(session: RunSession): void {
  try {
    fs.writeFileSync(
      sessionFilePath(session.runDir),
      JSON.stringify(
        {
          variantName: session.variantName,
          deckHash: session.deckHash,
          lastMode: session.lastMode,
          createdAt: session.createdAt,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch {
    // ignore
  }
}

function readRunSessionFile(runDir: string): RunSession | undefined {
  try {
    const p = sessionFilePath(runDir);
    if (!fs.existsSync(p)) return undefined;
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<RunSession>;
    if (typeof raw.variantName !== "string" || typeof raw.deckHash !== "string") return undefined;
    return {
      runDir,
      variantName: raw.variantName,
      deckHash: raw.deckHash,
      lastMode: (raw.lastMode as McuMode) ?? "i",
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    };
  } catch {
    return undefined;
  }
}

/** Есть ли промежуточные артефакты MCU для Continue/Final. */
export function hasVariantRunArtifacts(runDir: string, variantName: string): boolean {
  if (findVariantArtifactInDir(runDir, variantName, "dat")) return true;
  if (findVariantArtifactInDir(runDir, variantName, "mcu")) return true;
  try {
    const prefix = `${variantName}.mcu_`.toLowerCase();
    for (const entry of fs.readdirSync(runDir)) {
      if (entry.toLowerCase().startsWith(prefix)) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function isRunSessionKeyMatch(session: RunSession, variantName: string, deckHash: string): boolean {
  return session.variantName === variantName && session.deckHash === deckHash;
}

/**
 * Resolve session for continue/final: memory → disk json → artifacts fallback.
 * @returns session or error message
 */
export function resolveContinueFinalSession(options: {
  uri: string;
  runDir: string;
  variantName: string;
  deckHash: string;
  mode: McuMode;
}): { session: RunSession } | { message: string } {
  const { uri, runDir, variantName, deckHash, mode } = options;
  const existing = runSessions.get(uri);
  if (existing) {
    if (!isRunSessionKeyMatch(existing, variantName, deckHash)) {
      return {
        message:
          "Содержимое варианта изменилось после INPUT. Выполните INPUT ещё раз, чтобы продолжение было корректным.",
      };
    }
    return { session: existing };
  }

  const fromDisk = readRunSessionFile(runDir);
  if (fromDisk) {
    if (!isRunSessionKeyMatch(fromDisk, variantName, deckHash)) {
      return {
        message:
          "Содержимое варианта изменилось после INPUT. Выполните INPUT ещё раз, чтобы продолжение было корректным.",
      };
    }
    const session: RunSession = { ...fromDisk, runDir, lastMode: mode };
    runSessions.set(uri, session);
    return { session };
  }

  if (hasVariantRunArtifacts(runDir, variantName)) {
    const session: RunSession = {
      runDir,
      deckHash,
      variantName,
      lastMode: mode,
      createdAt: Date.now(),
    };
    runSessions.set(uri, session);
    writeRunSessionFile(session);
    return { session };
  }

  return {
    message:
      "Сначала выполните режим INPUT (debug/input), затем запускайте расчёт (CALCULATION/OUTPUT/continue).",
  };
}

/** Полная очистка runDir перед INPUT / Run (`a`): всё кроме копии deck (её перезапишет prepare). */
function cleanupRunDirFull(runDir: string, variantName: string): void {
  const expectedPrefix = `${variantName}.`;
  for (const entry of fs.readdirSync(runDir)) {
    // Копию deck (`burnup` без расширения) не трогаем здесь — её перезапишет prepare.
    if (entry === variantName) continue;
    if (entry === SESSION_FILE) continue;
    if (entry.startsWith(expectedPrefix)) {
      deleteQuietly(path.join(runDir, entry));
      continue;
    }
    // общие мусорные файлы
    if (
      entry === "end_time" ||
      entry === "step_end" ||
      entry === "no_sigma" ||
      entry === "energy.fis" ||
      entry === "mcuname" ||
      entry === "mcu5.ini" ||
      entry === "MCU5.INI" ||
      entry === "mcu5.sys" ||
      entry === "MCU5.SYS"
    ) {
      // ini перепишем перед запуском; mcu5.sys больше не используем
      deleteQuietly(path.join(runDir, entry));
      continue;
    }
    if (entry.endsWith(".bur")) deleteQuietly(path.join(runDir, entry));
  }
}

function cleanupRunDirForFinal(runDir: string, variantName: string): void {
  deleteVariantArtifact(runDir, variantName, "fin");
  deleteVariantArtifact(runDir, variantName, "lst");
}

function deleteQuietly(p: string): void {
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

export async function handleRunMcuStep(
  args: RunMcuStepArgs,
  settings: McuServerSettings,
  getDoc: (uri: string) => TextDocument | undefined
): Promise<{
  ok: boolean;
  exitCode?: number | null;
  diagnosticCount?: number;
  message?: string;
  solverResult?: SolverResult;
  runDir?: string;
  mcuNrPath?: string;
  sourceFsPath?: string;
  prepared?: boolean;
  /** После успешного Run/Final: путь к копии NAME.FIN рядом с исходником. */
  finCopiedPath?: string;
  finOverwritten?: boolean;
  /** Путь к NAME.LST в temp-run (для открытия в редакторе). */
  lstPath?: string;
}> {
  const doc = getDoc(args.uri);
  if (!doc) return { ok: false, message: "Document not open" };

  if (args.collectOnly) {
    const sourceFsPath = args.sourceFsPath ?? uriToFsPath(args.uri);
    const runDir = args.runDir;
    if (!runDir) return { ok: false, message: "collectOnly: не передан runDir" };
    const index = ensureDocumentIndex(doc);
    const result = collectMcuRunResult({
      workingDir: runDir,
      variantName: args.variantName,
      sourceFsPath,
      exitCode: args.exitCode ?? null,
    });
    setCachedSolverResult(index.hash, result);

    let finCopiedPath: string | undefined;
    let finOverwritten: boolean | undefined;
    const success = isSuccessfulMcuCollect(args.exitCode, result.diagnostics);
    // Run / Final: при успехе копируем FIN к исходному варианту.
    if ((args.mode === "c" || args.mode === "f") && success) {
      const copied = copyFinBesideSource(runDir, args.variantName, sourceFsPath);
      if (copied) {
        finCopiedPath = copied.path;
        finOverwritten = copied.overwritten;
      }
    }

    return {
      ok: success,
      exitCode: result.exitCode,
      diagnosticCount: result.diagnostics.length,
      solverResult: result,
      runDir,
      sourceFsPath,
      finCopiedPath,
      finOverwritten,
      lstPath: result.lstPath,
    };
  }

  const constantsLibPath = args.constantsLibPath ?? settings.mcuConstantsLibPath;
  const mcuNrPath = args.mcuNrPath ?? settings.mcuNrPath;
  if (!mcuNrPath) return { ok: false, message: "Укажите mcuhelper.mcuNrPath (путь к exe)" };
  if (!constantsLibPath) return { ok: false, message: "Укажите mcuhelper.mcuConstantsLibPath (путь к MDBNR)" };

  const variantName = args.variantName;
  const sourceFsPath = uriToFsPath(args.uri);
  if (!sourceFsPath || sourceFsPath.startsWith("untitled:")) {
    return { ok: false, message: "Сохраните файл варианта на диск перед запуском MCU-NR" };
  }
  if (!fs.existsSync(sourceFsPath)) {
    return { ok: false, message: `Файл варианта не найден на диске: ${sourceFsPath}` };
  }

  const index = ensureDocumentIndex(doc);
  const deckHash = index.hash;

  const mode = args.mode;
  const baseDir = uriToBaseDir(args.uri);
  const root = runsRootDir(baseDir);
  ensureDir(root);

  // Стабильный каталог: .mcuhelper-runs/<variantName> (без timestamp/hash).
  const runDir = path.join(root, variantName);
  ensureDir(runDir);

  if (mode === "i" || mode === "c") {
    cleanupRunDirFull(runDir, variantName);
    const session: RunSession = {
      runDir,
      deckHash,
      variantName,
      lastMode: mode,
      createdAt: Date.now(),
    };
    runSessions.set(args.uri, session);
    writeRunSessionFile(session);
  } else {
    const resolved = resolveContinueFinalSession({
      uri: args.uri,
      runDir,
      variantName,
      deckHash,
      mode,
    });
    if ("message" in resolved) {
      return { ok: false, message: resolved.message };
    }
    if (mode === "f") {
      cleanupRunDirForFinal(runDir, variantName);
    }
  }

  const stepKey = mcuModeToStepKey(mode);

  if (args.prepareOnly) {
    prepareMcuRunFiles({
      workingDir: runDir,
      variantName,
      constantsLibPath,
      sourceFsPath,
      stepKey,
    });
    return {
      ok: true,
      prepared: true,
      runDir,
      mcuNrPath,
      sourceFsPath,
      diagnosticCount: 0,
    };
  }

  const result = await runMcuStep({
    mcuNrPath,
    workingDir: runDir,
    variantName,
    constantsLibPath,
    sourceFsPath,
    stepKey,
  });

  if (index) setCachedSolverResult(index.hash, result);
  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    diagnosticCount: result.diagnostics.length,
    solverResult: result,
    runDir,
    mcuNrPath,
    sourceFsPath,
    lstPath: result.lstPath,
  };
}

export function applyServerSettings(
  target: McuServerSettings,
  cfg: Record<string, unknown>
): void {
  if (typeof cfg.mcuNrPath === "string") target.mcuNrPath = cfg.mcuNrPath;
  if (typeof cfg.mcuConstantsLibPath === "string") target.mcuConstantsLibPath = cfg.mcuConstantsLibPath;
  if (typeof cfg.enableSolverValidation === "boolean") {
    target.enableSolverValidation = cfg.enableSolverValidation;
  }
  if (typeof cfg.variantName === "string") target.variantName = cfg.variantName;
}

export function syncSettingsFromInitialize(
  target: McuServerSettings,
  initializationOptions?: Record<string, unknown>
): void {
  if (initializationOptions && typeof initializationOptions === "object") {
    applyServerSettings(target, initializationOptions);
  }
}
