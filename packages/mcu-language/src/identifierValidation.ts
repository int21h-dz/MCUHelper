import type { DiagnosticMessage, DocumentAst, SourceRange } from "./ast";

/** MCU id: буква + до 5 alnum → ≤6 символов (UserGuide §9, zoneBodyRefs). */
export const MCU_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9]{0,5}$/;

export function isValidMcuIdentifier(name: string): boolean {
  return MCU_IDENTIFIER_RE.test(name);
}

function nameRange(base: SourceRange, name: string, statementText: string): SourceRange {
  const idx = statementText.indexOf(name);
  if (idx < 0) return base;
  const startCol = base.start.character + idx;
  return {
    ...base,
    start: { line: base.start.line, character: startCol },
    end: { line: base.start.line, character: startCol + name.length },
  };
}

function pushInvalidName(
  diags: DiagnosticMessage[],
  name: string,
  range: SourceRange,
  kind: string,
  statementText?: string
): void {
  if (name === "*" || isValidMcuIdentifier(name)) return;
  const at = statementText ? nameRange(range, name, statementText) : range;
  const tooLong = name.length > 6;
  diags.push({
    severity: "error",
    code: tooLong ? "name-too-long" : "name-invalid",
    message: tooLong
      ? `${kind}: имя «${name}» длиннее 6 символов (MCU допускает букву и до 5 букв/цифр)`
      : `${kind}: имя «${name}» недопустимо (ожидается буква и до 5 букв/цифр)`,
    range: at,
  });
}

/** Длина/формат имён тел, зон, EQU/SET. */
export function analyzeIdentifierNames(ast: DocumentAst): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  const textByOffset = new Map<number, string>();
  for (const s of ast.statements) {
    textByOffset.set(s.range.offset, s.text);
  }

  for (const b of ast.bodies) {
    pushInvalidName(diags, b.name, b.range, `Тело ${b.bodyType}`, textByOffset.get(b.range.offset));
  }

  for (const z of ast.zones) {
    pushInvalidName(diags, z.name, z.range, "Зона", textByOffset.get(z.range.offset));
  }

  for (const c of ast.constants) {
    pushInvalidName(diags, c.name, c.range, c.mutable ? "SET" : "EQU", textByOffset.get(c.range.offset));
  }

  return diags;
}
