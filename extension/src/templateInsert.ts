import * as vscode from "vscode";
import { isMcunrDocument } from "./contentDetect";

export type InsertFormat = "snippet" | "plain";

export async function insertTemplate(text: string, format: InsertFormat = "plain"): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) {
    vscode.window.showWarningMessage("Откройте файл MCU-NR для вставки шаблона");
    return false;
  }
  const pos = editor.selection.active;
  if (format === "snippet" && text.includes("${")) {
    await editor.insertSnippet(new vscode.SnippetString(text), pos);
  } else {
    await editor.edit((eb) => eb.insert(pos, text));
  }
  return true;
}

export function registerTemplateInsert(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mcuhelper.insertTemplate",
      async (text: string, format?: InsertFormat) => {
        await insertTemplate(text, format ?? "plain");
      }
    ),
    vscode.languages.registerDocumentDropEditProvider(
      "mcunr",
      {
        provideDocumentDropEdits: async (_doc, _position, dataTransfer) => {
          const plain = await dataTransfer.get("text/plain")?.asString();
          if (!plain) return;
          const snippetFlag = await dataTransfer.get("application/mcuhelper.snippet")?.asString();
          const format: InsertFormat = snippetFlag === "1" || plain.includes("${") ? "snippet" : "plain";
          const insertText =
            format === "snippet" ? new vscode.SnippetString(plain) : plain;
          return new vscode.DocumentDropEdit(insertText, "Вставить шаблон MCU-NR");
        },
      },
      { dropMimeTypes: ["text/plain", "application/mcuhelper.snippet"] }
    )
  );
}

export async function goToSymbol(uri: string, range: { start: { line: number; character: number }; end: { line: number; character: number } }): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
  const editor = await vscode.window.showTextDocument(doc);
  const start = new vscode.Position(range.start.line, range.start.character);
  const end = new vscode.Position(range.end.line, range.end.character);
  editor.selection = new vscode.Selection(start, end);
  editor.revealRange(new vscode.Range(start, end));
}
