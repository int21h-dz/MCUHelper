import type { DiagnosticMessage, DocumentAst, SourceRange } from "./ast";

const NAME_VALUES = new Set(["MCU", "ZA"]);

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
  if (nameM && !NAME_VALUES.has(nameM[1].toUpperCase())) {
    diags.push({
      severity: "error",
      message: `MATR ${matNumber}: NAME=${nameM[1]} — ожидается MCU или ZA`,
      code: "matr-param-value",
      range: tokenSubrange(text, range, `NAME=${nameM[1]}`),
    });
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
  return diags;
}
