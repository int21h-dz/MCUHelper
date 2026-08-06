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

export const DEFAULT_DETECT_FROM_LANGUAGES = ["plaintext", "txt", "log", "text", "ansi", "ini"];

/** Расширения выдачи MCU — не исходники варианта. */
const MCU_OUTPUT_EXTS = new Set([".lst", ".fin", ".dat", ".pmc", ".sys", ".rst", ".rgs"]);

/**
 * LST/FIN/DAT/… и промежуточный .MCU в `.mcuhelper-runs/` —
 * не гоняем auto-encoding / auto-language (иначе reopen срывает вкладку).
 */
export function isMcuOutputArtifactPath(fsPath: string): boolean {
  if (!fsPath) return false;
  const normalized = fsPath.replace(/\\/g, "/");
  const ext = path.extname(normalized).toLowerCase();
  if (MCU_OUTPUT_EXTS.has(ext)) return true;
  // Исходник часто `.mcu`; в temp-run лежит промежуточный `NAME.MCU`.
  if (ext === ".mcu" && /\/\.mcuhelper-runs\//i.test(normalized)) return true;
  return false;
}

export function isMcuOutputArtifact(doc: vscode.TextDocument): boolean {
  return doc.uri.scheme === "file" && isMcuOutputArtifactPath(doc.uri.fsPath);
}

/**
 * URI, для которых уже успешно выставили mcunr в этой сессии.
 * Нельзя сбрасывать на onDidClose: смена languageId сама закрывает/открывает документ.
 */
const lockedMcunrUris = new Set<string>();
/** Параллельные setTextDocumentLanguage по одному URI. */
const languageSetInFlight = new Map<string, Promise<boolean>>();
/** Антидребезг reclaim: без длинного cooldown (иначе язык застревает в ini). */
const lastSetAttemptAt = new Map<string, number>();
/** Минимум между попытками setLanguage — рвёт петлю ~100мс, но не бросает detect. */
const SET_DEBOUNCE_MS = 400;

function uriKey(doc: vscode.TextDocument): string {
  return doc.uri.toString();
}

/** Сброс lock (тесты / ручная смена языка). */
export function clearMcunrLanguageLock(uri?: string): void {
  if (uri) {
    lockedMcunrUris.delete(uri);
    languageSetInFlight.delete(uri);
    lastSetAttemptAt.delete(uri);
    return;
  }
  lockedMcunrUris.clear();
  languageSetInFlight.clear();
  lastSetAttemptAt.clear();
}

/** Документ-кандидат на автоопределение MCU-NR (plaintext/ini/untitled и т.п.). */
export function isLanguageDetectCandidate(doc: vscode.TextDocument): boolean {
  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  if (!cfg.get<boolean>("autoDetectLanguage", true)) return false;
  if (doc.languageId === "mcunr") return false;
  if (isMcuOutputArtifact(doc)) return false;
  if (doc.uri.scheme !== "file" && doc.uri.scheme !== "untitled") return false;
  const from = cfg.get<string[]>("autoDetectFromLanguages", DEFAULT_DETECT_FROM_LANGUAGES);
  return from.includes(doc.languageId);
}

/** Сразу переключить на mcunr при вставке из каталога (доверенный источник). */
export async function ensureMcunrLanguageForCatalog(
  doc: vscode.TextDocument,
  log?: vscode.OutputChannel
): Promise<boolean> {
  if (!isLanguageDetectCandidate(doc)) return doc.languageId === "mcunr";
  try {
    await vscode.languages.setTextDocumentLanguage(doc, "mcunr");
    log?.appendLine(`MCU-NR из каталога: ${doc.uri.fsPath || doc.uri.toString()}`);
    return true;
  } catch (e) {
    log?.appendLine(`Не удалось установить язык mcunr: ${e}`);
    return false;
  }
}

/** Установить language id mcunr, если содержимое похоже на MCU-NR. */
export async function maybeSetMcunrLanguage(
  doc: vscode.TextDocument,
  log?: vscode.OutputChannel
): Promise<boolean> {
  const key = uriKey(doc);

  if (doc.languageId === "mcunr") {
    lockedMcunrUris.add(key);
    return false;
  }

  const inFlight = languageSetInFlight.get(key);
  if (inFlight) return inFlight;

  if (!isLanguageDetectCandidate(doc)) return false;

  const text = doc.getText();
  const result = scoreMcunrContent(text);
  if (!result.isMcunr) return false;

  const now = Date.now();
  const lastAttempt = lastSetAttemptAt.get(key) ?? 0;
  if (now - lastAttempt < SET_DEBOUNCE_MS) return false;
  lastSetAttemptAt.set(key, now);

  const work = (async (): Promise<boolean> => {
    try {
      await vscode.languages.setTextDocumentLanguage(doc, "mcunr");
      lockedMcunrUris.add(key);
      await pinMcunrFileAssociation(doc, log);
      // Pin может примениться только после reopen — если снова ini, одна догоняющая попытка.
      const after = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
      if (after && after.languageId !== "mcunr" && scoreMcunrContent(after.getText()).isMcunr) {
        await vscode.languages.setTextDocumentLanguage(after, "mcunr");
      }
      log?.appendLine(
        `Автоопределение MCU-NR: ${doc.uri.fsPath || doc.uri.toString()} (score=${result.score}, ${result.hits.join(", ")})`
      );
      return true;
    } catch (e) {
      log?.appendLine(`Не удалось установить язык mcunr: ${e}`);
      return false;
    } finally {
      languageSetInFlight.delete(key);
    }
  })();

  languageSetInFlight.set(key, work);
  return work;
}

/**
 * Для файлов без .mcu/.mcunr (напр. «958») VS Code снова ставит ini.
 * Glob вида star-star/name в files.associations закрепляет mcunr и рвёт петлю мерцания.
 */
async function pinMcunrFileAssociation(
  doc: vscode.TextDocument,
  log?: vscode.OutputChannel
): Promise<void> {
  if (doc.uri.scheme !== "file") return;
  if (isMcuOutputArtifact(doc)) return;
  const base = path.basename(doc.uri.fsPath);
  const ext = path.extname(base).toLowerCase();
  if (ext === ".mcu" || ext === ".mcunr") return;

  try {
    const cfg = vscode.workspace.getConfiguration("files", doc.uri);
    const associations = { ...(cfg.get<Record<string, string>>("associations") ?? {}) };
    const rel = vscode.workspace.asRelativePath(doc.uri, false);
    const keys = new Set<string>();
    // Голый basename «958» VS Code часто не матчит — нужен **/958.
    keys.add(`**/${base}`);
    if (rel && rel !== doc.uri.fsPath && !path.isAbsolute(rel)) {
      keys.add(rel.replace(/\\/g, "/"));
    }

    let changed = false;
    for (const pinKey of keys) {
      if (associations[pinKey] === "mcunr") continue;
      associations[pinKey] = "mcunr";
      changed = true;
    }
    if (!changed) return;

    // files.associations не поддерживает Folder scope — только Workspace / User.
    await cfg.update("associations", associations, vscode.ConfigurationTarget.Workspace);
    log?.appendLine(`files.associations: ${[...keys].join(", ")} → mcunr (анти-мерцание)`);
  } catch (e) {
    log?.appendLine(`Не удалось записать files.associations: ${e}`);
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
