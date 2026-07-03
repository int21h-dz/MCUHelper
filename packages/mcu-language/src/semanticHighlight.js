"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEMANTIC_TOKEN_LEGEND = void 0;
exports.buildSemanticTokenSpans = buildSemanticTokenSpans;
exports.semanticKindToIndex = semanticKindToIndex;
const lexer_1 = require("./lexer");
const schemaBridge_1 = require("./schemaBridge");
const BODY_KEYS = new Set([
    "SPH", "RCC", "ELL", "BOX", "WED", "RPP", "HEX", "HEXX", "HEXY", "RCZ",
    "UCX", "UCY", "UCZ", "PLG", "PLX", "PLY", "PLZ", "SLA", "SLB", "REC",
    "TRC", "ARB", "SBOX", "SHEX", "HEXG", "QUAD", "TRANSF", "UPOLY",
]);
const PIN_ISOTOPE_CARDS = new Set(["SI", "ICE", "CPM", "NEUT", "DELN", "EGRC"]);
function looksLikeZoneStatement(text) {
    const t = text.trim();
    if (/^(EQU|SET)\s/i.test(t))
        return false;
    if (/^(EQU|SET)\s+\w+\s*=/i.test(t))
        return false;
    if (/\s=\s/.test(t))
        return false;
    if (/(?:#|\/-\d+:|\/\d+:|\/\d+(?:\/\d+)?:|\/[BWMCR]\d|(?<![A-Za-z0-9]):\d+)/.test(t))
        return true;
    const m = t.match(/^[A-Za-z][A-Za-z0-9]{0,5}\s+(.+)/);
    if (!m)
        return false;
    let rest = m[1].replace(/;.*/, "").trim();
    const slashPos = rest.search(/\s+\/(?:-\d+|\d)/);
    if (slashPos >= 0)
        rest = rest.slice(0, slashPos).trim();
    if (/\d+\s*-\s*\d+/.test(rest))
        return true;
    if (/\bU\b/.test(rest))
        return true;
    if (/-\s*[A-Za-z][A-Za-z0-9]{0,5}/.test(rest))
        return true;
    if (/^\d+$/.test(rest))
        return true;
    return false;
}
function isExcludedNuclideLikeLine(text) {
    const t = text.trim();
    if (/\/|#|\(|\)/.test(t))
        return true;
    if (/\bU\b/.test(t))
        return true;
    if (/\s:\d+(\s|$)/.test(t))
        return true;
    if (/\s\/\d/.test(t))
        return true;
    return false;
}
function looksLikeNuclideLine(text) {
    const t = text.trim();
    if (!t || isExcludedNuclideLikeLine(t))
        return false;
    return /^[A-Za-z][A-Za-z0-9]{0,5}\s+\S+/.test(t);
}
function isMaterialNuclideLine(text) {
    if (!looksLikeNuclideLine(text))
        return false;
    if (isPinIsotopeListLine(text))
        return false;
    const parts = text.trim().split(/\s+/);
    const label = parts[0].toUpperCase();
    const second = parts[1] ?? "";
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?$/.test(second))
        return false;
    // PTYPE 1, ORCT 0 — карты регистрации, не нуклиды
    if ((0, schemaBridge_1.isKnownMcuLabel)(label) && !/[.Ee]/.test(second))
        return false;
    return true;
}
function isPinIsotopeListLine(text) {
    if (!looksLikeNuclideLine(text))
        return false;
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2)
        return false;
    return PIN_ISOTOPE_CARDS.has(parts[0].toUpperCase()) && /^[A-Za-z]+\d+$/.test(parts[1]);
}
function classifyLineStart(text, fragment) {
    const label = text.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
    if (!label)
        return null;
    if (BODY_KEYS.has(label))
        return "body";
    if (fragment === "geometry" && looksLikeZoneStatement(text))
        return "zone";
    if (isMaterialNuclideLine(text))
        return "nuclide";
    if (isPinIsotopeListLine(text))
        return "card";
    if ((0, schemaBridge_1.isKnownMcuLabel)(label) && !(fragment === "geometry" && looksLikeZoneStatement(text))) {
        return "card";
    }
    if (/^[A-Za-z]/.test(label))
        return "zone";
    return null;
}
function pushToken(spans, token, kind) {
    spans.push({
        line: token.line,
        char: token.column,
        length: token.value.length,
        kind,
    });
}
function lexerKind(token) {
    switch (token.type) {
        case "number":
            return "number";
        case "comment":
            return "comment";
        default:
            return null;
    }
}
/** Контекстная подсветка: карта / зона / тело / нуклид (поверх TextMate). */
function buildSemanticTokenSpans(ast, text) {
    const { lines } = (0, lexer_1.lexDocument)(text);
    const spans = [];
    const zoneLine = new Map();
    for (const z of ast.zones)
        zoneLine.set(z.range.start.line, z.name.toUpperCase());
    const bodyLine = new Map();
    for (const b of ast.bodies)
        bodyLine.set(b.range.start.line, b.bodyType.toUpperCase());
    const nuclideLines = new Set();
    for (const m of ast.materials) {
        for (const n of m.nuclides)
            nuclideLines.add(n.range.start.line);
    }
    const stmtFragment = new Map();
    for (const s of ast.statements) {
        for (let ln = s.range.start.line; ln <= s.range.end.line; ln++) {
            if (!stmtFragment.has(ln))
                stmtFragment.set(ln, s.fragment ?? null);
        }
    }
    for (const line of lines) {
        const fragment = stmtFragment.get(line.lineNo) ?? null;
        const trimmed = line.text.trim();
        const startKind = !line.isContinuation && trimmed
            ? zoneLine.has(line.lineNo)
                ? "zone"
                : bodyLine.has(line.lineNo)
                    ? "body"
                    : nuclideLines.has(line.lineNo) || isMaterialNuclideLine(trimmed)
                        ? "nuclide"
                        : classifyLineStart(trimmed, fragment)
            : null;
        let firstWordDone = line.isContinuation;
        for (const token of line.tokens) {
            const lk = lexerKind(token);
            if (lk === "comment" || lk === "number") {
                pushToken(spans, token, lk);
                continue;
            }
            if (!firstWordDone && (token.type === "card" || token.type === "label" || token.type === "identifier")) {
                firstWordDone = true;
                const kind = startKind;
                if (kind) {
                    pushToken(spans, token, kind);
                    continue;
                }
            }
            if (nuclideLines.has(line.lineNo) && token.type === "identifier") {
                const nuclideRe = /^[A-Za-z][A-Za-z0-9]{0,5}$/;
                if (nuclideRe.test(token.value) && !(0, schemaBridge_1.isKnownMcuLabel)(token.value)) {
                    pushToken(spans, token, "nuclide");
                    continue;
                }
            }
            if (isPinIsotopeListLine(trimmed) && token.type === "identifier" && /^[A-Za-z]+\d+$/.test(token.value)) {
                pushToken(spans, token, "zone");
                continue;
            }
        }
    }
    return spans;
}
exports.SEMANTIC_TOKEN_LEGEND = [
    "card",
    "body",
    "zone",
    "nuclide",
    "number",
    "comment",
];
function semanticKindToIndex(kind) {
    return exports.SEMANTIC_TOKEN_LEGEND.indexOf(kind);
}
//# sourceMappingURL=semanticHighlight.js.map