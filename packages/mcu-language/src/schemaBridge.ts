/** Runtime bridge: schema собирается раньше language (см. npm run build). */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const schemaKeywords = require("../../mcu-schema/dist/keywords") as typeof import("@mcuhelper/mcu-schema/keywords");

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const schemaIndex = require("../../mcu-schema/dist/index") as typeof import("@mcuhelper/mcu-schema");

export const {
  ALL_MCU_LABELS,
  detectFragmentFromLabel,
  isKnownMcuLabel,
  listAllMcuLabels,
  normalizeMcuLabel,
} = schemaKeywords;

export const {
  getBodyByKey,
  getBodyParamGroups,
  getCardByLabel,
  getCardArgSpec,
  getCardLineParamGroups,
  getNuclideLineParamGroups,
  MODS_VALUES,
  parseSyntaxRequiredPart,
  parseCardArgContext,
} = schemaIndex;

export type { CardArgEnumValue } from "@mcuhelper/mcu-schema";
