/**
 * Вставка / замена блока MATR из черновика конструктора.
 */

import * as vscode from "vscode";
import { loadMaterialsCompendiumApi, type MaterialDraft } from "./mcuLanguageBridge";

export async function insertNewMaterialCard(uri: vscode.Uri, draft: MaterialDraft): Promise<boolean> {
  const api = loadMaterialsCompendiumApi();
  const built = api.buildMatrCard(draft);
  if (!built.text.trim()) {
    vscode.window.showWarningMessage("Нечего вставлять.");
    return false;
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const hint = api.findMatrInsert(doc.getText());
  const numbered = { ...draft, number: hint.nextNumber };
  const card = api.buildMatrCard(numbered);
  const line = Math.max(0, Math.min(hint.line, doc.lineCount));
  const insertPos = line >= doc.lineCount ? new vscode.Position(doc.lineCount, 0) : new vscode.Position(line, 0);
  const text = card.text.endsWith("\n") ? card.text : `${card.text}\n`;

  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, insertPos, text);
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    vscode.window.showErrorMessage("Не удалось вставить MATR");
    return false;
  }
  vscode.window.showInformationMessage(`MATR ${numbered.number} вставлен (можно Undo).`);
  return true;
}

export async function replaceCurrentMaterialCard(
  uri: vscode.Uri,
  headerLine: number,
  draft: MaterialDraft
): Promise<boolean> {
  const api = loadMaterialsCompendiumApi();
  const built = api.buildMatrCard(draft);
  if (!built.text.trim()) {
    vscode.window.showWarningMessage("Нечего вставлять.");
    return false;
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  const endLine = api.findMatrBlockEndLine(doc.getText(), headerLine);
  const start = new vscode.Position(headerLine, 0);
  const end =
    endLine + 1 < doc.lineCount
      ? new vscode.Position(endLine + 1, 0)
      : new vscode.Position(endLine, doc.lineAt(endLine).text.length);
  const text = built.text.endsWith("\n") ? built.text : `${built.text}\n`;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(start, end), text);
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    vscode.window.showErrorMessage("Не удалось заменить MATR");
    return false;
  }
  vscode.window.showInformationMessage(`MATR ${draft.number} заменён (можно Undo).`);
  return true;
}
