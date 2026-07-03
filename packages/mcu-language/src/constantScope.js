"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.constScopeKey = constScopeKey;
exports.isConstantDefinedBefore = isConstantDefinedBefore;
exports.resolveScopeAtLine = resolveScopeAtLine;
exports.resolveScopeAtPosition = resolveScopeAtPosition;
exports.listVisibleConstants = listVisibleConstants;
exports.buildScopedVars = buildScopedVars;
const expression_1 = require("./expression");
/** Ключ имени константы в пределах scope (global | cell:NAME | lcell:NAME). */
function constScopeKey(scope, name) {
    return `${scope ?? "global"}::${name}`;
}
function isConstantDefinedBefore(c, line, character = Number.MAX_SAFE_INTEGER) {
    const { start } = c.range;
    return start.line < line || (start.line === line && start.character < character);
}
/**
 * Scope геометрии на строке line (0-based): global | lcell:NAME | cell:NAME.
 * Синхронно с парсером: LCELL/CELL открывают прототип, ENDL/ENDXCL/END закрывают.
 */
function resolveScopeAtLine(statements, line) {
    let scope = "global";
    const ordered = [...statements].sort((a, b) => {
        const d = a.range.start.line - b.range.start.line;
        return d !== 0 ? d : a.range.start.character - b.range.start.character;
    });
    for (const stmt of ordered) {
        if (stmt.range.start.line > line)
            break;
        const label = stmt.label?.toUpperCase() ?? "";
        const stmtLine = stmt.range.start.line;
        if (label === "LCELL") {
            const m = stmt.text.match(/^LCELL\s+(\w+)/i);
            if (m && stmtLine < line)
                scope = `lcell:${m[1]}`;
        }
        else if (label === "ENDL") {
            if (stmtLine <= line)
                scope = "global";
        }
        else if (label === "CELL") {
            const m = stmt.text.match(/^CELL\s+(\w+)/i);
            if (m && stmtLine < line)
                scope = `cell:${m[1]}`;
        }
        else if (label === "ENDXCL" || (label === "END" && scope.startsWith("cell:"))) {
            if (stmtLine <= line && scope.startsWith("cell:"))
                scope = "global";
        }
    }
    return scope;
}
function resolveScopeAtPosition(ast, line, character) {
    return resolveScopeAtLine(ast.statements, line);
}
/**
 * Эффективный набор констант/переменных в позиции курсора: global + локальные прототипа,
 * локальные перекрывают global с тем же именем.
 */
function listVisibleConstants(constants, contextScope, line, character = Number.MAX_SAFE_INTEGER) {
    const vars = new Map();
    const effective = new Map();
    const ordered = [...constants].sort((a, b) => a.range.offset - b.range.offset);
    for (const c of ordered) {
        if (!isConstantDefinedBefore(c, line, character))
            continue;
        const scope = c.scope ?? "global";
        if (scope !== "global" && scope !== contextScope)
            continue;
        const v = (0, expression_1.evaluateExpression)(c.expression, vars);
        if (v !== null) {
            vars.set(c.name, v);
            effective.set(c.name, {
                name: c.name,
                expression: c.expression,
                value: v,
                mutable: c.mutable,
                scope,
                range: c.range,
            });
        }
    }
    return [...effective.values()].sort((a, b) => a.range.offset - b.range.offset);
}
/**
 * Константы/переменные, видимые в точке beforeOffset внутри contextScope.
 * Глобальные EQU/SET + локальные прототипа (перекрывают глобальные с тем же именем).
 * См. UserGuide: CELL §9.2.2, LCELL §9.2.5 (txt ~3264, ~3541).
 */
function buildScopedVars(constants, beforeOffset, contextScope = "global") {
    const vars = new Map();
    for (const c of constants) {
        if (c.range.offset >= beforeOffset)
            break;
        const scope = c.scope ?? "global";
        if (scope !== "global" && scope !== contextScope)
            continue;
        const v = (0, expression_1.evaluateExpression)(c.expression, vars);
        if (v !== null)
            vars.set(c.name, v);
    }
    return vars;
}
//# sourceMappingURL=constantScope.js.map