"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBodyArgCount = validateBodyArgCount;
exports.analyzeBodyParameterCounts = analyzeBodyParameterCounts;
const constants_1 = require("./constants");
const schemaBridge_1 = require("./schemaBridge");
function tokensAfterBodyKeyword(text, bodyType) {
    const parts = text.trim().replace(/;.*/, "").split(/\s+/).filter(Boolean);
    if (!parts.length)
        return [];
    const u = bodyType.toUpperCase();
    if (parts[0].toUpperCase() === u)
        return parts.slice(1);
    if (parts.length > 1 && parts[1].toUpperCase() === u)
        return parts.slice(2);
    return [];
}
const HYBRID_COMMA_BODIES = new Set(["RCC", "BOX", "RPP", "RCZ"]);
/** Угол f в конце необязателен (UserGuide §9.1.3.8–9). */
const OPTIONAL_F_BODIES = new Set(["HEXX", "HEXY", "SHEX"]);
function maxWhitespaceArgs(bodyType, stmtText) {
    const upper = bodyType.toUpperCase();
    const groups = (0, schemaBridge_1.getBodyParamGroups)(upper)?.length ?? 0;
    const numerics = (0, constants_1.getBodyParamCount)(upper);
    if (!groups && numerics === undefined)
        return null;
    if (numerics === "var")
        return null;
    const tail = tokensAfterBodyKeyword(stmtText, upper).join(" ");
    if (tail.includes(",")) {
        if (HYBRID_COMMA_BODIES.has(upper) && typeof numerics === "number") {
            return numerics + 1;
        }
        if (OPTIONAL_F_BODIES.has(upper))
            return groups + 1;
        return groups;
    }
    if (typeof numerics === "number")
        return numerics + 1;
    return groups;
}
function minWhitespaceArgs(bodyType) {
    const groups = (0, schemaBridge_1.getBodyParamGroups)(bodyType)?.length ?? 0;
    return groups || null;
}
function formatExpectedParams(bodyType, stmtText) {
    const groups = (0, schemaBridge_1.getBodyParamGroups)(bodyType);
    const numerics = (0, constants_1.getBodyParamCount)(bodyType);
    const comma = stmtText?.includes(",");
    if (groups?.length && comma) {
        const optionalF = OPTIONAL_F_BODIES.has(bodyType.toUpperCase()) ? " [, f]" : "";
        return `${groups} (${groups.map((g) => g.label).join(", ")}${optionalF})`;
    }
    if (typeof numerics === "number") {
        return `${numerics + 1} (name + ${numerics} чисел)`;
    }
    if (groups?.length)
        return groups.map((g) => g.label).join(", ");
    return "";
}
function validateBodyArgCount(body, stmtText) {
    const max = maxWhitespaceArgs(body.bodyType, stmtText);
    if (max === null)
        return null;
    const actual = tokensAfterBodyKeyword(stmtText, body.bodyType);
    if (actual.length <= max)
        return null;
    return {
        severity: "error",
        message: `${body.bodyType} ${body.name}: лишние параметры — ожидается не более ${max} (${formatExpectedParams(body.bodyType, stmtText)}), введено ${actual.length}`,
        code: "body-params-extra",
        range: body.range,
    };
}
function analyzeBodyParameterCounts(ast) {
    const diags = [];
    const stmtByLine = new Map();
    for (const s of ast.statements) {
        stmtByLine.set(s.range.start.line, s.text);
    }
    for (const b of ast.bodies) {
        if (b.bodyType === "TRANSF")
            continue;
        const text = stmtByLine.get(b.range.start.line) ?? "";
        const extra = validateBodyArgCount(b, text);
        if (extra)
            diags.push(extra);
        const min = minWhitespaceArgs(b.bodyType);
        const actual = tokensAfterBodyKeyword(text, b.bodyType);
        if (min !== null && actual.length > 0 && actual.length < min) {
            diags.push({
                severity: "warning",
                message: `${b.bodyType} ${b.name}: мало параметров — ожидается ${min} (${formatExpectedParams(b.bodyType, text)}), введено ${actual.length}`,
                code: "body-params",
                range: b.range,
            });
        }
    }
    return diags;
}
//# sourceMappingURL=bodyParamValidation.js.map