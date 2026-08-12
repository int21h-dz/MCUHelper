import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import {
  loadWaterSteamApi,
  type PressureUnit,
  type WaterSteamState,
} from "./mcuLanguageBridge";
import {
  registerWaterSteamFocusTracker,
  resolveWaterSteamContext,
  type WaterSteamContext,
} from "./waterSteamContext";
import { applyHODensToMaterial } from "./waterSteamInsert";

type HostMsg =
  | { type: "ready" }
  | { type: "solveTRho"; T: number; rho: number }
  | { type: "solvePT"; T: number; P: number }
  | { type: "solvePRho"; P: number; rho: number }
  | { type: "insert"; nH: number; nO: number }
  | { type: "refreshContext" };

export { registerWaterSteamFocusTracker };

/** Webview ρ–T воды/пара (IAPWS-IF97) → dens H/O; P = Psat(T). */
export class WaterSteamPanel {
  private panel: vscode.WebviewPanel | undefined;
  private client: LanguageClient | undefined;
  private ctx: WaterSteamContext | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async show(client?: LanguageClient): Promise<void> {
    this.client = client;
    try {
      this.ctx = await resolveWaterSteamContext(client);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Вода / пар: не удалось открыть — ${msg}`);
      return;
    }

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      // HTML/CSS/JS могут обновиться после сборки — перезагружаем разметку.
      this.panel.webview.html = this.getHtml(this.panel.webview);
      await this.pushInit();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "mcuhelper.waterSteam",
      "MCU-NR: Вода / пар",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg: HostMsg) => void this.onMessage(msg));
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    await this.pushInit();
  }

  private postState(state: WaterSteamState): void {
    if (!this.panel) return;
    void this.panel.webview.postMessage({ type: "state", state });
  }

  private postError(e: unknown): void {
    if (!this.panel) return;
    void this.panel.webview.postMessage({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  private async onMessage(msg: HostMsg): Promise<void> {
    if (!this.panel) return;
    switch (msg.type) {
      case "ready":
        await this.pushInit();
        break;
      case "refreshContext":
        this.ctx = await resolveWaterSteamContext(this.client);
        await this.pushInit();
        break;
      case "solveTRho": {
        const api = loadWaterSteamApi();
        try {
          this.postState(api.stateFromTRho(msg.T, msg.rho));
        } catch (e) {
          this.postError(e);
        }
        break;
      }
      case "solvePT": {
        const api = loadWaterSteamApi();
        try {
          this.postState(api.stateFromPT(msg.P, msg.T));
        } catch (e) {
          this.postError(e);
        }
        break;
      }
      case "solvePRho": {
        const api = loadWaterSteamApi();
        try {
          this.postState(api.stateFromPRho(msg.P, msg.rho));
        } catch (e) {
          this.postError(e);
        }
        break;
      }
      case "insert": {
        if (!this.ctx) {
          vscode.window.showWarningMessage("Контекст материала не загружен.");
          return;
        }
        if (this.ctx.source !== "material" || this.ctx.materialRange == null) {
          this.ctx = await resolveWaterSteamContext(this.client);
        }
        await applyHODensToMaterial({ nH: msg.nH, nO: msg.nO, ctx: this.ctx });
        break;
      }
      default:
        break;
    }
  }

  private async pushInit(): Promise<void> {
    if (!this.panel || !this.ctx) return;
    const api = loadWaterSteamApi();
    const satCurve = api.buildSaturationCurve({ steps: 64 });
    void this.panel.webview.postMessage({
      type: "init",
      ctx: {
        source: this.ctx.source,
        note: this.ctx.note,
        footnote: this.ctx.footnote ?? "",
        docLabel: this.ctx.docLabel,
        materialNumber: this.ctx.materialNumber,
        canInsert: this.ctx.materialRange != null && this.ctx.materialNumber != null,
        line: this.ctx.line,
      },
      state: this.ctx.initial as WaterSteamState,
      satCurve,
      pressureUnits: api.PRESSURE_UNITS,
      defaultPressureUnit: "atm" as PressureUnit,
      atmMPa: api.ATM_MPA,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "waterSteam", "waterSteam.css")
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "waterSteam", "waterSteam.js")
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
  <title>Вода / пар</title>
</head>
<body>
  <div id="root">
    <header class="ws-header">
      <div>
        <h1>Вода / пар</h1>
        <p class="ws-sub">IAPWS-IF97 · ρ–T · радио «вычислять» · dens H и O</p>
      </div>
      <div class="ws-doc" id="docLabel"></div>
    </header>

    <p class="ws-note" id="note"></p>
    <p class="ws-footnote" id="footnote" hidden></p>

    <div class="ws-layout">
      <section class="ws-chart-wrap">
        <svg id="chart" viewBox="0 0 640 420" role="img" aria-label="Диаграмма ρ–T"></svg>
        <p class="ws-hover" id="hoverReadout">T = —   ·   ρ = —</p>
      </section>

      <section class="ws-panel">
        <div class="ws-grid">
          <label class="ws-field" id="fieldT">
            <span class="ws-field-head">
              <input type="radio" name="dep" value="T" id="depT" title="Вычислять температуру" />
              <span>T, K</span>
            </span>
            <input type="number" id="inpT" step="any" />
          </label>
          <label class="ws-field" id="fieldRho">
            <span class="ws-field-head">
              <input type="radio" name="dep" value="rho" id="depRho" title="Вычислять плотность" />
              <span>ρ, г/см³</span>
            </span>
            <input type="number" id="inpRho" step="any" min="0" />
          </label>
          <label class="ws-field ws-span-2" id="fieldP">
            <span class="ws-field-head">
              <input type="radio" name="dep" value="P" id="depP" title="Вычислять давление" checked />
              <span>Давление</span>
            </span>
            <span class="ws-p-inputs">
              <input type="number" id="inpP" step="any" min="0" />
              <select id="selPUnit" title="Единицы давления" aria-label="Единицы давления">
                <option value="atm">атм</option>
                <option value="Pa">Па</option>
                <option value="kPa">кПа</option>
                <option value="MPa">МПа</option>
                <option value="bar">бар</option>
              </select>
            </span>
          </label>
          <label>n<sub>H</sub> <input type="text" id="outNH" readonly /></label>
          <label>n<sub>O</sub> <input type="text" id="outNO" readonly /></label>
          <label class="ws-span-2">фаза <input type="text" id="outPhase" readonly /></label>
        </div>
        <div class="ws-actions">
          <button type="button" class="ws-btn ws-btn-sec" id="btnRefresh">Контекст с курсора</button>
          <button type="button" class="ws-btn ws-btn-accent" id="btnInsert" disabled>Вставить / заменить H и O</button>
        </div>
        <p class="ws-err" id="err" hidden></p>
      </section>
    </div>
  </div>
  <script src="${js}"></script>
</body>
</html>`;
  }
}
