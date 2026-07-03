"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBurnupLines = parseBurnupLines;
exports.isModuleCardLabel = isModuleCardLabel;
exports.classifyOtherModule = classifyOtherModule;
const schemaBridge_1 = require("./schemaBridge");
function parseBurnupLines(lines, startLine) {
    const cards = [];
    const diagnostics = [];
    let i = startLine;
    while (i < lines.length) {
        const raw = lines[i];
        if (!raw.trim() || raw[0] === "*" || raw.startsWith("C=")) {
            i++;
            continue;
        }
        const name = raw.slice(0, 6).trim();
        if (!name || !/^[A-Z]/.test(name)) {
            i++;
            continue;
        }
        const data = raw.slice(6, 72).trim();
        const words = data.split(/[\s,()]+/).filter(Boolean);
        cards.push({
            name,
            words,
            line: i,
            range: {
                start: { line: i, character: 0 },
                end: { line: i, character: raw.length },
                offset: i,
                endOffset: i + raw.length,
            },
        });
        i++;
        while (i < lines.length && lines[i].length > 0 && lines[i][0] === " ") {
            const cont = lines[i].slice(1, 72).trim();
            cards[cards.length - 1].words.push(...cont.split(/[\s,()]+/).filter(Boolean));
            i++;
        }
    }
    return { cards, diagnostics };
}
function isModuleCardLabel(label) {
    return (0, schemaBridge_1.isKnownMcuLabel)(label);
}
function classifyOtherModule(stmt) {
    const u = stmt.label.toUpperCase();
    if (["SRCD", "SRC", "SPNT", "TYPE", "SNAM", "REPER", "NOBJ"].includes(u))
        return "source";
    if (["REGD", "REG", "RGS", "NREG", "ENERG", "KEFF"].includes(u))
        return "registration";
    if (["TRJD", "TRJ", "NBAT", "NTOT", "NSKI", "ISTR"].includes(u))
        return "trajectory";
    if (["CALD", "CAL", "NAMV", "NAMVAR", "MAXS", "MAXSER", "STEP", "SERIES"].includes(u))
        return "calculationControl";
    if (u.startsWith("BUR") || u === "FINAL" || u === "CODE" || u === "FISZ" || u === "FISZON")
        return "burnup";
    return null;
}
//# sourceMappingURL=otherModules.js.map