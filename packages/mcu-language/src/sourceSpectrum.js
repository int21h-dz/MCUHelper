"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectSourceSpectra = collectSourceSpectra;
exports.findSourceSpectrumAtLine = findSourceSpectrumAtLine;
const expression_1 = require("./expression");
const burnupLoad_1 = require("./burnupLoad");
function buildVars(ast) {
    const vars = new Map();
    for (const c of ast.constants) {
        const v = (0, expression_1.evaluateExpression)(c.expression, vars);
        if (v !== null)
            vars.set(c.name, v);
    }
    return vars;
}
/** Все пары EMES+EPRO в порядке следования (модуль источников). */
function collectSourceSpectra(ast) {
    const vars = buildVars(ast);
    const blocks = [];
    let pendingAnglen;
    for (const stmt of ast.statements) {
        if (stmt.label === "ANGLEN") {
            const m = stmt.text.match(/^ANGLEN\s+(\S+)/i);
            pendingAnglen = m?.[1];
            continue;
        }
        if (stmt.label === "EMES") {
            blocks.push({
                name: pendingAnglen,
                energies: (0, burnupLoad_1.parseStatementNumbers)(stmt.text, vars),
                probabilities: [],
                emesRange: stmt.range,
            });
            continue;
        }
        if (stmt.label === "EPRO") {
            const probs = (0, burnupLoad_1.parseStatementNumbers)(stmt.text, vars);
            const open = blocks.find((b) => b.probabilities.length === 0 && b.energies.length > 0);
            if (open) {
                open.probabilities = probs;
                open.eproRange = stmt.range;
            }
        }
    }
    return blocks.filter((b) => b.energies.length > 0 && b.probabilities.length > 0);
}
function lineInRange(line, range) {
    return line >= range.start.line && line <= range.end.line;
}
/** Спектр, к которому относится строка (EMES, EPRO или продолжение). */
function findSourceSpectrumAtLine(ast, line) {
    for (const block of collectSourceSpectra(ast)) {
        if (lineInRange(line, block.emesRange))
            return block;
        if (block.eproRange && lineInRange(line, block.eproRange))
            return block;
    }
    return null;
}
//# sourceMappingURL=sourceSpectrum.js.map