import type { DiagnosticMessage, DocumentAst, SourceRange } from "./ast";
import { isDbmLibraryName, isNuclideNameFormat } from "./dbmLib";

function tokenSubrange(text: string, range: SourceRange, token: string): SourceRange {
  const idx = text.indexOf(token);
  if (idx < 0) return range;
  return {
    start: { line: range.start.line, character: range.start.character + idx },
    end: { line: range.start.line, character: range.start.character + idx + token.length },
    offset: range.offset + idx,
    endOffset: range.offset + idx + token.length,
  };
}

function matrTail(text: string): string {
  return text.replace(/^MATR\s+\d+/i, "").replace(/;.*/, "");
}

export function validateMatrLineParams(
  text: string,
  range: SourceRange,
  matNumber: number
): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  const tail = matrTail(text);

  const paramRe = /(?:^|\s)(T|GROUP|NAME|DENSAA|DENSWA|DENSAW|DENSWW|VOL|BUR)\s*=/gi;
  let pm: RegExpExecArray | null;
  while ((pm = paramRe.exec(tail))) {
    const param = pm[1]!;
    const token = `${param}=`;
    const afterEq = tail.slice(pm.index + pm[0].length);
    const hasValue = /^\s*\S/.test(afterEq);
    if (!hasValue) {
      diags.push({
        severity: "error",
        message: `MATR ${matNumber}: параметр ${token} без значения`,
        code: "matr-param-empty",
        range: tokenSubrange(text, range, token),
      });
    }
  }

  const nameM = tail.match(/NAME\s*=\s*(\S+)/i);
  if (nameM) {
    const nameVal = nameM[1]!;
    if (!isNuclideNameFormat(nameVal) && !isDbmLibraryName(nameVal)) {
      diags.push({
        severity: "error",
        message: `MATR ${matNumber}: NAME=${nameVal} — ожидается MCU, ZA или имя .DBM (≤6 символов)`,
        code: "matr-param-value",
        range: tokenSubrange(text, range, `NAME=${nameVal}`),
      });
    }
  }

  return diags;
}

export function analyzeMatrCardParams(ast: DocumentAst): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  for (const stmt of ast.statements) {
    if (stmt.label?.toUpperCase() !== "MATR") continue;
    const numM = stmt.text.match(/^MATR\s+(\d+)/i);
    const matNumber = numM ? parseInt(numM[1], 10) : null;
    if (matNumber == null) continue;
    diags.push(...validateMatrLineParams(stmt.text, stmt.range, matNumber));
  }

  for (const m of ast.materials) {
    if (!isDbmLibraryName(m.nameLib)) continue;
    if (m.nuclides.length > 0) {
      diags.push({
        severity: "error",
        message: `MATR ${m.number}: при NAME=${m.nameLib} нельзя задавать нуклиды — только одно кодовое имя из ${m.nameLib}.DBM`,
        code: "matr-dbm-mixed",
        range: m.nuclides[0]?.range ?? m.range,
      });
    }
    if (!m.libMaterialName) {
      diags.push({
        severity: "error",
        message: `MATR ${m.number}: при NAME=${m.nameLib} ожидается кодовое имя материала из ${m.nameLib}.DBM`,
        code: "matr-dbm-code",
        range: m.range,
      });
    }
  }

  return diags;
}
