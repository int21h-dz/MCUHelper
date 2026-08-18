/** Серый шрифт для нуклидов суммарного изотопа (SI/SINOT/SIDEN) в редакторе.
 *
 * ⚠ АГЕНТАМ — SI КАРТА vs КРЕМНИЙ (омоним):
 * - Карта `SI list` / `SI FP1…` — keyword в TextMate (отдельное правило в mcunr.tmLanguage.json,
 *   НЕ общий `|SI|` в cards). Здесь decoration НЕ трогает такие строки.
 * - Нуклид `SI dens` (`SI 1.1E-2`) — кремний в MATR; это обычная строка состава,
 *   её МОЖНО красить серым, если кремний попал в суммарный изотоп.
 * - Не «чинить» путаницу удалением SI из TextMate cards — используйте dens-lookahead.
 * - Синхрон эвристики: packages/mcu-language/src/siCardVsNuclide.ts
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface SumIsotopeRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface SumIsotopeNuclideDecoration {
  name: string;
  range: SumIsotopeRange;
  reasons?: string[];
  inAwLib?: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Строка карты суммарного изотопа (не состав MATR).
 * `SI 1.1E-2` — нуклид кремния, не карта. Синхрон с isSumIsotopeCardLine в mcu-language.
 */
export function isSumIsotopeCardLine(lineText: string): boolean {
  const code = lineText.replace(/;.*/, "").trim();
  if (!code) return false;
  const parts = code.split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  const head = parts[0]!.toUpperCase();
  if (head === "SINOT" || head === "SIDEN") return true;
  if (head !== "SI") return false;
  if (parts.length < 2) return true;
  // dens: число / sci / выражение; list: идентификаторы нуклидов (FP1, PB05, …)
  return !/^[+\-.(0-9]/.test(parts[1]!);
}

/**
 * Диапазон имени + концентрации на строке состава.
 * TextMate красит их разными scopes — decoration должна покрывать оба.
 */
export function nuclideCompositionEditorRange(
  doc: vscode.TextDocument,
  name: string,
  range: SumIsotopeRange
): vscode.Range | null {
  const from = range.start.line;
  const to = range.end.line >= range.start.line ? range.end.line : range.start.line;
  if (from < 0 || from >= doc.lineCount) return null;
  const last = Math.min(to, doc.lineCount - 1);
  for (let line = from; line <= last; line++) {
    const r = nuclideCompositionOnLine(doc, name, line);
    if (r) return r;
  }
  return null;
}

function nuclideCompositionOnLine(
  doc: vscode.TextDocument,
  name: string,
  line: number
): vscode.Range | null {
  const lineText = doc.lineAt(line).text;
  if (isSumIsotopeCardLine(lineText)) return null;
  const re = new RegExp(`(?:^|[\\s/])(${escapeRegExp(name)})(\\s+)(\\S+)`, "i");
  const m = re.exec(lineText);
  if (!m || m.index < 0) {
    const nameOnly = nuclideNameOnLine(doc, name, line, 0);
    return nameOnly;
  }
  const nameStart = m[0].startsWith(m[1]!) ? m.index : m.index + 1;
  const end = nameStart + m[1]!.length + m[2]!.length + m[3]!.length;
  return new vscode.Range(line, nameStart, line, end);
}

/** Диапазон только концентрации на строке состава (после имени нуклида). */
export function nuclideConcentrationEditorRange(
  doc: vscode.TextDocument,
  name: string,
  range: SumIsotopeRange
): vscode.Range | null {
  const from = range.start.line;
  const to = range.end.line >= range.start.line ? range.end.line : range.start.line;
  if (from < 0 || from >= doc.lineCount) return null;
  const last = Math.min(to, doc.lineCount - 1);
  for (let line = from; line <= last; line++) {
    const r = nuclideConcentrationOnLine(doc, name, line);
    if (r) return r;
  }
  return null;
}

function nuclideConcentrationOnLine(
  doc: vscode.TextDocument,
  name: string,
  line: number
): vscode.Range | null {
  const lineText = doc.lineAt(line).text;
  if (isSumIsotopeCardLine(lineText)) return null;
  const re = new RegExp(`(?:^|[\\s/])(${escapeRegExp(name)})(\\s+)(\\S+)`, "i");
  const m = re.exec(lineText);
  if (!m || m.index < 0) return null;
  const nameStart = m[0].startsWith(m[1]!) ? m.index : m.index + 1;
  const concStart = nameStart + m[1]!.length + m[2]!.length;
  const concEnd = concStart + m[3]!.length;
  return new vscode.Range(line, concStart, line, concEnd);
}

/** Диапазон только имени нуклида. */
export function nuclideNameEditorRange(
  doc: vscode.TextDocument,
  name: string,
  range: SumIsotopeRange
): vscode.Range | null {
  const from = range.start.line;
  const to = range.end.line >= range.start.line ? range.end.line : range.start.line;
  if (from < 0 || from >= doc.lineCount) return null;
  const last = Math.min(to, doc.lineCount - 1);
  for (let line = from; line <= last; line++) {
    const startChar = line === range.start.line ? range.start.character : 0;
    const r = nuclideNameOnLine(doc, name, line, startChar);
    if (r) return r;
  }
  return null;
}

function nuclideNameOnLine(
  doc: vscode.TextDocument,
  name: string,
  line: number,
  startChar: number
): vscode.Range | null {
  const lineText = doc.lineAt(line).text;
  const re = new RegExp(`(?:^|[\\s/])(${escapeRegExp(name)})(?=\\s|$)`, "i");
  const m = re.exec(lineText);
  if (!m || m.index < 0) {
    const slice = lineText.slice(startChar, startChar + name.length);
    if (slice.toUpperCase() === name.toUpperCase()) {
      return new vscode.Range(line, startChar, line, startChar + name.length);
    }
    return null;
  }
  const nameStart = m[0].length > m[1]!.length ? m.index + (m[0].length - m[1]!.length) : m.index;
  return new vscode.Range(line, nameStart, line, nameStart + m[1]!.length);
}

/**
 * Серый поверх TextMate: явные light/dark + opacity.
 * ThemeColor('descriptionForeground') часто не перебивает token colors.
 */
export function createSumIsotopeDecorationType(): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    light: { color: "#6e6e6e" },
    dark: { color: "#9a9a9a" },
    opacity: "0.72",
    fontStyle: "italic",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
}

/** Нуклид в SI, но записи в AW.LIB нет: предупреждающий акцент в редакторе. */
export function createMissingAwLibSumIsotopeDecorationType(): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    light: {
      color: "#9a5d00",
      backgroundColor: "rgba(255, 196, 61, 0.16)",
    },
    dark: {
      color: "#f2c14e",
      backgroundColor: "rgba(242, 193, 78, 0.16)",
    },
    border: "1px solid rgba(242, 193, 78, 0.38)",
    fontStyle: "italic",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
}

/** Компактная подпись ranges (для тестов / отладки; apply больше не early-return’ит по ней). */
export function decorationRangesSignature(opts: ReadonlyArray<{ range: vscode.Range }>): string {
  if (!opts.length) return "0";
  let h = opts.length | 0;
  for (const o of opts) {
    h = (Math.imul(h, 31) + o.range.start.line) | 0;
    h = (Math.imul(h, 31) + o.range.start.character) | 0;
    h = (Math.imul(h, 31) + o.range.end.line) | 0;
    h = (Math.imul(h, 31) + o.range.end.character) | 0;
  }
  const first = opts[0]!.range;
  const last = opts[opts.length - 1]!.range;
  return `${opts.length}:${first.start.line}:${last.end.line}:${h}`;
}

function markRangeFallback(n: SumIsotopeNuclideDecoration, lineCount: number): vscode.Range | null {
  const startLine = n.range.start.line;
  const endLine = n.range.end.line >= startLine ? n.range.end.line : startLine;
  if (startLine < 0 || startLine >= lineCount) return null;
  const end = Math.min(endLine, lineCount - 1);
  const endChar = Math.max(n.range.end.character, n.range.start.character + 1);
  return new vscode.Range(startLine, Math.max(0, n.range.start.character), end, endChar);
}

export function sumIsotopeHoverMessage(n: SumIsotopeNuclideDecoration): vscode.MarkdownString {
  const lines = ["Нуклид включён в суммарный изотоп."];
  if (n.inAwLib === false) {
    lines.push("", "Записи в `AW.LIB` нет, поэтому применён warning-стиль.");
  }
  if (n.reasons?.length) {
    lines.push("", ...n.reasons.map((reason) => `- ${reason}`));
  }
  const md = new vscode.MarkdownString(lines.join("\n"));
  md.isTrusted = false;
  return md;
}

export function applySumIsotopeDecorations(
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType,
  nuclides: SumIsotopeNuclideDecoration[]
): void {
  // #region agent log
  const _dbgT0 = Date.now();
  // #endregion
  const opts: vscode.DecorationOptions[] = [];
  const lineCount = editor.document.lineCount;
  let miss = 0;
  for (const n of nuclides) {
    if (n.range.start.line < 0 || n.range.start.line >= lineCount) continue;
    const r =
      nuclideCompositionEditorRange(editor.document, n.name, n.range) ?? markRangeFallback(n, lineCount);
    if (!r) {
      miss++;
      continue;
    }
    opts.push({
      range: r,
      hoverMessage: sumIsotopeHoverMessage(n),
    });
  }
  editor.setDecorations(decorationType, opts);
  // #region agent log
  {
    const payload = {
      sessionId: "f91ac2",
      runId: "post-fix4",
      hypothesisId: "B",
      location: "sumIsotopeDecorations.ts:applySumIsotopeDecorations",
      message: "setDecorations done",
      data: { input: nuclides.length, painted: opts.length, miss, ms: Date.now() - _dbgT0 },
      timestamp: Date.now(),
    };
    fetch("http://127.0.0.1:7911/ingest/3304a270-bbbf-4e90-96de-6ba27b8f72bf", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "f91ac2" },
      body: JSON.stringify(payload),
    }).catch(() => {});
    try {
      const roots = new Set<string>();
      roots.add(path.join(__dirname, "..", ".."));
      for (const f of vscode.workspace.workspaceFolders ?? []) {
        roots.add(f.uri.fsPath);
      }
      const line = JSON.stringify(payload) + "\n";
      for (const root of roots) {
        try {
          fs.appendFileSync(path.join(root, "debug-f91ac2.log"), line);
        } catch {
          /* ignore one root */
        }
      }
    } catch {
      /* ignore */
    }
  }
  // #endregion
}

export function clearSumIsotopeDecorations(
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType
): void {
  editor.setDecorations(decorationType, []);
}
