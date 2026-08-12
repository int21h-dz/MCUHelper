import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { readTextFileWithDetectedEncoding, writeTextFilePreservingEncoding } from "./encodingDetect";
import { ensureIncludeFileExists } from "./includeFileEnsure";
import {
  buildExpandedBlock,
  collectCollapsedIncludes,
  extractExpandedContent,
  findExpandedBlocks,
  parseExpandedBeginMarker,
  type ExpandedIncludeBlock,
} from "./includePreviewCore";

const DEFAULT_INLINE_MAX_LINES = 4000;

interface IncludeResolveModule {
  resolveIncludeFilePath: (baseDir: string, includePath: string) => { fsPath: string; exists: boolean };
}

function loadIncludeResolve(): IncludeResolveModule {
  const modPath = path.join(__dirname, "..", "..", "packages", "mcu-language", "dist", "includeResolve.js");
  const vendorPath = path.join(__dirname, "..", "vendor", "mcu-language", "includeResolve.js");
  const pick = fs.existsSync(modPath) ? modPath : vendorPath;
  if (fs.existsSync(pick)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(pick) as IncludeResolveModule;
  }
  return {
    resolveIncludeFilePath: (baseDir: string, includePath: string) => {
      const full = path.isAbsolute(includePath) ? includePath : path.join(baseDir, includePath);
      const candidates = [full, `${full}.mcu`, `${full}.mcunr`];
      for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return { fsPath: c, exists: true };
      }
      return { fsPath: full, exists: false };
    },
  };
}

const { resolveIncludeFilePath } = loadIncludeResolve();

function baseDirForDoc(doc: vscode.TextDocument): string | null {
  if (doc.uri.scheme !== "file") return null;
  return path.dirname(doc.uri.fsPath);
}

function countIncludeLines(fsPath: string): number | null {
  try {
    const text = readTextFileWithDetectedEncoding(fsPath);
    if (!text) return 0;
    return text.split(/\r?\n/).length;
  } catch {
    return null;
  }
}

function inlineMaxLines(): number {
  return vscode.workspace.getConfiguration("mcuhelper").get<number>("includeInlineMaxLines", DEFAULT_INLINE_MAX_LINES);
}

async function resolveOrCreateIncludeFile(
  baseDir: string,
  incPath: string
): Promise<{ fsPath: string; created: boolean } | null> {
  const { fsPath, exists } = resolveIncludeFilePath(baseDir, incPath);
  if (exists) return { fsPath, created: false };
  const ok = await ensureIncludeFileExists(fsPath);
  if (!ok) {
    void vscode.window.showErrorMessage(`MCU-NR: не удалось создать include-файл: ${incPath}`);
    return null;
  }
  return { fsPath, created: true };
}

async function openIncludeAsMcunr(fsPath: string, viewColumn?: vscode.ViewColumn): Promise<void> {
  const uri = vscode.Uri.file(fsPath);
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.languageId !== "mcunr") {
    await vscode.languages.setTextDocumentLanguage(doc, "mcunr");
  }
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: viewColumn ?? vscode.ViewColumn.Beside });
  onIncludeDocumentOpened?.();
}

class IncludeCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== "mcunr") return [];
    const text = document.getText();
    const lenses: vscode.CodeLens[] = [];

    for (const span of collectCollapsedIncludes(text)) {
      const lineText = document.lineAt(span.line);
      const range = new vscode.Range(span.line, 0, span.line, lineText.text.length);
      const baseDir = baseDirForDoc(document);
      let lineCount = "?";
      if (baseDir) {
        const { fsPath, exists } = resolveIncludeFilePath(baseDir, span.path);
        if (exists) {
          const n = countIncludeLines(fsPath);
          if (n != null) lineCount = String(n);
        } else {
          lineCount = "0 (новый)";
        }
      }

      lenses.push(
        new vscode.CodeLens(range, {
          title: `▸ Развернуть ${span.path} (${lineCount} стр.)`,
          command: "mcuhelper.expandIncludeInline",
          arguments: [document.uri.toString(), span.line],
        })
      );
      lenses.push(
        new vscode.CodeLens(range, {
          title: `↗ Открыть ${span.path}`,
          command: "mcuhelper.openIncludeFile",
          arguments: [document.uri.toString(), span.line],
        })
      );
    }

    for (const block of findExpandedBlocks(text)) {
      const range = new vscode.Range(block.beginLine, 0, block.beginLine, document.lineAt(block.beginLine).text.length);
      lenses.push(
        new vscode.CodeLens(range, {
          title: "▾ Свернуть include",
          command: "mcuhelper.collapseIncludeInline",
          arguments: [document.uri.toString(), block.beginLine],
        })
      );
    }

    return lenses;
  }
}

async function expandIncludeInline(uriStr: string, line: number): Promise<void> {
  const uri = vscode.Uri.parse(uriStr);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uriStr) ?? vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== uriStr) return;

  const includeLine = doc.lineAt(line);
  const directive = includeLine.text.trimEnd();
  if (!/^\s*#include\b/i.test(directive)) return;

  const baseDir = baseDirForDoc(doc);
  if (!baseDir) return;

  const pathMatch = directive.match(/#include\s+(?:<([^>]+)>|(\S+))/i);
  const incPath = (pathMatch?.[1] ?? pathMatch?.[2])?.trim();
  if (!incPath) return;

  const { fsPath, exists } = resolveIncludeFilePath(baseDir, incPath);
  const resolved = exists ? { fsPath, created: false } : await resolveOrCreateIncludeFile(baseDir, incPath);
  if (!resolved) return;
  if (resolved.created) {
    void vscode.window.setStatusBarMessage(`MCU-NR: создан include-файл ${incPath}`, 4000);
  }

  const lineCount = countIncludeLines(resolved.fsPath);
  const maxLines = inlineMaxLines();
  if (lineCount != null && lineCount > maxLines) {
    const pick = await vscode.window.showWarningMessage(
      `MCU-NR: ${incPath} — ${lineCount} строк (лимит inline ${maxLines}). Открыть файл отдельно?`,
      "Открыть",
      "Всё равно развернуть"
    );
    if (pick === "Открыть") {
      await openIncludeAsMcunr(resolved.fsPath);
      return;
    }
    if (pick !== "Всё равно развернуть") return;
  }

  let content: string;
  try {
    content = readTextFileWithDetectedEncoding(resolved.fsPath);
  } catch (e) {
    void vscode.window.showErrorMessage(`MCU-NR: не удалось прочитать ${incPath}: ${e}`);
    return;
  }

  const block = buildExpandedBlock(directive, content);
  const ok = await editor.edit((eb) => {
    eb.replace(includeLine.rangeIncludingLineBreak, `${block}\n`);
  });
  if (!ok) return;

  const beginLine = line;
  const endLine = beginLine + block.split("\n").length - 1;
  editor.revealRange(new vscode.Range(beginLine + 1, 0, beginLine + 1, 0));
  void vscode.window.setStatusBarMessage(`MCU-NR: развёрнут ${incPath} (стр. ${beginLine + 2}–${endLine})`, 4000);
}

async function collapseIncludeInline(uriStr: string, beginLine: number): Promise<void> {
  const uri = vscode.Uri.parse(uriStr);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uriStr) ?? vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== uriStr) return;

  const beginText = doc.lineAt(beginLine).text;
  const directive = parseExpandedBeginMarker(beginText);
  if (!directive) return;

  const lines = doc.getText().split(/\r?\n/);
  const block = findExpandedBlocks(doc.getText()).find((b) => b.beginLine === beginLine);
  if (!block) return;

  const content = extractExpandedContent(lines, block.beginLine, block.endLine);
  const baseDir = baseDirForDoc(doc);
  if (baseDir) {
    const pathMatch = directive.match(/#include\s+(?:<([^>]+)>|(\S+))/i);
    const incPath = (pathMatch?.[1] ?? pathMatch?.[2])?.trim();
    if (incPath) {
      const { fsPath } = resolveIncludeFilePath(baseDir, incPath);
      try {
        await ensureIncludeFileExists(fsPath);
        writeTextFilePreservingEncoding(fsPath, content);
      } catch (e) {
        void vscode.window.showErrorMessage(`MCU-NR: не удалось сохранить ${incPath}: ${e}`);
        return;
      }
    }
  }

  const start = doc.lineAt(block.beginLine).rangeIncludingLineBreak.start;
  const end = doc.lineAt(block.endLine).rangeIncludingLineBreak.end;
  const ok = await editor.edit((eb) => {
    eb.replace(new vscode.Range(start, end), `${directive}\n`);
  });
  if (ok) {
    editor.revealRange(new vscode.Range(block.beginLine, 0, block.beginLine, 0));
  }
}

/** Перед save: записать include-файлы и вернуть TextEdit, восстанавливающие #include. */
export function buildCollapseEditsForSave(doc: vscode.TextDocument): vscode.TextEdit[] {
  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const blocks = findExpandedBlocks(text);
  if (!blocks.length) return [];
  const baseDir = baseDirForDoc(doc);
  const edits: vscode.TextEdit[] = [];
  for (const block of [...blocks].sort((a, b) => b.beginLine - a.beginLine)) {
    const directive = parseExpandedBeginMarker(lines[block.beginLine]!);
    if (!directive) continue;
    const content = extractExpandedContent(lines, block.beginLine, block.endLine);
    if (baseDir) {
      const pathMatch = directive.match(/#include\s+(?:<([^>]+)>|(\S+))/i);
      const incPath = (pathMatch?.[1] ?? pathMatch?.[2])?.trim();
      if (incPath) {
        const { fsPath } = resolveIncludeFilePath(baseDir, incPath);
        try {
          if (!fs.existsSync(fsPath)) {
            fs.mkdirSync(path.dirname(fsPath), { recursive: true });
          }
          writeTextFilePreservingEncoding(fsPath, content);
        } catch {
          // save всё равно свернёт директиву; файл попробует CodeLens ▾ позже
        }
      }
    }
    const start = doc.lineAt(block.beginLine).rangeIncludingLineBreak.start;
    const end = doc.lineAt(block.endLine).rangeIncludingLineBreak.end;
    edits.push(vscode.TextEdit.replace(new vscode.Range(start, end), `${directive}\n`));
  }
  return edits;
}

async function openIncludeFile(uriStr: string, line: number): Promise<void> {
  const uri = vscode.Uri.parse(uriStr);
  const doc = await vscode.workspace.openTextDocument(uri);
  const baseDir = baseDirForDoc(doc);
  if (!baseDir) return;

  const directive = doc.lineAt(line).text;
  const pathMatch = directive.match(/#include\s+(?:<([^>]+)>|(\S+))/i);
  const incPath = (pathMatch?.[1] ?? pathMatch?.[2])?.trim();
  if (!incPath) return;

  const { fsPath, exists } = resolveIncludeFilePath(baseDir, incPath);
  const resolved = exists ? { fsPath, created: false } : await resolveOrCreateIncludeFile(baseDir, incPath);
  if (!resolved) return;
  if (resolved.created) {
    void vscode.window.setStatusBarMessage(`MCU-NR: создан include-файл ${incPath}`, 4000);
  }
  await openIncludeAsMcunr(resolved.fsPath);
}

/** Подсветка развёрнутого блока (лёгкий фон). */
function applyIncludeExpandedDecorations(editor: vscode.TextEditor, blocks: ExpandedIncludeBlock[]): void {
  const type = includeExpandedDecoration;
  if (!type) return;
  const ranges = blocks.map((b) => {
    const start = new vscode.Position(b.beginLine + 1, 0);
    const endLine = Math.max(b.beginLine + 1, b.endLine - 1);
    const endChar = editor.document.lineAt(endLine).text.length;
    return new vscode.Range(start, new vscode.Position(endLine, endChar));
  });
  editor.setDecorations(type, ranges);
}

let onIncludeDocumentOpened: (() => void) | undefined;

export function setIncludeDocumentOpenedHandler(handler: () => void): void {
  onIncludeDocumentOpened = handler;
}

let includeExpandedDecoration: vscode.TextEditorDecorationType | undefined;
let codeLensProvider: IncludeCodeLensProvider | undefined;

export function registerIncludePreview(context: vscode.ExtensionContext): void {
  includeExpandedDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.inactiveSelectionBackground"),
    isWholeLine: true,
  });
  context.subscriptions.push(includeExpandedDecoration);

  codeLensProvider = new IncludeCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "mcunr", scheme: "file" }, codeLensProvider)
  );

  const refresh = () => codeLensProvider?.refresh();
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === "mcunr") refresh();
    }),
    vscode.workspace.onDidOpenTextDocument((d) => {
      if (d.languageId === "mcunr") refresh();
    }),
    vscode.workspace.onDidCloseTextDocument(() => refresh()),
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.languageId !== "mcunr") return;
      const blocks = findExpandedBlocks(e.document.getText());
      if (!blocks.length) return;
      // Авто-свёртка: иначе на диск уйдёт вариант с маркерами вместо #include.
      e.waitUntil(Promise.resolve(buildCollapseEditsForSave(e.document)));
      void vscode.window.setStatusBarMessage(
        "MCU-NR: перед сохранением развёрнутые #include свёрнуты на диск",
        5000
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mcuhelper.expandIncludeInline", expandIncludeInline),
    vscode.commands.registerCommand("mcuhelper.collapseIncludeInline", collapseIncludeInline),
    vscode.commands.registerCommand("mcuhelper.openIncludeFile", openIncludeFile)
  );

  const refreshDecorations = (editor: vscode.TextEditor | undefined) => {
    if (!editor || editor.document.languageId !== "mcunr") return;
    applyIncludeExpandedDecorations(editor, findExpandedBlocks(editor.document.getText()));
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(refreshDecorations),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (e.textEditor.document.languageId === "mcunr") refreshDecorations(e.textEditor);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const ed = vscode.window.visibleTextEditors.find((x) => x.document === e.document);
      if (ed) refreshDecorations(ed);
    })
  );

  refreshDecorations(vscode.window.activeTextEditor);
}
