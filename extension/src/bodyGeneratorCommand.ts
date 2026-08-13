import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { BodyGeneratorPanel } from "./bodyGeneratorPanel";

let panel: BodyGeneratorPanel | undefined;

/** Открыть webview-конструктор геометрических тел. */
export async function runBodyGenerator(
  context: vscode.ExtensionContext,
  client?: LanguageClient
): Promise<void> {
  if (!panel) {
    panel = new BodyGeneratorPanel(context);
  }
  await panel.show(client);
}
