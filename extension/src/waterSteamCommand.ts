import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { WaterSteamPanel, registerWaterSteamFocusTracker } from "./waterSteamPanel";

let panel: WaterSteamPanel | undefined;
let focusTracked = false;

/** Открыть webview параметров воды/пара (IF97 → dens H/O). */
export async function runWaterSteam(
  context: vscode.ExtensionContext,
  client?: LanguageClient
): Promise<void> {
  if (!focusTracked) {
    registerWaterSteamFocusTracker(context);
    focusTracked = true;
  }
  if (!panel) {
    panel = new WaterSteamPanel(context);
  }
  await panel.show(client);
}
