import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export interface ExpandNaturalIsotopeArgs {
  uri: string;
  line: number;
  character: number;
  nuclideName: string;
  concentration: string;
}

interface McuIsotopeLine {
  mcuName: string;
  concentration: string;
}

const NUCLIDE_LINE_RE = /([A-Za-z][A-Za-z0-9]{0,5})\s+([\d.Ee+-]+)(\s+MODS=\S+)?/g;

export function findNuclideSpan(
  line: string,
  nuclideName: string,
  character: number
): { start: number; end: number; mods: string } | null {
  const want = nuclideName.toUpperCase();
  let match: RegExpExecArray | null;
  NUCLIDE_LINE_RE.lastIndex = 0;
  while ((match = NUCLIDE_LINE_RE.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (match[1].toUpperCase() !== want) continue;
    if (character < start || character >= end) continue;
    return { start, end, mods: match[3] ?? "" };
  }
  return null;
}

const HOVER_ENABLED_COMMANDS = [
  "mcuhelper.expandNaturalIsotope",
  "mcuhelper.addToSumIsotope",
];

function toTrustedHoverMarkdown(value: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString(value);
  md.isTrusted = { enabledCommands: HOVER_ENABLED_COMMANDS };
  md.supportThemeIcons = true;
  return md;
}

async function resolveEditor(uri: string): Promise<{ doc: vscode.TextDocument; editor: vscode.TextEditor }> {
  const parsed = vscode.Uri.parse(uri);
  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.toString() === parsed.toString()) {
    return { doc: active.document, editor: active };
  }
  const doc = await vscode.workspace.openTextDocument(parsed);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  return { doc, editor };
}

export function registerExpandNaturalIsotope(
  context: vscode.ExtensionContext,
  client: LanguageClient
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mcuhelper.expandNaturalIsotope",
      async (raw: ExpandNaturalIsotopeArgs | ExpandNaturalIsotopeArgs[]) => {
        const args = Array.isArray(raw) ? raw[0] : raw;
        if (!args?.uri) {
          vscode.window.showWarningMessage("Не удалось определить контекст для разложения");
          return;
        }

        const { doc, editor } = await resolveEditor(args.uri);
        const lineText = doc.lineAt(args.line).text;

        const span = findNuclideSpan(lineText, args.nuclideName, args.character);
        if (!span) {
          vscode.window.showWarningMessage(`Не найдена строка нуклида ${args.nuclideName}`);
          return;
        }

        const isotopes = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `MCU-NR: разложение ${args.nuclideName} на изотопы…`,
            cancellable: false,
          },
          () =>
            client.sendRequest<McuIsotopeLine[] | null>("mcuhelper/getNaturalIsotopeLines", {
              element: args.nuclideName,
              concentration: args.concentration,
            })
        );

        if (!isotopes?.length) {
          vscode.window.showWarningMessage(
            "Нет данных о природном составе. Нужен IAEA NDS или встроенный справочник."
          );
          return;
        }

        const indent = lineText.match(/^\s*/)?.[0] ?? "";
        const replacement = isotopes
          .map((iso) => `${indent}${iso.mcuName} ${iso.concentration}${span.mods}`)
          .join("\n");

        const range = new vscode.Range(args.line, span.start, args.line, span.end);

        const ok = await editor.edit((eb) => eb.replace(range, replacement));
        if (ok) {
          vscode.window.setStatusBarMessage(
            `MCU-NR: ${args.nuclideName} → ${isotopes.length} изотопов`,
            3000
          );
        }
      }
    )
  );
}

export function hoverMiddleware(): NonNullable<
  import("vscode-languageclient/node").LanguageClientOptions["middleware"]
> {
  return {
    provideHover: async (document, position, token, next) => {
      const hover = await next(document, position, token);
      if (!hover) return hover;

      hover.contents = hover.contents.map((part) => {
        if (typeof part === "string") {
          return toTrustedHoverMarkdown(part);
        }
        if (part && typeof part === "object" && "kind" in part && part.kind === "markdown" && "value" in part) {
          return toTrustedHoverMarkdown(String(part.value));
        }
        if (part instanceof vscode.MarkdownString) {
          part.isTrusted = { enabledCommands: HOVER_ENABLED_COMMANDS };
          part.supportThemeIcons = true;
          return part;
        }
        return part;
      });

      return hover;
    },
  };
}
