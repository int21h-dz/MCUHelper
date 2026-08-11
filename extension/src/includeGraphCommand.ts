import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

type IncludeGraphNode = {
  path: string;
  uri?: string;
  fsPath?: string;
  exists: boolean;
  encoding?: string;
  diagCount?: number;
  mainLine: number;
  nestedInclude?: boolean;
};

/** QuickPick графа #include из getIndex.includeGraph. */
export async function showIncludeGraph(client: LanguageClient | undefined): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "mcunr") {
    vscode.window.showWarningMessage("Откройте файл MCU-NR");
    return;
  }
  if (!client) {
    vscode.window.showWarningMessage("LSP ещё не готов");
    return;
  }

  const index = await client.sendRequest<{
    includeGraph?: IncludeGraphNode[];
  }>("mcuhelper/getIndex", { uri: editor.document.uri.toString() });

  const nodes = index.includeGraph ?? [];
  if (!nodes.length) {
    vscode.window.showInformationMessage("В варианте нет директив #include");
    return;
  }

  const picked = await vscode.window.showQuickPick(
    nodes.map((n) => ({
      label: n.path,
      description: [
        n.exists ? "есть" : "нет файла",
        n.encoding ? `enc=${n.encoding}` : "",
        n.diagCount ? `diag=${n.diagCount}` : "",
        n.nestedInclude ? "вложенный!" : "",
        `main:${n.mainLine + 1}`,
      ]
        .filter(Boolean)
        .join(" · "),
      node: n,
    })),
    {
      title: "Граф #include (main → файлы)",
      placeHolder: "Выберите include — открыть файл или перейти к директиве",
      ignoreFocusOut: true,
    }
  );
  if (!picked) return;

  const openFile = await vscode.window.showQuickPick(
    [
      { label: "Открыть include-файл", id: "file" },
      { label: "Перейти к директиве в main", id: "main" },
    ],
    { title: picked.label, ignoreFocusOut: true }
  );
  if (!openFile) return;

  if (openFile.id === "main") {
    const pos = new vscode.Position(picked.node.mainLine, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    return;
  }

  if (picked.node.fsPath) {
    const uri = vscode.Uri.file(picked.node.fsPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  } else if (picked.node.uri) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(picked.node.uri));
    await vscode.window.showTextDocument(doc, { preview: false });
  } else {
    vscode.window.showWarningMessage(`Файл include не найден: ${picked.node.path}`);
  }
}
