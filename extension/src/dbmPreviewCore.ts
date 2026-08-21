/**
 * Inline-развёртка материала .DBM в варианте (как #include).
 * Маркеры — комментарии MCU (`**`), directive = `DBM LIB/CODE`.
 */

export const DBM_BEGIN_RE = /^\*\*\s+\[mcuhelper\]\s+▼\s+(DBM\s+\S+\/\S+)\s*$/i;
export const DBM_END_RE = /^\*\*\s+\[mcuhelper\]\s+▲\s+(DBM\s+\S+\/\S+)\s*$/i;
export const MATR_DBM_NAME_RE = /^\s*MATR\b.*\bNAME\s*=\s*([A-Za-z][A-Za-z0-9]{0,5})\b/i;
export const LIB_CODE_LINE_RE = /^[A-Za-z][A-Za-z0-9]{0,5}$/;

const NUCLIDE_NAME_FORMATS = new Set(["MCU", "ZA"]);

export interface ExpandedDbmBlock {
  beginLine: number;
  endLine: number;
  /** Полная метка, напр. `DBM GRAPHI/CARB17`. */
  directive: string;
  library: string;
  code: string;
}

export interface CollapsedDbmUsage {
  /** Строка кодового имени. */
  line: number;
  library: string;
  code: string;
  /** Строка заголовка MATR. */
  matrLine: number;
}

export function isNuclideNameFormat(name: string): boolean {
  return NUCLIDE_NAME_FORMATS.has(name.trim().toUpperCase());
}

export function formatDbmExpandDirective(library: string, code: string): string {
  return `DBM ${library.trim().toUpperCase()}/${code.trim().toUpperCase()}`;
}

export function parseDbmExpandDirective(
  directive: string
): { library: string; code: string } | null {
  const m = directive.trim().match(/^DBM\s+([A-Za-z][A-Za-z0-9]{0,5})\/([A-Za-z][A-Za-z0-9]{0,5})$/i);
  if (!m) return null;
  return { library: m[1]!.toUpperCase(), code: m[2]!.toUpperCase() };
}

export function parseDbmBeginMarker(line: string): string | null {
  const m = line.match(DBM_BEGIN_RE);
  return m?.[1]?.trim() ?? null;
}

export function parseDbmEndMarker(line: string): string | null {
  const m = line.match(DBM_END_RE);
  return m?.[1]?.trim() ?? null;
}

export function buildExpandedDbmBlock(library: string, code: string, content: string): string {
  const directive = formatDbmExpandDirective(library, code);
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const lines = body.length ? body.split("\n") : [];
  return [`** [mcuhelper] ▼ ${directive}`, ...lines, `** [mcuhelper] ▲ ${directive}`].join("\n");
}

export function findExpandedDbmBlocks(text: string): ExpandedDbmBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: ExpandedDbmBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const directive = parseDbmBeginMarker(lines[i]!);
    if (!directive) continue;
    const parsed = parseDbmExpandDirective(directive);
    if (!parsed) continue;
    const endLine = findMatchingDbmEndLine(lines, i, directive);
    if (endLine < 0) continue;
    blocks.push({
      beginLine: i,
      endLine,
      directive,
      library: parsed.library,
      code: parsed.code,
    });
  }
  return blocks;
}

export function findMatchingDbmEndLine(lines: string[], beginLine: number, directive: string): number {
  const want = directive.trim().toUpperCase();
  for (let i = beginLine + 1; i < lines.length; i++) {
    const endDir = parseDbmEndMarker(lines[i]!);
    if (endDir && endDir.trim().toUpperCase() === want) return i;
  }
  return -1;
}

export function lineInExpandedDbmBlock(blocks: ExpandedDbmBlock[], line: number): boolean {
  return blocks.some((b) => line > b.beginLine && line < b.endLine);
}

export function extractExpandedDbmContent(lines: string[], beginLine: number, endLine: number): string {
  if (endLine <= beginLine + 1) return "";
  return lines.slice(beginLine + 1, endLine).join("\n");
}

/**
 * Свёрнутые использования .DBM: `MATR … NAME=LIB` + строка кода (не MCU/ZA).
 * Пропускает строки внутри развёрнутых DBM-блоков.
 */
export function collectCollapsedDbmUsages(text: string): CollapsedDbmUsage[] {
  const lines = text.split(/\r?\n/);
  const blocks = findExpandedDbmBlocks(text);
  const out: CollapsedDbmUsage[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lineInExpandedDbmBlock(blocks, i)) continue;
    if (blocks.some((b) => b.beginLine === i || b.endLine === i)) continue;

    const nameM = lines[i]!.match(MATR_DBM_NAME_RE);
    if (!nameM) continue;
    const library = nameM[1]!.trim();
    if (isNuclideNameFormat(library)) continue;

    for (let j = i + 1; j < lines.length && j <= i + 8; j++) {
      if (lineInExpandedDbmBlock(blocks, j)) continue;
      const raw = lines[j]!.trim();
      if (!raw || raw.startsWith("*") || raw.startsWith(";")) continue;
      if (/^(END|FINISH|MATR|PIN|DEF|TEMPR|CPM|CPMEND|HEAD|GEO|SOURCE)\b/i.test(raw)) break;
      const code = raw.replace(/;.*/, "").trim();
      if (!LIB_CODE_LINE_RE.test(code)) break;
      out.push({ line: j, library: library.toUpperCase(), code: code.toUpperCase(), matrLine: i });
      break;
    }
  }
  return out;
}
