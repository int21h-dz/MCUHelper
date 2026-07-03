"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCardArgContext = exports.parseSyntaxRequiredPart = exports.MODS_VALUES = exports.getNuclideLineParamGroups = exports.getCardLineParamGroups = exports.getCardArgSpec = exports.getCardByLabel = exports.getBodyParamGroups = exports.getBodyByKey = exports.normalizeMcuLabel = exports.listAllMcuLabels = exports.isKnownMcuLabel = exports.detectFragmentFromLabel = exports.ALL_MCU_LABELS = exports.schemaIndex = exports.schemaKeywords = void 0;
/** Runtime bridge: schema собирается раньше language (см. npm run build). */
// eslint-disable-next-line @typescript-eslint/no-require-imports
exports.schemaKeywords = require("../../mcu-schema/dist/keywords");
// eslint-disable-next-line @typescript-eslint/no-require-imports
exports.schemaIndex = require("../../mcu-schema/dist/index");
exports.ALL_MCU_LABELS = exports.schemaKeywords.ALL_MCU_LABELS, exports.detectFragmentFromLabel = exports.schemaKeywords.detectFragmentFromLabel, exports.isKnownMcuLabel = exports.schemaKeywords.isKnownMcuLabel, exports.listAllMcuLabels = exports.schemaKeywords.listAllMcuLabels, exports.normalizeMcuLabel = exports.schemaKeywords.normalizeMcuLabel;
exports.getBodyByKey = exports.schemaIndex.getBodyByKey, exports.getBodyParamGroups = exports.schemaIndex.getBodyParamGroups, exports.getCardByLabel = exports.schemaIndex.getCardByLabel, exports.getCardArgSpec = exports.schemaIndex.getCardArgSpec, exports.getCardLineParamGroups = exports.schemaIndex.getCardLineParamGroups, exports.getNuclideLineParamGroups = exports.schemaIndex.getNuclideLineParamGroups, exports.MODS_VALUES = exports.schemaIndex.MODS_VALUES, exports.parseSyntaxRequiredPart = exports.schemaIndex.parseSyntaxRequiredPart, exports.parseCardArgContext = exports.schemaIndex.parseCardArgContext;
//# sourceMappingURL=schemaBridge.js.map