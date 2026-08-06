/**
 * Загрузка parse/serialize DEFAULT.PHY из vendor или monorepo dist.
 */

import * as fs from "fs";
import * as path from "path";

export interface DefaultPhyRow {
  name: string;
  ace: string;
  mods: string;
  block: string;
  ehr: string;
  dtem: string;
  phs: string;
  pht: string;
  prd: string;
  eur: string;
  fcb: string;
  wcb: string;
  index: number;
  originalLine?: string;
  dirty?: boolean;
}

export type DefaultPhyBlock =
  | { kind: "comment"; text: string }
  | { kind: "blank"; text: string }
  | { kind: "data"; row: DefaultPhyRow };

export interface DefaultPhyWarning {
  line: number;
  message: string;
  severity: "warning" | "error";
}

export interface DefaultPhyDocument {
  blocks: DefaultPhyBlock[];
  warnings: DefaultPhyWarning[];
  fatal: boolean;
  hasTerminator: boolean;
}

type DefaultPhyMod = {
  parseDefaultPhy: (text: string) => DefaultPhyDocument;
  serializeDefaultPhy: (doc: DefaultPhyDocument) => string;
  listDataRows: (doc: DefaultPhyDocument) => DefaultPhyRow[];
  collectFieldOptions: (doc: DefaultPhyDocument) => { ace: string[]; mods: string[]; pht: string[] };
  formatDefCards: (rows: DefaultPhyRow[]) => string;
  createDefaultPhyRow: (partial?: Partial<DefaultPhyRow>, index?: number) => DefaultPhyRow;
  createMinimalDefaultPhyText: () => string;
};

let cached: DefaultPhyMod | undefined;

export function loadDefaultPhyMod(): DefaultPhyMod {
  if (cached) return cached;
  const candidates = [
    path.join(__dirname, "..", "vendor", "mcu-language", "defaultPhy.js"),
    path.join(__dirname, "..", "..", "packages", "mcu-language", "dist", "defaultPhy.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cached = require(p) as DefaultPhyMod;
      return cached;
    }
  }
  throw new Error("defaultPhy не найден. Выполните npm run build в корне проекта.");
}
