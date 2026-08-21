import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { formatMaterialNuclideCounts, type IndexPayload } from "./navData";

export type MatrLensMaterial = IndexPayload["summaries"]["materials"][number];

export function sameDocumentUri(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const ua = vscode.Uri.parse(a);
    const ub = vscode.Uri.parse(b);
    if (ua.toString() === ub.toString()) return true;
    // Windows: Z: vs z%3A, слэши, регистр — toString() часто расходится, fsPath стабильнее.
    const fa = ua.fsPath.replace(/\\/g, "/").toLowerCase();
    const fb = ub.fsPath.replace(/\\/g, "/").toLowerCase();
    return fa.length > 0 && fa === fb;
  } catch {
    return false;
  }
}

/** Куда ставить CodeLens: range в координатах редактора, иначе MATR-заголовок в этом файле. */
export function planMatrCodeLenses(
  documentUri: string,
  lineCount: number,
  lineAt: (line: number) => string,
  materials: ReadonlyArray<MatrLensMaterial>
): Array<{ line: number; material: MatrLensMaterial }> {
  const byDoc = materials.filter((m) => !m.uri || sameDocumentUri(m.uri, documentUri));
  const used = new Set<number>();
  const out: Array<{ line: number; material: MatrLensMaterial }> = [];

  for (let i = 0; i < byDoc.length; i++) {
    const m = byDoc[i]!;
    const line = m.range.start.line;
    if (line < 0 || line >= lineCount) continue;
    const text = lineAt(line);
    if (!/^\s*MATR\b/i.test(text)) continue;
    const num = parseInt(text.trim().match(/^MATR\s+(\d+)/i)?.[1] ?? "", 10);
    if (Number.isFinite(num) && num !== m.number) continue;
    out.push({ line, material: m });
    used.add(i);
  }

  for (let line = 0; line < lineCount; line++) {
    if (out.some((p) => p.line === line)) continue;
    const mm = lineAt(line).trim().match(/^MATR\s+(\d+)/i);
    if (!mm) continue;
    const num = parseInt(mm[1]!, 10);
    const idx = byDoc.findIndex((m, i) => m.number === num && !used.has(i));
    if (idx < 0) continue;
    used.add(idx);
    out.push({ line, material: byDoc[idx]! });
  }

  return out.sort((a, b) => a.line - b.line);
}

/** Компактная подпись CodeLens над MATR (как ▸ у #include). */
export function formatMatrCodeLensTitle(m: MatrLensMaterial): string {
  const parts = formatMaterialNuclideCounts(m);

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
  const placements = planMatrCodeLenses(
    documentUri,
    lineCount,
    (line) => document.lineAt(line).text,
    materials
  );

  for (const { line, material: m } of placements) {
    const lineText = document.lineAt(line).text;
    const range = new vscode.Range(line, 0, line, lineText.length);
    const title = formatMatrCodeLensTitle(m);
    if (!title) continue;

    const tipParts = [`MATR ${m.number}`];
    if (m.libMaterialName) tipParts.push(m.libMaterialName);
    if (m.nuclidesPreview) tipParts.push(m.nuclidesPreview);
    lenses.push(
      new vscode.CodeLens(range, {
        title,
        tooltip: tipParts.join(" — "),
        command: "mcuhelper.revealEditorRange",
        arguments: [
          documentUri,
          {
            start: { line, character: 0 },
            end: { line, character: lineText.length },
          },
        ],
      })
    );
  }

  // Как у #include: на кодовом имени — ↗ Открыть LIB.DBM
  for (const m of materials) {
    if (!m.libMaterialName) continue;
    if (m.uri && !sameDocumentUri(m.uri, documentUri)) continue;
    const codeLine = findLibMaterialCodeLine(document, m, lineCount);
    if (codeLine < 0) continue;
    const open = resolveDbmOpenLens(m, codeLine, document);
    if (open) lenses.push(open);
  }

  return lenses;
}

function findLibMaterialCodeLine(
  document: vscode.TextDocument,
  m: MatrLensMaterial,
  lineCount: number
): number {
  const want = m.libMaterialName!.toUpperCase();
  const hinted = m.libMaterialRange?.start.line;
  if (hinted != null && hinted >= 0 && hinted < lineCount) {
    if (document.lineAt(hinted).text.trim().toUpperCase() === want) return hinted;
  }
  const from = Math.max(0, m.range.start.line);
  const to = Math.min(lineCount - 1, m.range.start.line + 12);
  for (let L = from; L <= to; L++) {
    if (document.lineAt(L).text.trim().toUpperCase() === want) return L;
  }
  return -1;
}

function resolveDbmOpenLens(
  m: MatrLensMaterial,
  codeLine: number,
  document: vscode.TextDocument
): vscode.CodeLens | null {
  const library = m.dbm?.library ?? m.nameLib;
  if (!library) return null;
  const lineText = document.lineAt(codeLine).text;
  const range = new vscode.Range(codeLine, 0, codeLine, lineText.length);
  const fileLabel = `${library}.DBM`;

  let targetUri = m.dbm?.uri;
  if (!targetUri && m.dbm?.fsPath && m.dbm.exists) {
    targetUri = vscode.Uri.file(m.dbm.fsPath).toString();
  }
  if (!targetUri) {
    const libRoot = (vscode.workspace.getConfiguration("mcuhelper").get<string>("mcuConstantsLibPath") ?? "").trim();
    if (libRoot) {
      const preferred = path.join(libRoot, `${library}.DBM`);
      const lower = path.join(libRoot, `${library}.dbm`);
      const fsPath = fs.existsSync(preferred) ? preferred : fs.existsSync(lower) ? lower : "";
      if (fsPath) targetUri = vscode.Uri.file(fsPath).toString();
    }
  }

  const jumpRange = m.dbm?.range ?? {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };

  if (targetUri) {
    return new vscode.CodeLens(range, {
      title: `↗ Открыть ${fileLabel}`,
      tooltip: `Материал ${m.libMaterialName} из ${fileLabel}`,
      command: "mcuhelper.revealEditorRange",
      arguments: [targetUri, jumpRange],
    });
  }
  return new vscode.CodeLens(range, {
    title: `⚠ ${fileLabel} не найден`,
    tooltip: `Ожидается ${fileLabel} в корне MDBNR (mcuhelper.mcuConstantsLibPath)`,
    command: "mcuhelper.configureSolver",
  });
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
        uriOrArgs:
          | string
          | [
              string,
              {
                start: { line: number; character: number };
                end: { line: number; character: number };
              }
            ],
        rangeArg?: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        }
      ) => {
        // CodeLens: (uri, range); markdown hover: иногда один аргумент — массив [uri, range].
        const uriStr = Array.isArray(uriOrArgs) ? uriOrArgs[0] : uriOrArgs;
        const range = Array.isArray(uriOrArgs) ? uriOrArgs[1] : rangeArg;
        if (!uriStr || !range?.start || !range?.end) {
          return;
        }
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
