import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { isMcuOutputArtifact } from "./contentDetect";

interface EncodingDetectionResult {
  encoding: string;
  vscodeEncoding: string;
  confidence: number;
  shouldReopen: boolean;
}
type DetectFn = (buf: Buffer) => EncodingDetectionResult;
type MatchFn = (buf: Buffer, editorText: string) => boolean;
type ReadTextFn = (filePath: string) => string;
type EncodeFn = (text: string, encoding?: string) => Buffer;

/** Загрузка детектора из собранного mcu-language (общая логика с LSP и тестами). */
function loadEncodingModule(): {
  detect: DetectFn;
  diskMatches: MatchFn;
  readText: ReadTextFn;
  encode: EncodeFn;
} {
  const modPath = path.join(__dirname, "..", "..", "packages", "mcu-language", "dist", "encodingDetect.js");
  if (fs.existsSync(modPath)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(modPath) as {
      detectEncodingFromBuffer: DetectFn;
      diskTextMatchesEditor: MatchFn;
      readTextFileWithDetectedEncoding: ReadTextFn;
      encodeBuffer: EncodeFn;
    };
    return {
      detect: mod.detectEncodingFromBuffer,
      diskMatches: mod.diskTextMatchesEditor,
      readText: mod.readTextFileWithDetectedEncoding,
      encode: mod.encodeBuffer,
    };
  }
  return {
    detect: () => ({
      encoding: "utf8",
      vscodeEncoding: "utf8",
      confidence: 0,
      shouldReopen: false,
    }),
    diskMatches: () => true,
    readText: (filePath: string) => fs.readFileSync(filePath, "utf8"),
    encode: (text: string) => Buffer.from(text, "utf8"),
  };
}

const {
  detect: detectEncodingFromBuffer,
  diskMatches: diskTextMatchesEditor,
  readText: readTextFileWithDetectedEncoding,
  encode: encodeBuffer,
} = loadEncodingModule();

export { detectEncodingFromBuffer, diskTextMatchesEditor, readTextFileWithDetectedEncoding, encodeBuffer };

/** Запись текста с сохранением кодировки существующего файла (или UTF-8 для нового). */
export function writeTextFilePreservingEncoding(filePath: string, content: string): void {
  let encoding = "utf8";
  if (fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    encoding = detectEncodingFromBuffer(buf).encoding;
  }
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, encodeBuffer(content, encoding));
}

/** URI, для которых уже пробовали переоткрыть (защита от циклов). */
const attemptedReopen = new Set<string>();

function canAutoDetectEncoding(doc: vscode.TextDocument): boolean {
  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  if (!cfg.get<boolean>("autoDetectEncoding", true)) return false;
  if (doc.uri.scheme !== "file") return false;
  if (doc.isDirty) return false;
  // LST/FIN и пр. — не трогаем: workbench.action.reopenWithEncoding часто срывает вкладку.
  if (isMcuOutputArtifact(doc)) return false;
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
  const uri = doc.uri;

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
      await vscode.window.showTextDocument(uri, { preview: false });
    }

    await vscode.commands.executeCommand("workbench.action.reopenWithEncoding", {
      encoding: vscodeEncoding,
    });
    return true;
  } catch {
    // Команда часто бросает после закрытия вкладки — вернём файл на экран.
    try {
      await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: false });
    } catch {
      // ignore
    }
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
