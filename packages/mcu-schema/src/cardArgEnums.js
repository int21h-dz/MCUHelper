"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARD_ARG_SPECS = void 0;
exports.getCardArgSpec = getCardArgSpec;
exports.parseCardArgContext = parseCardArgContext;
const keywords_1 = require("./keywords");
const SUMZON_VALUES = [
    { value: "SUMB", title: "Выгорание всей системы" },
    { value: "ZONB", title: "Выгорание отдельных материалов" },
    { value: "SUMS", title: "Макроскопические сечения всей системы" },
    { value: "ZONS", title: "Макроскопические сечения материалов" },
    { value: "SUMR", title: "Радиационные характеристики всей системы" },
    { value: "ZONR", title: "Радиационные характеристики материалов" },
    { value: "SUMG", title: "Спектры γ-квантов всей системы" },
    { value: "ZONG", title: "Спектры γ-квантов материалов" },
];
const CONTEN_VALUES = [
    { value: "DENS", title: "Концентрация" },
    { value: "SIGM", title: "Макроскопическое сечение" },
    { value: "CURI", title: "Активность" },
    { value: "HEAT", title: "Энерговыделение при распаде" },
    { value: "HGAM", title: "Энергия γ при распаде" },
    { value: "HBET", title: "Энергия β при распаде" },
    { value: "QUOT", title: "Объём воды для разбавления" },
    { value: "SPNU", title: "Нейтроны спонтанного деления и (α,n)" },
];
const CODE_VALUES = [
    { value: "RSTP", title: "Опция STEP" },
    { value: "RFNL", title: "Опция FINAL" },
    { value: "RDEL", title: "Опция DELAY" },
    { value: "RFTB", title: "Опция FINTAB" },
    { value: "RDTB", title: "Опция DELTAB" },
    { value: "RFDN", title: "Опция FINDEN" },
    { value: "RSOU", title: "Опция SOURCE" },
    { value: "RSHR", title: "Опция SHORT" },
];
/** Допустимые токены аргументов карт (UserGuide §12, выгорание). */
exports.CARD_ARG_SPECS = {
    SUMZON: { kind: "enum", multi: true, values: SUMZON_VALUES },
    SUMZ: { kind: "enum", multi: true, values: SUMZON_VALUES },
    CONTEN: { kind: "enum", multi: true, values: CONTEN_VALUES },
    ACTI: { kind: "enum", multi: true, values: CONTEN_VALUES },
    FISP: { kind: "enum", multi: true, values: CONTEN_VALUES },
    PARA: { kind: "enum", multi: true, values: CONTEN_VALUES },
    CODE: { kind: "enum", multi: false, values: CODE_VALUES },
    TYPE: {
        kind: "enum",
        multi: false,
        values: [
            { value: "N", title: "Нейтроны" },
            { value: "PH", title: "Фотоны" },
            { value: "EL", title: "Электроны" },
            { value: "PO", title: "Позитроны" },
        ],
    },
    ZONPRI: { kind: "materialNumbers", title: "Номер материала (MATR)" },
    ZONP: { kind: "materialNumbers", title: "Номер материала (MATR)" },
    FISZON: { kind: "materialNumbers", title: "Делящийся материал (тип F)" },
    FISZ: { kind: "materialNumbers", title: "Делящийся материал (тип F)" },
    PBUR: { kind: "enum", multi: false, values: [{ value: "FST", title: "Быстрая система (fast)" }] },
};
function getCardArgSpec(cardLabel) {
    const u = cardLabel.toUpperCase();
    return exports.CARD_ARG_SPECS[u] ?? exports.CARD_ARG_SPECS[(0, keywords_1.normalizeMcuLabel)(u)];
}
/** Курсор в аргументах карты (после «CARD …»). */
function parseCardArgContext(linePrefix) {
    const code = linePrefix.replace(/;.*/, "");
    const m = code.match(/^([A-Za-z][A-Za-z0-9]{0,5})(\s+)(.*)$/s);
    if (!m)
        return null;
    const card = m[1].toUpperCase();
    const spec = getCardArgSpec(card);
    if (!spec)
        return null;
    const rest = m[3];
    const endsWithSpace = /\s$/.test(rest);
    const rawTokens = rest.trim() ? rest.trim().split(/[\s,]+/) : [];
    let partial = "";
    let used = rawTokens;
    if (!endsWithSpace && rawTokens.length > 0) {
        partial = rawTokens[rawTokens.length - 1] ?? "";
        used = rawTokens.slice(0, -1);
    }
    if (spec.kind === "enum" && !spec.multi && used.length >= 1 && !partial) {
        return null;
    }
    return {
        card,
        spec,
        usedValues: new Set(used.map((t) => t.toUpperCase())),
        partial: partial.toUpperCase(),
    };
}
//# sourceMappingURL=cardArgEnums.js.map