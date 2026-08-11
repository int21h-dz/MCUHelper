import * as fs from "fs";
import * as vscode from "vscode";
import { loadResultSummaryApi } from "./mcuLanguageBridge";

async function pickResultFile(title: string): Promise<string | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Выбрать",
    title,
    filters: {
      "MCU results": ["LST", "lst", "FIN", "fin"],
      All: ["*"],
    },
  });
  return uris?.[0]?.fsPath;
}

/** Сравнение двух LST/FIN → Output + CSV в буфер. */
export async function compareResults(): Promise<void> {
  const leftPath = await pickResultFile("Левый результат (LST/FIN)");
  if (!leftPath) return;
  const rightPath = await pickResultFile("Правый результат (LST/FIN)");
  if (!rightPath) return;

  const { summarizeMcuResultText, compareResultSummaries, formatResultCompareCsv } =
    loadResultSummaryApi();

  const leftText = fs.readFileSync(leftPath, "utf8");
  const rightText = fs.readFileSync(rightPath, "utf8");
  const left = summarizeMcuResultText(leftText, leftPath);
  const right = summarizeMcuResultText(rightText, rightPath);
  const deltas = compareResultSummaries(left, right);

  const out = vscode.window.createOutputChannel("MCU-NR Helper");
  out.appendLine(`Сравнение:\n  L: ${leftPath}\n  R: ${rightPath}`);
  for (const d of deltas) {
    out.appendLine(`${d.changed ? "*" : " "} ${d.field}: ${d.left} → ${d.right}`);
  }
  out.show(true);

  const csv = formatResultCompareCsv(deltas);
  await vscode.env.clipboard.writeText(csv);
  vscode.window.showInformationMessage("Сводка сравнения в Output; CSV скопирован в буфер.");
}
