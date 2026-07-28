import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

interface EncodingDetectionResult {
  encoding: string;
  vscodeEncoding: string;
  confidence: number;
  shouldReopen: boolean;
}
type DetectFn = (buf: Buffer) => EncodingDetectionResult;
type MatchFn = (buf: Buffer, editorText: string) => boolean;

/** Загрузка детектора из собранного mcu-language (общая логика с LSP и тестами). */
function loadEncodingModule(): { detect: DetectFn; diskMatches: MatchFn } {
  const modPath = path.join(__dirname, "..", "..", "packages", "mcu-language", "dist", "encodingDetect.js");
  if (fs.existsSync(modPath)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(modPath) as {
      detectEncodingFromBuffer: DetectFn;
      diskTextMatchesEditor: MatchFn;
    };
    return { detect: mod.detectEncodingFromBuffer, diskMatches: mod.diskTextMatchesEditor };
  }
  return {
    detect: () => ({
      encoding: "utf8",
      vscodeEncoding: "utf8",
      confidence: 0,
      shouldReopen: false,
    }),
    diskMatches: () => true,
  };
}

const { detect: detectEncodingFromBuffer, diskMatches: diskTextMatchesEditor } = loadEncodingModule();

export { detectEncodingFromBuffer, diskTextMatchesEditor };

/** URI, для которых уже пробовали переоткрыть (защита от циклов). */
const attemptedReopen = new Set<string>();

function canAutoDetectEncoding(doc: vscode.TextDocument): boolean {
  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  if (!cfg.get<boolean>("autoDetectEncoding", true)) return false;
  if (doc.uri.scheme !== "file") return false;
  if (doc.isDirty) return false;
  return true;
}

function readDocumentEncoding(doc: vscode.TextDocument): string | undefined {
  const enc = (doc as { encoding?: string }).encoding;
  return typeof enc === "string" ? enc : undefined;
}

async function reopenDocumentWithEncoding(
  doc: vscode.TextDocument,
  vscodeEncoding: string
): Promise<boolean> {
  const uriKey = doc.uri.toString();

  try {
    const editor =
      vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uriKey) ??
      vscode.window.activeTextEditor;
    if (editor?.document.uri.toString() === uriKey) {
      await vscode.window.showTextDocument(editor.document, {
        preview: false,
        viewColumn: editor.viewColumn,
      });
    } else {
      await vscode.window.showTextDocument(doc.uri, { preview: false });
    }

    await vscode.commands.executeCommand("workbench.action.reopenWithEncoding", {
      encoding: vscodeEncoding,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Если файл на диске в другой кодировке (1251/866/…), переоткрыть документ в VS Code.
 * Вызывать до автоопределения языка — иначе PIN/MATR могут не распознаться.
 */
export async function maybeFixDocumentEncoding(
  doc: vscode.TextDocument,
  log?: vscode.OutputChannel,
  force = false
): Promise<boolean> {
  if (!force && !canAutoDetectEncoding(doc)) return false;

  const uriKey = doc.uri.toString();
  if (!force && attemptedReopen.has(uriKey)) return false;

  let buf: Buffer;
  try {
    buf = fs.readFileSync(doc.uri.fsPath);
  } catch {
    return false;
  }

  if (diskTextMatchesEditor(buf, doc.getText())) return false;

  const result = detectEncodingFromBuffer(buf);
  if (!force && !result.shouldReopen) return false;

  const currentEnc = readDocumentEncoding(doc);
  if (currentEnc && currentEnc.toLowerCase() === result.vscodeEncoding.toLowerCase()) return false;

  if (!force) attemptedReopen.add(uriKey);
  const ok = await reopenDocumentWithEncoding(doc, result.vscodeEncoding);
  if (ok) {
    log?.appendLine(
      `Кодировка определена автоматически: ${doc.uri.fsPath} → ${result.vscodeEncoding} (confidence=${result.confidence})`
    );
    return true;
  }

  if (!force) attemptedReopen.delete(uriKey);
  log?.appendLine(`Не удалось переоткрыть ${doc.uri.fsPath} в кодировке ${result.vscodeEncoding}`);
  return false;
}

/** Команда: определить кодировку активного файла и при необходимости переоткрыть. */
export async function detectEncodingCommand(log?: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    vscode.window.showWarningMessage("Откройте файл с диска");
    return;
  }

  attemptedReopen.delete(editor.document.uri.toString());

  const buf = fs.readFileSync(editor.document.uri.fsPath);
  const result = detectEncodingFromBuffer(buf);
  const matches = diskTextMatchesEditor(buf, editor.document.getText());

  if (matches) {
    vscode.window.showInformationMessage(
      `Кодировка уже подходит: ${result.vscodeEncoding}${result.encoding !== "utf8" ? ` (${result.encoding})` : ""}`
    );
    return;
  }

  if (await maybeFixDocumentEncoding(editor.document, log, true)) {
    vscode.window.showInformationMessage(`Файл переоткрыт в кодировке ${result.vscodeEncoding}`);
    return;
  }

  vscode.window.showInformationMessage(
    `Рекомендуемая кодировка: ${result.vscodeEncoding}. Если нужно, переоткройте файл через “Reopen with Encoding”.`
  );
}

export function clearEncodingAttempt(uri: string): void {
  attemptedReopen.delete(uri);
}
