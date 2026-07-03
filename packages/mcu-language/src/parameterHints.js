"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMatrHeaderLinePrefix = isMatrHeaderLinePrefix;
exports.getCompositionLineParameterHover = getCompositionLineParameterHover;
exports.getNuclideLineParameterHover = getNuclideLineParameterHover;
exports.getParameterSignatureHelp = getParameterSignatureHelp;
exports.getActiveParameterHint = getActiveParameterHint;
const schemaBridge_1 = require("./schemaBridge");
const nuclideParamValidation_1 = require("./nuclideParamValidation");
const MATR_OPTIONAL_KEYS = [
    "T",
    "GROUP",
    "NAME",
    "DENSAA",
    "DENSWA",
    "DENSAW",
    "DENSWW",
    "VOL",
    "BUR",
];
function isMatrHeaderLinePrefix(prefix) {
    return /^\s*MATR\s+\d/i.test(prefix.trim());
}
function linePrefixBeforeCursor(line, cursorCharacter) {
    return line.slice(0, Math.min(cursorCharacter, line.length));
}
function splitTokens(text) {
    return text
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}
function activeArgIndex(tokenCountAfterHead, endsWithSpace) {
    if (tokenCountAfterHead <= 0)
        return 0;
    return endsWithSpace ? tokenCountAfterHead : tokenCountAfterHead - 1;
}
function buildSignature(head, groups, active, documentation) {
    const clamped = Math.max(0, Math.min(active, Math.max(0, groups.length - 1)));
    const label = `${head} ${groups.map((g) => g.label).join(" ")}`.trim();
    return { label, documentation, parameters: groups, activeParameter: clamped };
}
function bodySignature(linePrefix) {
    const code = linePrefix.replace(/;.*/, "");
    const tokens = splitTokens(code);
    if (!tokens.length)
        return null;
    const head = tokens[0].toUpperCase();
    let bodyKey = head;
    let argStart = 1;
    if (!(0, schemaBridge_1.getBodyParamGroups)(head) && tokens.length > 1) {
        const second = tokens[1].toUpperCase();
        if ((0, schemaBridge_1.getBodyParamGroups)(second)) {
            bodyKey = second;
            argStart = 2;
        }
    }
    const groups = (0, schemaBridge_1.getBodyParamGroups)(bodyKey);
    if (!groups)
        return null;
    const body = (0, schemaBridge_1.getBodyByKey)(bodyKey);
    const args = tokens.slice(argStart);
    const endsWithSpace = /\s$/.test(code);
    const active = activeArgIndex(args.length, endsWithSpace);
    return buildSignature(bodyKey, groups.map((g) => ({ label: g.label, documentation: g.documentation })), active, body ? `${body.title}. ${body.description}` : undefined);
}
function enumCardSignature(linePrefix) {
    const ctx = (0, schemaBridge_1.parseCardArgContext)(linePrefix);
    if (!ctx || ctx.spec.kind !== "enum")
        return null;
    const card = (0, schemaBridge_1.getCardByLabel)(ctx.card);
    const params = ctx.spec.values.map((v) => ({
        label: v.value,
        documentation: v.title,
    }));
    const code = linePrefix.replace(/;.*/, "");
    const endsWithSpace = /\s$/.test(code);
    const tokens = splitTokens(code);
    const afterCard = tokens.slice(1);
    let active = activeArgIndex(afterCard.length, endsWithSpace);
    if (!ctx.spec.multi && afterCard.length >= 1 && !endsWithSpace && !ctx.partial) {
        active = 0;
    }
    return buildSignature(ctx.card, params, active, card?.description ?? `Аргументы карты ${ctx.card}`);
}
const NUMERIC_PAIR_CARDS = new Set([
    "POWER",
    "POWE",
    "STEP",
    "DSTP",
    "TIMP",
    "TSEC",
    "TMIN",
    "THOU",
    "TDAY",
    "TYEA",
]);
function numericPairCardSignature(linePrefix, cardLabel) {
    if (!NUMERIC_PAIR_CARDS.has(cardLabel))
        return null;
    const code = linePrefix.replace(/;.*/, "");
    const tokens = splitTokens(code);
    if (tokens[0]?.toUpperCase() !== cardLabel)
        return null;
    const isPower = cardLabel === "POWER" || cardLabel === "POWE";
    const pairLabels = isPower
        ? [
            { label: "Q", documentation: "Мощность, кВт" },
            { label: "t", documentation: "Время, сут (верхняя граница интервала)" },
        ]
        : [
            { label: "t", documentation: "Время, сут" },
            { label: "n", documentation: "Число шагов на интервале" },
        ];
    const maxPairs = 12;
    const params = [];
    for (let i = 0; i < maxPairs; i++) {
        params.push(pairLabels[i % 2]);
    }
    const after = tokens.slice(1);
    const endsWithSpace = /\s$/.test(code);
    const active = activeArgIndex(after.length, endsWithSpace);
    const card = (0, schemaBridge_1.getCardByLabel)(cardLabel);
    return buildSignature(cardLabel, params, active, card?.description);
}
function genericCardSignature(linePrefix) {
    const code = linePrefix.replace(/;.*/, "");
    const tokens = splitTokens(code);
    if (tokens.length < 1)
        return null;
    const cardLabel = (0, schemaBridge_1.normalizeMcuLabel)(tokens[0]);
    if (cardLabel === "MATR" || (0, schemaBridge_1.getCardArgSpec)(cardLabel) || (0, schemaBridge_1.getBodyParamGroups)(cardLabel))
        return null;
    const card = (0, schemaBridge_1.getCardByLabel)(cardLabel);
    if (!card)
        return null;
    const dedicated = (0, schemaBridge_1.getCardLineParamGroups)(cardLabel);
    const placeholders = dedicated
        ? dedicated.map((p) => p.label)
        : (0, schemaBridge_1.parseSyntaxRequiredPart)(card.syntax);
    const params = dedicated ??
        (placeholders.length > 0
            ? placeholders.map((p) => ({ label: p, documentation: card.title }))
            : [{ label: "…", documentation: card.syntax }]);
    const after = tokens.slice(1);
    const endsWithSpace = /\s$/.test(code);
    const active = activeArgIndex(after.length, endsWithSpace);
    return buildSignature(cardLabel, params, active, `${card.title}\n\n${card.description}`);
}
function matrOptionalGroupIndex(key) {
    const idx = MATR_OPTIONAL_KEYS.indexOf(key);
    return idx >= 0 ? idx + 1 : 1;
}
function matrActiveParameter(tokens, endsWithSpace) {
    if (tokens.length <= 1)
        return 0;
    if (tokens.length === 2 && !endsWithSpace)
        return 0;
    if (tokens.length === 2 && endsWithSpace)
        return 1;
    const tail = tokens.slice(2);
    const present = new Set();
    for (const part of tail) {
        const key = part.match(/^([A-Za-z]+)=/)?.[1]?.toUpperCase();
        if (key)
            present.add(key);
    }
    const last = tail[tail.length - 1] ?? "";
    const lastKey = last.match(/^([A-Za-z]+)=/)?.[1]?.toUpperCase();
    if (lastKey)
        return matrOptionalGroupIndex(lastKey);
    if (!endsWithSpace && last && !last.includes("=")) {
        const prev = tail[tail.length - 2] ?? "";
        if (/^GROUP=/i.test(prev) || /^GROUP=/i.test(last)) {
            return matrOptionalGroupIndex("GROUP");
        }
    }
    for (let i = 0; i < MATR_OPTIONAL_KEYS.length; i++) {
        if (!present.has(MATR_OPTIONAL_KEYS[i]))
            return i + 1;
    }
    return MATR_OPTIONAL_KEYS.length;
}
function matrHeaderSignature(linePrefix) {
    if (!isMatrHeaderLinePrefix(linePrefix))
        return null;
    const code = linePrefix.replace(/;.*/, "");
    const tokens = splitTokens(code);
    const groups = (0, schemaBridge_1.getCardLineParamGroups)("MATR")?.map((g) => ({
        label: g.label,
        documentation: g.documentation,
    })) ?? [];
    if (!groups.length)
        return null;
    const endsWithSpace = /\s$/.test(code);
    const active = matrActiveParameter(tokens, endsWithSpace);
    const card = (0, schemaBridge_1.getCardByLabel)("MATR");
    return buildSignature("MATR", groups, active, card ? `${card.title}\n\n${card.description}` : "Карта MATR — заголовок материала");
}
function nuclideActiveParameter(tokens, endsWithSpace) {
    if (tokens.length === 1)
        return endsWithSpace ? 1 : 0;
    if (tokens.length === 2 && !endsWithSpace)
        return 1;
    if (tokens.length === 2 && endsWithSpace)
        return 2;
    const present = new Set();
    for (let i = 2; i < tokens.length; i++) {
        const key = tokens[i].match(/^([A-Za-z]+)=/)?.[1]?.toUpperCase();
        if (key)
            present.add(key);
    }
    const last = tokens[tokens.length - 1] ?? "";
    const lastKey = last.match(/^([A-Za-z]+)=/)?.[1]?.toUpperCase();
    if (lastKey) {
        const idx = nuclideParamValidation_1.OPTIONAL_PARAM_KEYS.indexOf(lastKey);
        if (idx >= 0)
            return 2 + idx;
    }
    if (!endsWithSpace && last && !last.includes("=")) {
        const partial = last.toUpperCase();
        const idx = nuclideParamValidation_1.OPTIONAL_PARAM_KEYS.findIndex((k) => k.startsWith(partial));
        if (idx >= 0)
            return 2 + idx;
    }
    for (let i = 0; i < nuclideParamValidation_1.OPTIONAL_PARAM_KEYS.length; i++) {
        if (!present.has(nuclideParamValidation_1.OPTIONAL_PARAM_KEYS[i]))
            return 2 + i;
    }
    return 2 + nuclideParamValidation_1.OPTIONAL_PARAM_KEYS.length - 1;
}
function nuclideLineSignature(linePrefix) {
    if (!(0, nuclideParamValidation_1.isNuclideCompositionLinePrefix)(linePrefix))
        return null;
    const code = linePrefix.replace(/;.*/, "");
    const tokens = splitTokens(code);
    if (!tokens.length)
        return null;
    const groups = (0, schemaBridge_1.getNuclideLineParamGroups)().map((g) => ({
        label: g.label,
        documentation: g.documentation,
    }));
    const endsWithSpace = /\s$/.test(code);
    const active = nuclideActiveParameter(tokens, endsWithSpace);
    return buildSignature(tokens[0], groups, active, "Строка состава MATR — имя нуклида, концентрация и опциональные ACE/MODS/DTEM/PHT");
}
/** Hover по активному параметру строки MATR или нуклида. */
function getCompositionLineParameterHover(line, cursorCharacter) {
    const prefix = linePrefixBeforeCursor(line, cursorCharacter);
    if (!isMatrHeaderLinePrefix(prefix) && !(0, nuclideParamValidation_1.isNuclideCompositionLinePrefix)(prefix))
        return null;
    const help = getParameterSignatureHelp(line, cursorCharacter);
    if (!help)
        return null;
    const p = help.parameters[help.activeParameter];
    if (!p)
        return null;
    return `**Параметр:** \`${p.label}\`\n\n${p.documentation ?? ""}`;
}
/** @deprecated Используйте getCompositionLineParameterHover */
function getNuclideLineParameterHover(line, cursorCharacter) {
    return getCompositionLineParameterHover(line, cursorCharacter);
}
/** Подсказка параметров для текущей позиции курсора в строке. */
function getParameterSignatureHelp(line, cursorCharacter) {
    const prefix = linePrefixBeforeCursor(line, cursorCharacter);
    const trimmed = prefix.trim();
    if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("C="))
        return null;
    const matr = matrHeaderSignature(prefix);
    if (matr)
        return matr;
    const nuclide = nuclideLineSignature(prefix);
    if (nuclide)
        return nuclide;
    const first = splitTokens(trimmed.replace(/;.*/, ""))[0]?.toUpperCase() ?? "";
    const body = bodySignature(prefix);
    if (body)
        return body;
    const enumSig = enumCardSignature(prefix);
    if (enumSig)
        return enumSig;
    if (NUMERIC_PAIR_CARDS.has(first)) {
        const pair = numericPairCardSignature(prefix, first);
        if (pair)
            return pair;
    }
    return genericCardSignature(prefix);
}
/** Имя активного параметра для списка completion. */
function getActiveParameterHint(line, cursorCharacter) {
    const help = getParameterSignatureHelp(line, cursorCharacter);
    if (!help?.parameters.length)
        return null;
    const p = help.parameters[help.activeParameter];
    return p ?? null;
}
//# sourceMappingURL=parameterHints.js.map