"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseStatementFirstNumber = parseStatementFirstNumber;
exports.getTotalHistoriesEstimate = getTotalHistoriesEstimate;
exports.formatTotalHistoriesEstimate = formatTotalHistoriesEstimate;
const expression_1 = require("./expression");
function buildVars(ast) {
    const vars = new Map();
    for (const c of ast.constants) {
        const v = (0, expression_1.evaluateExpression)(c.expression, vars);
        if (v !== null)
            vars.set(c.name, v);
    }
    return vars;
}
/** Первое числовое поле карты (после метки). */
function parseStatementFirstNumber(text, vars) {
    const m = text.trim().match(/^\S+\s+([\d.Ee+-]+)/);
    if (!m)
        return null;
    const fromExpr = (0, expression_1.evaluateExpression)(m[1], vars);
    if (fromExpr !== null)
        return fromExpr;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
}
/** Суммарное число моделируемых историй: NTOT × MAXSER (последние значения в варианте). */
function getTotalHistoriesEstimate(ast) {
    const vars = buildVars(ast);
    let ntot = null;
    let maxser = null;
    let nski = null;
    for (const stmt of ast.statements) {
        const label = stmt.label.toUpperCase();
        if (label === "NTOT") {
            const v = parseStatementFirstNumber(stmt.text, vars);
            if (v !== null)
                ntot = v;
        }
        else if (label === "MAXS" || label === "MAXSER") {
            const v = parseStatementFirstNumber(stmt.text, vars);
            if (v !== null)
                maxser = v;
        }
        else if (label === "NSKI") {
            const v = parseStatementFirstNumber(stmt.text, vars);
            if (v !== null)
                nski = v;
        }
    }
    if (ntot == null || maxser == null)
        return null;
    return {
        ntot,
        maxser,
        total: ntot * maxser,
        nski: nski ?? undefined,
    };
}
function formatTotalHistoriesEstimate(estimate) {
    const fmt = (n) => n.toLocaleString("ru-RU");
    const lines = [
        `**Всего историй:** NTOT × MAXSER = ${fmt(estimate.ntot)} × ${fmt(estimate.maxser)} = **${fmt(estimate.total)}**`,
    ];
    if (estimate.nski != null && estimate.nski > 0) {
        lines.push(`*NSKI = ${fmt(estimate.nski)}: в статистику пойдёт ${fmt(estimate.maxser)} серий после отбрасывания (UserGuide §14.1).*`);
    }
    return lines.join("\n\n");
}
//# sourceMappingURL=calculationControl.js.map