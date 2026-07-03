"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateExpression = evaluateExpression;
exports.collectVariableReferences = collectVariableReferences;
exports.findUndefinedVariables = findUndefinedVariables;
exports.parseNumbers = parseNumbers;
const DEG = Math.PI / 180;
const BUILTIN_FUNCS = new Set(["SIN", "COS", "TG", "SQRT", "LN", "LOG", "FUNH"]);
function evaluateExpression(expr, vars) {
    try {
        return evalExpr(expr.replace(/\s+/g, ""), vars);
    }
    catch {
        return null;
    }
}
/** Имена пользовательских констант/переменных, на которые ссылается выражение (без встроенных функций). */
function collectVariableReferences(expr) {
    try {
        return collectRefs(expr.replace(/\s+/g, ""));
    }
    catch {
        return [];
    }
}
function findUndefinedVariables(expr, vars) {
    const seen = new Set();
    const out = [];
    for (const name of collectVariableReferences(expr)) {
        if (!vars.has(name) && !seen.has(name)) {
            seen.add(name);
            out.push(name);
        }
    }
    return out;
}
function collectRefs(expr) {
    let pos = 0;
    const refs = [];
    function peek() {
        return expr[pos] ?? "";
    }
    function consume(ch) {
        if (ch && expr[pos] !== ch)
            throw new Error("expected " + ch);
        return expr[pos++];
    }
    function parseNumber() {
        const m = expr.slice(pos).match(/^(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?/);
        if (!m)
            throw new Error("number");
        pos += m[0].length;
    }
    function parseIdent() {
        const m = expr.slice(pos).match(/^[A-Za-z][A-Za-z0-9]*/);
        if (!m)
            throw new Error("ident");
        pos += m[0].length;
        return m[0];
    }
    function parsePrimary() {
        if (peek() === "(") {
            consume("(");
            parseAdd();
            consume(")");
            return;
        }
        if (/[\d.]/.test(peek())) {
            parseNumber();
            return;
        }
        const id = parseIdent();
        if (peek() === "(" && BUILTIN_FUNCS.has(id.toUpperCase())) {
            consume("(");
            parseAdd();
            consume(")");
            return;
        }
        refs.push(id);
    }
    function parseUnary() {
        if (peek() === "-" || peek() === "+") {
            consume();
            parseUnary();
            return;
        }
        parsePrimary();
    }
    function parseMul() {
        parseUnary();
        while (peek() === "*" || peek() === "/") {
            consume();
            parseUnary();
        }
    }
    function parseAdd() {
        parseMul();
        while (peek() === "+" || peek() === "-") {
            consume();
            parseMul();
        }
    }
    if (!expr)
        return [];
    parseAdd();
    if (pos !== expr.length)
        throw new Error("trailing");
    return refs;
}
function evalExpr(expr, vars) {
    let pos = 0;
    function peek() {
        return expr[pos] ?? "";
    }
    function consume(ch) {
        if (ch && expr[pos] !== ch)
            throw new Error("expected " + ch);
        return expr[pos++];
    }
    function parseNumber() {
        const m = expr.slice(pos).match(/^(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?/);
        if (!m)
            throw new Error("number");
        pos += m[0].length;
        return parseFloat(m[0]);
    }
    function parseIdent() {
        const m = expr.slice(pos).match(/^[A-Za-z][A-Za-z0-9]*/);
        if (!m)
            throw new Error("ident");
        pos += m[0].length;
        return m[0];
    }
    function parsePrimary() {
        if (peek() === "(") {
            consume("(");
            const v = parseAdd();
            consume(")");
            return v;
        }
        if (/[\d.]/.test(peek()))
            return parseNumber();
        const id = parseIdent();
        const upper = id.toUpperCase();
        if (peek() === "(") {
            consume("(");
            const arg = parseAdd();
            consume(")");
            if (upper === "SIN")
                return Math.sin(arg * DEG);
            if (upper === "COS")
                return Math.cos(arg * DEG);
            if (upper === "TG")
                return Math.tan(arg * DEG);
            if (upper === "SQRT")
                return Math.sqrt(arg);
            if (upper === "LN" || upper === "LOG")
                return Math.log(arg);
            if (upper === "FUNH")
                return arg < 0 ? 0 : 1;
            throw new Error("fn");
        }
        if (!vars.has(id))
            throw new Error("undef " + id);
        return vars.get(id);
    }
    function parseUnary() {
        if (peek() === "-") {
            consume("-");
            return -parseUnary();
        }
        if (peek() === "+") {
            consume("+");
            return parseUnary();
        }
        return parsePrimary();
    }
    function parseMul() {
        let v = parseUnary();
        while (peek() === "*" || peek() === "/") {
            const op = consume();
            const r = parseUnary();
            v = op === "*" ? v * r : v / r;
        }
        return v;
    }
    function parseAdd() {
        let v = parseMul();
        while (peek() === "+" || peek() === "-") {
            const op = consume();
            const r = parseMul();
            v = op === "+" ? v + r : v - r;
        }
        return v;
    }
    const result = parseAdd();
    if (pos !== expr.length)
        throw new Error("trailing");
    return result;
}
function parseNumbers(params, vars) {
    const out = [];
    for (const p of params) {
        const cleaned = p.replace(/,/g, " ").trim();
        if (!cleaned)
            continue;
        const parts = cleaned.split(/\s+/);
        for (const part of parts) {
            const v = evaluateExpression(part, vars);
            if (v !== null)
                out.push(v);
            else {
                const n = parseFloat(part);
                if (!isNaN(n))
                    out.push(n);
            }
        }
    }
    return out;
}
//# sourceMappingURL=expression.js.map