"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseZoneExpression = parseZoneExpression;
exports.collectBodyRefs = collectBodyRefs;
exports.evalZoneExpr = evalZoneExpr;
const BODY_NAME = /^[A-Za-z][A-Za-z0-9]{0,5}$/;
const BODY_NUM = /^\d+$/;
/** Парсер булевых выражений зон MCU-NR: `-` > ∩ > `U`. */
function parseZoneExpression(expression) {
    const cleaned = expression
        .replace(/\([^)]*\)/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleaned)
        return null;
    const unionParts = splitUnion(cleaned);
    if (unionParts.length === 0)
        return null;
    if (unionParts.length === 1)
        return parseIntersectPart(unionParts[0]);
    const operands = unionParts.map(parseIntersectPart).filter((x) => x !== null);
    if (operands.length === 0)
        return null;
    if (operands.length === 1)
        return operands[0];
    return { kind: "union", operands };
}
function splitUnion(expr) {
    const parts = [];
    let current = "";
    let i = 0;
    while (i < expr.length) {
        if (expr[i] === " " && expr.slice(i, i + 3) === " U ") {
            parts.push(current.trim());
            current = "";
            i += 3;
            continue;
        }
        current += expr[i];
        i++;
    }
    if (current.trim())
        parts.push(current.trim());
    return parts;
}
function parseIntersectPart(part) {
    const tokens = tokenizeIntersect(part);
    if (tokens.length === 0)
        return null;
    const operands = tokens.map(parseTerm).filter((x) => x !== null);
    if (operands.length === 0)
        return null;
    if (operands.length === 1)
        return operands[0];
    return { kind: "intersect", operands };
}
function readBodyToken(text, start) {
    const num = text.slice(start).match(/^(\d+)/);
    if (num)
        return { token: num[1], len: num[1].length };
    const name = text.slice(start).match(/^([A-Za-z][A-Za-z0-9]{0,5})/);
    if (name && name[1].toUpperCase() !== "U")
        return { token: name[1], len: name[1].length };
    return null;
}
function tokenizeIntersect(part) {
    const tokens = [];
    let i = 0;
    while (i < part.length) {
        while (i < part.length && part[i] === " ")
            i++;
        if (i >= part.length)
            break;
        if (part[i] === "-") {
            let j = i + 1;
            while (j < part.length && part[j] === " ")
                j++;
            const body = readBodyToken(part, j);
            if (body) {
                tokens.push("-" + body.token);
                i = j + body.len;
            }
            else {
                i++;
            }
        }
        else {
            const body = readBodyToken(part, i);
            if (body) {
                tokens.push(body.token);
                i += body.len;
            }
            else {
                i++;
            }
        }
    }
    return tokens;
}
function isBodyToken(token) {
    return BODY_NAME.test(token) || BODY_NUM.test(token);
}
function parseTerm(token) {
    if (token.startsWith("-")) {
        const name = token.slice(1);
        if (!isBodyToken(name))
            return null;
        const body = { kind: "body", name };
        return { kind: "complement", operand: body };
    }
    if (!isBodyToken(token) || token.toUpperCase() === "U")
        return null;
    return { kind: "body", name: token };
}
function collectBodyRefs(expr) {
    switch (expr.kind) {
        case "body":
            return [expr.name];
        case "complement":
            return collectBodyRefs(expr.operand);
        case "intersect":
        case "union":
            return expr.operands.flatMap(collectBodyRefs);
    }
}
function evalZoneExpr(expr, isInBody) {
    switch (expr.kind) {
        case "body":
            return isInBody(expr.name);
        case "complement":
            return !evalZoneExpr(expr.operand, isInBody);
        case "intersect":
            return expr.operands.every((op) => evalZoneExpr(op, isInBody));
        case "union":
            return expr.operands.some((op) => evalZoneExpr(op, isInBody));
    }
}
//# sourceMappingURL=zoneExpression.js.map