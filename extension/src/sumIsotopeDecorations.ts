/** Серый шрифт для нуклидов суммарного изотопа (SI/SINOT/SIDEN) в редакторе.
 *
 * ВАЖНО ДЛЯ АГЕНТОВ: не красить заголовок карты `SI list` как нуклид SI.
 * Карта SI должна быть keyword в TextMate (`mcunr.tmLanguage.json`, список cards) —
 * без неё SI выглядит как изотоп. Здесь — второй рубеж: decoration не трогает
 * строки SI/SINOT/SIDEN (кроме состава `SI dens` — кремний в MATR).
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

/** Строка карты суммарного изотопа (не состав MATR). `SI 1.1E-2` — нуклид, не карта. */
export function isSumIsotopeCardLine(lineText: string): boolean {
  const parts = lineText.trim().split(/\s+/).filter(Boolean);
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
  for (const n of nuclides) {
    const r = nuclideCompositionEditorRange(editor.document, n.name, n.range);
    if (!r) continue;
    opts.push({
      range: r,
    });
  }
  editor.setDecorations(decorationType, opts);
}

export function clearSumIsotopeDecorations(
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType
): void {
  editor.setDecorations(decorationType, []);
}
