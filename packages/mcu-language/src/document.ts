import * as crypto from "crypto";
import type { DocumentAst } from "./ast";
import { parseDocument, type ParseOptions } from "./parser";
import { analyzeSemantics, buildSummaries } from "./semantic";

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

function buildIndex(
  uri: string,
  text: string,
  version: number,
  hash: string,
  options?: Partial<ParseOptions>
): DocumentIndex {
  parseCount++;
  const ast = parseDocument(text, { uri, baseDir: options?.baseDir, expandInclude: options?.expandInclude });
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
  const hash = crypto.createHash("sha256").update(text).digest("hex");
  const expanded = options?.expandInclude !== false;
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

export function clearDocument(uri: string): void {
  cache.delete(cacheKey(uri, true));
  cache.delete(cacheKey(uri, false));
}
