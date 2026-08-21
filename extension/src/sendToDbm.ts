/**
 * ПКМ «Отправить в DBM»: состав MATR → *.DBM в MDBNR, в файле — NAME=lib + код.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { State } from "vscode-languageclient/node";
import { isMcunrDocument } from "./contentDetect";
import { readTextFileWithDetectedEncoding, writeTextFilePreservingEncoding } from "./encodingDetect";
import { getLastMcunrFocus } from "./waterSteamContext";

type DbmLibApi = {
  isDbmLibraryName: (name: string | undefined | null) => boolean;
  looksLikeLibMaterialCodeLine: (text: string) => boolean;
  listDbmLibrariesInRoot: (libRoot: string) => string[];
  resolveDbmFilePath: (libRoot: string, nameLib: string) => { fsPath: string; exists: boolean };
  findMatrCompositionSpan: (
    text: string,
    line: number
  ) => {
    headerLine: number;
    endLine: number;
    number: number;
    headerText: string;
    bodyLines: string[];
  } | null;
  extractDbmEntryFromMatrSpan: (
    span: {
      headerLine: number;
      endLine: number;
      number: number;
      headerText: string;
      bodyLines: string[];
    },
    materialCode: string
  ) =>
    | { ok: true; entry: { name: string; densType: 1 | 2; nuclides: Array<{ name: string; density: string; mods: string }> } }
    | { ok: false; error: string };
  upsertDbmMaterialInText: (
    dbmText: string,
    entry: { name: string; densType: 1 | 2; nuclides: Array<{ name: string; density: string; mods: string }> }
  ) => { text: string; replaced: boolean };
  listDbmExportEntries: (
    text: string
  ) => Array<{ name: string; densType: 1 | 2; nuclides: Array<{ name: string; density: string; mods: string }> }>;
  buildMatrDbmUsageBlock: (headerLine: string, libraryName: string, materialCode: string) => string;
  suggestDbmMaterialCode: (span: {
    headerLine: number;
    endLine: number;
    number: number;
    headerText: string;
    bodyLines: string[];
  }) => string;
};

function loadDbmApi(): DbmLibApi {
  const candidates = [
    path.join(__dirname, "..", "vendor", "mcu-language", "dbmLib.js"),
    path.join(__dirname, "..", "..", "packages", "mcu-language", "dist", "dbmLib.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(p) as DbmLibApi;
    }
  }
  throw new Error("dbmLib.js не найден. Выполните npm run build в корне проекта.");
}

function constantsLibPath(): string {
  return (vscode.workspace.getConfiguration("mcuhelper").get<string>("mcuConstantsLibPath") ?? "").trim();
}

async function resolveEditorAndLine(): Promise<
  { editor: vscode.TextEditor; doc: vscode.TextDocument; line: number } | undefined
> {
  const focus = getLastMcunrFocus();
  const ed = vscode.window.activeTextEditor;

  // ПКМ в редакторе — берём активный mcunr и текущую строку.
  if (ed && isMcunrDocument(ed.document)) {
    return { editor: ed, doc: ed.document, line: ed.selection.active.line };
  }

  // Команда из палитры/сайдбара: восстановить последний фокус в mcunr.
  if (!focus) return undefined;
  let doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === focus.uri);
  if (!doc) {
    try {
      doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(focus.uri));
    } catch {
      return undefined;
    }
  }
  if (!isMcunrDocument(doc)) return undefined;
  const editor =
    vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === focus.uri) ??
    (await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false }));
  return { editor, doc, line: focus.line };
}

async function pickLibraryName(api: DbmLibApi, libRoot: string): Promise<string | undefined> {
  const existing = api.listDbmLibrariesInRoot(libRoot);
  type Item = vscode.QuickPickItem & { id: string };
  const items: Item[] = [
    ...existing.map((n) => ({
      label: n,
      description: `${n}.DBM`,
      id: n,
    })),
    {
      label: "$(new-file) Новый файл .DBM…",
      description: "создать в корне MDBNR",
      id: "__new__",
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: "Библиотека материалов (.DBM)",
    placeHolder: "Выберите существующий файл или создайте новый",
  });
  if (!picked) return undefined;
  if (picked.id !== "__new__") return picked.id;

  const raw = await vscode.window.showInputBox({
    title: "Имя нового .DBM",
    prompt: "До 6 символов (NAME= в MATR), без расширения",
    placeHolder: "MYMAT",
    validateInput: (v) => {
      const t = v.trim();
      if (!t) return "Укажите имя";
      if (!api.isDbmLibraryName(t)) return "1–6 символов, не MCU/ZA (буква + буквы/цифры)";
      return undefined;
    },
  });
  return raw?.trim().toUpperCase();
}

async function pickMaterialCode(api: DbmLibApi, suggested: string): Promise<string | undefined> {
  const raw = await vscode.window.showInputBox({
    title: "Кодовое имя материала в .DBM",
    prompt: "Имя в библиотеке (как UO2) — одна строка состава MATR после экспорта",
    value: suggested,
    validateInput: (v) => {
      if (!api.looksLikeLibMaterialCodeLine(v.trim())) {
        return "1–6 символов: буква, затем буквы/цифры";
      }
      return undefined;
    },
  });
  return raw?.trim();
}

export async function sendMaterialToDbmCommand(client?: LanguageClient): Promise<boolean> {
  const api = loadDbmApi();
  const libRoot = constantsLibPath();
  if (!libRoot) {
    void vscode.window.showErrorMessage(
      "Не задан путь MDBNR (mcuhelper.mcuConstantsLibPath). Настройте пути MCU-NR."
    );
    return false;
  }
  if (!fs.existsSync(libRoot)) {
    void vscode.window.showErrorMessage(`Папка MDBNR не найдена:\n${libRoot}`);
    return false;
  }

  const ctx = await resolveEditorAndLine();
  if (!ctx) {
    void vscode.window.showWarningMessage("Откройте файл MCU-NR и поставьте курсор в секцию MATR.");
    return false;
  }

  const span = api.findMatrCompositionSpan(ctx.doc.getText(), ctx.line);
  if (!span) {
    void vscode.window.showWarningMessage(
      "Курсор не внутри блока MATR. Поставьте его на строку «MATR N …» или на нуклид состава (строка END после материала тоже допускается)."
    );
    return false;
  }

  const libraryName = await pickLibraryName(api, libRoot);
  if (!libraryName) return false;

  const materialCode = await pickMaterialCode(api, api.suggestDbmMaterialCode(span));
  if (!materialCode) return false;

  const extracted = api.extractDbmEntryFromMatrSpan(span, materialCode);
  if (!extracted.ok) {
    void vscode.window.showErrorMessage(extracted.error);
    return false;
  }

  const resolved = api.resolveDbmFilePath(libRoot, libraryName);
  let existingText = "";
  if (resolved.exists) {
    existingText = readTextFileWithDetectedEncoding(resolved.fsPath) ?? "";
    const already = api
      .listDbmExportEntries(existingText)
      .some((e) => e.name.toUpperCase() === materialCode.toUpperCase());
    if (already) {
      const overwrite = await vscode.window.showWarningMessage(
        `В ${libraryName}.DBM уже есть материал «${materialCode}». Заменить?`,
        { modal: true },
        "Заменить"
      );
      if (overwrite !== "Заменить") return false;
    }
  }

  const { text: dbmText, replaced } = api.upsertDbmMaterialInText(existingText, extracted.entry);
  const previousDbmSnapshot = resolved.exists ? existingText : null;
  try {
    if (!resolved.exists) {
      fs.writeFileSync(resolved.fsPath, dbmText, "utf8");
    } else {
      writeTextFilePreservingEncoding(resolved.fsPath, dbmText);
    }
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Не удалось записать ${path.basename(resolved.fsPath)}: ${e instanceof Error ? e.message : String(e)}`
    );
    return false;
  }

  const usage = api.buildMatrDbmUsageBlock(span.headerText, libraryName, materialCode);
  const start = new vscode.Position(span.headerLine, 0);
  const endLineText = ctx.doc.lineAt(span.endLine).text;
  const end = new vscode.Position(span.endLine, endLineText.length);
  const eol = ctx.doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const usageNormalized = usage.split(/\r?\n/).join(eol);

  const ok = await ctx.editor.edit((eb) => {
    eb.replace(new vscode.Range(start, end), usageNormalized);
  });
  if (!ok) {
    // Откат .DBM: иначе состав уже в библиотеке, а в варианте остался полный MATR.
    try {
      if (previousDbmSnapshot == null) {
        if (fs.existsSync(resolved.fsPath)) fs.unlinkSync(resolved.fsPath);
      } else {
        writeTextFilePreservingEncoding(resolved.fsPath, previousDbmSnapshot);
      }
    } catch {
      /* best-effort */
    }
    void vscode.window.showErrorMessage(
      "Не удалось заменить блок MATR в редакторе. Изменения в .DBM откатены."
    );
    return false;
  }

  if (client && client.state === State.Running) {
    try {
      await client.sendRequest("mcuhelper/reloadDbmLibraries");
    } catch {
      /* ignore */
    }
  }

  void vscode.window.showInformationMessage(
    replaced
      ? `MATR ${span.number} → ${materialCode} в ${libraryName}.DBM (обновлён)`
      : `MATR ${span.number} → ${materialCode} в ${libraryName}.DBM`
  );
  return true;
}

export function registerSendMaterialToDbm(
  context: vscode.ExtensionContext,
  getClient: () => LanguageClient | undefined
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("mcuhelper.sendMaterialToDbm", () =>
      sendMaterialToDbmCommand(getClient())
    )
  );
}
