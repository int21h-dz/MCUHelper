import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { BodyLivePreviewPanel } from "./bodyLivePreviewPanel";

let panel: BodyLivePreviewPanel | undefined;

/** Открыть / обновить живое превью тела под курсором. */
export async function runBodyLivePreview(
  context: vscode.ExtensionContext,
  client?: LanguageClient
): Promise<void> {
  if (!panel) {
    panel = new BodyLivePreviewPanel(context);
    panel.watch();
  }
  panel.setClient(client);
  await panel.show({ fromCommand: true });
}

/** Следить за курсором: автооткрытие по настройке `mcuhelper.liveBodyPreview`. */
export function registerBodyLivePreview(
  context: vscode.ExtensionContext,
  client?: LanguageClient
): void {
  if (!panel) {
    panel = new BodyLivePreviewPanel(context);
    panel.watch();
  }
  panel.setClient(client);
  panel.nudge();
}
