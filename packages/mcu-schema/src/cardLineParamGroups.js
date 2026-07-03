"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARD_LINE_PARAM_GROUPS = void 0;
exports.getCardLineParamGroups = getCardLineParamGroups;
exports.parseSyntaxRequiredPart = parseSyntaxRequiredPart;
/** Параметры на одной строке карты (без хвостов в [скобках] и без FINISH). */
exports.CARD_LINE_PARAM_GROUPS = {
    SPNT: [{ label: "x,y,z", documentation: "Координаты точечного источника (см)" }],
    SRCD: [
        { label: "print", documentation: "Печать карт (0/1), опционально" },
        { label: "debug", documentation: "Отладочная печать (0–5), опционально" },
    ],
    SRC: [
        { label: "print", documentation: "Печать карт (0/1), опционально" },
        { label: "debug", documentation: "Отладочная печать (0–5), опционально" },
    ],
    RGS: [
        { label: "print", documentation: "Печать карт (0/1), опционально" },
        { label: "debug", documentation: "Отладочная печать (0–5), опционально" },
    ],
    REGD: [
        { label: "print", documentation: "Печать карт (0/1), опционально" },
        { label: "debug", documentation: "Отладочная печать (0–5), опционально" },
    ],
    PIN: [
        { label: "print", documentation: "Печать карт (0/1)" },
        { label: "debug", documentation: "Отладочная печать (0–5)" },
    ],
    HEAD: [
        { label: "print", documentation: "Печать карт (0/1)" },
        { label: "trace", documentation: "Трассировка (0/1)" },
        { label: "listSize", documentation: "Размер списка" },
    ],
    MATR: [
        { label: "number", documentation: "Номер материала (целое, произвольный)" },
        { label: "T=…", documentation: "Температура материала, K (≥ 0; по умолчанию 300)" },
        {
            label: "GROUP=имя",
            documentation: "Произвольное символьное имя группы (напр. fuel, MOD, clad). Материалы с одной GROUP задаются в геометрии по имени группы; номер MATR внутри группы — внутренний.",
        },
        { label: "NAME=MCU|ZA", documentation: "Формат имён нуклидов: MCU (по умолчанию) или ZA" },
        { label: "DENSAA=…", documentation: "Ядерная плотность материала, режим атомных долей (яд/см³)" },
        { label: "DENSWA=…", documentation: "Плотность материала, г/см³, режим атомных долей" },
        { label: "DENSAW=…", documentation: "Ядерная плотность, режим весовых долей" },
        { label: "DENSWW=…", documentation: "Плотность, г/см³, режим весовых долей" },
        { label: "VOL=…", documentation: "Объём материала, см³" },
        { label: "BUR=…", documentation: "Параметры выгорания материала" },
    ],
    TEMPR: [{ label: "T", documentation: "Температура системы (K)" }],
    PTYPE: [{ label: "n", documentation: "Тип регистрации потоков" }],
    TTYPE: [{ label: "n", documentation: "Тип регистрации времени" }],
    NRET: [
        { label: "number", documentation: "Номер регистратора" },
        { label: "DOWN|UP", documentation: "Направление, опционально" },
    ],
};
function getCardLineParamGroups(cardLabel) {
    return exports.CARD_LINE_PARAM_GROUPS[cardLabel.toUpperCase()];
}
/** Обязательная часть syntax до первой `[…]`. */
function parseSyntaxRequiredPart(syntax) {
    const rest = syntax.replace(/^\S+\s*/, "");
    const beforeOptional = rest.split(/\[/)[0]?.trim() ?? "";
    if (!beforeOptional)
        return [];
    return beforeOptional.split(/\s+/).filter(Boolean);
}
//# sourceMappingURL=cardLineParamGroups.js.map