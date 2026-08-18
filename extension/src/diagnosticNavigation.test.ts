import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDiagnosticTree,
  buildDiagnosticTreeWithIncludes,
  buildIsotopeMismatchCsv,
  compareDiagnosticsByPosition,
  extractIsotopeNameFromDiag,
  findDiagnosticIndex,
  includeReferencesPath,
  LEXER_DIAGNOSTIC_CODES,
  MCUHELPER_DIAG_SOURCE,
  belongsToMcuhelperSidebar,
  mapLspSeverityToVsCode,
  positionScore,
} from "./diagnosticNavigation";
import * as vscode from "vscode";

type MockDiag = { range: { start: { line: number; character: number }; end: { line: number; character: number } } };

function diag(line: number, start: number, end: number): MockDiag {
  return { range: { start: { line, character: start }, end: { line, character: end } } };
}

describe("diagnosticNavigation", () => {
  it("positionScore orders by line then character", () => {
    assert.ok(positionScore({ line: 1, character: 0 }) > positionScore({ line: 0, character: 99 }));
  });

  it("compareDiagnosticsByPosition sorts ascending", () => {
    const a = diag(2, 0, 1);
    const b = diag(1, 5, 6);
    assert.ok(compareDiagnosticsByPosition(a as never, b as never) > 0);
  });

  it("lexer codes include no-tabs and line-length", () => {
    assert.ok(LEXER_DIAGNOSTIC_CODES.has("no-tabs"));
    assert.ok(LEXER_DIAGNOSTIC_CODES.has("line-length"));
  });

  it("sidebar keeps overlay MATR conc (mcuhelper) and does not drop MCU-NR source", () => {
    assert.equal(belongsToMcuhelperSidebar(MCUHELPER_DIAG_SOURCE), true);
    assert.equal(belongsToMcuhelperSidebar(undefined), true);
    assert.equal(belongsToMcuhelperSidebar("MCU-NR"), true);
    assert.equal(belongsToMcuhelperSidebar("eslint"), false);
  });

  it("includeReferencesPath matches bare name and relative path", () => {
    const mainDir = "C:\\proj\\variant";
    const incPath = "C:\\proj\\variant\\confpd.mcu";
    assert.equal(includeReferencesPath("confpd", incPath, mainDir), true);
    assert.equal(includeReferencesPath("confpd.mcu", incPath, mainDir), true);
    assert.equal(includeReferencesPath("other.mcu", incPath, mainDir), false);
  });

  it("findDiagnosticIndex next skips current and wraps", () => {
    const diags = [diag(0, 0, 1), diag(2, 0, 1), diag(5, 0, 1)];
    assert.equal(findDiagnosticIndex(diags, { line: 0, character: 0 }, 1), 1);
    assert.equal(findDiagnosticIndex(diags, { line: 5, character: 0 }, 1), 0);
    assert.equal(findDiagnosticIndex(diags, { line: 1, character: 0 }, 1), 1);
  });

  it("findDiagnosticIndex prev wraps backward", () => {
    const diags = [diag(0, 0, 1), diag(2, 0, 1)];
    assert.equal(findDiagnosticIndex(diags, { line: 0, character: 0 }, -1), 1);
    assert.equal(findDiagnosticIndex(diags, { line: 3, character: 0 }, -1), 1);
  });

  it("buildDiagnosticTree groups errors and warnings", () => {
    const diags = [
      new vscode.Diagnostic(
        new vscode.Range(0, 4, 0, 5),
        "Символ табуляции запрещён",
        vscode.DiagnosticSeverity.Error
      ),
      new vscode.Diagnostic(
        new vscode.Range(2, 200, 2, 210),
        "Строка длиннее 200 символов",
        vscode.DiagnosticSeverity.Warning
      ),
    ];
    diags[0].code = "no-tabs";
    diags[1].code = "line-length";

    const tree = buildDiagnosticTree("file:///test.mcu", diags);
    assert.equal(tree.length, 3);
    assert.equal(tree[0].label, "Источник LSP");
    assert.equal(tree[1].label, "Ошибки");
    assert.equal(tree[1].children?.length, 1);
    assert.equal(tree[2].label, "Предупреждения");
    assert.equal(tree[1].children?.[0].label, "L1:5");
    assert.equal(tree[1].children?.[0].description, "Символ табуляции запрещён");
    assert.ok(tree[1].children?.[0].badges?.includes("no-tabs"));
  });

  it("buildDiagnosticTree puts isotope mismatches in a separate group with CSV", () => {
    const mass = new vscode.Diagnostic(
      new vscode.Range(4, 0, 4, 4),
      "Атомная масса SI44: AW.LIB 44.035260 ≠ IAEA 44.031466 а.е.м. (Δ = +0.003794, Si-44)",
      vscode.DiagnosticSeverity.Warning
    );
    mass.code = "aw-mass-mismatch";
    const hl = new vscode.Diagnostic(
      new vscode.Range(5, 0, 5, 4),
      "T1/2 CS37: PARAMETE.THR 3.00 y ≠ IAEA 30.08 y (Δrel = 90.0%, Cs-137)",
      vscode.DiagnosticSeverity.Warning
    );
    hl.code = "thr-halflife-mismatch";
    const other = new vscode.Diagnostic(
      new vscode.Range(1, 0, 1, 5),
      "Строка длиннее 200 символов",
      vscode.DiagnosticSeverity.Warning
    );
    other.code = "line-length";

    const tree = buildDiagnosticTree("file:///iso.mcu", [mass, hl, other]);
    const isotope = tree.find((n) => n.id === "diag-isotope-mismatch");
    const warnings = tree.find((n) => n.id === "diag-warnings");
    assert.ok(isotope);
    assert.equal(isotope!.label, "Сверка изотопов");
    assert.equal(isotope!.children?.length, 2);
    assert.equal(isotope!.children?.[0].label, "SI44");
    assert.equal(isotope!.children?.[1].label, "CS37");
    assert.ok(isotope!.copyCsv);
    assert.ok(isotope!.copyCsv!.startsWith("code,nuclide,line,column"));
    assert.ok(isotope!.copyCsv!.includes("SI44"));
    assert.ok(isotope!.copyCsv!.includes("CS37"));
    assert.equal(warnings?.children?.length, 1);
    assert.ok(warnings!.children?.[0].badges?.includes("line-length"));
  });

  it("buildDiagnosticTreeWithIncludes adds separate #include group", () => {
    const main = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 4),
      "Main warning",
      vscode.DiagnosticSeverity.Warning
    );
    main.code = "line-length";
    const inc = new vscode.Diagnostic(
      new vscode.Range(1, 0, 1, 4),
      "Include error",
      vscode.DiagnosticSeverity.Error
    );
    inc.code = "matr-param-empty";
    const tree = buildDiagnosticTreeWithIncludes("file:///main.mcu", [main], [
      { path: "confpd.mcu", uri: "file:///confpd.mcu", diagnostics: [inc] },
    ]);
    const includeGroup = tree.find((n) => n.id === "diag-includes");
    assert.ok(includeGroup);
    assert.equal(includeGroup!.label, "#include");
    assert.equal(includeGroup!.children?.[0].label, "confpd.mcu");
    assert.equal(includeGroup!.children?.[0].children?.[0].label, "L2:1");
    assert.equal(includeGroup!.children?.[0].children?.[0].uri, "file:///confpd.mcu");
  });

  it("mapLspSeverityToVsCode maps LSP Warning(2) to VS Code Warning(1)", () => {
    assert.equal(mapLspSeverityToVsCode(1), vscode.DiagnosticSeverity.Error);
    assert.equal(mapLspSeverityToVsCode(2), vscode.DiagnosticSeverity.Warning);
    assert.equal(mapLspSeverityToVsCode(3), vscode.DiagnosticSeverity.Information);
    assert.equal(mapLspSeverityToVsCode(4), vscode.DiagnosticSeverity.Hint);
  });

  it("buildDiagnosticTree groups isotope mismatches by code even if severity is Information", () => {
    // Регрессия: без LSP→VS Code маппинга Warning(2) становился Information → «Прочее».
    const mass = new vscode.Diagnostic(
      new vscode.Range(4, 0, 4, 4),
      "Атомная масса SI44: AW.LIB 44.035260 ≠ IAEA 44.031466 а.е.м. (Δ = +0.003794, Si-44)",
      vscode.DiagnosticSeverity.Information
    );
    mass.code = "aw-mass-mismatch";

    const tree = buildDiagnosticTree("file:///iso-sev.mcu", [mass]);
    const isotope = tree.find((n) => n.id === "diag-isotope-mismatch");
    const other = tree.find((n) => n.id === "diag-other");
    assert.ok(isotope);
    assert.equal(isotope!.children?.length, 1);
    assert.ok(isotope!.copyCsv);
    assert.equal(other, undefined);
  });

  it("buildDiagnosticTree attaches add-to-SI action for aw-mass-missing", () => {
    const d = new vscode.Diagnostic(
      new vscode.Range(3, 0, 3, 3),
      "Нуклид FP1 отсутствует в AW.LIB — добавьте его в суммарный изотоп (карта SI)",
      vscode.DiagnosticSeverity.Error
    );
    d.code = "aw-mass-missing";
    const tree = buildDiagnosticTree("file:///miss.mcu", [d]);
    const isotope = tree.find((n) => n.id === "diag-isotope-mismatch");
    assert.ok(isotope);
    const leaf = isotope!.children?.[0];
    assert.ok(leaf?.action);
    assert.equal(leaf!.action!.command, "mcuhelper.addToSumIsotope");
    assert.equal((leaf!.action!.args as { nuclideName: string }).nuclideName, "FP1");
  });
});
