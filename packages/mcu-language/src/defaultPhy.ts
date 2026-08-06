/**
 * Парсер/сериализатор DEFAULT.PHY (UserGuide §8.2, txt 1848–1868).
 * Модель: упорядоченные блоки comment | blank | data; хвост `#` обязателен при записи.
 */

/** Дублирует schema MODS_VALUES — без зависимости от schemaBridge (для vendor в extension). */
export const DEFAULT_PHY_MODS_VALUES = [
  "G",
  "T",
  "COHR",
  "H2OK",
  "CH2K",
  "ZRHK",
  "HYH",
  "D2OK",
  "BEOK",
] as const;

export const DEFAULT_PHY_COLUMNS = [
  "NAME",
  "ACE",
  "MODS",
  "BLOCK",
  "EHR",
  "DTEM",
  "PHS",
  "PHT",
  "PRD",
  "EUR",
  "FCB",
  "WCB",
  "N",
] as const;

export type DefaultPhyColumn = (typeof DEFAULT_PHY_COLUMNS)[number];

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
  /** Порядковый номер (1…N); при сериализации пересчитывается. */
  index: number;
  /** Исходная строка (для preserve padding нетронутых строк). */
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
  /** true — запись блокировать (нет `#`, фатальные ошибки структуры). */
  fatal: boolean;
  hasTerminator: boolean;
}

export const DEFAULT_PHY_ROW_TEMPLATE: Omit<DefaultPhyRow, "index" | "originalLine" | "dirty"> = {
  name: "",
  ace: "E70",
  mods: "G",
  block: "0",
  ehr: ".0",
  dtem: "1.0",
  phs: "SVC",
  pht: "TVC",
  prd: ".0",
  eur: ".0",
  fcb: "-1.",
  wcb: "-1.",
};

const MODS_SET = new Set(DEFAULT_PHY_MODS_VALUES.map((m) => m.toUpperCase()));
const MODS_VALUES = DEFAULT_PHY_MODS_VALUES as unknown as string[];

export function createDefaultPhyRow(
  partial: Partial<DefaultPhyRow> = {},
  index = 1
): DefaultPhyRow {
  return {
    ...DEFAULT_PHY_ROW_TEMPLATE,
    ...partial,
    index,
    dirty: true,
  };
}

export function createMinimalDefaultPhyText(): string {
  return [
    "* DEFAULT.PHY — создано MCU Helper",
    "* Column: NAME ACE MODS BLOCK EHR DTEM PHS PHT PRD EUR FCB WCB N",
    "*",
    "#",
    "",
  ].join("\n");
}

function splitTokens(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

function parseDataLine(line: string, lineNo: number, warnings: DefaultPhyWarning[]): DefaultPhyRow | null {
  const tokens = splitTokens(line);
  if (tokens.length === 0) return null;

  if (tokens.length !== 13) {
    warnings.push({
      line: lineNo,
      message: `Ожидается 13 полей, получено ${tokens.length}`,
      severity: "warning",
    });
  }

  const get = (i: number, fallback = "") => tokens[i] ?? fallback;
  const name = get(0);
  if (!name) {
    warnings.push({ line: lineNo, message: "Пустое имя нуклида (NAME)", severity: "warning" });
  } else if (/\s/.test(name)) {
    warnings.push({ line: lineNo, message: `NAME содержит пробел: «${name}»`, severity: "warning" });
  }

  const mods = get(2);
  if (mods && !MODS_SET.has(mods.toUpperCase())) {
    warnings.push({
      line: lineNo,
      message: `MODS=${mods}: ожидается ${MODS_VALUES.join(", ")}`,
      severity: "warning",
    });
  }

  const indexRaw = get(12, "0");
  const index = Number.parseInt(indexRaw, 10);
  return {
    name,
    ace: get(1),
    mods,
    block: get(3, "0"),
    ehr: get(4, ".0"),
    dtem: get(5, "1.0"),
    phs: get(6, "SVC"),
    pht: get(7, "TVC"),
    prd: get(8, ".0"),
    eur: get(9, ".0"),
    fcb: get(10, "-1."),
    wcb: get(11, "-1."),
    index: Number.isFinite(index) ? index : 0,
    originalLine: line.replace(/\r$/, ""),
    dirty: false,
  };
}

export function parseDefaultPhy(text: string): DefaultPhyDocument {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks: DefaultPhyBlock[] = [];
  const warnings: DefaultPhyWarning[] = [];
  let hasTerminator = false;
  let afterHash = false;
  const nameLines = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i]!;
    const trimmed = line.trimEnd();

    if (afterHash) {
      if (trimmed.length > 0) {
        warnings.push({
          line: lineNo,
          message: "Данные после строки «#» игнорируются при записи",
          severity: "warning",
        });
      }
      continue;
    }

    if (trimmed.startsWith("#")) {
      hasTerminator = true;
      afterHash = true;
      if (trimmed !== "#") {
        warnings.push({
          line: lineNo,
          message: "Строка «#» должна содержать только символ # в первой позиции",
          severity: "warning",
        });
      }
      continue;
    }

    if (trimmed.length === 0) {
      blocks.push({ kind: "blank", text: line });
      continue;
    }

    if (line.startsWith("*") || trimmed.startsWith("*")) {
      blocks.push({ kind: "comment", text: line.startsWith("*") ? line : trimmed });
      continue;
    }

    const row = parseDataLine(line, lineNo, warnings);
    if (!row) {
      blocks.push({ kind: "blank", text: line });
      continue;
    }

    const key = row.name.toUpperCase();
    if (key) {
      const prev = nameLines.get(key);
      if (prev != null) {
        warnings.push({
          line: lineNo,
          message: `Дубликат NAME «${row.name}» (ранее строка ${prev})`,
          severity: "warning",
        });
      } else {
        nameLines.set(key, lineNo);
      }
    }

    blocks.push({ kind: "data", row });
  }

  const fatal = !hasTerminator;
  if (fatal) {
    warnings.push({
      line: lines.length,
      message: "Отсутствует завершающая строка «#»",
      severity: "error",
    });
  }

  return { blocks, warnings, fatal, hasTerminator };
}

/** Ширины колонок по эталону RUNTEST/DEFAULT.PHY. */
const COL_WIDTHS = {
  name: 5,
  ace: 4,
  mods: 5,
  block: 6,
  ehr: 5,
  dtem: 5,
  phs: 4,
  pht: 4,
  prd: 5,
  eur: 6,
  fcb: 4,
  wcb: 4,
  index: 4,
} as const;

function padRight(s: string, w: number): string {
  if (s.length >= w) return s + " ";
  return s.padEnd(w, " ");
}

function padLeft(s: string, w: number): string {
  if (s.length >= w) return " " + s;
  return s.padStart(w, " ");
}

export function formatDefaultPhyDataLine(row: DefaultPhyRow, index: number): string {
  return (
    padRight(row.name, COL_WIDTHS.name) +
    padRight(row.ace, COL_WIDTHS.ace) +
    padRight(row.mods, COL_WIDTHS.mods) +
    padRight(row.block, COL_WIDTHS.block) +
    padLeft(row.ehr, COL_WIDTHS.ehr) +
    padLeft(row.dtem, COL_WIDTHS.dtem) +
    "  " +
    padRight(row.phs, COL_WIDTHS.phs) +
    padRight(row.pht, COL_WIDTHS.pht) +
    padLeft(row.prd, COL_WIDTHS.prd) +
    padLeft(row.eur, COL_WIDTHS.eur) +
    padLeft(row.fcb, COL_WIDTHS.fcb) +
    padLeft(row.wcb, COL_WIDTHS.wcb) +
    padLeft(String(index), COL_WIDTHS.index)
  ).trimEnd();
}

/**
 * Пересобрать текст файла. № строк данных — 1…N.
 * Нетронутые (dirty !== true) строки с originalLine сохраняют padding, кроме хвоста номера.
 */
export function serializeDefaultPhy(doc: DefaultPhyDocument): string {
  const out: string[] = [];
  let dataIndex = 0;

  for (const block of doc.blocks) {
    if (block.kind === "comment" || block.kind === "blank") {
      out.push(block.text);
      continue;
    }
    dataIndex += 1;
    const row = { ...block.row, index: dataIndex };
    if (!row.dirty && row.originalLine) {
      const tokens = splitTokens(row.originalLine);
      if (tokens.length >= 12) {
        // Заменить только порядковый номер в конце, сохранив padding тела.
        const body = row.originalLine.replace(/\s+\S+\s*$/, "");
        const numWidth = Math.max(String(dataIndex).length + 1, 4);
        out.push(body + String(dataIndex).padStart(numWidth, " "));
        continue;
      }
    }
    out.push(formatDefaultPhyDataLine(row, dataIndex));
  }

  out.push("#");
  return out.join("\n") + "\n";
}

export function listDataRows(doc: DefaultPhyDocument): DefaultPhyRow[] {
  return doc.blocks.filter((b): b is { kind: "data"; row: DefaultPhyRow } => b.kind === "data").map((b) => b.row);
}

/** Индекс NAME → строка DEFAULT.PHY (для LSP-проверок варианта). */
export interface DefaultPhyTable {
  byName: Map<string, DefaultPhyRow>;
  path?: string;
  entryCount: number;
}

let currentPhyTable: DefaultPhyTable | null = null;

export function buildDefaultPhyTable(doc: DefaultPhyDocument, sourcePath?: string): DefaultPhyTable {
  const byName = new Map<string, DefaultPhyRow>();
  for (const row of listDataRows(doc)) {
    const key = row.name.trim().toUpperCase();
    if (!key) continue;
    // Первый выигрывает (как предупреждение о дубликате при parse).
    if (!byName.has(key)) byName.set(key, row);
  }
  return { byName, path: sourcePath, entryCount: byName.size };
}

export function setDefaultPhyTable(table: DefaultPhyTable | null): void {
  currentPhyTable = table;
}

export function getDefaultPhyTable(): DefaultPhyTable | null {
  return currentPhyTable;
}

export function clearDefaultPhyTable(): void {
  currentPhyTable = null;
}

export function getDefaultPhyEntry(name: string): DefaultPhyRow | null {
  if (!currentPhyTable) return null;
  return currentPhyTable.byName.get(name.trim().toUpperCase()) ?? null;
}

/** Карты DEF для вставки в .mcu (ACE/MODS/DTEM/PHT — только непустые). */
export function formatDefCards(rows: DefaultPhyRow[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (!row.name.trim()) continue;
    const parts = [`DEF ${row.name.trim()}`];
    if (row.ace.trim()) parts.push(`ACE=${row.ace.trim()}`);
    if (row.mods.trim()) parts.push(`MODS=${row.mods.trim()}`);
    if (row.dtem.trim()) parts.push(`DTEM=${row.dtem.trim()}`);
    if (row.pht.trim()) parts.push(`PHT=${row.pht.trim()}`);
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}

export function collectFieldOptions(doc: DefaultPhyDocument): { ace: string[]; mods: string[]; pht: string[] } {
  const ace = new Set<string>();
  const mods = new Set<string>(MODS_VALUES);
  const pht = new Set<string>();
  for (const row of listDataRows(doc)) {
    if (row.ace) ace.add(row.ace);
    if (row.mods) mods.add(row.mods);
    if (row.pht) pht.add(row.pht);
  }
  return {
    ace: [...ace].sort((a, b) => a.localeCompare(b)),
    mods: [...mods],
    pht: [...pht].sort((a, b) => a.localeCompare(b)),
  };
}
