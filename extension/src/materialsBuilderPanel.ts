import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import {
  loadMaterialsCompendiumApi,
  type DensMode,
  type MaterialDraft,
  type SlimMaterial,
  type UserMaterialRecord,
} from "./mcuLanguageBridge";
import { loadMaterialsCatalog, loadUserCatalog, saveUserCatalog, userCatalogPath } from "./materialsCompendiumStore";
import { insertNewMaterialCard } from "./materialsBuilderInsert";
import { getLastMcunrFocus, registerWaterSteamFocusTracker } from "./waterSteamContext";
import { isMcunrDocument } from "./contentDetect";

export { registerWaterSteamFocusTracker };

type HostMsg =
  | { type: "ready" }
  | { type: "refreshContext" }
  | { type: "fromContext" }
  | { type: "pick"; name: string; user?: boolean }
  | { type: "blank" }
  | { type: "saveUser" }
  | { type: "openUserCatalog" }
  | { type: "setMode"; mode: DensMode }
  | { type: "setRho"; rho: number }
  | { type: "setT"; T: number | null }
  | { type: "setComment"; comment: string }
  | { type: "setNumber"; number: number }
  | { type: "addNuclide"; name: string; value: number }
  | { type: "addImpurity"; name: string; weightPercent: number }
  | { type: "removeNuclide"; index: number }
  | { type: "setNuclide"; index: number; name?: string; value?: number }
  | { type: "insertNew" }
  | { type: "openUrl"; url: string };

type AwLibItem = { name: string; zaid: number; atomicWeight: number; isNatural: boolean };

const COMPENDIUM_GITHUB = "https://github.com/pyne/materials-compendium/tree/develop";
const COMPENDIUM_DOCS = "https://materials-compendium.readthedocs.io/en/latest/index.html";

function isAllowedCompendiumUrl(url: string): boolean {
  return url === COMPENDIUM_GITHUB || url === COMPENDIUM_DOCS;
}

function fileLabel(uri: vscode.Uri): string {
  const p = uri.fsPath.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function formatInsertTargetLabel(file: string, nextNumber: number): string {
  return `Вставка в конец PIN → MATR ${nextNumber} · ${file}`;
}

export class MaterialsBuilderPanel {
  private panel: vscode.WebviewPanel | undefined;
  private client: LanguageClient | undefined;
  private draft: MaterialDraft;
  private selected: SlimMaterial | undefined;
  private selectedUser: UserMaterialRecord | undefined;
  private targetUri: vscode.Uri | undefined;
  private targetLabel = "";
  private catalogMaterials: SlimMaterial[] = [];
  private userMaterials: UserMaterialRecord[] = [];
  private userBankPath = "";
  private userCatalogSaveSub: vscode.Disposable | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.draft = loadMaterialsCompendiumApi().emptyDraft(1);
  }

  async show(client?: LanguageClient): Promise<void> {
    this.client = client;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.panel.webview.html = this.getHtml(this.panel.webview);
      await this.pushInit();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "mcuhelper.materialsBuilder",
      "MCU-NR: Конструктор материалов",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      }
    );
    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg: HostMsg) => void this.onMessage(msg));
    this.userCatalogSaveSub = vscode.workspace.onDidSaveTextDocument((doc) => {
      void this.onUserCatalogSaved(doc);
    });
    this.panel.onDidDispose(() => {
      this.userCatalogSaveSub?.dispose();
      this.userCatalogSaveSub = undefined;
      this.panel = undefined;
    });
    await this.pushInit();
  }

  private async onMessage(msg: HostMsg): Promise<void> {
    const api = loadMaterialsCompendiumApi();
    switch (msg.type) {
      case "ready":
        await this.pushInit();
        break;
      case "refreshContext":
        await this.refreshEditorContext(false);
        this.postDraft();
        break;
      case "fromContext":
        await this.refreshEditorContext(true);
        this.postDraft();
        break;
      case "pick": {
        if (msg.user) {
          const um = this.userMaterials.find((m) => m.name.toLowerCase() === msg.name.toLowerCase());
          if (!um) return;
          this.selected = undefined;
          this.selectedUser = um;
          this.draft = api.draftFromUserMaterial(um, this.draft.number);
          this.postDraft();
          break;
        }
        const mat = this.catalogMaterials.find((m) => m.name === msg.name);
        if (!mat) return;
        this.selected = mat;
        this.selectedUser = undefined;
        this.draft = api.draftFromCatalog(mat, this.draft.mode, this.draft.number);
        this.postDraft();
        break;
      }
      case "blank":
        this.selected = undefined;
        this.selectedUser = undefined;
        this.draft = api.emptyDraft(this.draft.number);
        this.postDraft();
        break;
      case "saveUser":
        await this.saveDraftToUserBank();
        break;
      case "openUserCatalog":
        await this.openUserCatalog();
        break;
      case "setMode": {
        this.draft.mode = msg.mode;
        if (this.selected && !this.selectedUser) {
          const keepImp = this.draft.nuclides.filter((n) => n.impurity);
          const keepComment = this.draft.comment;
          this.draft = api.draftFromCatalog(this.selected, msg.mode, this.draft.number);
          this.draft.comment = keepComment;
          for (const imp of keepImp) {
            if (imp.impurity && this.draft.mode === "denswa") {
              this.draft = api.addImpurity(this.draft, imp.name, imp.value * 100);
            } else {
              this.draft.nuclides.push(imp);
            }
          }
        }
        this.syncRho();
        this.postDraft();
        break;
      }
      case "setRho":
        this.draft.densityGcm3 = msg.rho;
        this.postDraft();
        break;
      case "setT":
        this.draft.temperature = msg.T;
        this.postDraft();
        break;
      case "setComment":
        this.draft.comment = msg.comment;
        this.postDraft();
        break;
      case "setNumber":
        this.draft.number = msg.number;
        this.postDraft();
        break;
      case "addNuclide": {
        const mapped = api.pnnlNuclideToMcu(msg.name);
        if (!mapped.mcuName) return;
        this.draft.nuclides.push({
          name: mapped.mcuName,
          value: msg.value,
          inAwLib: mapped.inAwLib,
        });
        this.syncRho();
        this.postDraft();
        break;
      }
      case "addImpurity":
        this.draft = api.addImpurity(this.draft, msg.name, msg.weightPercent);
        this.syncRho();
        this.postDraft();
        break;
      case "removeNuclide":
        this.draft.nuclides.splice(msg.index, 1);
        this.syncRho();
        this.postDraft();
        break;
      case "setNuclide": {
        const row = this.draft.nuclides[msg.index];
        if (!row) return;
        if (msg.name != null) {
          const mapped = api.pnnlNuclideToMcu(msg.name);
          row.name = mapped.mcuName || msg.name;
          row.inAwLib = mapped.inAwLib;
        }
        if (msg.value != null) row.value = msg.value;
        this.syncRho();
        this.postDraft();
        break;
      }
      case "insertNew": {
        const uri = this.targetUri ?? this.editorUri();
        if (!uri) {
          vscode.window.showWarningMessage("Откройте файл MCU-NR и снова нажмите «Вставить».");
          return;
        }
        await insertNewMaterialCard(uri, this.draft);
        await this.refreshEditorContext();
        this.postDraft();
        break;
      }
      case "openUrl":
        if (!isAllowedCompendiumUrl(msg.url)) return;
        await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      default:
        break;
    }
  }

  private editorUri(): vscode.Uri | undefined {
    const focus = getLastMcunrFocus();
    if (focus) return vscode.Uri.parse(focus.uri);
    const ed = vscode.window.activeTextEditor;
    if (ed && isMcunrDocument(ed.document)) return ed.document.uri;
    return undefined;
  }

  private async visibleMatrDraft(): Promise<MaterialDraft | null> {
    const uri = this.targetUri ?? this.editorUri();
    if (!uri) return null;
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const focus = getLastMcunrFocus();
      const line = focus?.uri === uri.toString() ? focus.line : 0;
      return loadMaterialsCompendiumApi().draftFromVisibleMatr(doc.getText(), line);
    } catch {
      return null;
    }
  }

  private async refreshEditorContext(forceFromCursor = false): Promise<void> {
    const aw = await this.loadAwLib();
    if (aw.length) loadMaterialsCompendiumApi().setAwLibTableFromCatalog(aw);
    const uri = this.editorUri();
    this.targetUri = uri;
    this.targetLabel = "";
    if (!uri) {
      this.targetLabel = "Откройте файл MCU-NR — вставка в конец материалов";
      if (forceFromCursor) {
        void vscode.window.showWarningMessage("Нет файла MCU-NR в фокусе.");
      }
      return;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const api = loadMaterialsCompendiumApi();
      const hint = api.findMatrInsert(text);
      if (forceFromCursor) {
        this.selected = undefined;
        this.selectedUser = undefined;
      }
        const fromCtx = await this.visibleMatrDraft();
        if (fromCtx && (forceFromCursor || (!this.selected && !this.selectedUser))) {
          const keepComment = this.draft.comment;
          this.draft = { ...fromCtx, number: hint.nextNumber, comment: keepComment };
          this.targetLabel = formatInsertTargetLabel(fileLabel(uri), hint.nextNumber);
        } else {
          this.draft.number = hint.nextNumber;
          this.targetLabel = formatInsertTargetLabel(fileLabel(uri), hint.nextNumber);
          if (forceFromCursor) {
            void vscode.window.showWarningMessage("Курсор не в секции MATR — поставьте курсор в материал.");
          }
        }
    } catch {
      this.targetLabel = fileLabel(uri);
    }
  }

  private async saveDraftToUserBank(): Promise<void> {
    const api = loadMaterialsCompendiumApi();
    const fromCtx = await this.visibleMatrDraft();
    const draft =
      !this.selected && !this.selectedUser && fromCtx && fromCtx.nuclides.length
        ? { ...fromCtx, number: this.draft.number, comment: this.draft.comment }
        : this.draft;
    if (fromCtx && draft !== this.draft) {
      this.draft = draft;
    }
    const suggested =
      draft.sourceName ||
      this.selectedUser?.name ||
      (this.selected ? api.displayName(this.selected.name) : "") ||
      (fromCtx ? `MATR ${fromCtx.number}` : "");
    const name = await vscode.window.showInputBox({
      title: "Пользовательский банк материалов",
      prompt: this.userBankPath,
      value: suggested,
      placeHolder: "Имя материала",
      ignoreFocusOut: true,
    });
    if (name == null) return;
    let record;
    try {
      record = api.draftToUserMaterial(draft, name);
    } catch (e) {
      void vscode.window.showWarningMessage(e instanceof Error ? e.message : String(e));
      return;
    }
    const file = loadUserCatalog(this.context);
    const existing = api.findUserMaterial(file, record.name);
    if (existing) {
      const ok = await vscode.window.showWarningMessage(
        `«${existing.name}» уже есть в банке. Заменить?`,
        { modal: true },
        "Заменить"
      );
      if (ok !== "Заменить") return;
    }
    try {
      saveUserCatalog(this.context, api.upsertUserMaterial(file, record));
    } catch (e) {
      void vscode.window.showErrorMessage(
        `Не удалось записать банк: ${e instanceof Error ? e.message : String(e)}`
      );
      return;
    }
    this.userMaterials = loadUserCatalog(this.context).materials;
    this.selected = undefined;
    this.selectedUser = this.userMaterials.find((m) => m.name.toLowerCase() === record.name.toLowerCase());
    this.draft.sourceName = record.name;
    void vscode.window.showInformationMessage(`«${record.name}» сохранён в пользовательский банк.`);
    this.postCatalog();
    this.postDraft();
  }

  private async openUserCatalog(): Promise<void> {
    const filePath = this.userBankPath || userCatalogPath(this.context);
    this.userBankPath = filePath;
    const uri = vscode.Uri.file(filePath);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      try {
        saveUserCatalog(this.context, { version: 1, materials: [] });
      } catch (e) {
        void vscode.window.showErrorMessage(
          `Не удалось создать банк: ${e instanceof Error ? e.message : String(e)}`
        );
        return;
      }
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
  }

  private onUserCatalogSaved(doc: vscode.TextDocument): void {
    if (!this.userBankPath) return;
    const a = doc.uri.fsPath.replace(/\\/g, "/").toLowerCase();
    const b = this.userBankPath.replace(/\\/g, "/").toLowerCase();
    if (a !== b) return;
    this.userMaterials = loadUserCatalog(this.context).materials;
    if (this.selectedUser) {
      const name = this.selectedUser.name;
      this.selectedUser = this.userMaterials.find((m) => m.name.toLowerCase() === name.toLowerCase());
      if (this.selectedUser) {
        this.draft = loadMaterialsCompendiumApi().draftFromUserMaterial(this.selectedUser, this.draft.number);
      }
    }
    this.postCatalog();
    this.postDraft();
  }

  private webviewCatalog(): unknown[] {
    const displayName = loadMaterialsCompendiumApi().displayName;
    const userItems = this.userMaterials.map((m) => ({
      name: m.name,
      displayName: m.name,
      user: true,
      formula: m.formula ?? null,
      acronym: null,
      density: m.density,
      comment: m.comment ?? [],
      source: "user",
      references: [],
      elements: m.nuclides.map((n) => ({ element: n.name, isotopes: [] as string[] })),
    }));
    const pnnlItems = this.catalogMaterials.map((m) => ({
      name: m.name,
      displayName: displayName(m.name),
      user: false,
      formula: m.formula,
      acronym: m.acronym,
      density: m.density,
      comment: m.comment,
      source: m.source,
      references: m.references,
      elements: m.elements.map((el) => ({
        element: el.element,
        isotopes: el.isotopes.map((i) => i.isotope),
      })),
    }));
    return [...userItems, ...pnnlItems];
  }

  private selectedPayload(): {
    selectedName: string | null;
    selected: {
      name: string;
      displayName: string;
      comment: string[];
      source: string;
      references: string[];
      formula: string | null;
      user?: boolean;
    } | null;
  } {
    const displayName = loadMaterialsCompendiumApi().displayName;
    if (this.selectedUser) {
      return {
        selectedName: `user:${this.selectedUser.name}`,
        selected: {
          name: this.selectedUser.name,
          displayName: this.selectedUser.name,
          comment: this.selectedUser.comment ?? [],
          source: "user",
          references: [],
          formula: this.selectedUser.formula ?? null,
          user: true,
        },
      };
    }
    if (this.selected) {
      return {
        selectedName: this.selected.name,
        selected: {
          name: this.selected.name,
          displayName: displayName(this.selected.name),
          comment: this.selected.comment,
          source: this.selected.source,
          references: this.selected.references,
          formula: this.selected.formula,
        },
      };
    }
    return { selectedName: null, selected: null };
  }

  private postCatalog(): void {
    if (!this.panel) return;
    void this.panel.webview.postMessage({
      type: "catalog",
      catalog: this.webviewCatalog(),
      userCatalogPath: this.userBankPath,
      userCount: this.userMaterials.length,
    });
  }

  private async loadAwLib(): Promise<AwLibItem[]> {
    if (!this.client) return [];
    try {
      const list = await this.client.sendRequest<AwLibItem[]>("mcuhelper/getAwLibCatalog");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private async pushInit(): Promise<void> {
    if (!this.panel) return;
    let loaded;
    try {
      loaded = loadMaterialsCatalog(this.context);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Конструктор материалов: ${msg}`);
      return;
    }
    loadMaterialsCompendiumApi().loadNameTranslations(loaded.translations);
    this.catalogMaterials = loaded.catalog.materials;
    this.userBankPath = userCatalogPath(this.context);
    this.userMaterials = loadUserCatalog(this.context).materials;
    const awlib = await this.loadAwLib();
    loadMaterialsCompendiumApi().setAwLibTableFromCatalog(awlib);
    await this.refreshEditorContext();
    if (!this.draft.nuclides.length && !this.selected && !this.selectedUser) {
      this.draft = loadMaterialsCompendiumApi().emptyDraft(this.draft.number);
    }
    const sel = this.selectedPayload();
    void this.panel.webview.postMessage({
      type: "init",
      meta: {
        source: loaded.source,
        siteVersion: loaded.meta.siteVersion ?? "",
        sourceSha: loaded.meta.sourceSha,
        materialCount: loaded.catalog.materialCount,
        userCount: this.userMaterials.length,
        awLibCount: awlib.length,
      },
      catalog: this.webviewCatalog(),
      awlib: awlib.map((a) => a.name),
      userCatalogPath: this.userBankPath,
      targetLabel: this.targetLabel,
      draft: this.draft,
      selectedName: sel.selectedName,
      selected: sel.selected,
    });
  }

  private syncRho(): void {
    loadMaterialsCompendiumApi().syncDraftMassDensity(this.draft);
  }

  private postDraft(): void {
    if (!this.panel) return;
    const preview = loadMaterialsCompendiumApi().buildMatrCard(this.draft);
    const sel = this.selectedPayload();
    void this.panel.webview.postMessage({
      type: "draft",
      draft: this.draft,
      targetLabel: this.targetLabel,
      selectedName: sel.selectedName,
      selected: sel.selected,
      preview: preview.text,
      warnings: preview.warnings,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "materialsBuilder", "materialsBuilder.css")
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "materialsBuilder", "materialsBuilder.js")
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
  <title>Конструктор материалов</title>
</head>
<body>
  <div id="root">
    <header class="mb-header">
      <div>
        <h1>Конструктор материалов</h1>
        <p class="mb-sub">PNNL Compendium · AW.LIB · вставка в конец PIN</p>
        <p class="mb-links">
          <a href="#" data-url="${COMPENDIUM_GITHUB}">GitHub</a>
          <span>·</span>
          <a href="#" data-url="${COMPENDIUM_DOCS}">Документация</a>
        </p>
      </div>
      <div class="mb-meta" id="metaLabel"></div>
    </header>
    <div class="mb-layout">
      <aside class="mb-list-pane">
        <input type="search" id="search" placeholder="Поиск: имя, описание, Fe Cr Ni…" autocomplete="off" />
        <div class="mb-list-tools">
          <button type="button" class="mb-btn mb-btn-sec" id="btnBlank">Пустой состав</button>
          <button type="button" class="mb-btn mb-btn-sec" id="btnOpenUser" title="Открыть userCatalog.json">JSON банка</button>
          <span class="mb-count" id="listCount"></span>
        </div>
        <div id="list" class="mb-list" role="listbox"></div>
      </aside>
      <section class="mb-draft">
        <div class="mb-grid">
          <label>MATR № <input type="number" id="inpNum" min="1" step="1" readonly title="Номер = последний MATR в файле + 1" /></label>
          <label>T, K <input type="number" id="inpT" step="any" placeholder="нет" /></label>
          <label>ρ, г/см³ <input type="number" id="inpRho" step="any" min="0" /></label>
          <label>Режим
            <select id="selMode">
              <option value="denswa">DENSWA · весовые доли</option>
              <option value="isotope">Ядерные dens изотопов</option>
            </select>
          </label>
        </div>
        <label class="mb-comment">Комментарий
          <textarea id="inpComment" rows="3" placeholder="Заметка к своему материалу — сохранится в банке"></textarea>
        </label>
        <div class="mb-table-wrap">
          <table class="mb-table">
            <thead>
              <tr><th>Нуклид</th><th>Значение</th><th></th></tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
        <div class="mb-add">
          <input type="text" id="addName" list="awlibList" placeholder="Нуклид из AW.LIB" />
          <datalist id="awlibList"></datalist>
          <input type="number" id="addVal" step="any" min="0" placeholder="доля / dens" />
          <button type="button" class="mb-btn" id="btnAdd">Добавить</button>
          <input type="number" id="impPct" step="any" min="0" max="100" placeholder="примесь, мас.%" />
          <button type="button" class="mb-btn mb-btn-sec" id="btnImp">+ примесь</button>
        </div>
        <div class="mb-desc" id="desc"></div>
        <pre class="mb-preview" id="preview"></pre>
        <p class="mb-warn" id="warn" hidden></p>
        <div class="mb-actions">
          <span class="mb-target" id="targetLabel"></span>
          <button type="button" class="mb-btn mb-btn-sec" id="btnRefresh">Обновить номер</button>
          <button type="button" class="mb-btn mb-btn-sec" id="btnFromContext" title="Заполнить черновик из MATR под курсором">Из контекста</button>
          <button type="button" class="mb-btn mb-btn-sec" id="btnSaveUser">В пользовательский банк</button>
          <button type="button" class="mb-btn mb-btn-accent" id="btnInsert">Вставить в конец</button>
        </div>
      </section>
    </div>
  </div>
  <script src="${js}"></script>
</body>
</html>`;
  }
}
