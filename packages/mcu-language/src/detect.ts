/**
 * Эвристическое определение исходника MCU-NR по содержимому (имя/расширение не важны).
 * Используется расширением VS Code для setTextDocumentLanguage('mcunr').
 */

export interface McunrDetectionResult {
  isMcunr: boolean;
  score: number;
  hits: string[];
}

const RULES: ReadonlyArray<{ re: RegExp; pts: number; label: string }> = [
  /** PIN — заголовок фрагмента; value1/value2 необязательны (см. UserGuide). */
  { re: /^PIN\b/i, pts: 3, label: "PIN" },
  { re: /^MATR\s+\d/i, pts: 3, label: "MATR" },
  { re: /^HEAD\b/i, pts: 2, label: "HEAD" },
  { re: /^FINISH\b/i, pts: 2, label: "FINISH" },
  { re: /^DEF\b/i, pts: 1, label: "DEF" },
  { re: /^EQU\s+[A-Za-z]\w*\s*=/i, pts: 1, label: "EQU" },
  { re: /^CONT\s+/i, pts: 1, label: "CONT" },
  { re: /^TEMPR\b/i, pts: 1, label: "TEMPR" },
  { re: /^(RPP|RCZ|SPH|HEX|HEXX|HEXY)\s+\S/i, pts: 2, label: "BODY" },
  { re: /^LCELL\s+\w/i, pts: 2, label: "LCELL" },
  { re: /^CELL\s+\w/i, pts: 2, label: "CELL" },
  { re: /^LATT\s+/i, pts: 2, label: "LATT" },
  { re: /^NET\s+\w/i, pts: 2, label: "NET" },
  { re: /^BURN(?:UP)?\b/i, pts: 2, label: "BURN" },
  { re: /^SPNT\s+/i, pts: 2, label: "SPNT" },
  { re: /^RGS\s+\d/i, pts: 2, label: "RGS" },
  { re: /^NAMV(?:AR)?\s+/i, pts: 1, label: "NAMV" },
];

const DEFAULT_THRESHOLD = 4;
/** Первый проход: до 2 МБ (длинные преамбулы KDMK с тысячами строк **). */
const MAX_SAMPLE_CHARS = 2_000_000;
/** Второй проход, если порог не набран: ещё до 8 МБ от начала файла. */
const MAX_FULL_SCAN_CHARS = 8_000_000;

function isSkippedLine(trimmed: string): boolean {
  return trimmed[0] === "*" || trimmed.startsWith("C=");
}

function applyRules(
  stmt: string,
  seen: Set<string>,
  hits: string[],
  score: number
): number {
  let next = score;
  for (const rule of RULES) {
    if (rule.re.test(stmt) && !seen.has(rule.label)) {
      seen.add(rule.label);
      hits.push(rule.label);
      next += rule.pts;
    }
  }
  return next;
}

function scanLines(text: string, seen: Set<string>, hits: string[], score: number): number {
  let next = score;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw || isSkippedLine(raw)) continue;
    const stmt = raw.split(";")[0].trim();
    next = applyRules(stmt, seen, hits, next);
  }
  return next;
}

function applyBonuses(seen: Set<string>, score: number): number {
  let next = score;
  if (seen.has("PIN") && seen.has("MATR")) next += 2;
  if (seen.has("HEAD") && (seen.has("BODY") || seen.has("CONT"))) next += 2;
  if (seen.has("FINISH") && seen.has("HEAD")) next += 1;
  return next;
}

export function scoreMcunrContent(text: string): McunrDetectionResult {
  const hits: string[] = [];
  const seen = new Set<string>();

  const primaryEnd = Math.min(text.length, MAX_SAMPLE_CHARS);
  let score = scanLines(text.slice(0, primaryEnd), seen, hits, 0);

  if (score < DEFAULT_THRESHOLD && text.length > primaryEnd) {
    const fullEnd = Math.min(text.length, MAX_FULL_SCAN_CHARS);
    score = scanLines(text.slice(primaryEnd, fullEnd), seen, hits, score);
  }

  score = applyBonuses(seen, score);

  return { isMcunr: score >= DEFAULT_THRESHOLD, score, hits };
}

export function detectMcunrContent(text: string, threshold = DEFAULT_THRESHOLD): boolean {
  return scoreMcunrContent(text).score >= threshold;
}
