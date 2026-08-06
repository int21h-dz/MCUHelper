import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { isMcunrDocument } from "./contentDetect";
import type { NavTreeNode } from "./navData";
import { ADD_TO_SUM_ISOTOPE_DIAG_CODES } from "./addToSumIsotope";

/** Коды диагностик, которые выдаёт `lexDocument` в mcu-language. */
export const LEXER_DIAGNOSTIC_CODES = new Set(["no-tabs", "line-length"]);

/** Сверка AW.LIB / PARAMETE.THR с IAEA — отдельная группа в sidebar. */
export const ISOTOPE_MISMATCH_DIAGNOSTIC_CODES = new Set([
  "aw-mass-mismatch",
  "aw-mass-missing",
  "aw-mass-missing-siden",
  "thr-halflife-mismatch",
  "phy-missing",
  "phy-missing-siden",
]);

export type DiagnosticFilter = "lexer" | "all";

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

export interface McuIncludeDiagnosticPayload {
  path: string;
  uri: string;
  mainIncludeLine: number;
  diagnostics: McuDiagnosticPayload[];
}

export interface McuDiagnosticsResponse {
  diagnostics: McuDiagnosticPayload[];
  includeGroups: McuIncludeDiagnosticPayload[];
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
  const d = new vscode.Diagnostic(range, p.message, mapLspSeverityToVsCode(p.severity));
  if (p.code) d.code = p.code;
  d.source = p.source;
  return d;
}

/**
 * LSP DiagnosticSeverity: Error=1 Warning=2 Info=3 Hint=4
 * VS Code DiagnosticSeverity: Error=0 Warning=1 Info=2 Hint=3
 * Без маппинга Warning (2) попадает в «Прочее» как Information.
 */
export function mapLspSeverityToVsCode(severity: number): vscode.DiagnosticSeverity {
  switch (severity) {
    case 1:
      return vscode.DiagnosticSeverity.Error;
    case 2:
      return vscode.DiagnosticSeverity.Warning;
    case 3:
      return vscode.DiagnosticSeverity.Information;
    case 4:
      return vscode.DiagnosticSeverity.Hint;
    case 0:
      // уже VS Code Error (на всякий случай)
      return vscode.DiagnosticSeverity.Error;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

/** Диагностики напрямую из LSP (без «призраков» из кэша VS Code). */
export async function fetchMcuDiagnostics(
  client: LanguageClient,
  uri: vscode.Uri,
  filter: DiagnosticFilter,
  lineCount?: number
): Promise<vscode.Diagnostic[]> {
  const response = await client.sendRequest<McuDiagnosticsResponse>("mcuhelper/getDiagnostics", {
    uri: uri.toString(),
  });
  return (response?.diagnostics ?? [])
    .map(payloadToDiagnostic)
    .filter((d) => filter === "all" || LEXER_DIAGNOSTIC_CODES.has(diagnosticCode(d) ?? ""))
    .filter((d) => lineCount == null || d.range.start.line < lineCount)
    .sort(compareDiagnosticsByPosition);
}

export async function fetchMcuDiagnosticResponse(
  client: LanguageClient,
  uri: vscode.Uri
): Promise<{ diagnostics: vscode.Diagnostic[]; includeGroups: Array<{ path: string; uri: string; mainIncludeLine: number; diagnostics: vscode.Diagnostic[] }> }> {
  const response = await client.sendRequest<McuDiagnosticsResponse>("mcuhelper/getDiagnostics", {
    uri: uri.toString(),
  });
  return {
    diagnostics: (response?.diagnostics ?? []).map(payloadToDiagnostic).sort(compareDiagnosticsByPosition),
    includeGroups: (response?.includeGroups ?? []).map((group) => ({
      path: group.path,
      uri: group.uri,
      mainIncludeLine: group.mainIncludeLine,
      diagnostics: group.diagnostics.map(payloadToDiagnostic).sort(compareDiagnosticsByPosition),
    })),
  };
}

function severityLabel(severity: vscode.DiagnosticSeverity): string {
  if (severity === vscode.DiagnosticSeverity.Error) return "error";
  if (severity === vscode.DiagnosticSeverity.Warning) return "warning";
  return "info";
}

function isIsotopeMismatchDiag(d: vscode.Diagnostic): boolean {
  const code = diagnosticCode(d);
  return code != null && ISOTOPE_MISMATCH_DIAGNOSTIC_CODES.has(code);
}

/** Имя нуклида из текста предупреждения сверки. */
export function extractIsotopeNameFromDiag(d: { message: string }): string | undefined {
  const m =
    d.message.match(/^(?:Атомная масса|T1\/2)\s+(\S+?):/) ??
    d.message.match(/^Нуклид\s+(\S+)\s+отсутствует/);
  return m?.[1];
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * CSV группы сверки изотопов.
 * Колонки: code,nuclide,line,column,local,iaea,delta,target,message
 */
export function buildIsotopeMismatchCsv(diags: readonly vscode.Diagnostic[]): string {
  const header = "code,nuclide,line,column,local,iaea,delta,target,message";
  const rows = diags.map((d) => {
    const code = diagnosticCode(d) ?? "";
    const nuclide = extractIsotopeNameFromDiag(d) ?? "";
    const line = String(d.range.start.line + 1);
    const column = String(d.range.start.character + 1);
    let local = "";
    let iaea = "";
    let delta = "";
    let target = "";
    if (code === "aw-mass-mismatch") {
      const m = d.message.match(
        /AW\.LIB\s+([\d.]+)\s*≠\s*IAEA\s+([\d.]+).*?Δ\s*=\s*([+\-−]?[\d.eE+-]+).*?,\s*([A-Za-z]+-\d+)/
      );
      if (m) {
        local = m[1]!;
        iaea = m[2]!;
        delta = m[3]!.replace("−", "-");
        target = m[4]!;
      }
    } else if (code === "thr-halflife-mismatch") {
      const m = d.message.match(
        /PARAMETE\.THR\s+(.+?)\s*≠\s*IAEA\s+(.+?)\s*\(Δrel\s*=\s*([+\-−]?[\d.]+%)\s*,\s*([^)]+)\)/
      );
      if (m) {
        local = m[1]!.trim();
        iaea = m[2]!.trim();
        delta = m[3]!.replace("−", "-");
        target = m[4]!.trim();
      }
    }
    return [code, nuclide, line, column, local, iaea, delta, target, d.message]
      .map((c) => csvEscape(c))
      .join(",");
  });
  return [header, ...rows].join("\n");
}

/** Дерево для sidebar: ошибки / сверка изотопов / прочие предупреждения. */
export function buildDiagnosticTree(
  uri: string,
  diags: readonly vscode.Diagnostic[],
  maxItems = MAX_SIDEBAR_DIAGNOSTICS
): NavTreeNode[] {
  const capped = diags.length > maxItems ? diags.slice(0, maxItems) : diags;
  const truncated = diags.length > maxItems;
  /** По коду, не по severity — LSP/VS Code severity легко перепутать. */
  const isotope = capped.filter((d) => isIsotopeMismatchDiag(d));
  const isotopeIds = new Set(isotope);
  const errors = capped.filter(
    (d) => !isotopeIds.has(d) && d.severity === vscode.DiagnosticSeverity.Error
  );
  const warnings = capped.filter(
    (d) => !isotopeIds.has(d) && d.severity === vscode.DiagnosticSeverity.Warning
  );
  const other = capped.filter(
    (d) =>
      !isotopeIds.has(d) &&
      d.severity !== vscode.DiagnosticSeverity.Error &&
      d.severity !== vscode.DiagnosticSeverity.Warning
  );

  const toLeaf = (d: vscode.Diagnostic, index: number, preferNameLabel = false): NavTreeNode => {
    const code = diagnosticCode(d);
    const line = d.range.start.line + 1;
    const col = d.range.start.character + 1;
    const name = preferNameLabel ? extractIsotopeNameFromDiag(d) : undefined;
    const nuclideName =
      name ??
      (code && ADD_TO_SUM_ISOTOPE_DIAG_CODES.has(code) ? extractIsotopeNameFromDiag(d) : undefined);
    const leaf: NavTreeNode = {
      id: `diag-${index}-${d.range.start.line}-${d.range.start.character}`,
      label: name ?? `L${line}:${col}`,
      description: d.message,
      badges: code ? [code, severityLabel(d.severity)] : [severityLabel(d.severity)],
      uri,
      range: {
        start: { line: d.range.start.line, character: d.range.start.character },
        end: { line: d.range.end.line, character: d.range.end.character },
      },
    };
    if (nuclideName && code && ADD_TO_SUM_ISOTOPE_DIAG_CODES.has(code)) {
      leaf.action = {
        id: "add-to-si",
        label: "В SI",
        title: "Добавить в суммарный изотоп",
        command: "mcuhelper.addToSumIsotope",
        args: {
          uri,
          line: d.range.start.line,
          nuclideName,
        },
      };
    }
    return leaf;
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
  if (isotope.length > 0) {
    groups.push({
      id: "diag-isotope-mismatch",
      label: "Сверка изотопов",
      description: String(isotope.length),
      copyCsv: buildIsotopeMismatchCsv(isotope),
      children: isotope.map((d) => toLeaf(d, leafIndex++, true)),
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

export function buildDiagnosticTreeWithIncludes(
  uri: string,
  diags: readonly vscode.Diagnostic[],
  includeGroups: readonly { path: string; uri: string; diagnostics: readonly vscode.Diagnostic[] }[],
  maxItems = MAX_SIDEBAR_DIAGNOSTICS
): NavTreeNode[] {
  const groups = buildDiagnosticTree(uri, diags, maxItems);
  const includeCount = includeGroups.reduce((sum, g) => sum + g.diagnostics.length, 0);
  if (includeCount <= 0) return groups;

  let leafIndex = 10_000;
  const fileNodes: NavTreeNode[] = includeGroups.map((group, groupIndex) => ({
    id: `diag-include-file-${groupIndex}`,
    label: group.path,
    description: String(group.diagnostics.length),
    children: group.diagnostics.map((d) => {
      const code = diagnosticCode(d);
      const line = d.range.start.line + 1;
      const col = d.range.start.character + 1;
      return {
        id: `diag-include-${leafIndex++}-${line}-${col}`,
        label: `L${line}:${col}`,
        description: d.message,
        badges: code ? [code, severityLabel(d.severity)] : [severityLabel(d.severity)],
        uri: group.uri,
        range: {
          start: { line: d.range.start.line, character: d.range.start.character },
          end: { line: d.range.end.line, character: d.range.end.character },
        },
      };
    }),
  }));

  const sourceIdx = groups.findIndex((n) => n.id === "diag-source");
  const includeNode: NavTreeNode = {
    id: "diag-includes",
    label: "#include",
    description: String(includeCount),
    children: fileNodes,
  };
  if (sourceIdx >= 0) groups.splice(sourceIdx + 1, 0, includeNode);
  else groups.unshift(includeNode);
  return groups;
}

let diagnosticsSidebarGeneration = 0;

export async function applyDiagnosticsToSidebar(
  webview: vscode.Webview,
  panelId: string,
  document: vscode.TextDocument | undefined,
  client: LanguageClient | undefined
): Promise<void> {
  const generation = ++diagnosticsSidebarGeneration;
  if (!document || !isMcunrDocument(document)) {
    if (generation !== diagnosticsSidebarGeneration) return;
    webview.postMessage({
      type: "empty",
      panel: panelId,
      message: "Откройте файл MCU-NR для просмотра диагностики",
    });
    return;
  }

  if (!client) {
    if (generation !== diagnosticsSidebarGeneration) return;
    webview.postMessage({
      type: "empty",
      panel: panelId,
      message: "LSP ещё не готов — подождите немного",
    });
    return;
  }

  let response: { diagnostics: vscode.Diagnostic[]; includeGroups: Array<{ path: string; uri: string; mainIncludeLine: number; diagnostics: vscode.Diagnostic[] }> };
  try {
    response = await fetchMcuDiagnosticResponse(client, document.uri);
  } catch {
    if (generation !== diagnosticsSidebarGeneration) return;
    webview.postMessage({
      type: "empty",
      panel: panelId,
      message: "Не удалось получить диагностику из LSP",
    });
    return;
  }

  if (generation !== diagnosticsSidebarGeneration) return;

  const diags = response.diagnostics.filter((d) => d.range.start.line < document.lineCount);
  if (diags.length === 0 && response.includeGroups.every((g) => g.diagnostics.length === 0)) {
    webview.postMessage({
      type: "empty",
      panel: panelId,
      message: "Диагностики не найдены — вариант чист",
    });
    return;
  }

  const uri = document.uri.toString();
  const nodes = buildDiagnosticTreeWithIncludes(uri, diags, response.includeGroups);
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
