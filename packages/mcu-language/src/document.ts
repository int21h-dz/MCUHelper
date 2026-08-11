import * as crypto from "crypto";
import * as fs from "fs";
import type { DocumentAst } from "./ast";
import { parseDocument, type ParseOptions } from "./parser";
import { analyzeSemantics, buildSummaries } from "./semantic";
import {
  normalizeIncludeFsKey,
  parseIncludeLine,
  resolveIncludeFilePath,
  textHasIncludeDirective,
} from "./includeResolve";
import type { IncludeTextOverrides } from "./preprocessor";

export interface DocumentIndex {
  uri: string;
  version: number;
  ast: DocumentAst;
  hash: string;
  /** Отпечаток #include (mtime/size/буфер); пусто если expandInclude=false. */
  includeFp: string;
  summaries: ReturnType<typeof buildSummaries>;
}

const cache = new Map<string, DocumentIndex>();

function cacheKey(uri: string, expandInclude: boolean): string {
  return `${uri}#${expandInclude ? "expanded" : "source"}`;
}

/** Счётчик полных parse (для профилирования MCUHELPER_PROFILE=1). */
let parseCount = 0;

export function getDocumentParseCount(): number {
  return parseCount;
}

export function resetDocumentParseCount(): void {
  parseCount = 0;
}

/**
 * Отпечаток содержимого #include-файлов.
 * Открытый буфер → hash текста (правка SI до Save сбрасывает кэш main);
 * иначе mtime+size на диске.
 */
export function includeFilesFingerprint(
  text: string,
  baseDir: string | undefined,
  includeTextOverrides?: IncludeTextOverrides
): string {
  if (!baseDir || !textHasIncludeDirective(text)) return "";
  const parts: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseIncludeLine(line);
    if (!parsed) continue;
    const { fsPath, exists } = resolveIncludeFilePath(baseDir, parsed.path);
    const override = includeTextOverrides?.get(normalizeIncludeFsKey(fsPath));
    if (override != null) {
      const h = crypto.createHash("sha256").update(override).digest("hex").slice(0, 16);
      parts.push(`${fsPath}:buf:${h}`);
      continue;
    }
    if (!exists) {
      parts.push(`${parsed.path}:missing`);
      continue;
    }
    try {
      const st = fs.statSync(fsPath);
      parts.push(`${fsPath}:${st.size}:${st.mtimeMs}`);
    } catch {
      parts.push(`${parsed.path}:error`);
    }
  }
  return parts.join("|");
}

function buildIndex(
  uri: string,
  text: string,
  version: number,
  hash: string,
  includeFp: string,
  options?: Partial<ParseOptions>
): DocumentIndex {
  parseCount++;
  const ast = parseDocument(text, {
    uri,
    baseDir: options?.baseDir,
    expandInclude: options?.expandInclude,
    includeTextOverrides: options?.includeTextOverrides,
  });
  ast.diagnostics = analyzeSemantics(ast);
  const summaries = buildSummaries(ast);
  return { uri, version, ast, hash, includeFp, summaries };
}

export function analyzeDocument(
  uri: string,
  text: string,
  version: number,
  options?: Partial<ParseOptions>
): DocumentIndex {
  const expanded = options?.expandInclude !== false;
  const key = cacheKey(uri, expanded);
  const cached = cache.get(key);

  // Всегда сверяем hash текста: version сам по себе не гарантирует тождество
  // (тесты/повторный analyze с тем же version и другим текстом).
  // Быстрый путь без SHA-256 — в ensureDocumentIndex по Document.version.
  const includeFp = expanded
    ? includeFilesFingerprint(text, options?.baseDir, options?.includeTextOverrides)
    : "";
  const hash = crypto.createHash("sha256").update(text).update("\0").update(includeFp).digest("hex");
  if (cached && cached.hash === hash) {
    // Текст не менялся, только version — без reparse.
    if (cached.version !== version) cached.version = version;
    cached.includeFp = includeFp;
    return cached;
  }

  const index = buildIndex(uri, text, version, hash, includeFp, options);
  cache.set(key, index);
  return index;
}

export function getDocumentIndex(uri: string, expanded = true): DocumentIndex | undefined {
  return cache.get(cacheKey(uri, expanded));
}

/** Любой кэш того же uri+version (expanded или source) — чтобы не парсить дважды. */
export function getDocumentIndexForVersion(uri: string, version: number): DocumentIndex | undefined {
  for (const expanded of [true, false] as const) {
    const cached = cache.get(cacheKey(uri, expanded));
    if (cached && cached.version === version) return cached;
  }
  return undefined;
}

export function clearDocument(uri: string): void {
  cache.delete(cacheKey(uri, true));
  cache.delete(cacheKey(uri, false));
}

/**
 * Пересчёт summaries по уже разобранному AST (без reparse).
 * Нужен после загрузки AW.LIB / PARAMETE.THR: ρ и a_m зависят от глобальных таблиц,
 * а кэш индекса keyed по тексту и иначе оставляет activityBqPerG=null.
 *
 * @param uris если задан — только эти документы (оба ключа expanded/source);
 *             иначе весь кэш (тесты / полный сброс).
 */
export function rebuildCachedSummaries(uris?: ReadonlyArray<string>): number {
  let n = 0;
  if (uris == null) {
    for (const index of cache.values()) {
      index.summaries = buildSummaries(index.ast);
      n++;
    }
    return n;
  }
  const seen = new Set<string>();
  for (const uri of uris) {
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    for (const expanded of [true, false] as const) {
      const index = cache.get(cacheKey(uri, expanded));
      if (!index) continue;
      index.summaries = buildSummaries(index.ast);
      n++;
    }
  }
  return n;
}
