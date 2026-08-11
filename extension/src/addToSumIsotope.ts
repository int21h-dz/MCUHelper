/**
 * Добавление нуклида в суммарный изотоп (карта SI / правка SINOT).
 * UserGuide §8.5: SI list / SINOT list / SIDEN.
 *
 * Учитывает `#include`: активная SI/SINOT может быть во включаемом файле.
 * Упаковывает список в строки с code-частью ≤ 200 (как lexer `line-length`).
 */

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import * as vscode from "vscode";
import { findPinLine, lineStatementLabel } from "./defInsertPosition";
import { readTextFileWithDetectedEncoding } from "./encodingDetect";
import { isMcunrDocument } from "./contentDetect";

export interface AddToSumIsotopeArgs {
  uri: string;
  /** 0-based строка нуклида / диагностики в документе `uri`. */
  line: number;
  nuclideName: string;
}

/** Лимит длины code-части строки MCU (до `;`), см. lexer `line-length`. */
export const MCU_MAX_CODE_LINE_LENGTH = 200;

export type AddToSumIsotopePlan =
  | { kind: "already"; message: string }
  | {
      kind: "replace-range";
      uri: string;
      startLine: number;
      /** Inclusive. */
      endLine: number;
      newText: string;
      message: string;
    }
  | {
      kind: "insert-line";
      uri: string;
      beforeLine: number;
      text: string;
      message: string;
    };

/** @deprecated совместимость со старыми тестами — см. replace-range / insert-line с uri. */
export type LegacyAddToSumIsotopePlan =
  | { kind: "already"; message: string }
  | { kind: "replace-line"; line: number; newText: string; message: string }
  | { kind: "insert-line"; beforeLine: number; text: string; message: string };

const DENSITY_RE = /^[\d.Ee+-]+$/;
const INCLUDE_LINE_RE = /^\s*#include\s+(?:<([^>]+)>|(\S+))/i;

export interface ExpandedLine {
  text: string;
  editUri: string;
  editLine: number;
  /** Директива `#include` в main — не карта. */
  isIncludeDirective?: boolean;
}

export interface IncludeLoadResult {
  uri: string;
  lines: string[];
}

function looksLikeDens(token: string): boolean {
  if (DENSITY_RE.test(token)) return true;
  return /^[+\-.(0-9]/.test(token);
}

function isSiCardLine(text: string): boolean {
  const code = text.replace(/;.*/, "").trim();
  if (!code) return false;
  const tokens = code.split(/[\s,]+/).filter(Boolean);
  if (tokens[0]?.toUpperCase() !== "SI") return false;
  if (tokens.length === 1) return true;
  return !looksLikeDens(tokens[1]!);
}

function isSinotCardLine(text: string): boolean {
  const code = text.replace(/;.*/, "").trim();
  if (!code) return false;
  return code.split(/[\s,]+/).filter(Boolean)[0]?.toUpperCase() === "SINOT";
}

function isSidenCardLine(text: string): boolean {
  const code = text.replace(/;.*/, "").trim();
  if (!code) return false;
  return code.split(/[\s,]+/).filter(Boolean)[0]?.toUpperCase() === "SIDEN";
}

function splitCodeComment(line: string): { code: string; comment: string } {
  const idx = line.indexOf(";");
  if (idx < 0) return { code: line, comment: "" };
  return { code: line.slice(0, idx), comment: line.slice(idx) };
}

/** Длина code-части (до `;`), как в lexer. */
export function codePartLength(raw: string): number {
  const semi = raw.indexOf(";");
  return semi >= 0 ? semi : raw.length;
}

function tokensAfterLabel(code: string): string[] {
  const parts = code.trim().split(/[\s,]+/).filter(Boolean);
  return parts.length <= 1 ? [] : parts.slice(1);
}

function listHasName(tokens: string[], name: string): boolean {
  const u = name.toUpperCase();
  return tokens.some((t) => t.toUpperCase() === u);
}

function parseIncludePath(line: string): string | null {
  const m = line.match(INCLUDE_LINE_RE);
  if (!m) return null;
  return (m[1] ?? m[2])?.trim() || null;
}

function isContinuationLine(text: string): boolean {
  if (!text.length || (text[0] !== " " && text[0] !== "\t")) return false;
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith("**") || /^[Cc]=/.test(t)) return false;
  return true;
}

/**
 * Упаковка SI/SINOT в одну или несколько строк (continuation с ведущим пробелом),
 * code-часть каждой ≤ maxCodeLen.
 */
export function packSumCardLines(
  label: "SI" | "SINOT",
  tokens: string[],
  comment = "",
  maxCodeLen = MCU_MAX_CODE_LINE_LENGTH
): string[] {
  if (tokens.length === 0) {
    const alone = label;
    if (comment && codePartLength(alone) + 2 + comment.trimStart().length <= maxCodeLen) {
      const gap = comment.startsWith(";") ? "  " : " ";
      return [`${alone}${gap}${comment.trimStart()}`];
    }
    return [alone];
  }

  const out: string[] = [];
  let current: string = label;
  for (const tok of tokens) {
    const candidate = `${current} ${tok}`;
    if (codePartLength(candidate) <= maxCodeLen) {
      current = candidate;
      continue;
    }
    out.push(current);
    current = ` ${tok}`;
    // Один токен длиннее лимита — всё равно пишем (иначе потеряем имя).
  }
  out.push(current);

  if (comment) {
    const trimmed = comment.trimStart();
    const gap = trimmed.startsWith(";") ? "  " : " ";
    const withComment = `${out[0]}${gap}${trimmed}`;
    if (codePartLength(withComment) <= maxCodeLen) {
      out[0] = withComment;
    } else {
      const last = out[out.length - 1]!;
      const lastWith = `${last}${gap}${trimmed}`;
      if (codePartLength(lastWith) <= maxCodeLen) {
        out[out.length - 1] = lastWith;
      }
      // иначе комментарий не переносим — важнее уложиться в 200
    }
  }
  return out;
}

export function rebuildSumCardText(
  label: "SI" | "SINOT",
  tokens: string[],
  comment = "",
  maxCodeLen = MCU_MAX_CODE_LINE_LENGTH
): string {
  return packSumCardLines(label, tokens, comment, maxCodeLen).join("\n");
}

function includePathCandidates(includePath: string): string[] {
  const trimmed = includePath.trim();
  if (!trimmed) return [];
  const out = [trimmed];
  if (!path.extname(trimmed)) {
    out.push(`${trimmed}.mcu`, `${trimmed}.mcunr`);
  }
  return out;
}

export function resolveIncludeFsPath(
  baseDir: string,
  includePath: string
): { fsPath: string; exists: boolean } {
  for (const rel of includePathCandidates(includePath)) {
    const full = path.isAbsolute(rel) ? rel : path.join(baseDir, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return { fsPath: full, exists: true };
    }
  }
  const fallback = includePathCandidates(includePath)[0] ?? includePath;
  const full = path.isAbsolute(fallback) ? fallback : path.join(baseDir, fallback);
  return { fsPath: full, exists: false };
}

/** Развернуть main + тела `#include` в плоский список с привязкой к файлу правки. */
export function expandLinesForSumIsotope(
  mainUri: string,
  mainLines: readonly string[],
  loadInclude: (includePath: string) => IncludeLoadResult | null
): ExpandedLine[] {
  const out: ExpandedLine[] = [];
  for (let i = 0; i < mainLines.length; i++) {
    const text = mainLines[i] ?? "";
    const incPath = parseIncludePath(text);
    if (incPath) {
      out.push({ text, editUri: mainUri, editLine: i, isIncludeDirective: true });
      const loaded = loadInclude(incPath);
      if (!loaded) continue;
      for (let j = 0; j < loaded.lines.length; j++) {
        out.push({ text: loaded.lines[j] ?? "", editUri: loaded.uri, editLine: j });
      }
      continue;
    }
    out.push({ text, editUri: mainUri, editLine: i });
  }
  return out;
}

type ListMode = "si" | "sinot" | "none";

type CardLoc = {
  listMode: ListMode;
  list: string[];
  /** Expanded index of card header. */
  headerExpandedIndex: number | null;
  /** Inclusive expanded end (header + continuations). */
  endExpandedIndex: number | null;
  lastSumExpandedIndex: number | null;
};

function collectCardTokens(
  expanded: readonly ExpandedLine[],
  start: number
): { tokens: string[]; end: number; comment: string } {
  const first = expanded[start]!;
  const { code, comment } = splitCodeComment(first.text);
  const tokens = tokensAfterLabel(code);
  let end = start;
  for (let i = start + 1; i < expanded.length; i++) {
    const line = expanded[i]!;
    if (line.isIncludeDirective) break;
    // Continuation только в том же файле
    if (line.editUri !== first.editUri) break;
    if (line.editLine !== first.editLine + (i - start)) break;
    if (!isContinuationLine(line.text)) break;
    const { code: contCode } = splitCodeComment(line.text);
    tokens.push(...contCode.trim().split(/[\s,]+/).filter(Boolean));
    end = i;
  }
  return { tokens, end, comment };
}

function scanExpandedBefore(expanded: readonly ExpandedLine[], beforeExpandedIndex: number): CardLoc {
  const state: CardLoc = {
    listMode: "none",
    list: [],
    headerExpandedIndex: null,
    endExpandedIndex: null,
    lastSumExpandedIndex: null,
  };
  const end = Math.max(0, Math.min(beforeExpandedIndex, expanded.length));
  let i = 0;
  while (i < end) {
    const line = expanded[i]!;
    if (line.isIncludeDirective) {
      i++;
      continue;
    }
    const label = lineStatementLabel(line.text);
    if (!label) {
      i++;
      continue;
    }

    if (label === "SIDEN" || isSidenCardLine(line.text)) {
      state.lastSumExpandedIndex = i;
      i++;
      continue;
    }

    if (label === "SINOT" || isSinotCardLine(line.text)) {
      const { tokens, end: cardEnd } = collectCardTokens(expanded, i);
      state.lastSumExpandedIndex = cardEnd;
      state.headerExpandedIndex = i;
      state.endExpandedIndex = cardEnd;
      if (tokens.length === 0) {
        state.listMode = "none";
        state.list = [];
      } else {
        state.listMode = "sinot";
        state.list = tokens;
      }
      i = cardEnd + 1;
      continue;
    }

    if (label === "SI" && isSiCardLine(line.text)) {
      const { tokens, end: cardEnd } = collectCardTokens(expanded, i);
      state.lastSumExpandedIndex = cardEnd;
      state.headerExpandedIndex = i;
      state.endExpandedIndex = cardEnd;
      if (tokens.length === 0) {
        state.listMode = "none";
        state.list = [];
      } else {
        state.listMode = "si";
        state.list = tokens;
      }
      i = cardEnd + 1;
      continue;
    }

    i++;
  }
  return state;
}

function findExpandedIndex(
  expanded: readonly ExpandedLine[],
  uri: string,
  line: number
): number {
  for (let i = 0; i < expanded.length; i++) {
    const e = expanded[i]!;
    if (e.isIncludeDirective) continue;
    if (e.editUri === uri && e.editLine === line) return i;
  }
  // Fallback: конец того же uri или конец expanded
  let last = -1;
  for (let i = 0; i < expanded.length; i++) {
    if (expanded[i]!.editUri === uri) last = i;
  }
  return last >= 0 ? last : expanded.length;
}

function findInsertPlan(
  expanded: readonly ExpandedLine[],
  mainUri: string,
  mainLines: readonly string[],
  referenceExpandedIndex: number,
  lastSumExpandedIndex: number | null,
  text: string,
  message: string
): AddToSumIsotopePlan {
  if (lastSumExpandedIndex != null) {
    const last = expanded[lastSumExpandedIndex]!;
    return {
      kind: "insert-line",
      uri: last.editUri,
      beforeLine: last.editLine + 1,
      text,
      message,
    };
  }
  const pin = findPinLine(mainLines);
  if (pin >= 0) {
    return {
      kind: "insert-line",
      uri: mainUri,
      beforeLine: Math.min(pin + 1, mainLines.length),
      text,
      message,
    };
  }
  for (let i = 0; i < expanded.length; i++) {
    const e = expanded[i]!;
    if (e.isIncludeDirective) continue;
    if (lineStatementLabel(e.text) === "MATR") {
      return {
        kind: "insert-line",
        uri: e.editUri,
        beforeLine: e.editLine,
        text,
        message,
      };
    }
  }
  const ref = expanded[Math.min(referenceExpandedIndex, Math.max(0, expanded.length - 1))];
  if (ref && !ref.isIncludeDirective) {
    return {
      kind: "insert-line",
      uri: ref.editUri,
      beforeLine: ref.editLine,
      text,
      message,
    };
  }
  return {
    kind: "insert-line",
    uri: mainUri,
    beforeLine: 0,
    text,
    message,
  };
}

/**
 * План по уже развёрнутому списку строк (main + includes).
 */
export function planAddToSumIsotopeExpanded(
  expanded: readonly ExpandedLine[],
  mainUri: string,
  mainLines: readonly string[],
  nuclideName: string,
  referenceUri: string,
  referenceLine: number,
  maxCodeLen = MCU_MAX_CODE_LINE_LENGTH
): AddToSumIsotopePlan {
  const name = nuclideName.trim();
  if (!name) {
    return { kind: "already", message: "Пустое имя нуклида" };
  }

  const refExpanded = findExpandedIndex(expanded, referenceUri, referenceLine);
  const state = scanExpandedBefore(expanded, refExpanded);

  if (state.listMode === "si" && listHasName(state.list, name) && state.headerExpandedIndex != null) {
    return { kind: "already", message: `${name} уже указан в карте SI` };
  }

  if (state.listMode === "si" && state.headerExpandedIndex != null && state.endExpandedIndex != null) {
    const header = expanded[state.headerExpandedIndex]!;
    const { comment } = collectCardTokens(expanded, state.headerExpandedIndex);
    const next = [...state.list, name];
    const endLine = expanded[state.endExpandedIndex]!.editLine;
    return {
      kind: "replace-range",
      uri: header.editUri,
      startLine: header.editLine,
      endLine,
      newText: rebuildSumCardText("SI", next, comment, maxCodeLen),
      message: `Добавлено в SI: ${name}`,
    };
  }

  // Активен SINOT: список только исключает из суммы. Чтобы добавить в сумму — SI
  // (последняя карта списка побеждает). Имя из SINOT убираем, если оно там было.
  if (state.listMode === "sinot" && state.headerExpandedIndex != null && state.endExpandedIndex != null) {
    const header = expanded[state.headerExpandedIndex]!;
    const { comment } = collectCardTokens(expanded, state.headerExpandedIndex);
    const endLine = expanded[state.endExpandedIndex]!.editLine;
    if (listHasName(state.list, name)) {
      const next = state.list.filter((t) => t.toUpperCase() !== name.toUpperCase());
      if (next.length === 0) {
        return {
          kind: "replace-range",
          uri: header.editUri,
          startLine: header.editLine,
          endLine,
          newText: rebuildSumCardText("SI", [name], comment, maxCodeLen),
          message: `SINOT заменён на SI ${name}`,
        };
      }
      // Оставляем SINOT без имени и вставляем SI name сразу после блока SINOT.
      const sinotText = rebuildSumCardText("SINOT", next, comment, maxCodeLen);
      const siText = rebuildSumCardText("SI", [name], "", maxCodeLen);
      return {
        kind: "replace-range",
        uri: header.editUri,
        startLine: header.editLine,
        endLine,
        newText: `${sinotText}\n${siText}`,
        message: `Убрано из SINOT и добавлено в SI: ${name}`,
      };
    }
  }

  return findInsertPlan(
    expanded,
    mainUri,
    mainLines,
    refExpanded,
    state.lastSumExpandedIndex,
    rebuildSumCardText("SI", [name], "", maxCodeLen),
    `Вставлена карта SI ${name}`
  );
}

/**
 * Упрощённый план без includes (один файл) — для юнит-тестов.
 * Возвращает legacy-форму `replace-line` / `insert-line` без uri.
 */
export function planAddToSumIsotope(
  lines: readonly string[],
  nuclideName: string,
  referenceLine: number,
  maxCodeLen = MCU_MAX_CODE_LINE_LENGTH
): LegacyAddToSumIsotopePlan {
  const mainUri = "file:///inline.mcu";
  const expanded = expandLinesForSumIsotope(mainUri, lines, () => null);
  const plan = planAddToSumIsotopeExpanded(
    expanded,
    mainUri,
    lines,
    nuclideName,
    mainUri,
    referenceLine,
    maxCodeLen
  );
  if (plan.kind === "already") return plan;
  if (plan.kind === "replace-range") {
    return {
      kind: "replace-line",
      line: plan.startLine,
      newText: plan.newText,
      message: plan.message,
    };
  }
  return {
    kind: "insert-line",
    beforeLine: plan.beforeLine,
    text: plan.text,
    message: plan.message,
  };
}

export const ADD_TO_SUM_ISOTOPE_DIAG_CODES = new Set([
  "aw-mass-missing",
  "aw-mass-missing-siden",
  "phy-missing",
  "phy-missing-siden",
]);

function sameFsPath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

async function openDoc(uri: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
}

/**
 * Найти документ варианта (с `#include`), который подключает файл нуклида;
 * иначе сам документ нуклида.
 */
export async function findMainVariantDocument(nuclideUri: string): Promise<vscode.TextDocument> {
  const nuclideDoc = await openDoc(nuclideUri);
  const nuclideFs = nuclideDoc.uri.fsPath;

  const candidates: vscode.TextDocument[] = [];
  const active = vscode.window.activeTextEditor?.document;
  if (active && isMcunrDocument(active)) candidates.push(active);
  for (const doc of vscode.workspace.textDocuments) {
    if (!isMcunrDocument(doc)) continue;
    if (candidates.some((c) => c.uri.toString() === doc.uri.toString())) continue;
    candidates.push(doc);
  }

  for (const doc of candidates) {
    if (doc.uri.toString() === nuclideUri) {
      // Сам файл может быть main
      if (INCLUDE_LINE_RE.test(doc.getText()) || findPinLine(doc.getText().split(/\r?\n/)) >= 0) {
        return doc;
      }
      continue;
    }
    const baseDir = path.dirname(doc.uri.fsPath);
    const lines = doc.getText().split(/\r?\n/);
    for (const line of lines) {
      const inc = parseIncludePath(line);
      if (!inc) continue;
      const { fsPath, exists } = resolveIncludeFsPath(baseDir, inc);
      if (exists && sameFsPath(fsPath, nuclideFs)) return doc;
    }
  }

  return nuclideDoc;
}

function makeIncludeLoader(mainFsPath: string): (includePath: string) => IncludeLoadResult | null {
  const baseDir = path.dirname(mainFsPath);
  return (includePath: string) => {
    const { fsPath, exists } = resolveIncludeFsPath(baseDir, includePath);
    // Сначала открытый буфер редактора — иначе план строится по устаревшему диску.
    for (const doc of vscode.workspace.textDocuments) {
      if (!doc.uri.scheme || doc.uri.scheme !== "file") continue;
      if (!sameFsPath(doc.uri.fsPath, fsPath)) continue;
      return {
        uri: doc.uri.toString(),
        lines: doc.getText().split(/\r?\n/),
      };
    }
    if (!exists) return null;
    try {
      const text = readTextFileWithDetectedEncoding(fsPath);
      return {
        uri: pathToFileURL(fsPath).href,
        lines: text.split(/\r?\n/),
      };
    } catch {
      return null;
    }
  };
}

async function applyPlan(plan: AddToSumIsotopePlan): Promise<{ ok: boolean; editedUri: string } | { ok: false }> {
  if (plan.kind === "already") return { ok: false };

  const doc = await openDoc(plan.uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });

  let ok = false;
  if (plan.kind === "replace-range") {
    const start = new vscode.Position(plan.startLine, 0);
    const endLineText = doc.lineAt(Math.min(plan.endLine, doc.lineCount - 1)).text;
    const end = new vscode.Position(plan.endLine, endLineText.length);
    ok = await editor.edit((eb) => eb.replace(new vscode.Range(start, end), plan.newText));
  } else {
    const pos =
      plan.beforeLine >= doc.lineCount
        ? new vscode.Position(
            Math.max(0, doc.lineCount - 1),
            doc.lineAt(Math.max(0, doc.lineCount - 1)).text.length
          )
        : new vscode.Position(plan.beforeLine, 0);
    const insertText =
      plan.beforeLine >= doc.lineCount ? `\n${plan.text}\n` : `${plan.text}\n`;
    ok = await editor.edit((eb) => eb.insert(pos, insertText));
  }
  return { ok, editedUri: plan.uri };
}

export type AddToSumIsotopeHooks = {
  /** Принудительно пересчитать LSP-диагностики после правки. */
  revalidate?: () => Promise<void>;
  /** Обновить sidebar / decorations. */
  refreshUi?: () => void;
};

export async function executeAddToSumIsotope(
  raw: AddToSumIsotopeArgs | AddToSumIsotopeArgs[],
  hooks?: AddToSumIsotopeHooks
): Promise<void> {
  const args = Array.isArray(raw) ? raw[0] : raw;
  if (!args?.uri || !args.nuclideName) {
    vscode.window.showWarningMessage("Не удалось определить нуклид для добавления в SI");
    return;
  }

  const mainDoc = await findMainVariantDocument(args.uri);
  const mainUri = mainDoc.uri.toString();
  const mainLines = mainDoc.getText().split(/\r?\n/);
  const expanded = expandLinesForSumIsotope(mainUri, mainLines, makeIncludeLoader(mainDoc.uri.fsPath));

  const plan = planAddToSumIsotopeExpanded(
    expanded,
    mainUri,
    mainLines,
    args.nuclideName,
    args.uri,
    args.line ?? 0
  );

  if (plan.kind === "already") {
    vscode.window.setStatusBarMessage(`MCU-NR: ${plan.message}`, 3000);
    return;
  }

  const result = await applyPlan(plan);
  if (!result.ok) return;

  // Save: иначе LSP/expand читают старый диск, панель (getDiagnostics) и ховер (publishDiagnostics) разъезжаются.
  try {
    const editedDoc = await openDoc(result.editedUri);
    if (editedDoc.isDirty) {
      await editedDoc.save();
    }
  } catch {
    /* ignore */
  }

  // Main тоже должен быть открыт для publishDiagnostics на URI варианта.
  try {
    await openDoc(mainUri);
  } catch {
    /* ignore */
  }

  // Вернуть фокус на документ с нуклидом (иначе sidebar/diags смотрят на include).
  try {
    const nuclideDoc = await openDoc(args.uri);
    await vscode.window.showTextDocument(nuclideDoc, { preview: false, preserveFocus: false });
  } catch {
    /* ignore */
  }

  if (hooks?.revalidate) {
    try {
      await hooks.revalidate();
    } catch {
      /* older server */
    }
  }
  hooks?.refreshUi?.();

  const suffix =
    result.editedUri !== mainUri
      ? ` → ${path.basename(vscode.Uri.parse(result.editedUri).fsPath)}`
      : "";
  vscode.window.setStatusBarMessage(`MCU-NR: ${plan.message}${suffix}`, 4000);
}

export function registerAddToSumIsotope(
  context: vscode.ExtensionContext,
  hooks?: AddToSumIsotopeHooks
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mcuhelper.addToSumIsotope",
      (raw: AddToSumIsotopeArgs | AddToSumIsotopeArgs[]) => executeAddToSumIsotope(raw, hooks)
    )
  );
}
