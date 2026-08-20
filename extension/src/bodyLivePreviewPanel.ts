import * as path from "path";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { isMcunrDocument } from "./contentDetect";
import { loadBodyGeneratorApi, loadZoneStatementApi } from "./mcuLanguageBridge";

type VisibleConstant = {
  name: string;
  expression: string;
  value: number | null;
  mutable: boolean;
  scope: string;
};

type GeometrySceneLike = {
  primitives?: Array<{
    type: string;
    name: string;
    params: number[];
    bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
    color?: string;
  }>;
  bbox?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
};

type LiveZonePreviewLike = {
  zoneName: string;
  expression: string;
  quality?: "rough" | "draft" | "full";
  warnings?: string[];
  bbox?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  slices?: unknown[];
};

type MeshPreviewApi = {
  buildDraftBodyPreview: (input: {
    bodyType: string;
    name: string;
    params: number[];
    scenePrimitives: NonNullable<GeometrySceneLike["primitives"]>;
    sceneBbox?: GeometrySceneLike["bbox"];
    nearby?: { maxCount?: number; maxGapFactor?: number; excludeName?: string };
    transf?: { protoName: string; mode: string; A: number; B: number; f: number };
  }) => {
    slices?: unknown[];
    neighborNames?: string[];
    nearest?: { name: string; gap: number };
    warnings: string[];
    unsupported: boolean;
  };
};

const PREVIEW_DEBOUNCE_MS = 180;
const SCENE_DEBOUNCE_MS = 700;

function collectStatementSlice(
  doc: vscode.TextDocument,
  line: number
): { lines: string[]; offset: number; localIndex: number } | null {
  if (line < 0 || line >= doc.lineCount) return null;
  let start = line;
  while (start > 0 && doc.lineAt(start).text.startsWith(" ")) start--;
  let end = start;
  while (end + 1 < doc.lineCount && doc.lineAt(end + 1).text.startsWith(" ")) end++;
  const lines: string[] = [];
  for (let i = start; i <= end; i++) lines.push(doc.lineAt(i).text);
  return { lines, offset: start, localIndex: line - start };
}

function loadMeshPreviewApi(): MeshPreviewApi | null {
  const candidates = [
    path.join(__dirname, "..", "vendor", "mcu-geometry", "meshPreview.js"),
    path.join(__dirname, "..", "..", "packages", "mcu-geometry", "dist", "meshPreview.js"),
  ];
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(candidate) as MeshPreviewApi;
    } catch {
      /* try next */
    }
  }
  return null;
}

function livePreviewEnabled(): boolean {
  return vscode.workspace.getConfiguration("mcuhelper").get<boolean>("liveBodyPreview", true);
}

/** Живые сечения тела или зоны под курсором — тот же webview, что генератор, без формы. */
export class BodyLivePreviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private client: LanguageClient | undefined;
  private meshApi = loadMeshPreviewApi();
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private sceneTimer: ReturnType<typeof setTimeout> | undefined;
  private manualSliceTimer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private userClosed = false;
  private watching = false;
  private lastFocusKey = "";
  private sceneCache:
    | { uri: string; version: number; line: number; scene: GeometrySceneLike | null }
    | undefined;
  private constCache: { uri: string; line: number; constants: VisibleConstant[] } | undefined;
  private manualSlicePositions: Partial<{ x: number; y: number; z: number }> | undefined;
  private lastZoneContext: { uri: vscode.Uri; startLine: number; character: number; text: string } | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  setClient(client?: LanguageClient): void {
    this.client = client;
  }

  /** Первый кадр, если при активации курсор уже стоит на теле. */
  nudge(): void {
    this.schedulePreview();
  }

  watch(): void {
    if (this.watching) return;
    this.watching = true;
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.schedulePreview()),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (!isMcunrDocument(e.textEditor.document)) return;
        this.schedulePreview();
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!isMcunrDocument(e.document)) return;
        const ed = vscode.window.activeTextEditor;
        if (!ed || ed.document.uri.toString() !== e.document.uri.toString()) return;
        this.schedulePreview();
        this.scheduleSceneRefresh();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("mcuhelper.liveBodyPreview")) this.schedulePreview();
      })
    );
  }

  async show(opts?: { fromCommand?: boolean }): Promise<void> {
    if (opts?.fromCommand) this.userClosed = false;
    this.ensurePanel(true);
    await this.refreshNow();
  }

  private schedulePreview(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = undefined;
      void this.refreshNow();
    }, PREVIEW_DEBOUNCE_MS);
  }

  private scheduleSceneRefresh(): void {
    if (this.sceneTimer) clearTimeout(this.sceneTimer);
    this.sceneTimer = setTimeout(() => {
      this.sceneTimer = undefined;
      this.sceneCache = undefined;
      void this.refreshNow();
    }, SCENE_DEBOUNCE_MS);
  }

  private ensurePanel(focus: boolean): boolean {
    if (this.panel) {
      if (focus) this.panel.reveal(vscode.ViewColumn.Beside, true);
      return true;
    }
    if (this.userClosed && !focus) return false;
    if (!focus && !livePreviewEnabled()) return false;

    this.panel = vscode.window.createWebviewPanel(
      "mcuhelper.bodyLivePreview",
      "MCU-NR: Превью тела/зоны",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      }
    );
    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "ready") void this.refreshNow();
      if (msg?.type === "slicePlanesChanged") {
        this.manualSlicePositions = {
          x: typeof msg?.positions?.x === "number" ? msg.positions.x : undefined,
          y: typeof msg?.positions?.y === "number" ? msg.positions.y : undefined,
          z: typeof msg?.positions?.z === "number" ? msg.positions.z : undefined,
        };
        if (this.manualSliceTimer) clearTimeout(this.manualSliceTimer);
        this.manualSliceTimer = setTimeout(() => {
          this.manualSliceTimer = undefined;
          void this.refreshZonePreviewWithManualPlanes();
        }, 150);
      }
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.userClosed = true;
      this.lastFocusKey = "";
      this.manualSlicePositions = undefined;
      this.lastZoneContext = undefined;
      if (this.manualSliceTimer) clearTimeout(this.manualSliceTimer);
      this.manualSliceTimer = undefined;
    });
    return true;
  }

  private async refreshZonePreviewWithManualPlanes(): Promise<void> {
    if (!this.panel || !this.client || !this.lastZoneContext) return;
    const { uri, startLine, character, text } = this.lastZoneContext;
    const gen = ++this.generation;

    const postZonePreview = (
      zonePreview: LiveZonePreviewLike | null,
      qualityLabel: "rough" | "draft" | "full"
    ) => {
      if (!this.panel) return;
      const warnings = [...(zonePreview?.warnings ?? [])];
      const zoneName = zonePreview?.zoneName ?? "зона";
      const docLabel = `${vscode.workspace.asRelativePath(uri)}:${startLine + 1} · ZONE ${zoneName} · ${qualityLabel}`;
      this.panel.title = `MCU-NR: ZONE ${zoneName}`;
      void this.panel.webview.postMessage({
        type: "preview",
        text,
        warnings,
        zonePreview,
        autoName: null,
        docLabel,
        resetView: false,
      });
    };

    const zonePreviewRough = await this.fetchZonePreview(uri, startLine, character, {
      resolution: 96,
      quality: "rough",
      slicePositions: this.manualSlicePositions,
    });
    if (gen !== this.generation || !this.panel) return;
    postZonePreview(zonePreviewRough, "rough");

    const zonePreviewDraft = await this.fetchZonePreview(uri, startLine, character, {
      resolution: 96,
      quality: "draft",
      slicePositions: this.manualSlicePositions,
    });
    if (gen !== this.generation || !this.panel) return;
    postZonePreview(zonePreviewDraft, "draft");

    const zonePreviewFull = await this.fetchZonePreview(uri, startLine, character, {
      resolution: 192,
      quality: "full",
      slicePositions: this.manualSlicePositions,
    });
    if (gen !== this.generation || !this.panel) return;
    postZonePreview(zonePreviewFull ?? zonePreviewDraft, (zonePreviewFull ? "full" : "draft") as "rough" | "draft" | "full");
  }

  private async refreshNow(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isMcunrDocument(editor.document)) {
      if (this.panel) this.postIdle("Откройте файл MCU-NR и поставьте курсор на строку тела или зоны.");
      return;
    }

    const api = loadBodyGeneratorApi();
    const zoneApi = loadZoneStatementApi();
    const slice = collectStatementSlice(editor.document, editor.selection.active.line);
    const collected = slice
      ? api.collectContinuedStatement(slice.lines, slice.localIndex)
      : null;
    const parsed = collected ? api.parseBodySourceStatement(collected.text) : null;
    const zoneLike = collected ? zoneApi.looksLikeZoneStatement(collected.text) : false;

    if (!parsed && !zoneLike) {
      if (this.panel) {
        this.postIdle("Курсор не на теле или зоне. Последнее превью сохранено.");
      }
      return;
    }

    if (!this.ensurePanel(false)) return;
    if (!this.panel) return;

    const gen = ++this.generation;
    const startLine = slice!.offset + collected!.startLine;
    const focusKey = parsed
      ? `${parsed.bodyType}:${parsed.name}:${startLine}`
      : `ZONE:${collected!.text.trim().slice(0, 48)}:${startLine}`;
    const resetView = focusKey !== this.lastFocusKey;
    if (resetView) {
      this.manualSlicePositions = undefined;
      if (this.manualSliceTimer) clearTimeout(this.manualSliceTimer);
      this.manualSliceTimer = undefined;
    }
    this.lastFocusKey = focusKey;

    const uri = editor.document.uri;
    if (!parsed) {
      this.lastZoneContext = { uri, startLine, character: editor.selection.active.character, text: collected!.text };
      const postZonePreview = (
        zonePreview: LiveZonePreviewLike | null,
        previewResetView: boolean,
        qualityLabel: "rough" | "draft" | "full"
      ) => {
        if (!this.panel) return;
        const warnings = [...(zonePreview?.warnings ?? [])];
        const zoneName = zonePreview?.zoneName ?? "зона";
        const docLabel = `${vscode.workspace.asRelativePath(uri)}:${startLine + 1} · ZONE ${zoneName} · ${qualityLabel}`;
        this.panel.title = `MCU-NR: ZONE ${zoneName}`;
        void this.panel.webview.postMessage({
          type: "preview",
          text: collected!.text,
          warnings,
          zonePreview,
          autoName: null,
          docLabel,
          resetView: previewResetView,
        });
      };
      const zonePreviewRough = await this.fetchZonePreview(uri, startLine, editor.selection.active.character, {
        resolution: 96,
        quality: "rough",
        slicePositions: this.manualSlicePositions,
      });
      if (gen !== this.generation || !this.panel) return;
      postZonePreview(zonePreviewRough, resetView, "rough");
      const zonePreviewDraft = await this.fetchZonePreview(uri, startLine, editor.selection.active.character, {
        resolution: 96,
        quality: "draft",
        slicePositions: this.manualSlicePositions,
      });
      if (gen !== this.generation || !this.panel) return;
      postZonePreview(zonePreviewDraft, false, "draft");
      const zonePreviewFull = await this.fetchZonePreview(uri, startLine, editor.selection.active.character, {
        resolution: 192,
        quality: "full",
        slicePositions: this.manualSlicePositions,
      });
      if (gen !== this.generation || !this.panel) return;
      postZonePreview(zonePreviewFull ?? zonePreviewDraft, false, zonePreviewFull ? "full" : "draft");
      return;
    }

    const warnings: string[] = [];
    const constants = await this.fetchConstants(uri, startLine, editor.selection.active.character);
    if (gen !== this.generation || !this.panel) return;
    const vars = api.constantsToVarMap(constants);
    const isTransf = parsed.bodyType.toUpperCase() === "TRANSF";
    const resolved = isTransf
      ? { nums: [] as number[], warnings: [] as string[] }
      : api.resolveBodyParamNumbers(parsed.params, vars);
    const transf = isTransf ? api.resolveTransfParams(parsed.params, vars) : null;
    warnings.push(...(isTransf ? transf?.warnings ?? [] : resolved.warnings));

    const scene = await this.fetchScene(uri, editor.document.version, startLine, editor.selection.active.character);
    if (gen !== this.generation || !this.panel) return;

    let draftPreview: ReturnType<MeshPreviewApi["buildDraftBodyPreview"]> | null = null;
    const finite = isTransf
      ? Boolean(transf?.ok)
      : resolved.nums.length > 0 && resolved.nums.every(Number.isFinite);
    if (this.meshApi && finite && isTransf && transf) {
      draftPreview = this.meshApi.buildDraftBodyPreview({
        bodyType: "TRANSF",
        name: parsed.name,
        params: [transf.A, transf.B, transf.f],
        scenePrimitives: scene?.primitives ?? [],
        sceneBbox: scene?.bbox,
        nearby: { maxCount: 12, maxGapFactor: 4, excludeName: parsed.name },
        transf: {
          protoName: transf.protoName,
          mode: transf.mode,
          A: transf.A,
          B: transf.B,
          f: transf.f,
        },
      });
      warnings.push(...(draftPreview.warnings ?? []));
    } else if (this.meshApi && finite && !isTransf) {
      draftPreview = this.meshApi.buildDraftBodyPreview({
        bodyType: parsed.bodyType,
        name: parsed.name,
        params: resolved.nums,
        scenePrimitives: scene?.primitives ?? [],
        sceneBbox: scene?.bbox,
        nearby: { maxCount: 12, maxGapFactor: 4, excludeName: parsed.name },
      });
      warnings.push(...(draftPreview.warnings ?? []));
    } else if (!finite) {
      warnings.push("Не все параметры вычислены — сечение появится, когда строка станет полной.");
    }

    const docLabel = `${vscode.workspace.asRelativePath(uri)}:${startLine + 1} · ${parsed.bodyType} ${parsed.name}`;
    this.panel.title = `MCU-NR: ${parsed.bodyType} ${parsed.name}`;
    void this.panel.webview.postMessage({
      type: "preview",
      text: collected!.text,
      warnings,
      draftPreview,
      autoName: null,
      docLabel,
      resetView,
    });
  }

  private postIdle(message: string): void {
    if (!this.panel) return;
    void this.panel.webview.postMessage({
      type: "idle",
      message,
    });
  }

  private async fetchZonePreview(
    uri: vscode.Uri,
    line: number,
    character: number,
    options?: {
      resolution?: number;
      quality?: "rough" | "draft" | "full";
      slicePositions?: Partial<{ x: number; y: number; z: number }>;
    }
  ): Promise<LiveZonePreviewLike | null> {
    if (!this.client) return null;
    try {
      return await this.client.sendRequest<LiveZonePreviewLike | null>("mcuhelper/getLiveZonePreview", {
        uri: uri.toString(),
        line,
        character,
        resolution: options?.resolution ?? 192,
        quality: options?.quality ?? "full",
        slicePositions: options?.slicePositions,
      });
    } catch {
      return null;
    }
  }

  private async fetchConstants(uri: vscode.Uri, line: number, character: number): Promise<VisibleConstant[]> {
    if (
      this.constCache &&
      this.constCache.uri === uri.toString() &&
      Math.abs(this.constCache.line - line) < 8
    ) {
      return this.constCache.constants;
    }
    if (!this.client) return [];
    try {
      const index = await this.client.sendRequest<{
        summaries?: { constants?: VisibleConstant[] };
      }>("mcuhelper/getIndex", { uri: uri.toString(), line, character });
      const constants = index?.summaries?.constants ?? [];
      this.constCache = { uri: uri.toString(), line, constants };
      return constants;
    } catch {
      return this.constCache?.constants ?? [];
    }
  }

  private async fetchScene(
    uri: vscode.Uri,
    version: number,
    line: number,
    character: number
  ): Promise<GeometrySceneLike | null> {
    if (
      this.sceneCache &&
      this.sceneCache.uri === uri.toString() &&
      this.sceneCache.version === version &&
      this.sceneCache.line === line
    ) {
      return this.sceneCache.scene;
    }
    if (!this.client) return this.sceneCache?.scene ?? null;
    try {
      const scene = await this.client.sendRequest<GeometrySceneLike | null>("mcuhelper/getGeometry", {
        uri: uri.toString(),
        line,
        character,
      });
      this.sceneCache = { uri: uri.toString(), version, line, scene };
      return scene;
    } catch {
      return this.sceneCache?.scene ?? null;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const bust = String(Date.now());
    const css = webview
      .asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "media", "bodyGenerator", "bodyGenerator.css")
      )
      .with({ query: `v=${bust}` });
    const js = webview
      .asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "media", "bodyGenerator", "bodyGenerator.js")
      )
      .with({ query: `v=${bust}` });
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
    ].join("; ");
    const boot = JSON.stringify({ mode: "live", types: [], form: null, constants: [] }).replace(
      /</g,
      "\\u003c"
    );

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${css}" />
  <title>Превью тела/зоны</title>
</head>
<body class="bg-live">
  <div id="root">
    <header class="bg-header">
      <div>
        <h1>Превью тела / зоны</h1>
        <p class="bg-sub">следует за курсором в варианте · колесо — зум · перетаскивание — сдвиг · двойной клик — вписать</p>
      </div>
      <div class="bg-doc" id="docLabel"></div>
    </header>
    <div class="bg-layout bg-live-layout">
      <aside class="bg-preview">
        <div class="bg-preview-head">
          <h2>Сечения</h2>
          <span class="bg-muted" id="neighborInfo"></span>
        </div>
        <p class="bg-hint bg-slice-hint" id="idleHint"></p>
        <p class="bg-nearest" id="nearestInfo">ближайшее: —</p>
        <div class="bg-slice-controls" id="sliceControls"></div>
        <div class="bg-slices">
          <figure class="bg-slice">
            <figcaption id="capXY">XY</figcaption>
            <div class="bg-slice-view"><canvas id="sliceXY"></canvas></div>
          </figure>
          <figure class="bg-slice">
            <figcaption id="capXZ">XZ</figcaption>
            <div class="bg-slice-view"><canvas id="sliceXZ"></canvas></div>
          </figure>
          <figure class="bg-slice">
            <figcaption id="capYZ">YZ</figcaption>
            <div class="bg-slice-view"><canvas id="sliceYZ"></canvas></div>
          </figure>
        </div>
        <ul class="bg-warnings" id="warnings"></ul>
        <pre id="preview" class="bg-code"></pre>
      </aside>
    </div>
  </div>
  <script type="application/json" id="bg-boot">${boot}</script>
  <script src="${js}"></script>
</body>
</html>`;
  }
}
