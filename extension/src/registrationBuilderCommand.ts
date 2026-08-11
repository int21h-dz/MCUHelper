import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { RegistrationBuilderPanel } from "./registrationBuilderPanel";

let panel: RegistrationBuilderPanel | undefined;

/** Открыть webview-конструктор секции регистрации PTYPE…END. */
export async function runRegistrationBuilder(
  context: vscode.ExtensionContext,
  client?: LanguageClient
): Promise<void> {
  if (!panel) {
    panel = new RegistrationBuilderPanel(context);
  }
  await panel.show(client);
}
