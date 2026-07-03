"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnergyGroupValues = validateEnergyGroupValues;
exports.analyzeEnergyGroupStatements = analyzeEnergyGroupStatements;
const burnupLoad_1 = require("./burnupLoad");
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
/** Нижние границы ENERGY: ≥ 0, строго убывают; по UserGuide последняя граница — 0. */
function validateEnergyGroupValues(values) {
    const issues = [];
    if (!values.length) {
        issues.push({
            code: "energy-empty",
            message: "ENERGY: пустой список нижних границ энергетических групп",
        });
        return issues;
    }
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!Number.isFinite(v)) {
            issues.push({
                code: "energy-non-finite",
                message: `ENERGY: нечисловое значение в позиции ${i + 1}`,
            });
        }
        else if (v < 0) {
            issues.push({
                code: "energy-negative",
                message: `ENERGY: отрицательная граница в позиции ${i + 1} (${v})`,
            });
        }
    }
    for (let i = 0; i < values.length - 1; i++) {
        const a = values[i];
        const b = values[i + 1];
        if (!Number.isFinite(a) || !Number.isFinite(b))
            continue;
        if (a <= b) {
            issues.push({
                code: "energy-order",
                message: `ENERGY: границы должны строго убывать — позиция ${i + 1} (${a}) ≥ позиция ${i + 2} (${b})`,
            });
            break;
        }
    }
    const last = values[values.length - 1];
    if (Number.isFinite(last) && last !== 0) {
        issues.push({
            code: "energy-missing-zero",
            message: "ENERGY: последняя нижняя граница должна быть явно задана как 0",
        });
    }
    return issues;
}
function analyzeEnergyGroupStatements(ast) {
    const vars = buildVars(ast);
    const diags = [];
    for (const stmt of ast.statements) {
        const label = stmt.label?.toUpperCase();
        if (label !== "ENERGY" && label !== "ENERG")
            continue;
        const values = (0, burnupLoad_1.parseStatementNumbers)(stmt.text, vars);
        for (const issue of validateEnergyGroupValues(values)) {
            diags.push({
                severity: issue.code === "energy-missing-zero" ? "warning" : "error",
                message: issue.message,
                code: issue.code,
                range: stmt.range,
            });
        }
    }
    return diags;
}
//# sourceMappingURL=energyGroups.js.map