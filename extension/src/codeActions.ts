import * as vscode from "vscode";

const MATR_BLOCK_STOP = new Set([
  "MATR",
  "END",
  "FINISH",
  "DEF",
  "TEMPR",
  "PIN",
  "CPM",
  "CPMEND",
  "HEAD",
  "SINOT",
  "SIDEN",
  "ICE",
  "ICENOT",
]);

/** SI dens (кремний) — состав; SI list / прочие стоп-лейблы — конец MATR. */
function isMatrBlockStopLine(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const lab = t.split(/\s+/)[0]?.toUpperCase() ?? "";
  if (lab === "SI") {
    return !/^\s*SI\s+[+-]?(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?\b/i.test(t);
  }
  return MATR_BLOCK_STOP.has(lab);
}

/** Курсор в блоке MATR (заголовок или строки состава до следующего стоп-лейбла). */
export function isInsideMatrBlock(document: vscode.TextDocument, line: number): boolean {
  let header = -1;
  for (let i = Math.min(line, document.lineCount - 1); i >= 0; i--) {
    const t = document.lineAt(i).text.trim();
    if (/^MATR\s+\d+/i.test(t)) {
      header = i;
      break;
    }
    if (!t || t.startsWith("**") || t.startsWith(";")) continue;
    if (isMatrBlockStopLine(t)) return false;
  }
  if (header < 0) return false;
  for (let i = header + 1; i <= line; i++) {
    const t = document.lineAt(i).text.trim();
    if (!t || t.startsWith("**") || t.startsWith(";")) continue;
    if (isMatrBlockStopLine(t)) return false;
  }
  return true;
}

/**
 * Quick Fix для типовых диагностик MCU-NR.
 * Привязывает существующие команды к кодам diagnostics.
 */
export function registerMcuCodeActions(): vscode.Disposable {
  return vscode.languages.registerCodeActionsProvider(
    { language: "mcunr" },
    {
      provideCodeActions(document, range, context) {
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

        if (isInsideMatrBlock(document, range.start.line)) {
          const a = new vscode.CodeAction("Отправить в DBM", vscode.CodeActionKind.Refactor);
          a.command = { title: "Отправить в DBM", command: "mcuhelper.sendMaterialToDbm" };
          actions.push(a);
        }
        return actions;
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.Refactor] }
  );
}
