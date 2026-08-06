import * as crypto from "crypto";
import * as fs from "fs";
import type { DocumentAst } from "./ast";
import { parseDocument, type ParseOptions } from "./parser";
import { analyzeSemantics, buildSummaries } from "./semantic";
import { normalizeIncludeFsKey, parseIncludeLine, resolveIncludeFilePath } from "./includeResolve";
import type { IncludeTextOverrides } from "./preprocessor";

export interface DocumentIndex {
  uri: string;
  version: number;
  ast: DocumentAst;
  hash: string;
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
  if (!baseDir || !/#\s*include\b/i.test(text)) return "";
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
  return { uri, version, ast, hash, summaries };
}

export function analyzeDocument(
  uri: string,
  text: string,
  version: number,
  options?: Partial<ParseOptions>
): DocumentIndex {
  const expanded = options?.expandInclude !== false;
  const includeFp = expanded
    ? includeFilesFingerprint(text, options?.baseDir, options?.includeTextOverrides)
    : "";
  const hash = crypto.createHash("sha256").update(text).update("\0").update(includeFp).digest("hex");
  const key = cacheKey(uri, expanded);
  const cached = cache.get(key);
  if (cached && cached.version === version && cached.hash === hash) {
    return cached;
  }

  const index = buildIndex(uri, text, version, hash, options);
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
