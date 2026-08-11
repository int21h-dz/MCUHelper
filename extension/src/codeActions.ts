import * as vscode from "vscode";

/**
 * Quick Fix для типовых диагностик MCU-NR.
 * Привязывает существующие команды к кодам diagnostics.
 */
export function registerMcuCodeActions(): vscode.Disposable {
  return vscode.languages.registerCodeActionsProvider(
    { language: "mcunr" },
    {
      provideCodeActions(document, _range, context) {
        const actions: vscode.CodeAction[] = [];
        for (const diag of context.diagnostics) {
          const code = String(diag.code ?? "");
          if (
            code === "aw-mass-missing" ||
            code === "aw-mass-missing-siden" ||
            code === "phy-missing" ||
            code === "phy-missing-siden"
          ) {
            const a = new vscode.CodeAction("Добавить в суммарный изотоп (SI)", vscode.CodeActionKind.QuickFix);
            a.command = {
              title: "Добавить в SI",
              command: "mcuhelper.addToSumIsotope",
              arguments: [document.uri, diag.range],
            };
            a.diagnostics = [diag];
            a.isPreferred = true;
            actions.push(a);
          }
          if (code === "phy-missing" || code === "phy-missing-siden") {
            const a = new vscode.CodeAction("Открыть DEFAULT.PHY", vscode.CodeActionKind.QuickFix);
            a.command = { title: "DEFAULT.PHY", command: "mcuhelper.editDefaultPhy" };
            a.diagnostics = [diag];
            actions.push(a);
          }
          if (code === "matr-gap") {
            const a = new vscode.CodeAction(
              "Перенумеровать материалы вручную (см. диагностику)",
              vscode.CodeActionKind.Empty
            );
            a.diagnostics = [diag];
            actions.push(a);
          }
        }
        return actions;
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );
}
