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

export interface SumIsotopeRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface SumIsotopeNuclideDecoration {
  name: string;
  range: SumIsotopeRange;
  reasons: string[];
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
  if (range.start.line < 0 || range.start.line >= doc.lineCount) return null;
  const lineText = doc.lineAt(range.start.line).text;
  // Не затенять keyword карты SI/SINOT/SIDEN серым «суммарного изотопа».
  if (isSumIsotopeCardLine(lineText)) return null;
  const re = new RegExp(`(?:^|[\\s/])(${escapeRegExp(name)})(\\s+)(\\S+)`, "i");
  const m = re.exec(lineText);
  if (!m || m.index < 0) {
    const nameOnly = nuclideNameEditorRange(doc, name, range);
    return nameOnly;
  }
  const nameStart = m[0].startsWith(m[1]!) ? m.index : m.index + 1;
  const end = nameStart + m[1]!.length + m[2]!.length + m[3]!.length;
  return new vscode.Range(range.start.line, nameStart, range.start.line, end);
}

/** Диапазон только концентрации на строке состава (после имени нуклида). */
export function nuclideConcentrationEditorRange(
  doc: vscode.TextDocument,
  name: string,
  range: SumIsotopeRange
): vscode.Range | null {
  if (range.start.line < 0 || range.start.line >= doc.lineCount) return null;
  const lineText = doc.lineAt(range.start.line).text;
  if (isSumIsotopeCardLine(lineText)) return null;
  const re = new RegExp(`(?:^|[\\s/])(${escapeRegExp(name)})(\\s+)(\\S+)`, "i");
  const m = re.exec(lineText);
  if (!m || m.index < 0) return null;
  const nameStart = m[0].startsWith(m[1]!) ? m.index : m.index + 1;
  const concStart = nameStart + m[1]!.length + m[2]!.length;
  const concEnd = concStart + m[3]!.length;
  return new vscode.Range(range.start.line, concStart, range.start.line, concEnd);
}

/** Диапазон только имени нуклида. */
export function nuclideNameEditorRange(
  doc: vscode.TextDocument,
  name: string,
  range: SumIsotopeRange
): vscode.Range | null {
  if (range.start.line < 0 || range.start.line >= doc.lineCount) return null;
  const lineText = doc.lineAt(range.start.line).text;
  const re = new RegExp(`(?:^|[\\s/])(${escapeRegExp(name)})(?=\\s|$)`, "i");
  const m = re.exec(lineText);
  if (!m || m.index < 0) {
    const startChar = range.start.character;
    const slice = lineText.slice(startChar, startChar + name.length);
    if (slice.toUpperCase() === name.toUpperCase()) {
      return new vscode.Range(range.start.line, startChar, range.start.line, startChar + name.length);
    }
    return null;
  }
  const nameStart = m[0].length > m[1]!.length ? m.index + (m[0].length - m[1]!.length) : m.index;
  return new vscode.Range(range.start.line, nameStart, range.start.line, nameStart + m[1]!.length);
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

export function applySumIsotopeDecorations(
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType,
  nuclides: SumIsotopeNuclideDecoration[]
): void {
  const opts: vscode.DecorationOptions[] = [];
  const lineCount = editor.document.lineCount;
  for (const n of nuclides) {
    if (n.range.start.line < 0 || n.range.start.line >= lineCount) continue;
    const r = nuclideCompositionEditorRange(editor.document, n.name, n.range);
    if (!r) continue;
    opts.push({
      range: r,
    });
  }
  const signature = opts
    .map((o) => `${o.range.start.line}:${o.range.start.character}-${o.range.end.line}:${o.range.end.character}`)
    .join("|");
  const key = `sum:${editor.document.uri.toString()}`;
  if (lastDecorationSignatures.get(key) === signature) return;
  lastDecorationSignatures.set(key, signature);
  editor.setDecorations(decorationType, opts);
}

export function clearSumIsotopeDecorations(
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType
): void {
  lastDecorationSignatures.delete(`sum:${editor.document.uri.toString()}`);
  editor.setDecorations(decorationType, []);
}

const lastDecorationSignatures = new Map<string, string>();
