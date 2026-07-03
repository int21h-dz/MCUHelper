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
  const cached = cache.get(uri);
  if (cached && cached.version === version && cached.hash === hash) {
    return cached;
  }

  const index = buildIndex(uri, text, version, hash, options);
  cache.set(uri, index);
  return index;
}

export function getDocumentIndex(uri: string): DocumentIndex | undefined {
  return cache.get(uri);
}

export function clearDocument(uri: string): void {
  cache.delete(uri);
}
