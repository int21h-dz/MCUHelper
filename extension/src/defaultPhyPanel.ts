import * as vscode from "vscode";
import * as path from "path";
import { isMcunrDocument } from "./contentDetect";
import { buildDefInsertText, resolveDefInsertPosition } from "./defInsertPosition";
import {
  type DefaultPhyBlock,
  type DefaultPhyDocument,
  type DefaultPhyRow,
  loadDefaultPhyMod,
} from "./defaultPhyLib";
import {
  type McuEncodingId,
  defaultPhyTargetPath,
  fileMtimeMs,
  isPathUnderLibRoot,
  listLibraryExtensions,
  loadDefaultPhyBytes,
  mergeOptionLists,
  resolveDefaultPhyPath,
  writeDefaultPhyAtomic,
} from "./defaultPhyHelpers";

interface PhyEditorState {
  filePath: string;
  encoding: McuEncodingId;
  mtimeMs: number;
  libRoot: string;
  doc: DefaultPhyDocument;
  dirty: boolean;
  underLibRoot: boolean;
}

export class DefaultPhyPanel {
  private panel: vscode.WebviewPanel | undefined;
  private state: PhyEditorState | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private phy() {
    return loadDefaultPhyMod();
  }

  async show(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("mcuhelper");
    const libRoot = (cfg.get<string>("mcuConstantsLibPath") ?? "").trim();
    if (!libRoot) {
      const pick = await vscode.window.showWarningMessage(
        "Не задан путь к библиотеке констант MDBNR.",
        "Настроить пути"
      );
      if (pick) await vscode.commands.executeCommand("mcuhelper.configureSolver");
      return;
    }

    let filePath = resolveDefaultPhyPath(libRoot);
    if (!filePath) {
      const pick = await vscode.window.showWarningMessage(
        `В корне MDBNR нет DEFAULT.PHY:\n${libRoot}`,
        "Создать шаблон",
        "Отмена"
      );
      if (pick !== "Создать шаблон") return;
      filePath = defaultPhyTargetPath(libRoot);
      writeDefaultPhyAtomic(filePath, this.phy().createMinimalDefaultPhyText(), "utf8");
    }

    await this.openFile(filePath, libRoot);

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.pushState();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "mcuhelper.defaultPhy",
      "MCU-NR: DEFAULT.PHY",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg) => void this.onMessage(msg));
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.state = undefined;
    });
  }

  private async openFile(filePath: string, libRoot: string): Promise<void> {
    const loaded = loadDefaultPhyBytes(filePath);
    const doc = this.phy().parseDefaultPhy(loaded.text);
    this.state = {
      filePath,
      encoding: loaded.encoding,
      mtimeMs: loaded.mtimeMs,
      libRoot,
      doc,
      dirty: false,
      underLibRoot: isPathUnderLibRoot(filePath, libRoot),
    };
    if (this.panel) {
      this.panel.title = `MCU-NR: ${path.basename(filePath)}`;
    }
  }

  private optionsPayload() {
    if (!this.state) return { ace: [] as string[], mods: [] as string[], pht: [] as string[] };
    const fromFile = this.phy().collectFieldOptions(this.state.doc);
    const fromLib = listLibraryExtensions(this.state.libRoot);
    return {
      ace: mergeOptionLists(fromFile.ace, fromLib.ace),
      mods: fromFile.mods,
      pht: mergeOptionLists(fromFile.pht, fromLib.pht),
    };
  }

  private rowsPayload(): DefaultPhyRow[] {
    if (!this.state) return [];
    return this.phy()
      .listDataRows(this.state.doc)
      .map((r, i) => ({ ...r, index: i + 1 }));
  }

  private pushState(): void {
    if (!this.panel || !this.state) return;
    this.panel.webview.postMessage({
      type: "state",
      filePath: this.state.filePath,
      encoding: this.state.encoding,
      dirty: this.state.dirty,
      underLibRoot: this.state.underLibRoot,
      fatal: this.state.doc.fatal,
      warnings: this.state.doc.warnings,
      rows: this.rowsPayload(),
      options: this.optionsPayload(),
    });
  }

  private markDirty(): void {
    if (!this.state) return;
    this.state.dirty = true;
    if (this.panel) {
      this.panel.title = `MCU-NR: ${path.basename(this.state.filePath)} •`;
    }
  }

  private applyRows(rows: DefaultPhyRow[]): void {
    if (!this.state) return;
    const result: DefaultPhyBlock[] = [];
    let ri = 0;
    let lastDataIdx = -1;
    for (const b of this.state.doc.blocks) {
      if (b.kind !== "data") {
        result.push(b);
        continue;
      }
      if (ri < rows.length) {
        result.push({
          kind: "data",
          row: { ...rows[ri], dirty: true, originalLine: undefined, index: 0 },
        });
        lastDataIdx = result.length - 1;
        ri += 1;
      }
    }
    while (ri < rows.length) {
      const block: DefaultPhyBlock = {
        kind: "data",
        row: { ...rows[ri], dirty: true, originalLine: undefined, index: 0 },
      };
      if (lastDataIdx >= 0) {
        result.splice(lastDataIdx + 1, 0, block);
        lastDataIdx += 1;
      } else {
        let i = 0;
        while (i < result.length && result[i]!.kind === "comment") i += 1;
        result.splice(i, 0, block);
        lastDataIdx = i;
      }
      ri += 1;
    }
    this.state.doc = {
      blocks: result,
      warnings: [],
      fatal: false,
      hasTerminator: true,
    };
    const check = this.phy().parseDefaultPhy(this.phy().serializeDefaultPhy(this.state.doc));
    this.state.doc.warnings = check.warnings.filter((w) => w.message !== "Отсутствует завершающая строка «#»");
    this.state.doc.fatal = false;
    this.state.doc.hasTerminator = true;
    this.markDirty();
  }

  private async onMessage(msg: unknown): Promise<void> {
    if (!msg || typeof msg !== "object") return;
    const m = msg as Record<string, unknown>;
    if (typeof m.type !== "string") return;

    if (m.type === "ready") {
      this.pushState();
      return;
    }

    if (!this.state) return;

    if (m.type === "change" && Array.isArray(m.rows)) {
      this.applyRows(m.rows as DefaultPhyRow[]);
      this.pushState();
      return;
    }

    if (m.type === "addRow") {
      const rows = this.rowsPayload();
      rows.push(this.phy().createDefaultPhyRow({ name: "NEW" }, rows.length + 1));
      this.applyRows(rows);
      this.pushState();
      return;
    }

    if (m.type === "deleteRows" && Array.isArray(m.indices)) {
      const remove = new Set((m.indices as number[]).map((n) => Number(n)));
      const rows = this.rowsPayload().filter((_, i) => !remove.has(i));
      this.applyRows(rows);
      this.pushState();
      return;
    }

    if (m.type === "save") {
      await this.saveCurrent(false);
      return;
    }

    if (m.type === "saveAs") {
      await this.saveAs();
      return;
    }

    if (m.type === "insertDef" && Array.isArray(m.indices)) {
      await this.insertDef(m.indices as number[]);
      return;
    }

    if (m.type === "discardReload") {
      await this.openFile(this.state.filePath, this.state.libRoot);
      this.pushState();
    }
  }

  private async confirmExternalChange(): Promise<boolean> {
    if (!this.state) return false;
    const mt = fileMtimeMs(this.state.filePath);
    if (mt == null || mt === this.state.mtimeMs) return true;
    const pick = await vscode.window.showWarningMessage(
      "Файл DEFAULT.PHY изменён извне. Перезаписать?",
      "Перезаписать",
      "Отмена"
    );
    return pick === "Перезаписать";
  }

  private async saveCurrent(isSaveAs: boolean): Promise<void> {
    if (!this.state) return;
    const phy = this.phy();
    const text = phy.serializeDefaultPhy(this.state.doc);
    const check = phy.parseDefaultPhy(text);
    if (check.fatal) {
      vscode.window.showErrorMessage("Нельзя сохранить: отсутствует завершающая строка «#» или фатальная ошибка.");
      return;
    }
    const hardWarnings = check.warnings.filter((w) => w.severity === "warning");
    if (hardWarnings.length > 0) {
      const pick = await vscode.window.showWarningMessage(
        `Предупреждения (${hardWarnings.length}): ${hardWarnings[0]!.message}. Сохранить всё равно?`,
        "Сохранить",
        "Отмена"
      );
      if (pick !== "Сохранить") return;
    }

    if (!isSaveAs && this.state.underLibRoot) {
      const pick = await vscode.window.showWarningMessage(
        "Запись в банк MDBNR влияет на все расчёты. Штатно MCU рекомендует карту DEF. Создать .bak и сохранить?",
        "Сохранить с .bak",
        "Отмена"
      );
      if (pick !== "Сохранить с .bak") return;
    }

    if (!(await this.confirmExternalChange())) return;

    try {
      writeDefaultPhyAtomic(this.state.filePath, text, this.state.encoding, {
        backup: !isSaveAs && this.state.underLibRoot,
      });
      const loaded = loadDefaultPhyBytes(this.state.filePath);
      this.state.doc = phy.parseDefaultPhy(loaded.text);
      this.state.mtimeMs = loaded.mtimeMs;
      this.state.encoding = loaded.encoding;
      this.state.dirty = false;
      if (this.panel) this.panel.title = `MCU-NR: ${path.basename(this.state.filePath)}`;
      this.pushState();
      vscode.window.showInformationMessage(`Сохранено: ${this.state.filePath}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Не удалось сохранить DEFAULT.PHY: ${err}`);
    }
  }

  private async saveAs(): Promise<void> {
    if (!this.state) return;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(this.state.filePath),
      filters: { PHY: ["phy", "PHY"] },
      saveLabel: "Сохранить как",
    });
    if (!uri) return;
    this.state.filePath = uri.fsPath;
    this.state.underLibRoot = isPathUnderLibRoot(uri.fsPath, this.state.libRoot);
    await this.saveCurrent(true);
  }

  private async insertDef(indices: number[]): Promise<void> {
    if (!this.state) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isMcunrDocument(editor.document)) {
      vscode.window.showWarningMessage("Откройте файл MCU-NR (.mcu) для вставки DEF");
      return;
    }
    const rows = this.rowsPayload();
    const selected = indices.map((i) => rows[i]).filter((r): r is DefaultPhyRow => !!r);
    if (!selected.length) {
      vscode.window.showWarningMessage("Выберите строки в таблице");
      return;
    }
    const defBody = this.phy().formatDefCards(selected);
    if (!defBody) return;

    const doc = editor.document;
    const lines: string[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      lines.push(doc.lineAt(i).text);
    }
    const cursor = editor.selection.active;
    const plan = resolveDefInsertPosition(lines, cursor.line, cursor.character);
    if (plan.reason === "no-pin") {
      vscode.window.showWarningMessage(
        "В файле нет карты PIN — вставка DEF после PIN невозможна"
      );
      return;
    }

    const insertText = buildDefInsertText(plan, defBody);
    const pos = new vscode.Position(plan.line, plan.character);
    const ok = await editor.edit((eb) => eb.insert(pos, insertText));
    if (!ok) return;

    const endOffset = doc.offsetAt(pos) + insertText.length;
    const endPos = doc.positionAt(endOffset);
    editor.selection = new vscode.Selection(endPos, endPos);
    editor.revealRange(new vscode.Range(pos, endPos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    vscode.window.showInformationMessage(`Вставлено карт DEF: ${selected.length}`);
  }

  private getHtml(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "defaultPhy", "defaultPhy.css")
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "defaultPhy", "defaultPhy.js")
    );
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${css}">
  <title>DEFAULT.PHY</title>
</head>
<body>
  <div id="root"></div>
  <script src="${js}"></script>
</body>
</html>`;
  }
}
