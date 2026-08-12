/**
 * Вставка / замена ядерных dens H и O в MATR.
 */

import * as vscode from "vscode";
import { nuclideConcentrationEditorRange } from "./sumIsotopeDecorations";
import type { WaterSteamContext, WaterSteamNuclideRef } from "./waterSteamContext";
import { loadWaterSteamApi } from "./mcuLanguageBridge";

export interface InsertHODensArgs {
  nH: number;
  nO: number;
  ctx: WaterSteamContext;
}

function pickTarget(
  nuclides: WaterSteamNuclideRef[],
  family: "H" | "O"
): WaterSteamNuclideRef | undefined {
  const list = nuclides.filter((n) => n.family === family);
  if (!list.length) return undefined;
  const exact = list.find((n) => n.name.toUpperCase() === family);
  return exact ?? list[0];
}

/**
 * Заменить dens у существующих нуклидов семейств H/O или вставить строки H/O после заголовка MATR.
 */
export async function applyHODensToMaterial(args: InsertHODensArgs): Promise<boolean> {
  const { nH, nO, ctx } = args;
  if (!ctx.uri || ctx.materialRange == null || ctx.materialNumber == null) {
    vscode.window.showWarningMessage(
      "Нет целевого MATR. Поставьте курсор в секцию материала и откройте панель снова."
    );
    return false;
  }

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(ctx.uri));
  const api = loadWaterSteamApi();
  const densH = api.formatMcuNuclearDens(nH);
  const densO = api.formatMcuNuclearDens(nO);

  const edit = new vscode.WorkspaceEdit();
  const targetH = pickTarget(ctx.nuclides, "H");
  const targetO = pickTarget(ctx.nuclides, "O");

  let replaced = 0;
  let inserted = 0;

  if (targetH) {
    const r = nuclideConcentrationEditorRange(doc, targetH.name, targetH.range);
    if (r) {
      edit.replace(doc.uri, r, densH);
      replaced++;
    } else {
      vscode.window.showWarningMessage(`Не удалось найти dens у ${targetH.name}`);
      return false;
    }
  }

  if (targetO) {
    const r = nuclideConcentrationEditorRange(doc, targetO.name, targetO.range);
    if (r) {
      edit.replace(doc.uri, r, densO);
      replaced++;
    } else {
      vscode.window.showWarningMessage(`Не удалось найти dens у ${targetO.name}`);
      return false;
    }
  }

  const insertLines: string[] = [];
  if (!targetH) insertLines.push(`H ${densH}`);
  if (!targetO) insertLines.push(`O ${densO}`);

  if (insertLines.length) {
    // После строки заголовка MATR (start.line).
    const afterHeader = ctx.materialRange.start.line + 1;
    const text = insertLines.map((l) => `${l}\n`).join("");
    edit.insert(doc.uri, new vscode.Position(afterHeader, 0), text);
    inserted = insertLines.length;
  }

  if (replaced === 0 && inserted === 0) {
    vscode.window.showWarningMessage("Нечего вставлять.");
    return false;
  }

  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    vscode.window.showErrorMessage("Не удалось применить правку H/O dens");
    return false;
  }

  const parts: string[] = [];
  if (replaced) parts.push(`заменено ${replaced}`);
  if (inserted) parts.push(`вставлено ${inserted}`);
  vscode.window.showInformationMessage(
    `MATR ${ctx.materialNumber}: ${parts.join(", ")} (H ${densH}, O ${densO}). Undo доступен.`
  );
  return true;
}
