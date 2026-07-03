"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMatrLineParams = validateMatrLineParams;
exports.analyzeMatrCardParams = analyzeMatrCardParams;
const NAME_VALUES = new Set(["MCU", "ZA"]);
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
function matrTail(text) {
    return text.replace(/^MATR\s+\d+/i, "").replace(/;.*/, "");
}
function validateMatrLineParams(text, range, matNumber) {
    const diags = [];
    const tail = matrTail(text);
    const emptyRe = /(?:^|\s)(T|GROUP|NAME|DENSAA|DENSWA|DENSAW|DENSWW|VOL|BUR)\s*=\s*(?=\s|$)/gi;
    let em;
    while ((em = emptyRe.exec(tail))) {
        const token = `${em[1]}=`;
        diags.push({
            severity: "error",
            message: `MATR ${matNumber}: параметр ${token} без значения`,
            code: "matr-param-empty",
            range: tokenSubrange(text, range, token),
        });
    }
    const nameM = tail.match(/NAME\s*=\s*(\S+)/i);
    if (nameM && !NAME_VALUES.has(nameM[1].toUpperCase())) {
        diags.push({
            severity: "error",
            message: `MATR ${matNumber}: NAME=${nameM[1]} — ожидается MCU или ZA`,
            code: "matr-param-value",
            range: tokenSubrange(text, range, `NAME=${nameM[1]}`),
        });
    }
    return diags;
}
function analyzeMatrCardParams(ast) {
    const diags = [];
    for (const stmt of ast.statements) {
        if (stmt.label?.toUpperCase() !== "MATR")
            continue;
        const numM = stmt.text.match(/^MATR\s+(\d+)/i);
        const matNumber = numM ? parseInt(numM[1], 10) : null;
        if (matNumber == null)
            continue;
        diags.push(...validateMatrLineParams(stmt.text, stmt.range, matNumber));
    }
    return diags;
}
//# sourceMappingURL=matrCardValidation.js.map