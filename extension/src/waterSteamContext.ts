/**
 * Контекст курсора для webview воды/пара: MATR с H+O или дефолт T/P/ρ.
 *
 * Клик по sidebar/webview сбрасывает activeTextEditor — поэтому помним
 * последний фокус в mcunr (URI + строка).
 *
 * Важно: `MaterialSummary.range` в индексе — только строка `MATR N …`,
 * не весь блок нуклидов. Ищем секцию по span «заголовок → последний нуклид /
 * до следующего MATR».
 */

import type { LanguageClient } from "vscode-languageclient/node";
import * as vscode from "vscode";
import { isMcunrDocument } from "./contentDetect";
import type { IndexPayload, SourceRange } from "./navData";
import { loadWaterSteamApi, type WaterSteamState } from "./mcuLanguageBridge";

export type WaterSteamContextSource = "material" | "default";

export interface WaterSteamNuclideRef {
  name: string;
  concentration: string;
  range: SourceRange;
  family: "H" | "O";
}

export interface WaterSteamContext {
  uri: string;
  docLabel: string;
  line: number;
  source: WaterSteamContextSource;
  materialNumber?: number;
  materialRange?: SourceRange;
  temperature?: number;
  massDensityGcm3?: number | null;
  nuclides: WaterSteamNuclideRef[];
  initial: WaterSteamState;
  note: string;
  /** Сноска про смеси / гидроксиды (только из MATR). */
  footnote?: string;
}

export interface McunrCursorFocus {
  uri: string;
  line: number;
  character: number;
}

export type MaterialAtLine = IndexPayload["summaries"]["materials"][number];

let lastMcunrFocus: McunrCursorFocus | undefined;

function rememberFocus(editor: vscode.TextEditor): void {
  if (!isMcunrDocument(editor.document)) return;
  lastMcunrFocus = {
    uri: editor.document.uri.toString(),
    line: editor.selection.active.line,
    character: editor.selection.active.character,
  };
}

/** Подписка: сохранять курсор в mcunr до клика по sidebar/webview. */
let focusTrackerRegistered = false;
export function registerWaterSteamFocusTracker(context: vscode.ExtensionContext): void {
  if (focusTrackerRegistered) return;
  focusTrackerRegistered = true;
  const ed = vscode.window.activeTextEditor;
  if (ed) rememberFocus(ed);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) rememberFocus(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      rememberFocus(e.textEditor);
    })
  );
}

export function getLastMcunrFocus(): McunrCursorFocus | undefined {
  return lastMcunrFocus;
}

/** Для тестов. */
export function setLastMcunrFocusForTests(focus: McunrCursorFocus | undefined): void {
  lastMcunrFocus = focus;
}

function rangeCoversLine(range: SourceRange, line: number): boolean {
  return line >= range.start.line && line <= range.end.line;
}

/** Конец секции MATR в координатах редактора (вкл. нуклиды и строки между ними). */
export function materialSectionEndLine(
  mat: MaterialAtLine,
  allSortedByStart: ReadonlyArray<MaterialAtLine>
): number {
  let end = mat.range.end.line;
  for (const n of mat.nuclides) {
    end = Math.max(end, n.range.end.line, n.range.start.line);
  }
  const start = mat.range.start.line;
  const next = allSortedByStart.find((m) => m.range.start.line > start);
  if (next) {
    // До следующего MATR (комментарии/пустые строки внутри блока тоже «в секции»).
    end = Math.max(end, next.range.start.line - 1);
  }
  return end;
}

/**
 * MATR, в чьей секции лежит строка редактора (0-based).
 * Нельзя опираться только на `mat.range` — там один заголовок.
 */
export function findMaterialAtEditorLine(
  materials: ReadonlyArray<MaterialAtLine>,
  line: number
): MaterialAtLine | undefined {
  if (!materials.length) return undefined;

  // Сначала точное попадание в нуклид / заголовок.
  for (const m of materials) {
    if (rangeCoversLine(m.range, line)) return m;
    for (const n of m.nuclides) {
      if (rangeCoversLine(n.range, line)) return m;
    }
  }

  const sorted = [...materials].sort((a, b) => a.range.start.line - b.range.start.line);
  for (const m of sorted) {
    const start = m.range.start.line;
    const end = materialSectionEndLine(m, sorted);
    if (line >= start && line <= end) return m;
  }
  return undefined;
}

async function resolveDocumentAndLine(
  preferred?: vscode.TextEditor
): Promise<{ doc: vscode.TextDocument; line: number; uri: string } | undefined> {
  const ed = preferred ?? vscode.window.activeTextEditor;
  if (ed && isMcunrDocument(ed.document)) {
    rememberFocus(ed);
    return {
      doc: ed.document,
      line: ed.selection.active.line,
      uri: ed.document.uri.toString(),
    };
  }

  if (lastMcunrFocus) {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(lastMcunrFocus.uri));
      if (isMcunrDocument(doc)) {
        return { doc, line: lastMcunrFocus.line, uri: lastMcunrFocus.uri };
      }
    } catch {
      /* ignore */
    }
  }

  for (const visible of vscode.window.visibleTextEditors) {
    if (isMcunrDocument(visible.document)) {
      return {
        doc: visible.document,
        line: visible.selection.active.line,
        uri: visible.document.uri.toString(),
      };
    }
  }

  return undefined;
}

export async function resolveWaterSteamContext(
  client: LanguageClient | undefined,
  editor?: vscode.TextEditor
): Promise<WaterSteamContext> {
  const api = loadWaterSteamApi();
  const defaultState = api.defaultAmbientState();
  const loc = await resolveDocumentAndLine(editor);

  const base = (extra: Partial<WaterSteamContext>): WaterSteamContext => ({
    uri: loc?.uri ?? "",
    docLabel: loc ? vscode.workspace.asRelativePath(loc.doc.uri) : "(нет активного mcunr)",
    line: loc?.line ?? 0,
    source: "default",
    nuclides: [],
    initial: defaultState,
    note: "Курсор не в MATR с H и O — T=313 K, P=1 атм, ρ из IF97.",
    ...extra,
  });

  if (!loc) {
    return base({ note: "Нет активного файла MCU-NR — использованы T=313 K, P=1 атм." });
  }

  if (!client) {
    return base({ note: "LSP недоступен — использованы T=313 K, P=1 атм." });
  }

  let index: IndexPayload | null = null;
  try {
    index = await client.sendRequest<IndexPayload | null>("mcuhelper/getIndex", {
      uri: loc.uri,
    });
  } catch {
    return base({ note: "Не удалось получить индекс — дефолт T/P/ρ." });
  }

  const line = loc.line;
  const materials = index?.summaries?.materials ?? [];
  const mat = findMaterialAtEditorLine(materials, line);
  if (!mat) {
    return base({
      uri: loc.uri,
      line,
      note: `Курсор (стр. ${line + 1}) вне секции MATR — T=313 K, P=1 атм, ρ из IF97.`,
    });
  }

  const names = mat.nuclides.map((n) => n.name);
  if (!api.materialHasHO(names)) {
    return base({
      uri: loc.uri,
      line,
      materialNumber: mat.number,
      materialRange: mat.range,
      temperature: mat.temperature,
      massDensityGcm3: mat.massDensityGcm3,
      note: `MATR ${mat.number} без пары H+O — T=313 K, P=1 атм, ρ из IF97.`,
    });
  }

  const nuclides: WaterSteamNuclideRef[] = [];
  for (const n of mat.nuclides) {
    const family = api.waterElementFamily(n.name);
    if (family) {
      nuclides.push({
        name: n.name,
        concentration: n.concentration,
        range: n.range,
        family,
      });
    }
  }

  const allNuclides = mat.nuclides.map((n) => ({
    name: n.name,
    concentration: n.concentration,
  }));
  const water = api.extractWaterComponentFromNuclides(allNuclides);
  const rhoWater = water?.rhoGcm3 ?? null;

  const initial = api.initialStateFromMaterial({
    T: mat.temperature,
    rho: rhoWater,
  });
  if (water && water.nH2O > 0) {
    initial.nH = water.nH;
    initial.nO = water.nO;
    if (water.warning) {
      initial.warning = initial.warning
        ? `${initial.warning} ${water.warning}`
        : water.warning;
    }
  }

  const rhoNote =
    rhoWater != null
      ? `ρ(H₂O)=${rhoWater.toPrecision(5)} г/см³`
      : water?.warning ?? "ρ(H₂O) недоступна → ρ′";

  return {
    uri: loc.uri,
    docLabel: vscode.workspace.asRelativePath(loc.doc.uri),
    line,
    source: "material",
    materialNumber: mat.number,
    materialRange: mat.range,
    temperature: mat.temperature,
    massDensityGcm3: rhoWater,
    nuclides,
    initial,
    footnote: api.WATER_DENSITY_MIXTURE_FOOTNOTE,
    note:
      mat.temperature != null
        ? `MATR ${mat.number} (стр. ${line + 1}): T=${mat.temperature} K, ${rhoNote}, P из T+ρ.`
        : `MATR ${mat.number} (стр. ${line + 1}): T по умолчанию (нет TEMP), ${rhoNote}, P из T+ρ.`,
  };
}
