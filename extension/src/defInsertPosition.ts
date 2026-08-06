/**
 * Позиция вставки карт DEF в исходник варианта (UserGuide §8.3).
 * Вне физмодуля — сразу после PIN; внутри — в курсор / после Enter на непустой строке.
 */

/** Маркеры начала фрагмента после physical (см. FRAGMENT_STARTERS в mcu-schema). */
const AFTER_PHYSICAL_STARTERS = new Set([
  "HEAD",
  "CONT",
  "MIR",
  "SRCD",
  "SRC",
  "SPNT",
  "RGS",
  "REGD",
  "REG",
  "BRG",
  "BRGD",
  "TRJD",
  "TRJ",
  "NTOT",
  "NAMV",
  "NAMVAR",
  "CALD",
  "CAL",
  "BURN",
  "BURD",
  "BURNUP",
]);

export type DefInsertReason = "after-pin" | "at-cursor" | "after-eol";

export type DefInsertPlan = {
  line: number;
  character: number;
  /** Текст перед телом DEF (часто "\\n"). */
  prefix: string;
  /** Текст после тела DEF (обычно "\\n"). */
  suffix: string;
  reason: DefInsertReason;
};

export type DefInsertResult = DefInsertPlan | { reason: "no-pin" };

function isCommentOrBlank(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  return t.startsWith("**") || /^[Cc]=/.test(t);
}

/** Метка предложения в первой позиции (не continuation с ведущим пробелом). */
export function lineStatementLabel(line: string): string | null {
  if (!line.length) return null;
  if (line[0] === " " || line[0] === "\t") return null;
  if (isCommentOrBlank(line)) return null;
  const m = line.match(/^([A-Za-z][A-Za-z0-9]*)/);
  return m ? m[1].toUpperCase() : null;
}

/** Индекс строки PIN (0-based) или -1. */
export function findPinLine(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lineStatementLabel(lines[i]) === "PIN") return i;
  }
  return -1;
}

/**
 * Диапазон физмодуля: от PIN до строки перед следующим стартером фрагмента
 * (или до конца файла).
 */
export function physicalModuleRange(
  lines: readonly string[]
): { startLine: number; endLine: number } | undefined {
  const pin = findPinLine(lines);
  if (pin < 0) return undefined;
  let endLine = lines.length - 1;
  for (let i = pin + 1; i < lines.length; i++) {
    const label = lineStatementLabel(lines[i]);
    if (label && AFTER_PHYSICAL_STARTERS.has(label)) {
      endLine = i - 1;
      break;
    }
  }
  if (endLine < pin) endLine = pin;
  return { startLine: pin, endLine };
}

export function isInsidePhysicalModule(
  lines: readonly string[],
  cursorLine: number
): boolean {
  const range = physicalModuleRange(lines);
  if (!range) return false;
  const line = Math.max(0, Math.min(cursorLine, Math.max(0, lines.length - 1)));
  return line >= range.startLine && line <= range.endLine;
}

/**
 * @param lines строки документа (без разделителей)
 * @param cursorLine 0-based
 * @param cursorCharacter 0-based
 */
export function resolveDefInsertPosition(
  lines: readonly string[],
  cursorLine: number,
  cursorCharacter: number
): DefInsertResult {
  const pinLine = findPinLine(lines);
  if (pinLine < 0) return { reason: "no-pin" };

  const safeLine =
    lines.length === 0 ? 0 : Math.max(0, Math.min(cursorLine, lines.length - 1));
  const lineText = lines[safeLine] ?? "";
  const safeChar = Math.max(0, Math.min(cursorCharacter, lineText.length));

  if (!isInsidePhysicalModule(lines, safeLine)) {
    const nextLine = pinLine + 1;
    if (nextLine < lines.length) {
      return {
        line: nextLine,
        character: 0,
        prefix: "",
        suffix: "\n",
        reason: "after-pin",
      };
    }
    const pinText = lines[pinLine] ?? "";
    return {
      line: pinLine,
      character: pinText.length,
      prefix: "\n",
      suffix: "\n",
      reason: "after-pin",
    };
  }

  if (lineText.trim() === "") {
    return {
      line: safeLine,
      character: safeChar,
      prefix: "",
      suffix: "\n",
      reason: "at-cursor",
    };
  }

  return {
    line: safeLine,
    character: lineText.length,
    prefix: "\n",
    suffix: "\n",
    reason: "after-eol",
  };
}

export function buildDefInsertText(plan: DefInsertPlan, defBody: string): string {
  return `${plan.prefix}${defBody}${plan.suffix}`;
}
