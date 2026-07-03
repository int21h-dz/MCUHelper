"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARD_SNIPPETS = exports.MODULE_TEMPLATES = exports.FRAGMENT_DISPLAY = void 0;
exports.padBurnupLabel = padBurnupLabel;
exports.getCardInsertText = getCardInsertText;
exports.buildCatalogPayload = buildCatalogPayload;
const keywords_1 = require("./keywords");
exports.FRAGMENT_DISPLAY = {
    physical: "Физический модуль",
    geometry: "Геометрический модуль",
    source: "Модуль источников",
    registration: "Модуль регистрации",
    burnupRegistration: "Регистрация для выгорания",
    trajectory: "Модуль траекторий",
    calculationControl: "Управление счётом",
    burnup: "Модуль выгорания",
};
exports.MODULE_TEMPLATES = {
    physical: [
        "PIN 1 0",
        "TEMPR 300.",
        "MATR 1",
        "U235 1.10E-03",
        "H 0.0001 MODS=G",
        "O 2.3E-06",
        "FINISH Physical module",
    ].join("\n"),
    geometry: [
        "HEAD 3 0",
        "CONT T T M M M M M M",
        "HEX C 0,0,0 1.806,0,100",
        "RCZ FU 0,0,0 100 0.4915",
        "RCZ ZA 0,0,0 100 0.5042",
        "RCZ CL 0,0,0 100 0.5753",
        "END",
        "FUEL FU /1:1",
        "SPACE ZA -FU /2:4",
        "CLAD CL -ZA /3:3",
        "WATR C -CL /4:2",
        "END",
        "FINISH",
    ].join("\n"),
    source: ["SPNT 0.2, 0.15, 0.5", "FINISH"].join("\n"),
    registration: ["RGS 1 0", "KEFF", "FINISH"].join("\n"),
    burnupRegistration: ["BRG 1 0", "BMAX 7", "VOL 0.45 0.17 0.76", "BUCL 0.0, 0.0, 0.099126", "FINISH"].join("\n"),
    trajectory: ["NTOT 200", "FINISH"].join("\n"),
    calculationControl: ["NAMVAR BURNUP", "MAXSER 500", "NPRINT 0", "FINISH"].join("\n"),
    burnup: [
        "BURN",
        "CODE     RSTP",
        "FISZON   1 1 5 7",
        "POWER    0.146",
        "STEP     20 2",
        "ZONPRI   1",
        "SUMZON   ZONB",
        "CONTEN",
        "FINISH",
    ].join("\n"),
};
/** Явные шаблоны вставки для частых карт (VS Code snippet syntax). */
exports.CARD_SNIPPETS = {
    PIN: "PIN ${1:0} ${2:0}",
    MATR: "MATR ${1:1}\n${2:U235} ${3:1.10E-03}\n${4:H} ${5:0.0001} MODS=G",
    TEMPR: "TEMPR ${1:300.}",
    DEF: "DEF ${1:name} ACE=${2:ace}",
    HEAD: "HEAD ${1:3} ${2:0}",
    CONT: "CONT ${1:T} ${2:T} ${3:M} ${4:M} ${5:M} ${6:M} ${7:M} ${8:M}",
    EQU: "EQU ${1:name} ${2:expression}",
    SET: "SET ${1:name} ${2:value}",
    RGS: "RGS ${1:1} ${2:0}",
    REGD: "REGD ${1:1} ${2:0}",
    KEFF: "KEFF",
    BRG: "BRG ${1:1} ${2:0}",
    BRGD: "BRGD ${1:1} ${2:0}",
    BMAX: "BMAX ${1:7}",
    VOL: "VOL ${1:0.45} ${2:0.17}",
    BUCL: "BUCL ${1:0.0}, ${2:0.0}, ${3:0.099126}",
    SPNT: "SPNT ${1:0.2}, ${2:0.15}, ${3:0.5}",
    SRCD: "SRCD ${1:1} ${2:0}",
    NPS: "NPS ${1:10000}",
    NTOT: "NTOT ${1:200}",
    NAMV: "NAMVAR ${1:BURNUP}",
    NAMVAR: "NAMVAR ${1:BURNUP}",
    MAXS: "MAXSER ${1:500}",
    MAXSER: "MAXSER ${1:500}",
    NPRINT: "NPRINT ${1:0}",
    FINISH: "FINISH",
    END: "END",
    CELL: "CELL ${1:name}",
    NET: "NET ${1:name} ${2:root} ${3:cols} ${4:rows}",
    LCELL: "LCELL ${1:name}",
    LATT: "LATT ${1:GLTL}",
    ZONE: "${1:ZON1} ${2:BODY} # m=${3:1} z=${4:1} o=${5:1}",
};
function padBurnupLabel(label) {
    const u = label.toUpperCase().slice(0, 6);
    return u.padEnd(6, " ");
}
function getCardInsertText(card, fragmentId) {
    const key = card.label.toUpperCase();
    const explicit = exports.CARD_SNIPPETS[key];
    if (explicit) {
        return { text: explicit, format: explicit.includes("${") ? "snippet" : "plain" };
    }
    if (card.example) {
        const lines = card.example.trim().split("\n");
        const first = lines[0] ?? "";
        return { text: card.example, format: first.includes("${") ? "snippet" : "plain" };
    }
    if (fragmentId === "burnup") {
        return { text: `${padBurnupLabel(key)}${"${1:}"}`, format: "snippet" };
    }
    return { text: `${key} `, format: "plain" };
}
function cardToItem(label, fragmentId, lookup) {
    const card = lookup(label);
    if (!card)
        return null;
    const { text, format } = getCardInsertText(card, fragmentId);
    return {
        label: card.label,
        title: card.title,
        syntax: card.syntax,
        description: card.description,
        example: card.example,
        insertText: text,
        insertFormat: format,
    };
}
function labelsForFragment(fragmentId) {
    const labels = new Set(keywords_1.MCU_LABELS_BY_FRAGMENT[fragmentId]);
    if (fragmentId !== "burnup") {
        labels.add("FINISH");
    }
    return [...labels].sort((a, b) => a.localeCompare(b));
}
function buildCardGroups(fragmentId, lookup, bodyTypes) {
    const groups = [];
    if (fragmentId === "geometry") {
        const cardItems = [];
        for (const label of labelsForFragment(fragmentId)) {
            const item = cardToItem(label, fragmentId, lookup);
            if (item)
                cardItems.push(item);
        }
        groups.push({ title: "Карты", items: cardItems });
        const bodyItems = bodyTypes.map((b) => ({
            label: b.key,
            title: b.title,
            syntax: b.snippet.replace(/\$\{\d+:?([^}]*)\}/g, "$1"),
            description: b.description,
            insertText: b.snippet,
            insertFormat: "snippet",
        }));
        groups.push({ title: "Тела", items: bodyItems });
        return groups;
    }
    const items = [];
    for (const label of labelsForFragment(fragmentId)) {
        const item = cardToItem(label, fragmentId, lookup);
        if (item)
            items.push(item);
    }
    groups.push({ title: "Карты", items });
    return groups;
}
function schemaDeps() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("./index");
}
function buildCatalogPayload() {
    const { BODY_TYPES, FRAGMENT_MARKERS, FRAGMENT_ORDER, getCardByLabel: lookup } = schemaDeps();
    return FRAGMENT_ORDER.map((id) => ({
        id,
        title: exports.FRAGMENT_DISPLAY[id],
        marker: FRAGMENT_MARKERS[id][0] ?? id,
        template: exports.MODULE_TEMPLATES[id],
        cardGroups: buildCardGroups(id, lookup, BODY_TYPES),
    }));
}
//# sourceMappingURL=catalog.js.map