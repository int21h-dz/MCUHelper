import * as vscode from "vscode";
import { nuclideConcentrationEditorRange, type SumIsotopeRange } from "./sumIsotopeDecorations";

export interface StableIsotopeDecoration {
  name: string;
  range: SumIsotopeRange;
}

/** Синий как у имён нуклидов (variable.other в тёмной/светлой теме VS Code). */
export function stableIsotopeDecorationOptions(): vscode.DecorationRenderOptions {
  return {
    light: { color: "#001080" },
    dark: { color: "#9CDCFE" },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  };
}

export function createStableIsotopeDecorationType(): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType(stableIsotopeDecorationOptions());
}

function markRangeFallback(n: StableIsotopeDecoration, lineCount: number): vscode.Range | null {
  const startLine = n.range.start.line;
  if (startLine < 0 || startLine >= lineCount) return null;
  const endLine = n.range.end.line >= startLine ? Math.min(n.range.end.line, lineCount - 1) : startLine;
  const endChar = Math.max(n.range.end.character, n.range.start.character + 1);
  return new vscode.Range(startLine, Math.max(0, n.range.start.character), endLine, endChar);
}

export function applyStableIsotopeDecorations(
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType,
  nuclides: StableIsotopeDecoration[]
): void {
  const opts: vscode.DecorationOptions[] = [];
  const lineCount = editor.document.lineCount;
  for (const n of nuclides) {
    if (n.range.start.line < 0 || n.range.start.line >= lineCount) continue;
    const r =
      nuclideConcentrationEditorRange(editor.document, n.name, n.range) ?? markRangeFallback(n, lineCount);
    if (!r) continue;
    opts.push({
      range: r,
      hoverMessage: new vscode.MarkdownString("Стабильный изотоп (`T1/2` не задан)."),
    });
  }
  editor.setDecorations(decorationType, opts);
}

export function clearStableIsotopeDecorations(
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType
): void {
  editor.setDecorations(decorationType, []);
}
