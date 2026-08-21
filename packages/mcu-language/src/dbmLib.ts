/**
 * Библиотеки материалов .DBM в корне MDBNR (UserGuide §8.11).
 * NAME= на MATR — имя файла (≤6 символов) без расширения; состав — одно кодовое имя.
 */

import * as fs from "fs";
import * as path from "path";
import type { SourceRange } from "./ast";

const NUCLIDE_NAME_FORMATS = new Set(["MCU", "ZA"]);

export interface DbmNuclideLine {
  name: string;
  density: string;
  mods: string;
  line: number;
}

export interface DbmMaterialEntry {
  name: string;
  nuclideCount: number;
  /** 1 → A (DENSWA/DENSAA), 2 → W (DENSWW/DENSAW). */
  densType: 1 | 2;
  nuclides: DbmNuclideLine[];
  /** 0-based строка заголовка материала. */
  headerLine: number;
}

export interface DbmLibrary {
  path?: string;
  materials: Map<string, DbmMaterialEntry>;
}

/** NAME=MCU|ZA — формат имён нуклидов, не файл .DBM. */
export function isNuclideNameFormat(name: string | undefined | null): boolean {
  if (!name) return false;
  return NUCLIDE_NAME_FORMATS.has(name.trim().toUpperCase());
}

/**
 * Имя файла библиотеки материалов (без .DBM): 1–6 символов, не MCU/ZA.
 * UserGuide §8.11.
 */
export function isDbmLibraryName(name: string | undefined | null): boolean {
  if (!name || isNuclideNameFormat(name)) return false;
  return /^[A-Za-z][A-Za-z0-9]{0,5}$/.test(name.trim());
}

/** Строка состава MATR с кодовым именем (без dens). */
export function looksLikeLibMaterialCodeLine(text: string): boolean {
  const t = text.trim().replace(/;.*/, "").trim();
  if (!t) return false;
  return /^[A-Za-z][A-Za-z0-9]{0,5}$/.test(t);
}

/** Переименование DENSxY под Тип_x из .DBM (1=A, 2=W). */
export function remapDensParamForType(densParam: string, densType: 1 | 2): string {
  const key = densParam.trim().toUpperCase();
  if (densType === 1) {
    if (key === "DENSWW") return "DENSWA";
    if (key === "DENSAW") return "DENSAA";
    return key;
  }
  if (key === "DENSWA") return "DENSWW";
  if (key === "DENSAA") return "DENSAW";
  return key;
}

export function rangeAtLine(line: number, text = ""): SourceRange {
  const len = text.length;
  return {
    start: { line, character: 0 },
    end: { line, character: Math.max(len, 0) },
    offset: 0,
    endOffset: 0,
  };
}

/** Разбор текста .DBM. */
export function parseDbmLibrary(text: string, sourcePath?: string): DbmLibrary {
  const materials = new Map<string, DbmMaterialEntry>();
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("*")) {
      i++;
      continue;
    }
    if (trimmed.startsWith("#")) break;

    const header = trimmed.match(/^([A-Za-z][A-Za-z0-9]{0,5})\s+(\d+)\s+([12])\s*$/);
    if (!header) {
      i++;
      continue;
    }

    const name = header[1]!;
    const nuclideCount = parseInt(header[2]!, 10);
    const densType = parseInt(header[3]!, 10) as 1 | 2;
    const headerLine = i;
    const nuclides: DbmNuclideLine[] = [];
    i++;

    while (i < lines.length && nuclides.length < nuclideCount) {
      const nRaw = (lines[i] ?? "").trim();
      if (!nRaw || nRaw.startsWith("*")) {
        i++;
        continue;
      }
      if (nRaw.startsWith("#")) break;
      // Следующий заголовок материала — не добрали нуклиды.
      if (/^[A-Za-z][A-Za-z0-9]{0,5}\s+\d+\s+[12]\s*$/.test(nRaw)) break;

      const nm = nRaw.match(/^([A-Za-z][A-Za-z0-9]{0,5})\s+(\S+)(?:\s+(\S+))?\s*$/);
      if (nm) {
        nuclides.push({
          name: nm[1]!,
          density: nm[2]!,
          mods: (nm[3] ?? "A").toUpperCase() === "A" ? "A" : nm[3]!,
          line: i,
        });
      }
      i++;
    }

    materials.set(name.toUpperCase(), {
      name,
      nuclideCount,
      densType,
      nuclides,
      headerLine,
    });
  }

  return { path: sourcePath, materials };
}

/** Case-insensitive поиск NAME.DBM в корне MDBNR. */
export function resolveDbmFilePath(
  libRoot: string,
  nameLib: string
): { fsPath: string; exists: boolean } {
  const root = libRoot?.trim();
  const base = nameLib.trim();
  if (!root || !base) {
    return { fsPath: path.join(root || "", `${base || "NAME"}.DBM`), exists: false };
  }

  const preferred = path.join(root, `${base}.DBM`);
  if (fs.existsSync(preferred) && fs.statSync(preferred).isFile()) {
    return { fsPath: preferred, exists: true };
  }
  const lower = path.join(root, `${base}.dbm`);
  if (fs.existsSync(lower) && fs.statSync(lower).isFile()) {
    return { fsPath: lower, exists: true };
  }

  const want = `${base}.DBM`.toUpperCase();
  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.toUpperCase() === want) {
        return { fsPath: path.join(root, ent.name), exists: true };
      }
    }
  } catch {
    /* ignore */
  }
  return { fsPath: preferred, exists: false };
}

const dbmCache = new Map<string, { mtimeMs: number; size: number; lib: DbmLibrary }>();

let dbmLibRoot: string | null = null;

export function setDbmLibRoot(root: string | null | undefined): void {
  const next = root?.trim() || null;
  if (next !== dbmLibRoot) {
    dbmLibRoot = next;
    dbmCache.clear();
  }
}

export function getDbmLibRoot(): string | null {
  return dbmLibRoot;
}

export function clearDbmCache(): void {
  dbmCache.clear();
}

/** Загрузка .DBM из корня MDBNR (с кэшем по mtime/size). */
export function loadDbmLibrary(nameLib: string, libRoot = dbmLibRoot): DbmLibrary | null {
  if (!libRoot || !isDbmLibraryName(nameLib)) return null;
  const { fsPath, exists } = resolveDbmFilePath(libRoot, nameLib);
  if (!exists) return null;
  try {
    const st = fs.statSync(fsPath);
    const cached = dbmCache.get(fsPath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return cached.lib;
    }
    const text = fs.readFileSync(fsPath, "utf8");
    const lib = parseDbmLibrary(text, fsPath);
    dbmCache.set(fsPath, { mtimeMs: st.mtimeMs, size: st.size, lib });
    return lib;
  } catch {
    return null;
  }
}

export function getDbmMaterial(
  nameLib: string,
  materialCode: string,
  libRoot = dbmLibRoot
): DbmMaterialEntry | null {
  const lib = loadDbmLibrary(nameLib, libRoot);
  if (!lib) return null;
  return lib.materials.get(materialCode.trim().toUpperCase()) ?? null;
}

/** Имена *.DBM в корне MDBNR (без расширения, как в NAME=). */
export function listDbmLibrariesInRoot(libRoot: string): string[] {
  const root = libRoot?.trim();
  if (!root || !fs.existsSync(root)) return [];
  const names = new Set<string>();
  try {
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      if (!/\.dbm$/i.test(ent.name)) continue;
      const base = ent.name.replace(/\.dbm$/i, "");
      if (isDbmLibraryName(base)) names.add(base.toUpperCase());
    }
  } catch {
    return [];
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Материал из каталога MDBNR (для sidebar / drag-insert). */
export interface DbmCatalogMaterial {
  library: string;
  code: string;
  nuclideCount: number;
  densType: 1 | 2;
  headerLine: number;
  fsPath: string;
  nuclidesPreview: string;
}

export interface DbmCatalogLibrary {
  library: string;
  fsPath: string;
  materials: DbmCatalogMaterial[];
}

/**
 * Все материалы из всех *.DBM в корне MDBNR (порядок: имя файла, затем код).
 * Для панели «Материалы» — перетаскивание с синтаксисом NAME=lib.
 */
export function listDbmCatalog(libRoot: string): DbmCatalogLibrary[] {
  const names = listDbmLibrariesInRoot(libRoot);
  const out: DbmCatalogLibrary[] = [];
  for (const library of names) {
    const lib = loadDbmLibrary(library, libRoot);
    if (!lib?.path) continue;
    const materials: DbmCatalogMaterial[] = [];
    for (const e of lib.materials.values()) {
      materials.push({
        library,
        code: e.name,
        nuclideCount: e.nuclideCount,
        densType: e.densType,
        headerLine: e.headerLine,
        fsPath: lib.path,
        nuclidesPreview: e.nuclides
          .slice(0, 4)
          .map((n) => n.name)
          .join(" "),
      });
    }
    materials.sort((a, b) => a.code.localeCompare(b.code, undefined, { sensitivity: "base" }));
    out.push({ library, fsPath: lib.path, materials });
  }
  return out;
}

/**
 * Snippet для вставки использования .DBM в deck:
 * `MATR ${1:N} NAME=LIB` + кодовое имя.
 */
export function buildMatrDbmInsertSnippet(
  libraryName: string,
  materialCode: string,
  suggestedNumber = 1
): string {
  const n = Math.max(1, Math.floor(Number(suggestedNumber)) || 1);
  const lib = libraryName.trim();
  const code = materialCode.trim();
  return `MATR \${1:${n}} NAME=${lib}\n${code}\nEND\n`;
}

const MATR_BLOCK_STOP = new Set([
  "MATR",
  "END",
  "FINISH",
  "DEF",
  "TEMPR",
  "PIN",
  "CPM",
  "CPMEND",
  "HEAD",
  "CONT",
  "RGS",
  "BURN",
  "SOURCE",
  "NPS",
  "GEO",
  "TRX",
  "SINOT",
  "SIDEN",
  "ICE",
  "ICENOT",
]);

export interface DbmExportNuclide {
  name: string;
  density: string;
  mods: string;
}

export interface DbmExportEntry {
  name: string;
  densType: 1 | 2;
  nuclides: DbmExportNuclide[];
}

export interface MatrCompositionSpan {
  headerLine: number;
  endLine: number;
  number: number;
  headerText: string;
  /** Строки тела состава (без заголовка), trim не пустые. */
  bodyLines: string[];
}

function lineLabel(raw: string): string {
  return raw.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
}

function isMatrCompositionStopLine(raw: string): boolean {
  const lab = lineLabel(raw);
  if (lab === "SI") {
    // SI dens (кремний) — продолжение состава; SI list — стоп.
    return !/^\s*SI\s+[+-]?(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?\b/i.test(raw);
  }
  return MATR_BLOCK_STOP.has(lab);
}

/** Конец «секции» для курсора: состав + END/пустые/** до следующего MATR или модуля. */
function matrSectionEndLine(lines: string[], header: number, compositionEnd: number): number {
  let end = compositionEnd;
  for (let i = compositionEnd + 1; i < lines.length; i++) {
    const raw = (lines[i] ?? "").trim();
    if (!raw || raw.startsWith("**") || raw.startsWith(";")) {
      end = i;
      continue;
    }
    if (/^MATR\s+\d+/i.test(raw)) break;
    const lab = lineLabel(raw);
    // END между материалами — ещё эта секция; FINISH/HEAD/… — уже другой модуль.
    if (lab === "END") {
      end = i;
      continue;
    }
    if (MATR_BLOCK_STOP.has(lab) || (lab === "SI" && isMatrCompositionStopLine(raw))) break;
    // Лишний текст после состава — не расширяем (нуклид уже учтён в compositionEnd).
    break;
  }
  return end;
}

/** densType для .DBM: 2 если в заголовке DENSWW/DENSAW, иначе 1. */
export function densTypeFromMatrHeader(headerText: string): 1 | 2 {
  if (/\b(DENSWW|DENSAW)\s*=/i.test(headerText)) return 2;
  return 1;
}

/** Блок MATR под строкой курсора (видимый текст файла). */
export function findMatrCompositionSpan(text: string, line: number): MatrCompositionSpan | null {
  const lines = text.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return null;

  const headers: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*MATR\s+\d+/i.test(lines[i] ?? "")) headers.push(i);
  }
  if (!headers.length) return null;

  let header = -1;
  for (const h of headers) {
    if (h <= line) header = h;
  }
  if (header < 0) return null;

  let compositionEnd = header;
  for (let i = header + 1; i < lines.length; i++) {
    const raw = (lines[i] ?? "").trim();
    if (!raw || raw.startsWith("**") || raw.startsWith(";")) {
      compositionEnd = i;
      continue;
    }
    if (isMatrCompositionStopLine(raw)) break;
    compositionEnd = i;
  }

  const sectionEnd = matrSectionEndLine(lines, header, compositionEnd);
  if (line > sectionEnd) return null;

  const headerText = lines[header] ?? "";
  const num = parseInt(headerText.trim().match(/^MATR\s+(\d+)/i)?.[1] ?? "", 10);
  if (!Number.isFinite(num)) return null;

  const bodyLines: string[] = [];
  for (let i = header + 1; i <= compositionEnd; i++) {
    const t = (lines[i] ?? "").trim();
    if (!t || t.startsWith("**") || t.startsWith(";")) continue;
    if (isMatrCompositionStopLine(t)) break;
    bodyLines.push(t);
  }

  return {
    headerLine: header,
    /** Для замены в редакторе — только состав (без END после блока). */
    endLine: compositionEnd,
    number: num,
    headerText,
    bodyLines,
  };
}

const NUCLIDE_EXPORT_RE =
  /^\/?([A-Za-z][A-Za-z0-9]{0,5})\s+(\S+)(?:\s+MODS=(\S+))?/i;

/** Извлечь запись .DBM из блока MATR (изотопный состав). */
export function extractDbmEntryFromMatrSpan(
  span: MatrCompositionSpan,
  materialCode: string
): { ok: true; entry: DbmExportEntry } | { ok: false; error: string } {
  const code = materialCode.trim();
  if (!looksLikeLibMaterialCodeLine(code)) {
    return { ok: false, error: "Имя материала: 1–6 символов (буква + буквы/цифры)" };
  }

  // Уже кодовое имя из .DBM — нечего экспортировать.
  if (
    span.bodyLines.length === 1 &&
    looksLikeLibMaterialCodeLine(span.bodyLines[0]!) &&
    isDbmLibraryName(span.headerText.match(/NAME\s*=\s*(\S+)/i)?.[1])
  ) {
    return { ok: false, error: "Материал уже задан кодовым именем из .DBM" };
  }

  const densType = densTypeFromMatrHeader(span.headerText);
  const nuclides: DbmExportNuclide[] = [];
  for (const raw of span.bodyLines) {
    if (/^(T|GROUP|NAME|DENSAA|DENSWA|DENSAW|DENSWW|VOL|BUR)\s*=/i.test(raw)) continue;
    if (looksLikeLibMaterialCodeLine(raw)) {
      return { ok: false, error: "В составе уже есть кодовое имя — экспортируйте изотопный MATR" };
    }
    const m = raw.match(NUCLIDE_EXPORT_RE);
    if (!m) continue;
    const name = m[1]!;
    if (["MODS", "ACE", "DTEM", "PHT"].includes(name.toUpperCase())) continue;
    nuclides.push({
      name,
      density: m[2]!,
      mods: m[3] ? m[3]! : "A",
    });
  }

  if (!nuclides.length) {
    return { ok: false, error: "В MATR нет нуклидов для записи в .DBM" };
  }

  return {
    ok: true,
    entry: { name: code, densType, nuclides },
  };
}

export function formatDbmMaterialEntry(entry: DbmExportEntry): string {
  const lines = [`${entry.name} ${entry.nuclides.length} ${entry.densType}`];
  for (const n of entry.nuclides) {
    lines.push(`${n.name} ${n.density} ${n.mods}`);
  }
  return lines.join("\n");
}

/** Список материалов из текста .DBM в порядке файла (для upsert). */
export function listDbmExportEntries(text: string): DbmExportEntry[] {
  const lib = parseDbmLibrary(text);
  const out: DbmExportEntry[] = [];
  for (const e of lib.materials.values()) {
    out.push({
      name: e.name,
      densType: e.densType,
      nuclides: e.nuclides.map((n) => ({ name: n.name, density: n.density, mods: n.mods })),
    });
  }
  return out;
}

export function serializeDbmLibrary(entries: DbmExportEntry[]): string {
  if (!entries.length) return "#\n";
  const parts: string[] = [];
  for (const e of entries) {
    if (parts.length) parts.push("*");
    parts.push(formatDbmMaterialEntry(e));
  }
  parts.push("#");
  return parts.join("\n") + "\n";
}

/** Добавить/заменить материал в тексте .DBM. */
export function upsertDbmMaterialInText(
  dbmText: string,
  entry: DbmExportEntry
): { text: string; replaced: boolean } {
  const entries = listDbmExportEntries(dbmText);
  const key = entry.name.toUpperCase();
  const idx = entries.findIndex((e) => e.name.toUpperCase() === key);
  let replaced = false;
  if (idx >= 0) {
    entries[idx] = entry;
    replaced = true;
  } else {
    entries.push(entry);
  }
  return { text: serializeDbmLibrary(entries), replaced };
}

/** Удалить материал по кодовому имени (no-op, если нет). */
export function removeDbmMaterialFromText(
  dbmText: string,
  materialCode: string
): { text: string; removed: boolean } {
  const key = materialCode.trim().toUpperCase();
  if (!key) return { text: dbmText, removed: false };
  const entries = listDbmExportEntries(dbmText);
  const next = entries.filter((e) => e.name.toUpperCase() !== key);
  if (next.length === entries.length) return { text: dbmText, removed: false };
  return { text: serializeDbmLibrary(next), removed: true };
}

/**
 * Upsert записи; при смене кодового имени удаляет прежний код (rename без орфана).
 */
export function upsertDbmMaterialWithRename(
  dbmText: string,
  entry: DbmExportEntry,
  previousCode?: string | null
): { text: string; replaced: boolean; renamedFrom: string | null } {
  let { text, replaced } = upsertDbmMaterialInText(dbmText, entry);
  const prev = previousCode?.trim() ?? "";
  const next = entry.name.trim();
  if (!prev || prev.toUpperCase() === next.toUpperCase()) {
    return { text, replaced, renamedFrom: null };
  }
  const removed = removeDbmMaterialFromText(text, prev);
  return {
    text: removed.text,
    replaced,
    renamedFrom: removed.removed ? prev : null,
  };
}

/** Заголовок MATR: NAME= → библиотека .DBM, прочие параметры сохранить. */
export function rewriteMatrHeaderForDbm(headerLine: string, libraryName: string): string {
  const lib = libraryName.trim();
  let h = headerLine.replace(/\s*NAME\s*=\s*\S+/gi, "");
  h = h.replace(/\s+$/g, "");
  return `${h} NAME=${lib}`;
}

/** Текст замены блока MATR на использование .DBM. */
export function buildMatrDbmUsageBlock(
  headerLine: string,
  libraryName: string,
  materialCode: string
): string {
  const header = rewriteMatrHeaderForDbm(headerLine, libraryName);
  return `${header}\n${materialCode.trim()}`;
}

/** Готовый plain-текст MATR с NAME= (без сниппет-плейсхолдеров). */
export function buildMatrDbmInsertPlain(
  libraryName: string,
  materialCode: string,
  matrNumber: number
): string {
  const n = Math.max(1, Math.floor(Number(matrNumber)) || 1);
  return `MATR ${n} NAME=${libraryName.trim()}\n${materialCode.trim()}\nEND\n`;
}

/** Предлагаемое кодовое имя: GROUP= или первые буквы. */
export function suggestDbmMaterialCode(span: MatrCompositionSpan): string {
  const group = span.headerText.match(/GROUP\s*=\s*(\S+)/i)?.[1];
  if (group && looksLikeLibMaterialCodeLine(group)) return group.toUpperCase();
  const first = span.bodyLines
    .map((l) => l.match(NUCLIDE_EXPORT_RE)?.[1])
    .find(Boolean);
  if (first && looksLikeLibMaterialCodeLine(first)) {
    // U235 → U235 ок; часто хотят UO2 — оставляем имя первого нуклида как fallback.
    return first.toUpperCase();
  }
  return `M${span.number}`.slice(0, 6);
}
