import * as fs from "fs";
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
  collectSumIsotopeMarks,
  type DocumentIndex,
  type DiagnosticMessage,
} from "@mcuhelper/mcu-language";
import { isGeoBodyLabel } from "@mcuhelper/mcu-schema";
import { buildScene, buildSliceGrid, queryPoint } from "@mcuhelper/mcu-geometry";
import type { SliceAxis } from "@mcuhelper/mcu-geometry";
import { SymbolInformation, SymbolKind, Diagnostic, DiagnosticSeverity, FoldingRange, FoldingRangeKind, DocumentLink } from "vscode-languageserver";
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

export interface McuServerSettings {
  mcuNrPath: string;
  mcuConstantsLibPath: string;
  enableSolverValidation: boolean;
  variantName: string;
  enableIaeaNuclideHover: boolean;
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

/** Единая точка получения индекса: version-cache в analyzeDocument + проверка version. */
export function ensureDocumentIndex(doc: TextDocument): DocumentIndex {
  const uri = doc.uri;
  const text = doc.getText();
  // Без #include expanded≡source — один parse на diagnostics+getIndex. С include нужен expand.
  const expandInclude = /#\s*include\b/i.test(text);
  const cached = getDocumentIndex(uri, expandInclude);
  if (cached && cached.version === doc.version) {
    return cached;
  }
  const t0 = performance.now();
  const textLen = text.length;
  const baseDir = uriToBaseDir(uri);
  const index = analyzeDocument(uri, text, doc.version, { baseDir, expandInclude });
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
  // Всегда source (без expand): иначе диагностики из #include «прилипают» к строкам исходника.
  const index = analyzeDocument(doc.uri, doc.getText(), doc.version, { baseDir, expandInclude: false });
  const lineCount = doc.lineCount;
  const diags = index.ast.diagnostics
    .map(toLspDiagnostic)
    .filter((d) => d.range.start.line < lineCount);

  // Solver-диагностики: либо уже переданы в extra (после runMcuStep), либо из кэша.
  // Не мержить оба источника — иначе дубли (одна и та же ошибка дважды).
  const solverFromExtra = extraSolverDiags.filter((d) => d.range.start.line < lineCount);
  let out: Diagnostic[];
  if (solverFromExtra.length > 0) {
    out = [...diags, ...solverFromExtra];
  } else {
    const cached = getCachedSolverResult(index.hash);
    if (cached) {
      diags.push(
        ...cached.diagnostics.map(toLspDiagnostic).filter((d) => d.range.start.line < lineCount)
      );
    }
    out = diags;
  }
  return out;
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

const INDEX_NUCLIDE_SOFT_LIMIT = 20_000;

/** На full-core нуклиды в summaries раздувают JSON до 100+ МБ — для UI оставляем счётчики.
 * Нуклиды суммарного изотопа оставляем (серый UI / sidebar muted). */
export function slimSummariesForIndex<T extends DocumentIndex["summaries"]>(summaries: T): T {
  const nuc = summaries.materials.reduce((n, m) => n + m.nuclides.length, 0);
  if (nuc <= INDEX_NUCLIDE_SOFT_LIMIT) return summaries;
  return {
    ...summaries,
    materials: summaries.materials.map((m) => ({
      ...m,
      nuclides: m.nuclides.filter((n) => Boolean(n.sumIsotope)) as typeof m.nuclides,
    })),
  };
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

  let summaries = { ...index.summaries };
  let editorContext: { line: number; character: number; scope: string } | undefined;

  if (line != null && line >= 0) {
    const scope = resolveScopeAtLine(index.ast.statements, line);
    const char = character ?? Number.MAX_SAFE_INTEGER;
    editorContext = { line, character: char, scope };
    summaries.constants = listVisibleConstants(index.ast.constants, scope, line, char);
  }

  /** Компактный список для decorations — не зависит от slim nuclides. */
  const sumIsotopeMarks = collectSumIsotopeMarks(index.ast).map((m) => ({
    name: m.name,
    concentration: m.concentration,
    range: m.range,
    reasons: m.reasons,
  }));

  summaries = slimSummariesForIndex(summaries);
  const statements = selectNavStatements(index);
  return {
    summaries,
    fragments: index.ast.fragments,
    statements,
    hash: index.hash,
    editorContext,
    sumIsotopeMarks,
  };
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
