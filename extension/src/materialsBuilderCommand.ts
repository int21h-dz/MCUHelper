import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { MaterialsBuilderPanel } from "./materialsBuilderPanel";
import { registerWaterSteamFocusTracker } from "./waterSteamPanel";

let panel: MaterialsBuilderPanel | undefined;
let focusTracked = false;

/** Открыть webview-конструктор материалов. */
export async function runMaterialsBuilder(
  context: vscode.ExtensionContext,
  client?: LanguageClient
): Promise<void> {
  if (!focusTracked) {
    registerWaterSteamFocusTracker(context);
    focusTracked = true;
  }
  if (!panel) {
    panel = new MaterialsBuilderPanel(context);
  }
  await panel.show(client);
}
