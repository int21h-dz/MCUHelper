import * as path from "path";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import {
  aggregateBatchSummary,
  buildBatchItem,
  clampBatchConcurrency,
  formatBatchItemLine,
  formatBatchSummaryText,
  mapPool,
  type BatchValidateItem,
} from "./batchValidate";
import { runMcuInTerminal } from "./mcuTerminalRun";
import { runMcuStepFlow } from "./mcuStepRunner";

function variantNameFromFsPath(fsPath: string): string {
  const name = path.basename(fsPath);
  return name.replace(/\.[^.]+$/, "").slice(0, 8) || "NAME";
}

/** Выбор .mcu/.mcunr: multi QuickPick по workspace, иначе Open Dialog. */
export async function pickBatchInputFiles(): Promise<vscode.Uri[] | undefined> {
  const found = await vscode.workspace.findFiles("**/*.{mcu,mcunr}", "**/node_modules/**", 500);
  if (found.length > 0) {
    const items = found
      .map((uri) => ({
        label: path.basename(uri.fsPath),
        description: vscode.workspace.asRelativePath(uri, false),
        uri,
      }))
      .sort((a, b) => a.description.localeCompare(b.description, "ru"));
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: "MCU-NR: Проверить варианты (INPUT)",
      placeHolder: "Выберите файлы .mcu / .mcunr (можно несколько)",
      ignoreFocusOut: true,
      matchOnDescription: true,
    });
    if (!picked) return undefined;
    if (picked.length === 0) {
      vscode.window.showWarningMessage("Не выбрано ни одного файла");
      return undefined;
    }
    return picked.map((p) => p.uri);
  }

  const dialog = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFiles: true,
    canSelectFolders: false,
    openLabel: "Проверить INPUT",
    title: "MCU-NR: выбрать варианты (.mcu / .mcunr)",
    filters: {
      "MCU-NR": ["mcu", "mcunr"],
      All: ["*"],
    },
  });
  return dialog;
}

/**
 * Batch INPUT: только stepKey `i`, свой runDir на вариант (чужие не чистятся), без CALCULATION.
 */
export async function batchValidateInput(opts: {
  client: LanguageClient;
  output: vscode.OutputChannel;
  ensureSolverPaths: () => Promise<{ mcuNrPath: string; constantsLibPath: string } | undefined>;
}): Promise<void> {
  const { client, output, ensureSolverPaths } = opts;
  const paths = await ensureSolverPaths();
  if (!paths) return;

  const uris = await pickBatchInputFiles();
  if (!uris?.length) return;

  const cfg = vscode.workspace.getConfiguration("mcuhelper");
  const concurrency = clampBatchConcurrency(cfg.get("batchConcurrency"));

  output.appendLine("");
  output.appendLine(`——— Batch INPUT (${uris.length} файл(ов), concurrency=${concurrency}) ———`);
  output.show(true);

  const items = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "MCU-NR: batch INPUT",
      cancellable: true,
    },
    async (progress, token) => {
      let done = 0;
      return mapPool(uris, concurrency, async (uri) => {
        if (token.isCancellationRequested) {
          return buildBatchItem({
            filePath: uri.fsPath,
            variantName: variantNameFromFsPath(uri.fsPath),
            ok: false,
            message: "отменено",
          });
        }

        const variantName = variantNameFromFsPath(uri.fsPath);
        progress.report({
          message: `${variantName} (${done + 1}/${uris.length})`,
          increment: done === 0 ? 0 : 100 / uris.length,
        });

        let item: BatchValidateItem;
        try {
          const doc = await vscode.workspace.openTextDocument(uri);
          if (doc.isUntitled) {
            item = buildBatchItem({
              filePath: uri.fsPath,
              variantName,
              ok: false,
              message: "файл не сохранён на диск",
            });
          } else if (doc.isDirty && !(await doc.save())) {
            item = buildBatchItem({
              filePath: uri.fsPath,
              variantName,
              ok: false,
              message: "не удалось сохранить перед INPUT",
            });
          } else {
            const flow = await runMcuStepFlow({
              sendRequest: (method, params) => client.sendRequest(method, params),
              uri: doc.uri.toString(),
              variantName,
              mode: "i",
              mcuNrPath: paths.mcuNrPath,
              constantsLibPath: paths.constantsLibPath,
              stepTitle: "MCU-NR INPUT (batch)",
              runInTerminal: runMcuInTerminal,
            });
            item = buildBatchItem({
              filePath: uri.fsPath,
              variantName,
              ok: flow.ok && !flow.firstError,
              firstErrorMessage: flow.firstError?.message,
              warningCount: flow.warningCount,
              lstPath: flow.lstPath,
              message: flow.message,
            });
          }
        } catch (e) {
          item = buildBatchItem({
            filePath: uri.fsPath,
            variantName,
            ok: false,
            message: e instanceof Error ? e.message : String(e),
          });
        }

        done += 1;
        output.appendLine(formatBatchItemLine(item));
        return item;
      });
    }
  );

  const summary = aggregateBatchSummary(items);
  output.appendLine(formatBatchSummaryText(summary));
  output.appendLine("(клик по абсолютному пути LST/исходника в Output обычно открывает файл)");

  const msg = `Batch INPUT: ok ${summary.okCount}, fail ${summary.failCount}, warnings ${summary.warningTotal} (из ${summary.total})`;
  if (summary.failCount > 0) {
    vscode.window.showWarningMessage(msg, "Открыть Output").then((pick) => {
      if (pick) output.show(true);
    });
  } else {
    vscode.window.showInformationMessage(msg, "Открыть Output").then((pick) => {
      if (pick) output.show(true);
    });
  }
}
