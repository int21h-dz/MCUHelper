import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { isMcunrDocument } from "./contentDetect";
import { loadRegistrationBuilderApi, type RegistrationBuilderInput } from "./mcuLanguageBridge";

type FormState = {
  ptype: 1 | 2 | 3;
  ttype?: 0 | 1 | 2;
  materials: string;
  zones: string;
  objects: string;
  energy: string;
  includeFlux: boolean;
  includeReactions: boolean;
  reactions: string;
};

type IndexHints = {
  materials: Array<{ number: number; label?: string }>;
  zones: Array<{ name: string; regNum?: number }>;
  hasRgs: boolean;
};

function parseNumberList(raw: string): number[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map((n) => Math.floor(n));
}

function parseEnergyList(raw: string): number[] {
  const nums = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  return nums.length ? nums : [0];
}

function formToInput(form: FormState): RegistrationBuilderInput {
  return {
    ptype: form.ptype,
    ttype: form.ttype,
    materials: parseNumberList(form.materials),
    zones: parseNumberList(form.zones),
    objects: parseNumberList(form.objects),
    energy: parseEnergyList(form.energy),
    includeFlux: form.includeFlux,
    includeReactions: form.includeReactions,
    reactions: form.includeReactions ? parseNumberList(form.reactions || "1") : undefined,
  };
}

const DEFAULT_FORM: FormState = {
  ptype: 1,
  materials: "1",
  zones: "",
  objects: "",
  energy: "0",
  includeFlux: true,
  includeReactions: false,
  reactions: "1",
};

/** Webview-конструктор секции регистрации PTYPE…END. */
export class RegistrationBuilderPanel {
  private panel: vscode.WebviewPanel | undefined;
  private client: LanguageClient | undefined;
  private form: FormState = { ...DEFAULT_FORM };

  constructor(private readonly context: vscode.ExtensionContext) {}

  async show(client?: LanguageClient): Promise<void> {
    this.client = client;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      await this.pushState();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "mcuhelper.registrationBuilder",
      "MCU-NR: Конструктор регистрации",
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
    });
    await this.pushState();
  }

  private async onMessage(msg: { type?: string; form?: FormState }): Promise<void> {
    if (!this.panel) return;
    switch (msg.type) {
      case "ready":
        await this.pushState();
        break;
      case "preview":
        if (msg.form) this.form = { ...this.form, ...msg.form };
        this.postPreview();
        break;
      case "insert":
        if (msg.form) this.form = { ...this.form, ...msg.form };
        await this.insertIntoEditor();
        break;
      case "refreshHints":
        await this.pushState();
        break;
      default:
        break;
    }
  }

  private postPreview(): void {
    if (!this.panel) return;
    try {
      const { buildRegistrationSection } = loadRegistrationBuilderApi();
      const built = buildRegistrationSection(formToInput(this.form));
      void this.panel.webview.postMessage({
        type: "preview",
        text: built.text,
        warnings: built.warnings,
      });
    } catch (e) {
      void this.panel.webview.postMessage({
        type: "preview",
        text: "",
        warnings: [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  private async fetchHints(): Promise<IndexHints> {
    const empty: IndexHints = { materials: [], zones: [], hasRgs: false };
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isMcunrDocument(editor.document)) return empty;
    const text = editor.document.getText();
    const hasRgs = /^\s*(RGS|REGD|REG)\b/im.test(text);

    if (!this.client) return { ...empty, hasRgs };
    try {
      const index = await this.client.sendRequest<{
        materials?: Array<{ number: number; group?: string }>;
        zones?: Array<{ name: string; regNum?: number }>;
      }>("mcuhelper/getIndex", { uri: editor.document.uri.toString() });
      return {
        hasRgs,
        materials: (index?.materials ?? []).map((m) => ({
          number: m.number,
          label: m.group ? `${m.number} (${m.group})` : String(m.number),
        })),
        zones: (index?.zones ?? [])
          .filter((z) => z.regNum != null && z.regNum > 0)
          .map((z) => ({ name: z.name, regNum: z.regNum })),
      };
    } catch {
      return { ...empty, hasRgs };
    }
  }

  private async pushState(): Promise<void> {
    if (!this.panel) return;
    const hints = await this.fetchHints();
    void this.panel.webview.postMessage({
      type: "state",
      form: this.form,
      hints,
      docLabel: vscode.window.activeTextEditor?.document.fileName
        ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri)
        : "(нет активного mcunr)",
    });
    this.postPreview();
  }

  private async insertIntoEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isMcunrDocument(editor.document)) {
      vscode.window.showWarningMessage("Откройте файл MCU-NR и снова нажмите «Вставить».");
      return;
    }

    const { buildRegistrationSection, findRegistrationInsertLine } = loadRegistrationBuilderApi();
    const built = buildRegistrationSection(formToInput(this.form));
    const insertLine = findRegistrationInsertLine(editor.document.getText());
    if (insertLine === undefined) {
      vscode.window.showErrorMessage(
        "Не найден фрагмент RGS/REG/REGD — сначала вставьте заголовок регистрации."
      );
      return;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.insert(editor.document.uri, new vscode.Position(insertLine, 0), built.text);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) {
      vscode.window.showErrorMessage("Не удалось вставить секцию регистрации");
      return;
    }
    vscode.window.showInformationMessage("Секция регистрации вставлена (можно Undo).");
    await this.pushState();
  }

  private getHtml(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "registrationBuilder", "registrationBuilder.css")
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "registrationBuilder", "registrationBuilder.js")
    );
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
  <title>Конструктор регистрации</title>
</head>
<body>
  <div id="root">
    <header class="rb-header">
      <div>
        <h1>Конструктор регистрации</h1>
        <p class="rb-sub">Секция <code>PTYPE … ENERGY … END</code> внутри RGS</p>
      </div>
      <div class="rb-doc" id="docLabel"></div>
    </header>

    <div class="rb-layout">
      <form class="rb-form" id="form" autocomplete="off">
        <fieldset>
          <legend>Частицы</legend>
          <label class="rb-field">
            <span>PTYPE</span>
            <select name="ptype" id="ptype">
              <option value="1">1 — нейтроны</option>
              <option value="2">2 — фотоны</option>
              <option value="3">3 — электроны</option>
            </select>
          </label>
          <label class="rb-field">
            <span>TTYPE (опц.)</span>
            <select name="ttype" id="ttype">
              <option value="">— не задавать —</option>
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>Области</legend>
          <label class="rb-field">
            <span>Материалы (MFLU/MRCT)</span>
            <input name="materials" id="materials" placeholder="1 2 3 или 0 = все" />
            <div class="rb-chips" id="matChips"></div>
          </label>
          <label class="rb-field">
            <span>Рег. зоны (ZFLU/ZRCT)</span>
            <input name="zones" id="zones" placeholder="1 2 или пусто" />
            <div class="rb-chips" id="zoneChips"></div>
          </label>
          <label class="rb-field">
            <span>Объекты (OFLU/ORCT)</span>
            <input name="objects" id="objects" placeholder="опционально" />
          </label>
        </fieldset>

        <fieldset>
          <legend>Что регистрировать</legend>
          <label class="rb-check"><input type="checkbox" id="includeFlux" checked /> Поток (MFLU/ZFLU/OFLU)</label>
          <label class="rb-check"><input type="checkbox" id="includeReactions" /> Реакции (MRCT/ZRCT + RCT)</label>
          <label class="rb-field" id="reactionsWrap" hidden>
            <span>RCT</span>
            <input name="reactions" id="reactions" value="1" />
          </label>
        </fieldset>

        <fieldset>
          <legend>ENERGY</legend>
          <label class="rb-field">
            <span>Нижние границы, эВ (0 явно)</span>
            <input name="energy" id="energy" value="0" />
          </label>
        </fieldset>

        <div class="rb-actions">
          <button type="button" class="rb-btn secondary" id="btnRefresh">Обновить подсказки</button>
          <button type="button" class="rb-btn primary" id="btnInsert">Вставить в RGS</button>
        </div>
        <p class="rb-hint" id="rgsHint"></p>
      </form>

      <aside class="rb-preview">
        <div class="rb-preview-head">
          <h2>Preview</h2>
          <span class="rb-muted">до подтверждения в редакторе</span>
        </div>
        <ul class="rb-warnings" id="warnings"></ul>
        <pre id="preview" class="rb-code"></pre>
      </aside>
    </div>
  </div>
  <script src="${js}"></script>
</body>
</html>`;
  }
}
