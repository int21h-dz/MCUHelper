import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { isMcunrDocument } from "./contentDetect";
import type { NavTreeNode } from "./navData";

/** Коды диагностик, которые выдаёт `lexDocument` в mcu-language. */
export const LEXER_DIAGNOSTIC_CODES = new Set(["no-tabs", "line-length"]);

export type DiagnosticFilter = "lexer" | "all";

/** Ответ LSP `mcuhelper/getDiagnostics` — только исходный текст файла. */
export interface McuDiagnosticPayload {
  severity: number;
  message: string;
  code?: string;
  source: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

/** Не строить в sidebar десятки тысяч узлов. */
export const MAX_SIDEBAR_DIAGNOSTICS = 500;

function diagnosticCode(d: vscode.Diagnostic): string | undefined {
  if (typeof d.code === "string") return d.code;
  if (d.code && typeof d.code === "object" && "value" in d.code) {
    return String(d.code.value);
  }
  return undefined;
}

export function positionScore(pos: { line: number; character: number }): number {
  return pos.line * 1_000_000 + pos.character;
}

export function compareDiagnosticsByPosition(a: vscode.Diagnostic, b: vscode.Diagnostic): number {
  return positionScore(a.range.start) - positionScore(b.range.start);
}

function payloadToDiagnostic(p: McuDiagnosticPayload): vscode.Diagnostic {
  const range = new vscode.Range(
    p.range.start.line,
    p.range.start.character,
    p.range.end.line,
    p.range.end.character
  );
  const d = new vscode.Diagnostic(range, p.message, p.severity);
  if (p.code) d.code = p.code;
  d.source = p.source;
  return d;
}

/** Диагностики напрямую из LSP (без «призраков» из кэша VS Code). */
export async function fetchMcuDiagnostics(
  client: LanguageClient,
  uri: vscode.Uri,
  filter: DiagnosticFilter,
  lineCount?: number
): Promise<vscode.Diagnostic[]> {
  const payload = await client.sendRequest<McuDiagnosticPayload[]>("mcuhelper/getDiagnostics", {
    uri: uri.toString(),
  });
  return (payload ?? [])
    .map(payloadToDiagnostic)
    .filter((d) => filter === "all" || LEXER_DIAGNOSTIC_CODES.has(diagnosticCode(d) ?? ""))
    .filter((d) => lineCount == null || d.range.start.line < lineCount)
    .sort(compareDiagnosticsByPosition);
}

function severityLabel(severity: vscode.DiagnosticSeverity): string {
  if (severity === vscode.DiagnosticSeverity.Error) return "error";
  if (severity === vscode.DiagnosticSeverity.Warning) return "warning";
  return "info";
}

/** Дерево для sidebar: группы «Ошибки» / «Предупреждения», клик — переход в редактор. */
export function buildDiagnosticTree(
  uri: string,
  diags: readonly vscode.Diagnostic[],
  maxItems = MAX_SIDEBAR_DIAGNOSTICS
): NavTreeNode[] {
  const capped = diags.length > maxItems ? diags.slice(0, maxItems) : diags;
  const truncated = diags.length > maxItems;
  const errors = capped.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
  const warnings = capped.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning);
  const other = capped.filter(
    (d) => d.severity !== vscode.DiagnosticSeverity.Error && d.severity !== vscode.DiagnosticSeverity.Warning
  );

  const toLeaf = (d: vscode.Diagnostic, index: number): NavTreeNode => {
    const code = diagnosticCode(d);
    const line = d.range.start.line + 1;
    const col = d.range.start.character + 1;
    return {
      id: `diag-${index}-${d.range.start.line}-${d.range.start.character}`,
      label: `L${line}:${col}`,
      description: d.message,
      badges: code ? [code, severityLabel(d.severity)] : [severityLabel(d.severity)],
      uri,
      range: {
        start: { line: d.range.start.line, character: d.range.start.character },
        end: { line: d.range.end.line, character: d.range.end.character },
      },
    };
  };

  const groups: NavTreeNode[] = [];
  let leafIndex = 0;

  if (errors.length > 0) {
    groups.push({
      id: "diag-errors",
      label: "Ошибки",
      description: String(errors.length),
      children: errors.map((d) => toLeaf(d, leafIndex++)),
    });
  }
  if (warnings.length > 0) {
    groups.push({
      id: "diag-warnings",
      label: "Предупреждения",
      description: String(warnings.length),
      children: warnings.map((d) => toLeaf(d, leafIndex++)),
    });
  }
  if (other.length > 0) {
    groups.push({
      id: "diag-other",
      label: "Прочее",
      description: String(other.length),
      children: other.map((d) => toLeaf(d, leafIndex++)),
    });
  }

  if (truncated) {
    groups.unshift({
      id: "diag-truncated",
      label: "Показаны не все",
      description: `${maxItems} из ${diags.length}`,
      children: [
        {
          id: "diag-truncated-hint",
          label: "…",
          description: `Скрыто ещё ${diags.length - maxItems}. Alt+F7/F8 или «Экспорт диагностик».`,
          badges: ["info"],
        },
      ],
    });
  }

  if (diags.length > 0) {
    groups.unshift({
      id: "diag-source",
      label: "Источник LSP",
      description: `${diags.length} шт.`,
      badges: ["info"],
    });
  }

  return groups;
}

export async function applyDiagnosticsToSidebar(
  webview: vscode.Webview,
  panelId: string,
  document: vscode.TextDocument | undefined,
  client: LanguageClient | undefined
): Promise<void> {
  if (!document || !isMcunrDocument(document)) {
    webview.postMessage({
      type: "empty",
      panel: panelId,
      message: "Откройте файл MCU-NR для просмотра диагностики",
    });
    return;
  }

  if (!client) {
    webview.postMessage({
      type: "empty",
      panel: panelId,
      message: "LSP ещё не готов — подождите немного",
    });
    return;
  }

  let diags: vscode.Diagnostic[];
  try {
    diags = await fetchMcuDiagnostics(client, document.uri, "all", document.lineCount);
  } catch {
    webview.postMessage({
      type: "empty",
      panel: panelId,
      message: "Не удалось получить диагностику из LSP",
    });
    return;
  }

  if (diags.length === 0) {
    webview.postMessage({
      type: "empty",
      panel: panelId,
      message: "Диагностики не найдены — вариант чист",
    });
    return;
  }

  const uri = document.uri.toString();
  const nodes = buildDiagnosticTree(uri, diags);
  webview.postMessage({
    type: "tree",
    panel: panelId,
    nodes,
  });
}

/** Индекс следующей/предыдущей диагностики относительно курсора (с wrap). */
export function findDiagnosticIndex(
  diags: readonly { range: { start: { line: number; character: number }; end: { line: number; character: number } } }[],
  pos: { line: number; character: number },
  direction: 1 | -1
): number {
  if (diags.length === 0) return -1;
  const cur = positionScore(pos);

  if (direction > 0) {
    for (let i = 0; i < diags.length; i++) {
      const start = positionScore(diags[i].range.start);
      const end = positionScore(diags[i].range.end);
      if (start > cur) return i;
      if (cur >= start && cur <= end) return (i + 1) % diags.length;
    }
    return 0;
  }

  for (let i = diags.length - 1; i >= 0; i--) {
    const start = positionScore(diags[i].range.start);
    const end = positionScore(diags[i].range.end);
    if (end < cur) return i;
    if (cur >= start && cur <= end) return (i - 1 + diags.length) % diags.length;
  }
  return diags.length - 1;
}

export async function goToMcuDiagnostic(
  direction: 1 | -1,
  filter: DiagnosticFilter,
  getClient: () => LanguageClient | undefined
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isMcunrDocument(editor.document)) {
    vscode.window.showWarningMessage("Откройте файл MCU-NR");
    return;
  }

  const client = getClient();
  if (!client) {
    vscode.window.showWarningMessage("LSP ещё не готов");
    return;
  }

  let diags: vscode.Diagnostic[];
  try {
    diags = await fetchMcuDiagnostics(client, editor.document.uri, filter);
  } catch {
    vscode.window.showWarningMessage("Не удалось получить диагностику из LSP");
    return;
  }

  if (diags.length === 0) {
    vscode.window.showInformationMessage(
      filter === "lexer" ? "Ошибок лексера не найдено" : "Диагностика MCU-NR не найдена"
    );
    return;
  }

  const idx = findDiagnosticIndex(diags, editor.selection.active, direction);
  const target = diags[idx];
  const start = target.range.start;
  editor.selection = new vscode.Selection(start, start);
  editor.revealRange(target.range, vscode.TextEditorRevealType.InCenter);

  const code = diagnosticCode(target);
  const codeSuffix = code ? ` [${code}]` : "";
  void vscode.window.setStatusBarMessage(`${idx + 1}/${diags.length}${codeSuffix}: ${target.message}`, 4000);
}

export function registerDiagnosticNavigation(
  context: vscode.ExtensionContext,
  getClient: () => LanguageClient | undefined
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("mcuhelper.nextLexerError", () => goToMcuDiagnostic(1, "lexer", getClient)),
    vscode.commands.registerCommand("mcuhelper.prevLexerError", () => goToMcuDiagnostic(-1, "lexer", getClient)),
    vscode.commands.registerCommand("mcuhelper.nextDiagnostic", () => goToMcuDiagnostic(1, "all", getClient)),
    vscode.commands.registerCommand("mcuhelper.prevDiagnostic", () => goToMcuDiagnostic(-1, "all", getClient))
  );
}
