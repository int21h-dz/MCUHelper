import * as vscode from "vscode";
import type { IndexPayload } from "./navData";

export type MatrLensMaterial = IndexPayload["summaries"]["materials"][number];

/** Компактная подпись CodeLens над MATR (как ▸ у #include). */
export function formatMatrCodeLensTitle(m: MatrLensMaterial): string {
  const parts: string[] = [];
  const n = m.nuclideCount;
  parts.push(n === 1 ? "1 нукл." : `${n} нукл.`);

  const si = m.sumIsotopeCount ?? 0;
  if (si > 0) parts.push(`${si} в SI`);

  const rho = m.massDensityGcm3;
  if (rho != null && Number.isFinite(rho) && rho > 0) {
    parts.push(
      rho >= 0.01 && rho < 10_000
        ? `ρ≈${rho.toPrecision(4)} г/см³`
        : `ρ≈${rho.toExponential(3)} г/см³`
    );
  }

  const vol = m.volumeCm3;
  if (vol != null && Number.isFinite(vol) && vol > 0) {
    parts.push(
      vol >= 0.01 && vol < 1e9
        ? `V≈${vol.toPrecision(4)} см³`
        : `V≈${vol.toExponential(3)} см³`
    );
  }

  const mass = m.massG;
  if (mass != null && Number.isFinite(mass) && mass > 0) {
    parts.push(mass >= 1000 ? `m≈${(mass / 1000).toPrecision(3)} кг` : `m≈${mass.toPrecision(3)} г`);
  }

  const act = m.activityBqPerG;
  if (act != null && Number.isFinite(act) && act > 0) {
    parts.push(`A≈${formatActivityCompact(act)}`);
  }

  if (m.temperature != null && Number.isFinite(m.temperature)) {
    parts.push(`T=${m.temperature}`);
  }
  if (m.group) parts.push(`GROUP=${m.group}`);

  return parts.join(" · ");
}

function formatActivityCompact(bqPerG: number): string {
  const abs = Math.abs(bqPerG);
  const units: Array<{ div: number; suffix: string }> = [
    { div: 1e15, suffix: "ПБк/г" },
    { div: 1e12, suffix: "ТБк/г" },
    { div: 1e9, suffix: "ГБк/г" },
    { div: 1e6, suffix: "МБк/г" },
    { div: 1e3, suffix: "кБк/г" },
    { div: 1, suffix: "Бк/г" },
  ];
  for (const u of units) {
    if (abs >= u.div || u.div === 1) {
      const v = bqPerG / u.div;
      const s =
        abs / u.div >= 100 || abs / u.div < 0.01
          ? v.toExponential(3)
          : v.toPrecision(4).replace(/\.?0+$/, "").replace(/(\.\d*?)0+$/, "$1");
      return `${s.endsWith(".") ? s.slice(0, -1) : s} ${u.suffix}`;
    }
  }
  return `${bqPerG} Бк/г`;
}

export function buildMatrCodeLenses(
  document: vscode.TextDocument,
  materials: ReadonlyArray<MatrLensMaterial>,
  documentUri: string
): vscode.CodeLens[] {
  if (document.languageId !== "mcunr") return [];
  const lenses: vscode.CodeLens[] = [];
  const lineCount = document.lineCount;

  for (const m of materials) {
    const line = m.range.start.line;
    if (line < 0 || line >= lineCount) continue;
    const lineText = document.lineAt(line).text;
    // Не ставим lens на чужие строки, если range уехал после include-remap.
    if (!/^\s*MATR\b/i.test(lineText)) continue;

    const range = new vscode.Range(line, 0, line, lineText.length);
    const title = formatMatrCodeLensTitle(m);
    if (!title) continue;

    const tipParts = [`MATR ${m.number}`];
    if (m.nuclidesPreview) tipParts.push(m.nuclidesPreview);
    lenses.push(
      new vscode.CodeLens(range, {
        title,
        tooltip: tipParts.join(" — "),
        command: "mcuhelper.revealEditorRange",
        arguments: [
          documentUri,
          {
            start: { line: m.range.start.line, character: m.range.start.character },
            end: { line: m.range.end.line, character: m.range.end.character },
          },
        ],
      })
    );
  }
  return lenses;
}

class MatrCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;
  private readonly indexByUri = new Map<string, IndexPayload>();

  refresh(): void {
    this.emitter.fire();
  }

  setIndex(uri: string, index: IndexPayload | null): void {
    if (!index) this.indexByUri.delete(uri);
    else this.indexByUri.set(uri, index);
    this.refresh();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const uri = document.uri.toString();
    const index = this.indexByUri.get(uri);
    if (!index) return [];
    return buildMatrCodeLenses(document, index.summaries.materials, uri);
  }
}

let provider: MatrCodeLensProvider | undefined;

export function registerMatrCodeLens(context: vscode.ExtensionContext): void {
  provider = new MatrCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "mcunr", scheme: "file" }, provider),
    vscode.languages.registerCodeLensProvider({ language: "mcunr", scheme: "untitled" }, provider),
    vscode.commands.registerCommand(
      "mcuhelper.revealEditorRange",
      async (
        uriStr: string,
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        }
      ) => {
        const uri = vscode.Uri.parse(uriStr);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const r = new vscode.Range(
          range.start.line,
          range.start.character,
          range.end.line,
          range.end.character
        );
        editor.selection = new vscode.Selection(r.start, r.start);
        editor.revealRange(r, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    )
  );
}

/** Обновить CodeLens после getIndex (sidebar / decorations). */
export function updateMatrCodeLensIndex(uri: string, index: IndexPayload | null): void {
  provider?.setIndex(uri, index);
}
