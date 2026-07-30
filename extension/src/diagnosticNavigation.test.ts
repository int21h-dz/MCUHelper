import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDiagnosticTree,
  compareDiagnosticsByPosition,
  findDiagnosticIndex,
  LEXER_DIAGNOSTIC_CODES,
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
});
