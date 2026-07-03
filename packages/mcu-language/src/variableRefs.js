"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeUndefinedVariables = analyzeUndefinedVariables;
const expression_1 = require("./expression");
const constantScope_1 = require("./constantScope");
function isNumericLiteral(token) {
    return /^[+-]?(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?$/.test(token);
}
function checkExpression(expr, vars, context) {
    const trimmed = expr.trim();
    if (!trimmed || isNumericLiteral(trimmed))
        return null;
    const undef = (0, expression_1.findUndefinedVariables)(trimmed, vars);
    if (undef.length) {
        const list = undef.map((n) => `«${n}»`).join(", ");
        return {
            code: "var-undef",
            message: `Неинициализированная константа/переменная ${list}${context ? ` (${context})` : ""}`,
        };
    }
    if ((0, expression_1.collectVariableReferences)(trimmed).length === 0 && (0, expression_1.evaluateExpression)(trimmed, vars) === null) {
        return { code: "expr-syntax", message: `Некорректное выражение «${trimmed}»${context ? ` (${context})` : ""}` };
    }
    if ((0, expression_1.evaluateExpression)(trimmed, vars) === null && (0, expression_1.collectVariableReferences)(trimmed).length > 0) {
        return { code: "expr-syntax", message: `Не удалось вычислить «${trimmed}»${context ? ` (${context})` : ""}` };
    }
    return null;
}
function pushExprDiag(diags, expr, vars, range, context) {
    const issue = checkExpression(expr, vars, context);
    if (!issue)
        return;
    diags.push({
        severity: "error",
        message: issue.message,
        code: issue.code,
        range,
    });
}
function tokensAfterLabel(text) {
    return text
        .trim()
        .replace(/^\S+\s*/, "")
        .split(/[\s,]+/)
        .filter(Boolean);
}
const EXPR_CARD_LABELS = new Set([
    "TEMPR",
    "VOL",
    "POWER",
    "POWE",
    "STEP",
    "DSTP",
    "TIMP",
    "TSEC",
    "TMIN",
    "THOU",
    "TDAY",
    "TYEA",
    "ENERGY",
    "ENERG",
]);
function matrExpressionFields(text) {
    const out = [];
    const numM = text.match(/^MATR\s+(\d+)/i);
    const prefix = numM ? `MATR ${numM[1]}` : "MATR";
    const tempM = text.match(/T\s*=\s*(\S+)/i);
    if (tempM)
        out.push({ expr: tempM[1], label: `${prefix}: T` });
    const densM = text.match(/(DENSAA|DENSWA|DENSAW|DENSWW)\s*=\s*(\S+)/i);
    if (densM)
        out.push({ expr: densM[2], label: `${prefix}: ${densM[1]}` });
    return out;
}
function analyzeUndefinedVariables(ast) {
    const diags = [];
    for (const c of ast.constants) {
        const scope = c.scope ?? "global";
        const vars = (0, constantScope_1.buildScopedVars)(ast.constants, c.range.offset, scope);
        pushExprDiag(diags, c.expression, vars, c.range, `${c.mutable ? "SET" : "EQU"} ${c.name}`);
    }
    for (const b of ast.bodies) {
        const vars = (0, constantScope_1.buildScopedVars)(ast.constants, b.range.offset, b.scope ?? "global");
        const ctx = `${b.bodyType} ${b.name}`;
        for (let i = 0; i < b.params.length; i++) {
            pushExprDiag(diags, b.params[i], vars, b.range, `${ctx}, параметр ${i + 1}`);
        }
    }
    for (const stmt of ast.statements) {
        const label = stmt.label?.toUpperCase() ?? "";
        const vars = (0, constantScope_1.buildScopedVars)(ast.constants, stmt.range.offset, "global");
        if (label === "MATR") {
            for (const field of matrExpressionFields(stmt.text)) {
                pushExprDiag(diags, field.expr, vars, stmt.range, field.label);
            }
            continue;
        }
        if (!EXPR_CARD_LABELS.has(label))
            continue;
        const tokens = tokensAfterLabel(stmt.text);
        for (let i = 0; i < tokens.length; i++) {
            pushExprDiag(diags, tokens[i], vars, stmt.range, `${label} [${i + 1}]`);
        }
    }
    for (const mat of ast.materials) {
        const vars = (0, constantScope_1.buildScopedVars)(ast.constants, mat.range.offset, "global");
        for (const n of mat.nuclides) {
            pushExprDiag(diags, n.density, vars, n.range, `MATR ${mat.number}: ${n.name}`);
        }
    }
    return diags;
}
//# sourceMappingURL=variableRefs.js.map