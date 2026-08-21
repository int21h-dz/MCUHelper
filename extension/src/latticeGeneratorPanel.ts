import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { isMcunrDocument } from "./contentDetect";
import {
  loadLatticeGeneratorApi,
  type LatticeGeneratorInput,
} from "./mcuLanguageBridge";

type HostMsg =
  | { type: "ready" }
  | { type: "setForm"; form: LatticeGeneratorInput }
  | { type: "preview" }
  | { type: "insert" }
  | { type: "replace" }
  | { type: "fromContext" }
  | { type: "clearContext" }
  | { type: "requestContext" }
  | { type: "insertLcell"; name: string };

type BoundLattice = {
  uri: vscode.Uri;
  startLine: number;
  endLine: number;
};

type ContextPayload = {
  lcellNames: string[];
  zoneNames: string[];
  docLabel: string;
  canReplace: boolean;
  boundLabel: string;
};

/**
 * Webview-конструктор LATT GLTL (UserGuide §9.2.6.1).
 * LISTEL = упорядоченный список прототипов; PARM = [/n] x,y,z.
 * Автооткрытие при курсоре в блоке LATT GLTL — как live body preview.
 */
const AUTO_DEBOUNCE_MS = 180;

function liveLatticeEnabled(): boolean {
  return vscode.workspace.getConfiguration("mcuhelper").get<boolean>("liveLatticeGenerator", true);
}

export class LatticeGeneratorPanel {
  private panel: vscode.WebviewPanel | undefined;
  private client: LanguageClient | undefined;
  private form: LatticeGeneratorInput;
  private lastUri: vscode.Uri | undefined;
  private lastLine = 0;
  private bound: BoundLattice | undefined;
  private editorWatch: vscode.Disposable[] = [];
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private userClosed = false;
  private watching = false;
  private lastAutoKey = "";

  constructor(private readonly context: vscode.ExtensionContext) {
    try {
      this.form = loadLatticeGeneratorApi().defaultLatticeGeneratorInput();
    } catch {
      this.form = {
        latticeType: "GLTL",
        zoneName: "ZL",
        elements: ["Pogl20", "TVS281", "PustY2"],
        cols: 4,
        rows: 4,
        iMin: 0,
        iMax: 3,
        jMin: 0,
        jMax: 3,
        vectorA: ["0", "0", "0"],
        vectorB: ["25", "0", "0"],
        vectorC: ["0", "25", "0"],
        cartogram: [],
        placements: [{ element: "Pogl20", protoIndex: 1, x: "0", y: "0", z: "0" }],
        lfixso: "",
        lblack: "",
        footprints: [],
      };
    }
    this.form.latticeType = "GLTL";
  }

  setClient(client?: LanguageClient): void {
    this.client = client;
  }

  /** Первый кадр, если при активации курсор уже в LATT GLTL. */
  nudge(): void {
    this.scheduleAuto();
  }

  watch(): void {
    if (this.watching) return;
    this.watching = true;
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleAuto()),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (!isMcunrDocument(e.textEditor.document)) return;
        this.scheduleAuto();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("mcuhelper.liveLatticeGenerator")) this.scheduleAuto();
      })
    );
  }

  async show(opts?: { fromCommand?: boolean; client?: LanguageClient }): Promise<void> {
    if (opts?.client) this.client = opts.client;
    if (opts?.fromCommand) this.userClosed = false;
    this.rememberEditor();
    if (!this.ensurePanel(true)) return;
    this.watchEditors();
    this.panel!.webview.html = this.getHtml(this.panel!.webview);
    await this.tryLoadFromContext(false, { allowNearest: true });
    await this.pushState();
  }

  private scheduleAuto(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      this.autoTimer = undefined;
      void this.refreshFromCursor();
    }, AUTO_DEBOUNCE_MS);
  }

  /** Курсор в блоке LATT GLTL → открыть/подгрузить (без nearest по файлу). */
  private async refreshFromCursor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isMcunrDocument(editor.document)) return;

    this.lastUri = editor.document.uri;
    this.lastLine = editor.selection.active.line;

    const hit = this.gltlBlockAtCursor(editor.document, this.lastLine);
    if (!hit) return;

    const key = `${editor.document.uri.toString()}:${hit.startLine}`;
    if (this.panel && key === this.lastAutoKey) return;

    if (!this.ensurePanel(false)) return;
    if (!this.panel) return;

    const loaded = await this.tryLoadFromContext(false, { allowNearest: false });
    if (!loaded) return;
    this.lastAutoKey = key;
    await this.pushState();
  }

  private gltlBlockAtCursor(
    doc: vscode.TextDocument,
    line: number
  ): { startLine: number; endLine: number } | null {
    try {
      const api = loadLatticeGeneratorApi();
      const lines = doc.getText().replace(/\r\n/g, "\n").split("\n");
      const range = api.findLatticeBlockAtLine(lines, line);
      if (!range) return null;
      // только если курсор реально внутри блока (не «ближайший ниже»)
      if (line < range.startLine || line > range.endLine) return null;
      if (!/^\s*LATT\s+GLTL\b/i.test(lines[range.startLine] ?? "")) return null;
      return range;
    } catch {
      return null;
    }
  }

  private ensurePanel(focus: boolean): boolean {
    if (this.panel) {
      if (focus) this.panel.reveal(vscode.ViewColumn.Beside, true);
      return true;
    }
    if (this.userClosed && !focus) return false;
    if (!focus && !liveLatticeEnabled()) return false;

    this.panel = vscode.window.createWebviewPanel(
      "mcuhelper.latticeGenerator",
      "MCU-NR: Решётка GLTL",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      }
    );
    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg: HostMsg) => void this.onMessage(msg));
    this.panel.onDidDispose(() => {
      this.disposeWatches();
      this.panel = undefined;
      this.userClosed = true;
      this.lastAutoKey = "";
    });
    this.watchEditors();
    return true;
  }

  private disposeWatches(): void {
    for (const d of this.editorWatch) d.dispose();
    this.editorWatch = [];
  }

  private watchEditors(): void {
    this.disposeWatches();
    this.editorWatch = [
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.rememberEditor();
        void this.pushContextOnly();
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor.document.uri.toString() === this.lastUri?.toString()) {
          this.lastLine = e.textEditor.selection.active.line;
        }
      }),
    ];
  }

  private rememberEditor(): void {
    const ed = vscode.window.activeTextEditor;
    if (ed && isMcunrDocument(ed.document)) {
      this.lastUri = ed.document.uri;
      this.lastLine = ed.selection.active.line;
    }
  }

  private targetUri(): vscode.Uri | undefined {
    const ed = vscode.window.activeTextEditor;
    if (ed && isMcunrDocument(ed.document)) return ed.document.uri;
    return this.lastUri;
  }

  private async onMessage(msg: HostMsg): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.pushState();
        break;
      case "setForm":
        this.form = this.normalizeForm(msg.form);
        await this.pushPreview();
        break;
      case "preview":
        await this.pushPreview();
        break;
      case "insert":
        await this.insertIntoEditor(false);
        break;
      case "replace":
        await this.insertIntoEditor(true);
        break;
      case "fromContext":
        this.rememberEditor();
        await this.tryLoadFromContext(true, { allowNearest: true });
        await this.pushState();
        break;
      case "clearContext":
        this.bound = undefined;
        await this.pushContextOnly();
        break;
      case "requestContext":
        await this.pushContextOnly();
        break;
      case "insertLcell":
        await this.insertLcellStub(msg.name);
        break;
      default:
        break;
    }
  }

  private normalizeForm(raw: LatticeGeneratorInput): LatticeGeneratorInput {
    const elements = (raw.elements ?? [])
      .map((e) => String(e ?? "").trim())
      .filter(Boolean);
    const placements = (raw.placements ?? []).map((p) => {
      const element = String(p.element ?? "").trim();
      let protoIndex =
        typeof p.protoIndex === "number" && p.protoIndex >= 1
          ? Math.floor(p.protoIndex)
          : elements.indexOf(element) + 1;
      if (protoIndex < 1) protoIndex = 1;
      return {
        element: elements[protoIndex - 1] ?? element,
        protoIndex,
        x: String(p.x ?? "0"),
        y: String(p.y ?? "0"),
        z: String(p.z ?? "0"),
      };
    });
    return {
      latticeType: "GLTL",
      zoneName: String(raw.zoneName ?? "ZL").trim() || "ZL",
      elements: elements.length ? elements : ["A"],
      cols: 1,
      rows: 1,
      iMin: 0,
      iMax: 0,
      jMin: 0,
      jMax: 0,
      vectorA: ["0", "0", "0"],
      vectorB: ["1", "0", "0"],
      vectorC: ["0", "1", "0"],
      cartogram: [],
      placements: placements.length
        ? placements
        : [{ element: elements[0] ?? "A", protoIndex: 1, x: "0", y: "0", z: "0" }],
      lfixso: String(raw.lfixso ?? "").trim(),
      lblack: String(raw.lblack ?? "").trim(),
      footprints: Array.isArray(raw.footprints) ? raw.footprints : [],
    };
  }

  private async tryLoadFromContext(
    notify: boolean,
    opts?: { allowNearest?: boolean }
  ): Promise<boolean> {
    const uri = this.targetUri();
    try {
      return await this.tryLoadFromContextInner(notify, uri, opts?.allowNearest !== false);
    } catch (err) {
      this.bound = undefined;
      if (notify) {
        vscode.window.showErrorMessage(
          `Конструктор GLTL: ${(err instanceof Error ? err.message : String(err)).slice(0, 180)}`
        );
      }
      return false;
    }
  }

  private async tryLoadFromContextInner(
    notify: boolean,
    uri: vscode.Uri | undefined,
    allowNearest: boolean
  ): Promise<boolean> {
    if (!uri) {
      if (notify) vscode.window.showWarningMessage("Откройте файл MCU-NR.");
      return false;
    }
    this.rememberEditor();
    const doc = await vscode.workspace.openTextDocument(uri);
    const api = loadLatticeGeneratorApi();
    const text = doc.getText();
    const uriStr = uri.toString();
    const lines = text.replace(/\r\n/g, "\n").split("\n");

    // 1) строка курсора → блок LATT; иначе (только по кнопке) ближайший GLTL
    let line = this.lastLine;
    let range = api.findLatticeBlockAtLine(lines, line);
    if (range && (line < range.startLine || line > range.endLine)) {
      range = null;
    }
    if (!range || !/^\s*LATT\s+GLTL\b/i.test(lines[range.startLine] ?? "")) {
      if (!allowNearest) {
        this.bound = undefined;
        return false;
      }
      const near =
        api.findNearestGltlLatticeLine?.(text, line) ??
        lines.findIndex((l) => /^\s*LATT\s+GLTL\b/i.test(l));
      if (near >= 0) {
        line = near;
        range = api.findLatticeBlockAtLine(lines, line);
      }
    }
    if (!range) {
      this.bound = undefined;
      if (notify) {
        vscode.window.showInformationMessage("В файле нет блока LATT GLTL.");
      }
      return false;
    }

    // 2) PARM/LISTEL из текста блока редактора (как в файле)
    const block = lines.slice(range.startLine, range.endLine + 1).join("\n");
    const fromText = api.parseLatticeBlockText(block);
    if (!fromText || fromText.latticeType !== "GLTL") {
      this.bound = undefined;
      if (notify) {
        vscode.window.showWarningMessage("Блок LATT не разобран как GLTL.");
      }
      return false;
    }

    // 3) полный разбор (AST + footprints) поверх текста
    let hit =
      api.parseGltlLatticeAtLine?.(text, range.startLine, { uri: uriStr }) ??
      (() => {
        const h = api.parseLatticeAtLine(text, range!.startLine);
        return h && h.input.latticeType === "GLTL" ? h : null;
      })();

    const input = hit?.input ?? fromText;
    // текст блока побеждает по placements/elements, если он полнее
    if (fromText.elements.length >= (input.elements?.length ?? 0)) {
      input.elements = fromText.elements;
    }
    if (fromText.placements.length >= (input.placements?.length ?? 0)) {
      input.placements = fromText.placements;
    }
    input.zoneName = fromText.zoneName || input.zoneName;
    input.lfixso = fromText.lfixso || input.lfixso;
    input.lblack = fromText.lblack || input.lblack;
    input.latticeType = "GLTL";

    // LISTEL как в сайдбаре
    if (this.client) {
      try {
        const index = (await this.client.sendRequest("mcuhelper/getIndex", {
          uri: uriStr,
          line: range.startLine,
          character: 0,
        })) as {
          summaries?: {
            lattices?: Array<{
              latticeType: string;
              elements: Array<{ name: string }>;
              range: { start: { line: number }; end: { line: number } };
            }>;
          };
        };
        const match = (index.summaries?.lattices ?? []).find(
          (l) =>
            l.latticeType.toUpperCase() === "GLTL" &&
            l.range.start.line >= range!.startLine - 2 &&
            l.range.start.line <= range!.endLine
        );
        if (match?.elements?.length) {
          const names = match.elements.map((e) => e.name).filter(Boolean);
          if (names.length >= input.elements.length) {
            input.elements = names;
            input.placements = (input.placements ?? []).map((p) => {
              const i =
                p.protoIndex && p.protoIndex >= 1
                  ? p.protoIndex
                  : Math.max(1, names.indexOf(p.element) + 1);
              return { ...p, protoIndex: i, element: names[i - 1] ?? p.element };
            });
          }
        }
      } catch {
        /* optional */
      }
    }

    input.footprints =
      api.ensureLcellFootprints?.(text, input.elements, input.footprints) ??
      input.footprints ??
      [];

    this.form = this.normalizeForm(input);
    this.bound = {
      uri: doc.uri,
      startLine: range.startLine,
      endLine: range.endLine,
    };
    this.lastAutoKey = `${doc.uri.toString()}:${range.startLine}`;
    if (notify) {
      const g = api.inferGltlGridSize?.(this.form.placements);
      const grid = g ? ` · ${g.cols}×${g.rows}` : "";
      const fp = this.form.footprints.filter((f) => f.shapes.length > 0).length;
      vscode.window.showInformationMessage(
        `GLTL ← стр.${range.startLine + 1}: ${this.form.elements.join(", ")} · ${this.form.placements.length} сдвигов${grid} · контуров ${fp}/${this.form.elements.length}`
      );
    }
    return true;
  }

  private async fetchContext(): Promise<ContextPayload> {
    const uri = this.targetUri();
    const docLabel = uri ? uri.fsPath.replace(/\\/g, "/").split("/").pop() ?? "" : "";
    const canReplace = Boolean(this.bound);
    const boundLabel = this.bound
      ? `GLTL ${this.form.zoneName} · стр. ${this.bound.startLine + 1}–${this.bound.endLine + 1}`
      : "";
    if (!this.client || !uri) {
      return { lcellNames: [], zoneNames: [], docLabel, canReplace, boundLabel };
    }
    try {
      const index = (await this.client.sendRequest("mcuhelper/getIndex", {
        uri: uri.toString(),
      })) as {
        summaries?: {
          bodies?: Array<{ scope?: string }>;
          lattices?: Array<{ elements?: Array<{ name: string }> }>;
          zones?: Array<{ name: string }>;
        };
      };
      const fromBodies = (index.summaries?.bodies ?? [])
        .map((b) => b.scope)
        .filter((s): s is string => Boolean(s && s.startsWith("lcell:")))
        .map((s) => s.slice("lcell:".length));
      const fromLattices = (index.summaries?.lattices ?? []).flatMap((l) =>
        (l.elements ?? []).map((e) => e.name)
      );
      return {
        lcellNames: [...new Set([...fromBodies, ...fromLattices].filter(Boolean))],
        zoneNames: [...new Set((index.summaries?.zones ?? []).map((z) => z.name).filter(Boolean))],
        docLabel,
        canReplace,
        boundLabel,
      };
    } catch {
      return { lcellNames: [], zoneNames: [], docLabel, canReplace, boundLabel };
    }
  }

  private async pushContextOnly(): Promise<void> {
    if (!this.panel) return;
    const ctx = await this.fetchContext();
    await this.panel.webview.postMessage({ type: "context", ...ctx });
  }

  private async pushPreview(): Promise<void> {
    if (!this.panel) return;
    const built = loadLatticeGeneratorApi().buildGltlLatticeStatement(this.form);
    await this.panel.webview.postMessage({
      type: "preview",
      text: built.text,
      warnings: built.warnings,
      okToInsert: built.okToInsert,
      canReplace: Boolean(this.bound),
    });
  }

  private async pushState(): Promise<void> {
    if (!this.panel) return;
    await this.panel.webview.postMessage({ type: "form", form: this.form });
    await this.pushContextOnly();
    await this.pushPreview();
  }

  private async insertIntoEditor(replace: boolean): Promise<void> {
    const uri = replace && this.bound ? this.bound.uri : this.targetUri();
    if (!uri) {
      vscode.window.showWarningMessage("Откройте файл MCU-NR и снова нажмите действие.");
      return;
    }
    this.form = this.normalizeForm(this.form);
    const built = loadLatticeGeneratorApi().buildGltlLatticeStatement(this.form);
    if (!built.okToInsert) {
      vscode.window.showWarningMessage(built.warnings[0] ?? "Исправьте параметры.");
      return;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    const text = built.text.replace(/\n$/, "") + "\n";

    if (replace && this.bound && this.bound.uri.toString() === doc.uri.toString()) {
      const start = new vscode.Position(this.bound.startLine, 0);
      const endLine = Math.min(this.bound.endLine, doc.lineCount - 1);
      const end = doc.lineAt(endLine).rangeIncludingLineBreak.end;
      edit.replace(doc.uri, new vscode.Range(start, end), text);
    } else {
      const line = Math.max(0, Math.min(this.lastLine, Math.max(0, doc.lineCount - 1)));
      const lineText = doc.lineAt(line).text;
      if (lineText.trim().length === 0) {
        edit.insert(doc.uri, new vscode.Position(line, 0), text);
      } else {
        edit.insert(doc.uri, new vscode.Position(line, lineText.length), `\n${text}`);
      }
    }

    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      vscode.window.showErrorMessage(replace ? "Не удалось заменить решётку" : "Не удалось вставить решётку");
      return;
    }

    if (replace && this.bound) {
      const newLines = text.replace(/\n$/, "").split("\n").length;
      this.bound = {
        uri: doc.uri,
        startLine: this.bound.startLine,
        endLine: this.bound.startLine + newLines - 1,
      };
    }

    vscode.window.showInformationMessage(
      replace ? "LATT GLTL заменена (Undo)." : "LATT GLTL вставлена (Undo)."
    );
    await this.pushContextOnly();
  }

  private async insertLcellStub(name: string): Promise<void> {
    const uri = this.targetUri();
    if (!uri) {
      vscode.window.showWarningMessage("Откройте файл MCU-NR.");
      return;
    }
    const built = loadLatticeGeneratorApi().buildLcellStub(name);
    if (!built.okToInsert) {
      vscode.window.showWarningMessage(built.warnings[0] ?? "Некорректное имя LCELL.");
      return;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    const line = Math.max(0, Math.min(this.lastLine, Math.max(0, doc.lineCount - 1)));
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(line, 0), built.text);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      vscode.window.showErrorMessage("Не удалось вставить LCELL");
      return;
    }
    if (!this.form.elements.includes(name.trim())) {
      this.form.elements = [...this.form.elements, name.trim()];
    }
    vscode.window.showInformationMessage(`LCELL ${name.trim()} вставлена (Undo).`);
    await this.pushState();
  }

  private getHtml(webview: vscode.Webview): string {
    const bust = String(Date.now());
    const css = webview
      .asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "media", "latticeGenerator", "latticeGenerator.css")
      )
      .with({ query: `v=${bust}` });
    const js = webview
      .asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "media", "latticeGenerator", "latticeGenerator.js")
      )
      .with({ query: `v=${bust}` });
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${css}" />
  <title>Решётка GLTL</title>
</head>
<body>
  <div id="root"><p style="padding:16px;opacity:.7">Загрузка конструктора GLTL…</p></div>
  <script src="${js}"></script>
</body>
</html>`;
  }
}
