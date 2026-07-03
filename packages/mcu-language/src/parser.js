"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRAGMENT_ORDER = void 0;
exports.parseDocument = parseDocument;
const constants_1 = require("./constants");
Object.defineProperty(exports, "FRAGMENT_ORDER", { enumerable: true, get: function () { return constants_1.FRAGMENT_ORDER; } });
const lexer_1 = require("./lexer");
const preprocessor_1 = require("./preprocessor");
const schemaBridge_1 = require("./schemaBridge");
const BODY_KEYS = new Set([
    "SPH", "RCC", "ELL", "BOX", "WED", "RPP", "HEX", "HEXX", "HEXY", "RCZ",
    "UCX", "UCY", "UCZ", "PLG", "PLX", "PLY", "PLZ", "SLA", "SLB", "REC",
    "TRC", "ARB", "SBOX", "SHEX", "HEXG", "QUAD", "TRANSF", "UPOLY",
]);
function rangeFromLine(line, startCol = 0, endCol) {
    const end = endCol ?? line.text.length;
    return {
        start: { line: line.lineNo, character: startCol },
        end: { line: line.lineNo, character: end },
        offset: line.offset + startCol,
        endOffset: line.offset + end,
    };
}
function mergeStatementLines(lines, start) {
    let text = lines[start].text.trim();
    let end = start;
    while (end + 1 < lines.length && lines[end + 1].isContinuation) {
        end++;
        text += " " + lines[end].text.trim();
    }
    const semi = text.indexOf(";");
    if (semi >= 0)
        text = text.slice(0, semi);
    return {
        text,
        end,
        range: {
            start: { line: lines[start].lineNo, character: 0 },
            end: { line: lines[end].lineNo, character: lines[end].text.length },
            offset: lines[start].offset,
            endOffset: lines[end].offset + lines[end].text.length,
        },
    };
}
function detectFragment(label, current, stmtText) {
    const next = (0, schemaBridge_1.detectFragmentFromLabel)(label, current);
    if (current === "geometry" && next !== "geometry" && next !== null && looksLikeZoneStatement(stmtText)) {
        return "geometry";
    }
    return next;
}
function parseZoneTail(text) {
    const hashIdx = text.indexOf("#");
    if (hashIdx >= 0) {
        const tail = { kind: "hash" };
        const part = text.slice(hashIdx + 1);
        const re = /([MmZzOo]|IM|im|IZ|iz|IO|io|G|g)\s*=\s*(\S+)/g;
        let m;
        while ((m = re.exec(part))) {
            const k = m[1].toLowerCase();
            const v = m[2];
            if (k === "m")
                tail.m = parseInt(v, 10);
            else if (k === "z")
                tail.z = parseInt(v, 10);
            else if (k === "o")
                tail.o = parseInt(v, 10);
            else if (k === "im")
                tail.im = parseInt(v, 10);
            else if (k === "iz")
                tail.iz = parseInt(v, 10);
            else if (k === "io")
                tail.io = parseInt(v, 10);
            else if (k === "g")
                tail.g = v;
        }
        return tail;
    }
    const slashRegMat = text.match(/\/(\d+):(\d+)(?:\/(\d+))?/);
    if (slashRegMat) {
        return {
            kind: "legacy",
            reg: parseInt(slashRegMat[1], 10),
            mat: parseInt(slashRegMat[2], 10),
            obj: slashRegMat[3] ? parseInt(slashRegMat[3], 10) : undefined,
        };
    }
    const slashColonMat = text.match(/\/:(\d+)(?:\/(\d+))?/);
    if (slashColonMat) {
        return {
            kind: "legacy",
            mat: parseInt(slashColonMat[1], 10),
            obj: slashColonMat[2] ? parseInt(slashColonMat[2], 10) : undefined,
            defaultRegObj: true,
        };
    }
    const bc = text.match(/\/([BWMCR]\d*)/);
    if (bc) {
        return { kind: "legacy", bcType: bc[1] };
    }
    const slashRegOnly = text.match(/\/(\d+)(?:\/(\d+))?(?!\s*:)/);
    if (slashRegOnly) {
        return {
            kind: "legacy",
            reg: parseInt(slashRegOnly[1], 10),
            obj: slashRegOnly[2] ? parseInt(slashRegOnly[2], 10) : undefined,
            inheritMat: true,
        };
    }
    const colonOnly = text.match(/:(\d+)/);
    if (colonOnly) {
        return {
            kind: "legacy",
            mat: parseInt(colonOnly[1], 10),
            defaultRegObj: true,
        };
    }
    return null;
}
function parseMaterial(stmt, range) {
    const m = stmt.match(/^MATR\s+(\d+)(.*)/i);
    if (!m)
        return null;
    const number = parseInt(m[1], 10);
    const rest = m[2];
    const tempM = rest.match(/T\s*=\s*([\d.Ee+-]+)/i);
    const groupM = rest.match(/GROUP\s*=\s*(\S+)/i);
    const nameM = rest.match(/NAME\s*=\s*(\S+)/i);
    const densM = rest.match(/(DENSAA|DENSWA|DENSAW|DENSWW)\s*=\s*([\d.Ee+-]+)/i);
    const nuclides = [];
    const lines = stmt.split(/\n|(?=\/)/);
    const nuclideRe = /([A-Za-z][A-Za-z0-9]{0,5})\s+([\d.Ee+-]+)/g;
    let nm;
    const body = stmt.replace(/^MATR\s+\d+[^\n]*/i, "");
    while ((nm = nuclideRe.exec(body))) {
        if (["MODS", "ACE", "DTEM", "PHT", "T", "GROUP", "NAME", "DENSAA", "DENSWA", "DENSAW", "DENSWW", "BUR", "VOL"].some((x) => nm[1].toUpperCase().startsWith(x)))
            continue;
        const mods = body.match(new RegExp(nm[1] + `\\s+[\\d.Ee+-]+\\s+MODS=(\\S+)`, "i"));
        nuclides.push({
            name: nm[1],
            density: nm[2],
            mods: mods?.[1],
            range,
        });
    }
    return {
        kind: "material",
        number,
        label: "MATR",
        temperature: tempM ? parseFloat(tempM[1]) : undefined,
        group: groupM?.[1],
        nameLib: nameM?.[1],
        densParam: densM?.[1],
        densValue: densM ? parseFloat(densM[2]) : undefined,
        nuclides,
        range,
    };
}
function parseBody(stmt, range) {
    const transf = stmt.match(/^TRANSF\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)/i);
    if (transf) {
        return {
            kind: "body",
            bodyType: "TRANSF",
            name: transf[1],
            params: transf[4].split(/[\s,]+/).filter(Boolean),
            range,
            transf: true,
            protoName: transf[2],
        };
    }
    const parts = stmt.trim().split(/\s+/);
    if (parts.length < 2)
        return null;
    const typeKey = parts[1].toUpperCase();
    if (!BODY_KEYS.has(typeKey) && !BODY_KEYS.has(parts[0].toUpperCase()))
        return null;
    let bodyType;
    let name;
    let paramsStart;
    if (BODY_KEYS.has(typeKey)) {
        bodyType = typeKey;
        name = parts[0] === typeKey ? "*" : parts[0];
        paramsStart = 2;
        if (parts[0].toUpperCase() === typeKey) {
            name = "*";
            paramsStart = 1;
        }
    }
    else {
        bodyType = parts[0].toUpperCase();
        name = parts[1];
        paramsStart = 2;
    }
    const params = parts.slice(paramsStart).join(" ").split(/[\s,]+/).filter(Boolean);
    return { kind: "body", bodyType, name, params, range };
}
function parseZone(stmt, range) {
    const parts = stmt.trim().split(/\s+/);
    if (parts.length < 2)
        return null;
    const name = parts[0];
    if (!/^[A-Za-z]/.test(name))
        return null;
    let netCarrier;
    let idx = 1;
    const netM = stmt.match(/\((\w+)\)/);
    if (netM)
        netCarrier = netM[1];
    let searchType;
    if (parts[idx] === "T") {
        searchType = "T";
        idx++;
    }
    else if (parts[idx]?.startsWith("/")) {
        searchType = parts[idx];
        idx++;
    }
    const tailIdx = stmt.search(/(?:#|\/-\d+:|\/\d+:|\/\d+(?:\/\d+)?:|\/[BWMCR]\d|(?<![A-Za-z0-9]):\d+)/);
    const exprEnd = tailIdx >= 0 ? tailIdx : stmt.length;
    const expression = stmt.slice(stmt.indexOf(name) + name.length, exprEnd).trim();
    return {
        kind: "zone",
        name,
        expression,
        searchType,
        netCarrier,
        tail: parseZoneTail(stmt),
        range,
    };
}
const NUCLIDE_INLINE_KEYWORDS = new Set(["MODS", "ACE", "DTEM", "PHT"]);
/** Не путать строку состава с зоной (R001 4 :1, /reg:mat). Слеш `/U235` — разделитель нуклидов на одной строке. */
function isExcludedNuclideLikeLine(text) {
    const t = text.trim();
    if (/[#()]/.test(t))
        return true;
    if (/\bU\b/.test(t))
        return true;
    if (/\s:\d+(\s|$)/.test(t))
        return true;
    if (/\s\/\d/.test(t))
        return true;
    if (/\/-\d+/.test(t))
        return true;
    if (/\/\d+:/.test(t))
        return true;
    if (/\/\d+(?:\/\d+)?:/.test(t))
        return true;
    return false;
}
/** Строка состава MATR: U235 1.10E-03. */
function isNuclideLine(text) {
    const t = text.trim();
    if (isExcludedNuclideLikeLine(t))
        return false;
    return /^[A-Za-z][A-Za-z0-9]{0,5}\s+[\d.Ee+-]+/.test(t);
}
/** Похожа на нуклид, но концентрация может быть с опечаткой (U238 owl.20836E-01). */
function looksLikeNuclideLine(text) {
    const t = text.trim();
    if (!t || isExcludedNuclideLikeLine(t))
        return false;
    return /^[A-Za-z][A-Za-z0-9]{0,5}\s+\S+/.test(t);
}
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
function parseNuclidesFromLine(text, range) {
    const nuclides = [];
    if (!isNuclideLine(text)) {
        const head = text.trim().match(/^([A-Za-z][A-Za-z0-9]{0,5})\s+(\S+)/);
        if (!head || NUCLIDE_INLINE_KEYWORDS.has(head[1].toUpperCase())) {
            return { nuclides };
        }
        return {
            nuclides,
            diagnostic: {
                severity: "error",
                message: `MATR: неверный формат концентрации для ${head[1]}: «${head[2]}»`,
                code: "matr-nuclide-syntax",
                range: tokenSubrange(text, range, head[2]),
            },
        };
    }
    const nuclideRe = /([A-Za-z][A-Za-z0-9]{0,5})\s+([\d.Ee+-]+)/g;
    let nm;
    while ((nm = nuclideRe.exec(text))) {
        if (NUCLIDE_INLINE_KEYWORDS.has(nm[1].toUpperCase()))
            continue;
        const mods = text.match(new RegExp(nm[1] + `\\s+[\\d.Ee+-]+\\s+MODS=(\\S+)`, "i"));
        nuclides.push({ name: nm[1], density: nm[2], mods: mods?.[1], range });
    }
    return { nuclides };
}
/** Зона с булевым выражением и хвостом /reg:mat — даже если имя совпадает с меткой справочника (GRBL, ZRTB…). */
function looksLikeZoneStatement(text) {
    const t = text.trim();
    if (/^(EQU|SET)\s/i.test(t))
        return false;
    if (/^(EQU|SET)\s+\w+\s*=/i.test(t))
        return false;
    if (/\s=\s/.test(t))
        return false;
    // хвост зоны — те же эвристики, что в parseZone (в т.ч. /-6:1/-2)
    if (/(?:#|\/-\d+:|\/\d+:|\/\d+(?:\/\d+)?:|\/[BWMCR]\d|(?<![A-Za-z0-9]):\d+)/.test(t))
        return true;
    const m = t.match(/^[A-Za-z][A-Za-z0-9]{0,5}\s+(.+)/);
    if (!m)
        return false;
    let rest = m[1].replace(/;.*/, "").trim();
    const slashPos = rest.search(/\s+\/(?:-\d+|\d)/);
    if (slashPos >= 0)
        rest = rest.slice(0, slashPos).trim();
    if (/\d+\s*-\s*\d+/.test(rest))
        return true;
    if (/\bU\b/.test(rest))
        return true;
    if (/-\s*[A-Za-z][A-Za-z0-9]{0,5}/.test(rest))
        return true;
    if (/^\d+$/.test(rest))
        return true;
    return false;
}
/** Служебная/комментарная строка (MATR ** dens…, **EQU черновики, C=, *). */
function isIgnorableAuxLine(text) {
    const t = text.trim();
    if (!t)
        return true;
    if (t.startsWith("C="))
        return true;
    if (t.startsWith("*"))
        return true;
    return false;
}
function parseCameraPreset(line, lineNo) {
    const m = line.match(/\*\s*interesting\s+section\s+left\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+right\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+dir\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i);
    if (!m)
        return null;
    return {
        name: `section L${lineNo}`,
        left: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])],
        right: [parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6])],
        dir: [parseFloat(m[7]), parseFloat(m[8]), parseFloat(m[9])],
        line: lineNo,
    };
}
function parseDocument(text, options) {
    let sourceText = (0, preprocessor_1.expandRepeats)(text);
    const includes = [];
    const diagnostics = [];
    if (options.expandInclude !== false && options.baseDir) {
        const expanded = (0, preprocessor_1.expandIncludes)(sourceText, options.baseDir);
        sourceText = expanded.text;
        for (const err of expanded.errors) {
            diagnostics.push({
                severity: "error",
                message: err,
                code: "include",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, offset: 0, endOffset: 0 },
            });
        }
    }
    const { lines, diagnostics: lexDiag } = (0, lexer_1.lexDocument)(sourceText);
    diagnostics.push(...lexDiag);
    const statements = [];
    const materials = [];
    const bodies = [];
    const zones = [];
    const constants = [];
    const cells = [];
    const nets = [];
    const latticeElements = [];
    const lattices = [];
    const cameraPresets = [];
    let currentFragment = null;
    const fragmentStarts = [];
    let finishCount = 0;
    let currentScope = "global";
    let inMaterialBlock = false;
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const cam = parseCameraPreset(line.text, line.lineNo);
        if (cam)
            cameraPresets.push(cam);
        if (line.tokens.some((t) => t.type === "include")) {
            const inc = line.tokens.find((t) => t.type === "include");
            if (inc) {
                includes.push({ kind: "include", path: inc.value, range: rangeFromLine(line) });
            }
            i++;
            continue;
        }
        if (line.tokens.length === 0 || line.tokens[0].type === "comment") {
            i++;
            continue;
        }
        if (line.isContinuation) {
            i++;
            continue;
        }
        const stmt = mergeStatementLines(lines, i);
        const label = stmt.text.split(/\s+/)[0]?.toUpperCase() ?? "";
        const prevFragment = currentFragment;
        currentFragment = detectFragment(label, currentFragment, stmt.text);
        if (currentFragment && currentFragment !== prevFragment) {
            if (!fragmentStarts.find((f) => f.id === currentFragment)) {
                fragmentStarts.push({ id: currentFragment, line: line.lineNo });
            }
        }
        if (label) {
            statements.push({
                kind: "statement",
                label,
                text: stmt.text,
                range: stmt.range,
                fragment: currentFragment ?? "physical",
            });
        }
        if (label === "FINISH") {
            finishCount++;
            if (currentFragment === "physical")
                inMaterialBlock = false;
        }
        if (label === "EQU" || label === "SET") {
            const em = stmt.text.match(/^(EQU|SET)\s+(\w+)\s*=\s*(.+)/i);
            if (em) {
                constants.push({
                    kind: "constant",
                    name: em[2],
                    expression: em[3],
                    mutable: em[1].toUpperCase() === "SET",
                    scope: currentScope,
                    range: stmt.range,
                });
            }
        }
        if (label === "MATR") {
            inMaterialBlock = true;
            const mat = parseMaterial(stmt.text, stmt.range);
            if (mat) {
                let j = stmt.end + 1;
                while (j < lines.length) {
                    const nextStmt = mergeStatementLines(lines, j);
                    const nl = nextStmt.text.split(/\s+/)[0]?.toUpperCase() ?? "";
                    if (["MATR", "END", "FINISH", "DEF", "TEMPR", "PIN"].includes(nl))
                        break;
                    if (isIgnorableAuxLine(nextStmt.text)) {
                        j = nextStmt.end + 1;
                        continue;
                    }
                    if (looksLikeNuclideLine(nextStmt.text)) {
                        const parsed = parseNuclidesFromLine(nextStmt.text, nextStmt.range);
                        if (parsed.diagnostic)
                            diagnostics.push(parsed.diagnostic);
                        mat.nuclides.push(...parsed.nuclides);
                        j = nextStmt.end + 1;
                    }
                    else
                        break;
                }
                materials.push(mat);
            }
        }
        if (label === "LCELL") {
            const lm = stmt.text.match(/^LCELL\s+(\w+)/i);
            if (lm)
                currentScope = `lcell:${lm[1]}`;
        }
        if (label === "ENDL")
            currentScope = "global";
        if (label === "CELL")
            currentScope = `cell:${stmt.text.split(/\s+/)[1] ?? "?"}`;
        if (label === "ENDXCL" || (label === "END" && currentScope.startsWith("cell:"))) {
            if (currentScope.startsWith("cell:"))
                currentScope = "global";
        }
        if (label === "END" && inMaterialBlock && currentFragment === "physical") {
            inMaterialBlock = false;
        }
        if (BODY_KEYS.has(label) || stmt.text.match(/^TRANSF/i) || BODY_KEYS.has(stmt.text.split(/\s+/)[1]?.toUpperCase() ?? "")) {
            const body = parseBody(stmt.text, stmt.range);
            if (body) {
                body.scope = currentScope;
                bodies.push(body);
            }
        }
        if (label === "CELL") {
            const cm = stmt.text.match(/^CELL\s+(\w+)(?:\s+EXTEND)?/i);
            if (cm) {
                cells.push({
                    kind: "cell",
                    name: cm[1],
                    extend: /EXTEND/i.test(stmt.text),
                    bodies: [],
                    zones: [],
                    lattices: [],
                    range: stmt.range,
                });
            }
        }
        if (label === "NET") {
            const nm = stmt.text.match(/^NET\s+(\w+)\s+([-\d.,\s]+)\s+(\d+)\s+(\d+)(?:\s+(\d+))?/i);
            if (nm) {
                nets.push({
                    kind: "net",
                    name: nm[1],
                    root: nm[2].trim(),
                    cols: parseInt(nm[3], 10),
                    rows: parseInt(nm[4], 10),
                    layers: nm[5] ? parseInt(nm[5], 10) : undefined,
                    typeMap: [],
                    range: stmt.range,
                });
            }
        }
        if (label === "LCELL") {
            const lm = stmt.text.match(/^LCELL\s+(\w+)/i);
            if (lm) {
                latticeElements.push({
                    kind: "lcell",
                    name: lm[1],
                    bodies: [],
                    zones: [],
                    nets: [],
                    range: stmt.range,
                });
            }
        }
        if (label === "LATT") {
            const latticeType = stmt.text.split(/\s+/)[1] ?? "GLTL";
            const zonePart = stmt.text.replace(/^LATT\s+\S+\s*/i, "").trim();
            const zoneNames = zonePart
                .split(/[\s,]+/)
                .map((s) => s.trim())
                .filter((s) => s.length > 0 && /^[A-Za-z]/.test(s));
            lattices.push({
                kind: "lattice",
                latticeType,
                zoneName: zoneNames[0] ?? "",
                zoneNames,
                elements: [],
                positions: [],
                range: stmt.range,
            });
        }
        if (label === "LISTEL" && lattices.length > 0) {
            const raw = stmt.text.replace(/^LISTEL\s*/i, "").trim();
            const names = raw
                .split(/\s+/)
                .map((s) => {
                const m = s.match(/^([A-Za-z][A-Za-z0-9]{0,5})/);
                return m ? m[1] : "";
            })
                .filter(Boolean);
            const last = lattices[lattices.length - 1];
            last.elements.push(...names);
        }
        if (label === "PARM" && lattices.length > 0) {
            const raw = stmt.text.replace(/^PARM\s*/i, "").trim();
            if (raw)
                lattices[lattices.length - 1].positions.push(raw);
        }
        const skipAsZone = label === "EQU" ||
            label === "SET" ||
            ((inMaterialBlock || currentFragment === "physical") && looksLikeNuclideLine(stmt.text)) ||
            currentFragment !== "geometry" ||
            ((0, schemaBridge_1.isKnownMcuLabel)(label) && !looksLikeZoneStatement(stmt.text)) ||
            /^T\d+/i.test(label) ||
            /^P\d+/i.test(label) ||
            /^E-?\d+/i.test(label) ||
            /^I-?\d+/i.test(label) ||
            /^F-?\d+/i.test(label);
        if (!BODY_KEYS.has(label) && /^[A-Za-z]/.test(label) && !skipAsZone) {
            const zone = parseZone(stmt.text, stmt.range);
            if (zone && zone.expression.length > 0) {
                zone.scope = currentScope;
                zones.push(zone);
            }
        }
        // NET cartograms T01, P0101, O0101
        if (/^T\d+/i.test(label) && nets.length > 0) {
            const vals = stmt.text.split(/\s+/).slice(1);
            nets[nets.length - 1].typeMap.push(vals);
        }
        if (/^P\d+/i.test(label) && nets.length > 0) {
            const vals = stmt.text.split(/\s+/).slice(1).map(Number);
            if (!nets[nets.length - 1].regMaps)
                nets[nets.length - 1].regMaps = [];
            nets[nets.length - 1].regMaps.push([vals.map(String)]);
        }
        i = stmt.end + 1;
    }
    // Fragment order validation
    const fragments = [];
    for (let fi = 0; fi < fragmentStarts.length; fi++) {
        const start = fragmentStarts[fi];
        const endLine = fi + 1 < fragmentStarts.length ? fragmentStarts[fi + 1].line - 1 : lines.length - 1;
        fragments.push({ id: start.id, startLine: start.line, endLine });
        const expectedIdx = constants_1.FRAGMENT_ORDER.indexOf(start.id);
        if (fi > 0) {
            const prevIdx = constants_1.FRAGMENT_ORDER.indexOf(fragmentStarts[fi - 1].id);
            if (expectedIdx < prevIdx) {
                diagnostics.push({
                    severity: "error",
                    message: `Нарушен порядок фрагментов: ${start.id} после ${fragmentStarts[fi - 1].id}`,
                    code: "fragment-order",
                    range: {
                        start: { line: start.line, character: 0 },
                        end: { line: start.line, character: 10 },
                        offset: lines[start.line]?.offset ?? 0,
                        endOffset: (lines[start.line]?.offset ?? 0) + 10,
                    },
                });
            }
        }
    }
    if (finishCount === 0 && materials.length > 0) {
        diagnostics.push({
            severity: "warning",
            message: "Не найдена карта FINISH",
            code: "no-finish",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, offset: 0, endOffset: 0 },
        });
    }
    return {
        uri: options.uri,
        statements,
        materials,
        bodies,
        zones,
        constants,
        cells,
        nets,
        latticeElements,
        lattices,
        includes,
        fragments,
        diagnostics,
        cameraPresets,
    };
}
//# sourceMappingURL=parser.js.map