"use strict";
/**
 * Эвристическое определение исходника MCU-NR по содержимому (имя/расширение не важны).
 * Используется расширением VS Code для setTextDocumentLanguage('mcunr').
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreMcunrContent = scoreMcunrContent;
exports.detectMcunrContent = detectMcunrContent;
const RULES = [
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
const MAX_SAMPLE_CHARS = 2000000;
/** Второй проход, если порог не набран: ещё до 8 МБ от начала файла. */
const MAX_FULL_SCAN_CHARS = 8000000;
function isSkippedLine(trimmed) {
    return trimmed[0] === "*" || trimmed.startsWith("C=");
}
function applyRules(stmt, seen, hits, score) {
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
function scanLines(text, seen, hits, score) {
    let next = score;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const raw = line.trim();
        if (!raw || isSkippedLine(raw))
            continue;
        const stmt = raw.split(";")[0].trim();
        next = applyRules(stmt, seen, hits, next);
    }
    return next;
}
function applyBonuses(seen, score) {
    let next = score;
    if (seen.has("PIN") && seen.has("MATR"))
        next += 2;
    if (seen.has("HEAD") && (seen.has("BODY") || seen.has("CONT")))
        next += 2;
    if (seen.has("FINISH") && seen.has("HEAD"))
        next += 1;
    return next;
}
function scoreMcunrContent(text) {
    const hits = [];
    const seen = new Set();
    const primaryEnd = Math.min(text.length, MAX_SAMPLE_CHARS);
    let score = scanLines(text.slice(0, primaryEnd), seen, hits, 0);
    if (score < DEFAULT_THRESHOLD && text.length > primaryEnd) {
        const fullEnd = Math.min(text.length, MAX_FULL_SCAN_CHARS);
        score = scanLines(text.slice(primaryEnd, fullEnd), seen, hits, score);
    }
    score = applyBonuses(seen, score);
    return { isMcunr: score >= DEFAULT_THRESHOLD, score, hits };
}
function detectMcunrContent(text, threshold = DEFAULT_THRESHOLD) {
    return scoreMcunrContent(text).score >= threshold;
}
//# sourceMappingURL=detect.js.map