/**
 * Inline-просмотр/редактирование материала .DBM в варианте (аналог #include).
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { readTextFileWithDetectedEncoding, writeTextFilePreservingEncoding } from "./encodingDetect";
import {
  buildExpandedDbmBlock,
  collectCollapsedDbmUsages,
  extractExpandedDbmContent,
  findExpandedDbmBlocks,
  parseDbmBeginMarker,
  type ExpandedDbmBlock,
} from "./dbmPreviewCore";

type DbmPreviewApi = {
  isDbmLibraryName: (name: string | undefined | null) => boolean;
  resolveDbmFilePath: (libRoot: string, nameLib: string) => { fsPath: string; exists: boolean };
  loadDbmLibrary: (
    nameLib: string,
    libRoot?: string | null
  ) => {
    path?: string;
    materials: Map<
      string,
      {
        name: string;
        nuclideCount: number;
        densType: 1 | 2;
        nuclides: Array<{ name: string; density: string; mods: string }>;
      }
    >;
  } | null;
  formatDbmMaterialEntry: (entry: {
    name: string;
    densType: 1 | 2;
    nuclides: Array<{ name: string; density: string; mods: string }>;
  }) => string;
  listDbmExportEntries: (
    text: string
  ) => Array<{ name: string; densType: 1 | 2; nuclides: Array<{ name: string; density: string; mods: string }> }>;
  upsertDbmMaterialInText: (
    dbmText: string,
    entry: { name: string; densType: 1 | 2; nuclides: Array<{ name: string; density: string; mods: string }> }
  ) => { text: string; replaced: boolean };
  upsertDbmMaterialWithRename: (
    dbmText: string,
    entry: { name: string; densType: 1 | 2; nuclides: Array<{ name: string; density: string; mods: string }> },
    previousCode?: string | null
  ) => { text: string; replaced: boolean; renamedFrom: string | null };
  clearDbmCache: () => void;
};

function loadDbmApi(): DbmPreviewApi | null {
  const candidates = [
    path.join(__dirname, "..", "vendor", "mcu-language", "dbmLib.js"),
    path.join(__dirname, "..", "..", "packages", "mcu-language", "dist", "dbmLib.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(p) as DbmPreviewApi;
    }
  }
  return null;
}

function constantsLibPath(): string {
  return (vscode.workspace.getConfiguration("mcuhelper").get<string>("mcuConstantsLibPath") ?? "").trim();
}

function resolveDbmFsPath(library: string): { fsPath: string; exists: boolean } | null {
  const api = loadDbmApi();
  const libRoot = constantsLibPath();
  if (!api || !libRoot || !api.isDbmLibraryName(library)) return null;
  return api.resolveDbmFilePath(libRoot, library);
}

function formatEntryContent(
  api: DbmPreviewApi,
  library: string,
  code: string
): { content: string; nuclideCount: number } | null {
  const libRoot = constantsLibPath();
  const lib = api.loadDbmLibrary(library, libRoot);
  const entry = lib?.materials.get(code.toUpperCase());
  if (!entry) return null;
  return {
    content: api.formatDbmMaterialEntry({
      name: entry.name,
      densType: entry.densType,
      nuclides: entry.nuclides.map((n) => ({ name: n.name, density: n.density, mods: n.mods })),
    }),
    nuclideCount: entry.nuclideCount,
  };
}

class DbmCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== "mcunr") return [];
    const text = document.getText();
    const lenses: vscode.CodeLens[] = [];
    const api = loadDbmApi();

    for (const span of collectCollapsedDbmUsages(text)) {
      const lineText = document.lineAt(span.line);
      const range = new vscode.Range(span.line, 0, span.line, lineText.text.length);
      let countLabel = "?";
      if (api) {
        const packed = formatEntryContent(api, span.library, span.code);
        if (packed) countLabel = String(packed.nuclideCount);
      }
      lenses.push(
        new vscode.CodeLens(range, {
          title: `▸ Развернуть ${span.code} (${countLabel} нукл.)`,
          tooltip: `Показать состав из ${span.library}.DBM прямо в варианте (как #include)`,
          command: "mcuhelper.expandDbmInline",
          arguments: [document.uri.toString(), span.line, span.library, span.code],
        })
      );
    }

    for (const block of findExpandedDbmBlocks(text)) {
      const range = new vscode.Range(
        block.beginLine,
        0,
        block.beginLine,
        document.lineAt(block.beginLine).text.length
      );
      lenses.push(
        new vscode.CodeLens(range, {
          title: `▾ Свернуть ${block.code} → ${block.library}.DBM`,
          tooltip: "Записать состав в .DBM и вернуть кодовое имя",
          command: "mcuhelper.collapseDbmInline",
          arguments: [document.uri.toString(), block.beginLine],
        })
      );
    }

    return lenses;
  }
}

async function expandDbmInline(
  uriStr: string,
  line: number,
  library: string,
  code: string
): Promise<void> {
  const uri = vscode.Uri.parse(uriStr);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor =
    vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uriStr) ??
    vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== uriStr) return;

  const api = loadDbmApi();
  if (!api) {
    void vscode.window.showErrorMessage("MCU-NR: dbmLib не найден — выполните npm run build");
    return;
  }

  const resolved = resolveDbmFsPath(library);
  if (!resolved?.exists) {
    void vscode.window.showWarningMessage(
      `MCU-NR: ${library}.DBM не найден в MDBNR (mcuhelper.mcuConstantsLibPath)`
    );
    return;
  }

  const packed = formatEntryContent(api, library, code);
  if (!packed) {
    void vscode.window.showWarningMessage(`MCU-NR: материал ${code} не найден в ${library}.DBM`);
    return;
  }

  const codeLine = doc.lineAt(line);
  if (codeLine.text.trim().replace(/;.*/, "").trim().toUpperCase() !== code.toUpperCase()) {
    return;
  }

  const block = buildExpandedDbmBlock(library, code, packed.content);
  const ok = await editor.edit((eb) => {
    eb.replace(codeLine.rangeIncludingLineBreak, `${block}\n`);
  });
  if (!ok) return;

  editor.revealRange(new vscode.Range(line + 1, 0, line + 1, 0));
  void vscode.window.setStatusBarMessage(
    `MCU-NR: развёрнут ${code} из ${library}.DBM — правки пишутся в .DBM при свёртке/сохранении`,
    5000
  );
}

async function writeExpandedContentToDbm(
  api: DbmPreviewApi,
  library: string,
  expectedCode: string,
  content: string
): Promise<{ code: string; renamedFrom: string | null } | null> {
  const resolved = resolveDbmFsPath(library);
  if (!resolved) {
    void vscode.window.showErrorMessage(`MCU-NR: не задан путь MDBNR для ${library}.DBM`);
    return null;
  }

  const entries = api.listDbmExportEntries(content.endsWith("\n") ? content + "#" : `${content}\n#`);
  if (!entries.length) {
    void vscode.window.showErrorMessage(
      `MCU-NR: в развёртке ${expectedCode} нет валидного заголовка материала .DBM`
    );
    return null;
  }
  const entry = entries[0]!;
  let dbmText = "";
  try {
    dbmText = resolved.exists ? readTextFileWithDetectedEncoding(resolved.fsPath) : "#\n";
  } catch (e) {
    void vscode.window.showErrorMessage(`MCU-NR: не удалось прочитать ${library}.DBM: ${e}`);
    return null;
  }

  const upsert =
    typeof api.upsertDbmMaterialWithRename === "function"
      ? api.upsertDbmMaterialWithRename(dbmText, entry, expectedCode)
      : { ...api.upsertDbmMaterialInText(dbmText, entry), renamedFrom: null as string | null };
  try {
    if (!fs.existsSync(path.dirname(resolved.fsPath))) {
      fs.mkdirSync(path.dirname(resolved.fsPath), { recursive: true });
    }
    writeTextFilePreservingEncoding(resolved.fsPath, upsert.text);
    api.clearDbmCache();
  } catch (e) {
    void vscode.window.showErrorMessage(`MCU-NR: не удалось сохранить ${library}.DBM: ${e}`);
    return null;
  }
  return { code: entry.name, renamedFrom: upsert.renamedFrom };
}

async function collapseDbmInline(uriStr: string, beginLine: number): Promise<void> {
  const uri = vscode.Uri.parse(uriStr);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor =
    vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uriStr) ??
    vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== uriStr) return;

  const api = loadDbmApi();
  if (!api) return;

  const beginText = doc.lineAt(beginLine).text;
  const directive = parseDbmBeginMarker(beginText);
  if (!directive) return;

  const block = findExpandedDbmBlocks(doc.getText()).find((b) => b.beginLine === beginLine);
  if (!block) return;

  const lines = doc.getText().split(/\r?\n/);
  const content = extractExpandedDbmContent(lines, block.beginLine, block.endLine);
  const written = await writeExpandedContentToDbm(api, block.library, block.code, content);
  if (!written) return;

  const start = doc.lineAt(block.beginLine).rangeIncludingLineBreak.start;
  const end = doc.lineAt(block.endLine).rangeIncludingLineBreak.end;
  const ok = await editor.edit((eb) => {
    eb.replace(new vscode.Range(start, end), `${written.code}\n`);
  });
  if (ok) {
    editor.revealRange(new vscode.Range(block.beginLine, 0, block.beginLine, 0));
    const renameNote = written.renamedFrom
      ? ` (переименован с ${written.renamedFrom})`
      : "";
    void vscode.window.setStatusBarMessage(
      `MCU-NR: ${written.code} записан в ${block.library}.DBM${renameNote}`,
      4000
    );
  }
}

/** Перед save: записать .DBM и вернуть кодовые имена (как у #include).
 * Collapse только для блоков, успешно записанных в MDBNR — иначе риск потери состава.
 */
export function buildCollapseEditsForDbmSave(doc: vscode.TextDocument): vscode.TextEdit[] {
  const api = loadDbmApi();
  if (!api) {
    void vscode.window.showErrorMessage(
      "MCU-NR: dbmLib не найден — развёртки .DBM не свёрнуты. Выполните npm run build."
    );
    return [];
  }
  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const blocks = findExpandedDbmBlocks(text);
  if (!blocks.length) return [];

  const edits: vscode.TextEdit[] = [];
  const failures: string[] = [];
  const renames: string[] = [];

  for (const block of [...blocks].sort((a, b) => b.beginLine - a.beginLine)) {
    const content = extractExpandedDbmContent(lines, block.beginLine, block.endLine);
    const entries = api.listDbmExportEntries(content.endsWith("\n") ? content + "#" : `${content}\n#`);
    const entry = entries[0];
    if (!entry) {
      failures.push(`${block.library}/${block.code}: нет валидного заголовка .DBM`);
      continue;
    }

    const resolved = resolveDbmFsPath(block.library);
    if (!resolved) {
      failures.push(`${block.library}/${block.code}: не задан путь MDBNR`);
      continue;
    }

    try {
      const dbmText = resolved.exists ? readTextFileWithDetectedEncoding(resolved.fsPath) : "#\n";
      const upsert =
        typeof api.upsertDbmMaterialWithRename === "function"
          ? api.upsertDbmMaterialWithRename(dbmText, entry, block.code)
          : { ...api.upsertDbmMaterialInText(dbmText, entry), renamedFrom: null as string | null };
      if (!fs.existsSync(path.dirname(resolved.fsPath))) {
        fs.mkdirSync(path.dirname(resolved.fsPath), { recursive: true });
      }
      writeTextFilePreservingEncoding(resolved.fsPath, upsert.text);
      api.clearDbmCache();
      if (upsert.renamedFrom) {
        renames.push(`${upsert.renamedFrom} → ${entry.name} в ${block.library}.DBM`);
      }
    } catch (e) {
      failures.push(
        `${block.library}/${block.code}: ${e instanceof Error ? e.message : String(e)}`
      );
      continue;
    }

    const start = doc.lineAt(block.beginLine).rangeIncludingLineBreak.start;
    const end = doc.lineAt(block.endLine).rangeIncludingLineBreak.end;
    edits.push(vscode.TextEdit.replace(new vscode.Range(start, end), `${entry.name}\n`));
  }

  if (failures.length) {
    void vscode.window.showErrorMessage(
      `MCU-NR: .DBM не записан — развёртка оставлена в файле:\n${failures.slice(0, 3).join("\n")}` +
        (failures.length > 3 ? `\n…ещё ${failures.length - 3}` : "")
    );
  }
  if (renames.length) {
    void vscode.window.showWarningMessage(
      `MCU-NR: кодовое имя в .DBM изменено (старое удалено):\n${renames.slice(0, 3).join("\n")}`
    );
  }
  return edits;
}

function applyDbmExpandedDecorations(editor: vscode.TextEditor, blocks: ExpandedDbmBlock[]): void {
  const type = dbmExpandedDecoration;
  if (!type) return;
  const ranges = blocks.map((b) => {
    const start = new vscode.Position(b.beginLine + 1, 0);
    const endLine = Math.max(b.beginLine + 1, b.endLine - 1);
    const endChar = editor.document.lineAt(endLine).text.length;
    return new vscode.Range(start, new vscode.Position(endLine, endChar));
  });
  editor.setDecorations(type, ranges);
}

let dbmExpandedDecoration: vscode.TextEditorDecorationType | undefined;
let codeLensProvider: DbmCodeLensProvider | undefined;

export function registerDbmPreview(context: vscode.ExtensionContext): void {
  dbmExpandedDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.inactiveSelectionBackground"),
    isWholeLine: true,
  });
  context.subscriptions.push(dbmExpandedDecoration);

  codeLensProvider = new DbmCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "mcunr", scheme: "file" }, codeLensProvider),
    vscode.languages.registerCodeLensProvider({ language: "mcunr", scheme: "untitled" }, codeLensProvider)
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
      const blocks = findExpandedDbmBlocks(e.document.getText());
      if (!blocks.length) return;
      const edits = buildCollapseEditsForDbmSave(e.document);
      if (!edits.length) return;
      e.waitUntil(Promise.resolve(edits));
      void vscode.window.setStatusBarMessage(
        "MCU-NR: перед сохранением развёрнутые .DBM свёрнуты и записаны в MDBNR",
        5000
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mcuhelper.expandDbmInline", expandDbmInline),
    vscode.commands.registerCommand("mcuhelper.collapseDbmInline", collapseDbmInline)
  );

  const refreshDecorations = (editor: vscode.TextEditor | undefined) => {
    if (!editor || editor.document.languageId !== "mcunr") return;
    applyDbmExpandedDecorations(editor, findExpandedDbmBlocks(editor.document.getText()));
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
