import * as vscode from "vscode";

import { LanguageClient } from "vscode-languageclient/node";

import { isMcunrDocument } from "./contentDetect";



interface PointQueryResult {

  point: { x: number; y: number; z: number };

  zone?: {

    name: string;

    materialNum?: number;

    regNum?: number;

    objNum?: number;

    expression: string;

    color: string;

  };

  material?: { number: number; nuclides: { name: string; density: string }[] };

  objectNum?: number;

  bodyHits: string[];

}



const REFRESH_DEBOUNCE_MS = 350;
const GEOMETRY_REFRESH_DEBOUNCE_MS = 800;



export class GeometryPanel {

  private panel: vscode.WebviewPanel | undefined;

  private documentUri: string | undefined;

  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  private geometryGeneration = 0;



  constructor(

    private context: vscode.ExtensionContext,

    private client: LanguageClient

  ) {}



  async show(): Promise<void> {

    const editor = vscode.window.activeTextEditor;

    if (!editor || !isMcunrDocument(editor.document)) {

      vscode.window.showWarningMessage("Откройте файл MCU-NR");

      return;

    }



    this.documentUri = editor.document.uri.toString();



    const scene = await this.client.sendRequest<unknown>("mcuhelper/getGeometry", this.documentUri);

    if (!scene) {

      vscode.window.showErrorMessage("Не удалось построить сечение геометрии");

      return;

    }



    if (this.panel) {

      this.panel.reveal();

      this.panel.webview.postMessage({ type: "scene", scene });

    } else {

      this.panel = vscode.window.createWebviewPanel(

        "mcuhelper.geometry",

        "MCU-NR: Сечения",

        vscode.ViewColumn.Beside,

        { enableScripts: true, retainContextWhenHidden: true }

      );

      this.panel.onDidDispose(() => {

        this.panel = undefined;

        this.documentUri = undefined;

        if (this.refreshTimer) clearTimeout(this.refreshTimer);

      });

      this.panel.webview.html = this.getHtml();

      this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));

      this.panel.webview.postMessage({ type: "scene", scene });

    }

  }



  /** Обновить срез при изменении отслеживаемого файла (без ручного refresh). */

  onDocumentChanged(doc: vscode.TextDocument): void {

    if (!this.panel || !this.documentUri) return;

    if (doc.uri.toString() !== this.documentUri) return;

    if (!isMcunrDocument(doc)) return;



    if (this.refreshTimer) clearTimeout(this.refreshTimer);

    this.refreshTimer = setTimeout(() => {

      void this.pushGeometryUpdate();

    }, GEOMETRY_REFRESH_DEBOUNCE_MS);

  }



  private async pushGeometryUpdate(): Promise<void> {

    if (!this.panel || !this.documentUri) return;

    const generation = ++this.geometryGeneration;

    try {

      const scene = await this.client.sendRequest<unknown>("mcuhelper/getGeometry", this.documentUri);

      if (generation !== this.geometryGeneration) return;

      if (scene && this.panel) {

        this.panel.webview.postMessage({ type: "scene", scene });

      }

    } catch {

      /* LSP может быть занят; следующее изменение повторит запрос */

    }

  }



  private async onMessage(msg: {

    type: string;

    x?: number;

    y?: number;

    z?: number;

    axis?: string;

    position?: number;

    resolution?: number;

  }): Promise<void> {

    if (!this.panel || !this.documentUri) return;



    if (msg.type === "ready") {

      const scene = await this.client.sendRequest<unknown>("mcuhelper/getGeometry", this.documentUri);

      if (scene) this.panel.webview.postMessage({ type: "scene", scene });

      return;

    }



    if (msg.type === "queryPoint" && msg.x !== undefined && msg.y !== undefined && msg.z !== undefined) {

      const result = await this.client.sendRequest<PointQueryResult | null>("mcuhelper/queryPoint", {

        uri: this.documentUri,

        x: msg.x,

        y: msg.y,

        z: msg.z,

      });

      this.panel.webview.postMessage({ type: "pointResult", result });

      return;

    }



    if (msg.type === "getSlice" && msg.axis && msg.position !== undefined) {

      const slice = await this.client.sendRequest<unknown>("mcuhelper/getSlice", {

        uri: this.documentUri,

        axis: msg.axis,

        position: msg.position,

        resolution: msg.resolution ?? 256,

      });

      this.panel.webview.postMessage({ type: "sliceResult", slice });

    }

  }



  private getHtml(): string {

    const cssUri = this.panel!.webview.asWebviewUri(

      vscode.Uri.joinPath(this.context.extensionUri, "media", "geometry", "viewer.css")

    );

    const jsUri = this.panel!.webview.asWebviewUri(

      vscode.Uri.joinPath(this.context.extensionUri, "media", "geometry", "viewer.js")

    );

    const csp = `default-src 'none'; script-src ${this.panel!.webview.cspSource}; style-src ${this.panel!.webview.cspSource} 'unsafe-inline'`;

    return `<!DOCTYPE html>

<html>

<head>

  <meta charset="UTF-8">

  <meta http-equiv="Content-Security-Policy" content="${csp}">

  <link rel="stylesheet" href="${cssUri}">

</head>

<body>

  <div id="toolbar">

    <label>Плоскость:

      <select id="plane">

        <option value="sliceXY" selected>XY (нормаль Z)</option>

        <option value="sliceXZ">XZ (нормаль Y)</option>

        <option value="sliceYZ">YZ (нормаль X)</option>

      </select>

    </label>

    <label>Позиция: <span id="slicePosLabel">Z=0</span>

      <input type="range" id="slicePos" min="-20" max="20" step="0.1" value="0">

    </label>

    <label>Разрешение:

      <select id="resolution">

        <option value="64">64</option>

        <option value="128">128</option>

        <option value="256" selected>256</option>

        <option value="512">512</option>

        <option value="1024">1024</option>

      </select>

    </label>

    <label>Раскраска:

      <select id="colorBy">

        <option value="material">Материал</option>

        <option value="zone">Зона</option>

      </select>

    </label>

    <button id="resetView" title="Показать весь срез">Сброс масштаба</button>

    <label>X <input type="number" id="ptX" step="0.1" value="0"></label>

    <label>Y <input type="number" id="ptY" step="0.1" value="0"></label>

    <label>Z <input type="number" id="ptZ" step="0.1" value="50"></label>

    <button id="queryBtn">Проверить точку</button>

  </div>

  <div id="main">

    <div id="slice-wrap"><canvas id="slice-canvas"></canvas></div>

    <div id="sidebar">

      <div id="legend"></div>

      <div id="hint" class="hint">Колёсико — зум к курсору · Shift+ЛКМ — сдвиг</div>

      <div id="info"><span class="label">Кликните на срезе для проверки точки</span></div>

    </div>

  </div>

  <script src="${jsUri}"></script>

</body>

</html>`;

  }

}

