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

const lastStableDecorationSignatures = new Map<string, string>();

export function applyStableIsotopeDecorations(
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType,
  nuclides: StableIsotopeDecoration[]
): void {
  const opts: vscode.DecorationOptions[] = [];
  const lineCount = editor.document.lineCount;
  for (const n of nuclides) {
    if (n.range.start.line < 0 || n.range.start.line >= lineCount) continue;
    const r = nuclideConcentrationEditorRange(editor.document, n.name, n.range);
    if (!r) continue;
    opts.push({
      range: r,
      hoverMessage: new vscode.MarkdownString("Стабильный изотоп (`T1/2` не задан)."),
    });
  }
  const signature = opts
    .map((o) => `${o.range.start.line}:${o.range.start.character}-${o.range.end.line}:${o.range.end.character}`)
    .join("|");
  const key = editor.document.uri.toString();
  if (lastStableDecorationSignatures.get(key) === signature) return;
  lastStableDecorationSignatures.set(key, signature);
  editor.setDecorations(decorationType, opts);
}

export function clearStableIsotopeDecorations(
  editor: vscode.TextEditor,
  decorationType: vscode.TextEditorDecorationType
): void {
  lastStableDecorationSignatures.delete(editor.document.uri.toString());
  editor.setDecorations(decorationType, []);
}
