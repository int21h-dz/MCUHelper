import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { LatticeGeneratorPanel } from "./latticeGeneratorPanel";

let panel: LatticeGeneratorPanel | undefined;

/** Открыть webview-конструктор решётки GLTL. */
export async function runLatticeGenerator(
  context: vscode.ExtensionContext,
  client?: LanguageClient
): Promise<void> {
  if (!panel) {
    panel = new LatticeGeneratorPanel(context);
    panel.watch();
  }
  panel.setClient(client);
  await panel.show({ fromCommand: true });
}

/** Следить за курсором: автооткрытие в блоке LATT GLTL (`mcuhelper.liveLatticeGenerator`). */
export function registerLatticeGenerator(
  context: vscode.ExtensionContext,
  client?: LanguageClient
): void {
  if (!panel) {
    panel = new LatticeGeneratorPanel(context);
    panel.watch();
  }
  panel.setClient(client);
  panel.nudge();
}
