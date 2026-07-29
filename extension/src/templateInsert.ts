import * as vscode from "vscode";
import {
  DEFAULT_DETECT_FROM_LANGUAGES,
  ensureMcunrLanguageForCatalog,
  isLanguageDetectCandidate,
  isMcunrDocument,
} from "./contentDetect";

export type InsertFormat = "snippet" | "plain";

function canInsertTemplate(doc: vscode.TextDocument): boolean {
  return isMcunrDocument(doc) || isLanguageDetectCandidate(doc);
}

export async function insertTemplate(text: string, format: InsertFormat = "plain"): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !canInsertTemplate(editor.document)) {
    vscode.window.showWarningMessage("Откройте файл MCU-NR для вставки шаблона");
    return false;
  }
  await ensureMcunrLanguageForCatalog(editor.document);
  const pos = editor.selection.active;
  if (format === "snippet" && text.includes("${")) {
    await editor.insertSnippet(new vscode.SnippetString(text), pos);
  } else {
    await editor.edit((eb) => eb.insert(pos, text));
  }
  return true;
}

function dropLanguageSelectors(): vscode.DocumentSelector {
  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  const from = cfg.get<string[]>("autoDetectFromLanguages", DEFAULT_DETECT_FROM_LANGUAGES);
  const ids = new Set(["mcunr", ...from]);
  return [...ids].map((language) => ({ language }));
}

async function isCatalogDrop(dataTransfer: vscode.DataTransfer): Promise<boolean> {
  const mcu = await dataTransfer.get("application/mcuhelper.mcu")?.asString();
  if (mcu === "1") return true;
  const snippet = await dataTransfer.get("application/mcuhelper.snippet")?.asString();
  return snippet === "0" || snippet === "1";
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
      dropLanguageSelectors(),
      {
        provideDocumentDropEdits: async (doc, _position, dataTransfer) => {
          const plain = await dataTransfer.get("text/plain")?.asString();
          if (!plain) return;
          if (await isCatalogDrop(dataTransfer)) {
            await ensureMcunrLanguageForCatalog(doc);
          }
          const snippetFlag = await dataTransfer.get("application/mcuhelper.snippet")?.asString();
          const format: InsertFormat = snippetFlag === "1" || plain.includes("${") ? "snippet" : "plain";
          const insertText =
            format === "snippet" ? new vscode.SnippetString(plain) : plain;
          return new vscode.DocumentDropEdit(insertText, "Вставить шаблон MCU-NR");
        },
      },
      {
        dropMimeTypes: [
          "text/plain",
          "application/mcuhelper.snippet",
          "application/mcuhelper.mcu",
        ],
      }
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
