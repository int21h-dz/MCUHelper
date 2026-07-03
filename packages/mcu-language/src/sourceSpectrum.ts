import type { DocumentAst, SourceRange } from "./ast";
import { evaluateExpression } from "./expression";
import { parseStatementNumbers } from "./burnupLoad";

function buildVars(ast: Pick<DocumentAst, "constants">): Map<string, number> {
  const vars = new Map<string, number>();
  for (const c of ast.constants) {
    const v = evaluateExpression(c.expression, vars);
    if (v !== null) vars.set(c.name, v);
  }
  return vars;
}

export interface SourceSpectrumBlock {
  /** Имя спектра из предшествующей карты ANGLEN. */
  name?: string;
  energies: number[];
  probabilities: number[];
  emesRange: SourceRange;
  eproRange?: SourceRange;
}

/** Все пары EMES+EPRO в порядке следования (модуль источников). */
export function collectSourceSpectra(ast: DocumentAst): SourceSpectrumBlock[] {
  const vars = buildVars(ast);
  const blocks: SourceSpectrumBlock[] = [];
  let pendingAnglen: string | undefined;

  for (const stmt of ast.statements) {
    if (stmt.label === "ANGLEN") {
      const m = stmt.text.match(/^ANGLEN\s+(\S+)/i);
      pendingAnglen = m?.[1];
      continue;
    }
    if (stmt.label === "EMES") {
      blocks.push({
        name: pendingAnglen,
        energies: parseStatementNumbers(stmt.text, vars),
        probabilities: [],
        emesRange: stmt.range,
      });
      continue;
    }
    if (stmt.label === "EPRO") {
      const probs = parseStatementNumbers(stmt.text, vars);
      const open = blocks.find((b) => b.probabilities.length === 0 && b.energies.length > 0);
      if (open) {
        open.probabilities = probs;
        open.eproRange = stmt.range;
      }
    }
  }

  return blocks.filter((b) => b.energies.length > 0 && b.probabilities.length > 0);
}

function lineInRange(line: number, range: SourceRange): boolean {
  return line >= range.start.line && line <= range.end.line;
}

/** Спектр, к которому относится строка (EMES, EPRO или продолжение). */
export function findSourceSpectrumAtLine(ast: DocumentAst, line: number): SourceSpectrumBlock | null {
  for (const block of collectSourceSpectra(ast)) {
    if (lineInRange(line, block.emesRange)) return block;
    if (block.eproRange && lineInRange(line, block.eproRange)) return block;
  }
  return null;
}
