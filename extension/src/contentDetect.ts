import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export interface McunrDetectionResult {
  isMcunr: boolean;
  score: number;
  hits: string[];
}

type DetectFn = (text: string) => boolean;
type ScoreFn = (text: string) => McunrDetectionResult;

/** Загрузка детектора из собранного mcu-language (общая логика с тестами). */
function loadDetector(): { detect: DetectFn; score: ScoreFn } {
  const detectPath = path.join(__dirname, "..", "..", "packages", "mcu-language", "dist", "detect.js");
  if (fs.existsSync(detectPath)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(detectPath) as {
      detectMcunrContent: DetectFn;
      scoreMcunrContent: ScoreFn;
    };
    return { detect: mod.detectMcunrContent, score: mod.scoreMcunrContent };
  }
  return { detect: () => false, score: () => ({ isMcunr: false, score: 0, hits: [] }) };
}

const { detect: detectMcunrContent, score: scoreMcunrContent } = loadDetector();

export { detectMcunrContent, scoreMcunrContent };

const DEFAULT_DETECT_FROM = ["plaintext", "txt", "log", "text", "ansi", "ini"];

function canAutoDetect(doc: vscode.TextDocument): boolean {
  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  if (!cfg.get<boolean>("autoDetectLanguage", true)) return false;
  if (doc.languageId === "mcunr") return false;
  if (doc.uri.scheme !== "file" && doc.uri.scheme !== "untitled") return false;
  const from = cfg.get<string[]>("autoDetectFromLanguages", DEFAULT_DETECT_FROM);
  return from.includes(doc.languageId);
}

/** Установить language id mcunr, если содержимое похоже на MCU-NR. */
export async function maybeSetMcunrLanguage(
  doc: vscode.TextDocument,
  log?: vscode.OutputChannel
): Promise<boolean> {
  if (!canAutoDetect(doc)) return false;

  const text = doc.getText();
  const result = scoreMcunrContent(text);
  if (!result.isMcunr) return false;

  try {
    await vscode.languages.setTextDocumentLanguage(doc, "mcunr");
    log?.appendLine(
      `Автоопределение MCU-NR: ${doc.uri.fsPath || doc.uri.toString()} (score=${result.score}, ${result.hits.join(", ")})`
    );
    return true;
  } catch (e) {
    log?.appendLine(`Не удалось установить язык mcunr: ${e}`);
    return false;
  }
}

export function isMcunrByContent(doc: vscode.TextDocument): boolean {
  if (doc.languageId === "mcunr") return true;
  return detectMcunrContent(doc.getText());
}

/** Документ MCU-NR: явный language id или сигнатуры в содержимом. */
export function isMcunrDocument(doc: vscode.TextDocument): boolean {
  return isMcunrByContent(doc);
}
