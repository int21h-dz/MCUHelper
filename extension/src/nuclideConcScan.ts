/** Держать в синхроне с packages/mcu-language/src/nuclideConcScan.ts */

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/;
const IDENT_RE = /^[A-Za-z][A-Za-z0-9]{0,5}$/;
const OPTIONAL_PARAM_RE = /^(ACE|MODS|DTEM|PHT)=/i;

const CARD_HEADS = new Set([
  "MATR", "PIN", "HEAD", "TEMPR", "FINISH", "END", "DEF", "EQU", "SET", "VOL",
  "SINOT", "SIDEN", "ICE", "ICENOT",
]);

export type QuickConcIssue = {
  line: number;
  character: number;
  endCharacter: number;
  message: string;
  code: "matr-nuclide-conc" | "matr-nuclide-extra";
};

function stripComment(line: string): string {
  return line.replace(/\s+\*\*.*$/, "").replace(/;.*$/, "");
}

function isExcludedNuclideLikeLine(text: string): boolean {
  const t = text.trim();
  if (/[#()]/.test(t)) return true;
  if (/\s:\d+(\s|$)/.test(t)) return true;
  if (/\s\/\d/.test(t)) return true;
  return false;
}

function tokenIndex(line: string, token: string): number {
  const idx = line.indexOf(token);
  return idx < 0 ? Math.max(0, line.search(/\S/)) : idx;
}

/**
 * Строка состава MATR: число, либо одно имя EQU/SET.
 * Умножение и произвольные выражения MCU в концентрации не вычисляет.
 */
export function scanNuclideConcentrationLine(
  lineText: string,
  lineNumber: number,
  knownEquNames: ReadonlySet<string>
): QuickConcIssue[] {
  const stripped = stripComment(lineText);
  const trimmed = stripped.trim();
  if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("C=")) return [];
  if (isExcludedNuclideLikeLine(trimmed)) return [];

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [];
  const name = parts[0]!;
  if (!IDENT_RE.test(name) || CARD_HEADS.has(name.toUpperCase())) return [];
  const dens = parts[1]!;
  const issues: QuickConcIssue[] = [];

  if (NUMBER_RE.test(dens)) {
    for (let i = 2; i < parts.length; i++) {
      const tok = parts[i]!;
      if (OPTIONAL_PARAM_RE.test(tok)) continue;
      const at = tokenIndex(lineText, tok);
      issues.push({
        line: lineNumber,
        character: at,
        endCharacter: at + tok.length,
        code: "matr-nuclide-extra",
        message: `MATR: ${name} — лишний токен «${tok}». В концентрации только число или имя EQU, без умножения.`,
      });
      break;
    }
    return issues;
  }

  const densAt = tokenIndex(lineText, dens);
  if (IDENT_RE.test(dens)) {
    const key = dens.toUpperCase();
    if (knownEquNames.size > 0 && !knownEquNames.has(key)) {
      issues.push({
        line: lineNumber,
        character: densAt,
        endCharacter: densAt + dens.length,
        code: "matr-nuclide-conc",
        message: `MATR: концентрация ${name} «${dens}» — неинициализированная константа (нет EQU/SET).`,
      });
    }
    return issues;
  }

  issues.push({
    line: lineNumber,
    character: densAt,
    endCharacter: densAt + dens.length,
    code: "matr-nuclide-conc",
    message: `MATR: концентрация ${name} «${dens}» не число и не имя EQU. Умножение/выражение в составе MCU не вычисляет.`,
  });
  return issues;
}
