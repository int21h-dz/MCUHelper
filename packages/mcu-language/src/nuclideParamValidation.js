"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPTIONAL_PARAM_KEYS = void 0;
exports.isNuclideCompositionLinePrefix = isNuclideCompositionLinePrefix;
exports.findNuclideLineExtraTokens = findNuclideLineExtraTokens;
exports.validateNuclideLineExtras = validateNuclideLineExtras;
exports.analyzeDuplicateNuclides = analyzeDuplicateNuclides;
exports.analyzeNuclideParameterCounts = analyzeNuclideParameterCounts;
const schemaBridge_1 = require("./schemaBridge");
const NUCLIDE_OPTIONAL_PARAMS = new Set(["ACE", "MODS", "DTEM", "PHT"]);
const DENSITY_RE = /^[\d.Ee+-]+$/;
const OPTIONAL_PARAM_KEYS = ["ACE", "MODS", "DTEM", "PHT"];
exports.OPTIONAL_PARAM_KEYS = OPTIONAL_PARAM_KEYS;
const NUCLIDE_LINE_EXCLUDED_HEADS = new Set([
    "MATR", "PIN", "HEAD", "TEMPR", "FINISH", "END", "DEF", "EQU", "SET", "VOL",
    "NTOT", "MAXS", "MAXSER", "POWER", "POWE", "STEP", "DSTP", "ENERGY", "ENERG",
    "CONT", "LCELL", "ENDL", "CELL", "ENDXCL", "NET", "LATT", "LISTEL", "PARM",
    "SPH", "RCC", "ELL", "BOX", "WED", "RPP", "HEX", "HEXX", "HEXY", "RCZ",
    "UCX", "UCY", "UCZ", "PLG", "PLX", "PLY", "PLZ", "SLA", "SLB", "REC",
    "TRC", "ARB", "SBOX", "SHEX", "HEXG", "QUAD", "TRANSF", "UPOLY",
    "EMES", "EPRO", "SRCD", "SRC", "RGS", "REGD", "PTYPE", "TTYPE", "NRET", "SPNT",
]);
function isExcludedNuclideLikeLine(text) {
    const t = text.trim();
    if (/[#()]/.test(t))
        return true;
    if (/\bU\b/.test(t))
        return true;
    if (/\s:\d+(\s|$)/.test(t))
        return true;
    if (/\s\/\d/.test(t))
        return true;
    if (/\/-\d+/.test(t))
        return true;
    if (/\/\d+:/.test(t))
        return true;
    if (/\/\d+(?:\/\d+)?:/.test(t))
        return true;
    return false;
}
function looksLikeNuclideLine(text) {
    const t = text.trim();
    if (isExcludedNuclideLikeLine(t))
        return false;
    return /^[A-Za-z][A-Za-z0-9]{0,5}\s+\S+/.test(t);
}
function isNuclideCompositionLinePrefix(prefix) {
    const code = prefix.replace(/;.*/, "");
    const trimmed = code.trim();
    if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("C="))
        return false;
    if (isExcludedNuclideLikeLine(trimmed))
        return false;
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (!tokens.length || !/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(tokens[0]))
        return false;
    if (NUCLIDE_LINE_EXCLUDED_HEADS.has(tokens[0].toUpperCase()))
        return false;
    if (tokens.length === 1)
        return /\s$/.test(code);
    if (/^[\d.Ee+-]+$/.test(tokens[1]))
        return true;
    return /\b(ACE|MODS|DTEM|PHT)=/i.test(trimmed);
}
function isIgnorableAuxLine(text) {
    const t = text.trim();
    if (!t)
        return true;
    if (t.startsWith("C="))
        return true;
    if (t.startsWith("*"))
        return true;
    return false;
}
function tokenSubrange(text, range, token) {
    const idx = text.indexOf(token);
    if (idx < 0)
        return range;
    return {
        start: { line: range.start.line, character: range.start.character + idx },
        end: { line: range.start.line, character: range.start.character + idx + token.length },
        offset: range.offset + idx,
        endOffset: range.offset + idx + token.length,
    };
}
function isOptionalNuclideParam(token) {
    const m = token.match(/^([A-Za-z]+)=(\S+)$/);
    return Boolean(m && NUCLIDE_OPTIONAL_PARAMS.has(m[1].toUpperCase()));
}
function validateOptionalParamValue(key, value) {
    const k = key.toUpperCase();
    if (k === "MODS") {
        if (!schemaBridge_1.MODS_VALUES.includes(value.toUpperCase())) {
            return `MODS=${value}: ожидается ${schemaBridge_1.MODS_VALUES.join(", ")}`;
        }
        return null;
    }
    if (k === "DTEM") {
        if (!DENSITY_RE.test(value)) {
            return `DTEM=${value}: ожидается число (допуск по температуре, K)`;
        }
        return null;
    }
    if (k === "ACE" || k === "PHT") {
        if (DENSITY_RE.test(value) || /^[\d.,]+$/.test(value)) {
            return `${k}=${value}: ожидается имя файла библиотеки, не число`;
        }
        return null;
    }
    return null;
}
function findInvalidOptionalParamsInSegment(segment) {
    const parts = segment.trim().replace(/;.*/, "").split(/\s+/).filter(Boolean);
    if (parts.length < 2 || !DENSITY_RE.test(parts[1]))
        return [];
    const invalid = [];
    for (let i = 2; i < parts.length; i++) {
        const m = parts[i].match(/^([A-Za-z]+)=(\S+)$/);
        if (!m || !NUCLIDE_OPTIONAL_PARAMS.has(m[1].toUpperCase()))
            continue;
        const msg = validateOptionalParamValue(m[1], m[2]);
        if (msg)
            invalid.push({ token: parts[i], message: msg });
    }
    return invalid;
}
function findExtraTokensInSegment(segment) {
    const parts = segment.trim().replace(/;.*/, "").split(/\s+/).filter(Boolean);
    if (parts.length < 2 || !DENSITY_RE.test(parts[1]))
        return [];
    const extras = [];
    for (let i = 2; i < parts.length; i++) {
        if (!isOptionalNuclideParam(parts[i]))
            extras.push(parts[i]);
    }
    return extras;
}
function findNuclideLineExtraTokens(text) {
    const body = text.trim().replace(/;.*/, "");
    const extras = [];
    for (const segment of body.split(/\//)) {
        extras.push(...findExtraTokensInSegment(segment));
    }
    return extras;
}
function validateNuclideLineExtras(text, range, matNumber) {
    const extras = findNuclideLineExtraTokens(text);
    if (!extras.length)
        return null;
    const name = text.trim().match(/^([A-Za-z][A-Za-z0-9]{0,5})/)?.[1] ?? "?";
    const listed = extras.slice(0, 3).map((t) => `«${t}»`).join(", ");
    const tail = extras.length > 3 ? ` (всего ${extras.length})` : "";
    return {
        severity: "error",
        message: `MATR ${matNumber}: ${name} — лишние параметры: ${listed}${tail}`,
        code: "matr-nuclide-extra",
        range: tokenSubrange(text, range, extras[0]),
    };
}
function validateNuclideLineOptionalParams(text, range, matNumber) {
    const name = text.trim().match(/^([A-Za-z][A-Za-z0-9]{0,5})/)?.[1] ?? "?";
    const diags = [];
    for (const segment of text.trim().replace(/;.*/, "").split(/\//)) {
        for (const bad of findInvalidOptionalParamsInSegment(segment)) {
            diags.push({
                severity: "error",
                message: `MATR ${matNumber}: ${name} — ${bad.message}`,
                code: "matr-nuclide-param",
                range: tokenSubrange(text, range, bad.token),
            });
        }
    }
    return diags;
}
function collectNuclideCompositionLines(ast) {
    const sorted = [...ast.statements].sort((a, b) => a.range.start.line - b.range.start.line);
    const out = [];
    let currentMat = null;
    for (const stmt of sorted) {
        const label = (stmt.label ?? "").toUpperCase();
        if (label === "MATR") {
            const m = stmt.text.match(/^MATR\s+(\d+)/i);
            currentMat = m ? parseInt(m[1], 10) : null;
            continue;
        }
        if (currentMat === null)
            continue;
        if (["MATR", "END", "FINISH", "DEF", "TEMPR", "PIN"].includes(label)) {
            if (label === "END" && stmt.fragment === "physical")
                currentMat = null;
            else if (label !== "END")
                currentMat = null;
            continue;
        }
        if (isIgnorableAuxLine(stmt.text))
            continue;
        if (looksLikeNuclideLine(stmt.text)) {
            out.push({ stmt, matNumber: currentMat });
        }
    }
    return out;
}
function analyzeDuplicateNuclides(ast) {
    const diags = [];
    for (const mat of ast.materials) {
        const seen = new Set();
        for (const n of mat.nuclides) {
            const key = n.name.toUpperCase();
            if (seen.has(key)) {
                diags.push({
                    severity: "error",
                    message: `MATR ${mat.number}: нуклид ${n.name} задан повторно`,
                    code: "matr-nuclide-dup",
                    range: n.range,
                });
            }
            else {
                seen.add(key);
            }
        }
    }
    return diags;
}
function analyzeNuclideParameterCounts(ast) {
    const diags = [];
    for (const { stmt, matNumber } of collectNuclideCompositionLines(ast)) {
        const extra = validateNuclideLineExtras(stmt.text, stmt.range, matNumber);
        if (extra)
            diags.push(extra);
        diags.push(...validateNuclideLineOptionalParams(stmt.text, stmt.range, matNumber));
    }
    diags.push(...analyzeDuplicateNuclides(ast));
    return diags;
}
//# sourceMappingURL=nuclideParamValidation.js.map