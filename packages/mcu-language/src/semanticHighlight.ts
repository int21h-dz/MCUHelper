import type { DocumentAst } from "./ast";
import { lexDocument, type Token } from "./lexer";
import { isKnownMcuLabel } from "./schemaBridge";
import { looksLikeZoneStatement } from "./zoneStatement";

export type SemanticHighlightKind = "card" | "body" | "zone" | "nuclide" | "number" | "comment";

export interface SemanticTokenSpan {
  line: number;
  char: number;
  length: number;
  kind: SemanticHighlightKind;
}

const BODY_KEYS = new Set([
  "SPH", "RCC", "ELL", "BOX", "WED", "RPP", "HEX", "HEXX", "HEXY", "RCZ",
  "UCX", "UCY", "UCZ", "PLG", "PLX", "PLY", "PLZ", "SLA", "SLB", "REC",
  "TRC", "ARB", "SBOX", "SHEX", "HEXG", "QUAD", "TRANSF", "UPOLY",
]);

const PIN_ISOTOPE_CARDS = new Set(["SI", "ICE", "CPM", "NEUT", "DELN", "EGRC"]);

function isExcludedNuclideLikeLine(text: string): boolean {
  const t = text.trim();
  if (/\/|#|\(|\)/.test(t)) return true;
  if (/\bU\b/.test(t)) return true;
  if (/\s:\d+(\s|$)/.test(t)) return true;
  if (/\s\/\d/.test(t)) return true;
  return false;
}

function looksLikeNuclideLine(text: string): boolean {
  const t = text.trim();
  if (!t || isExcludedNuclideLikeLine(t)) return false;
  return /^[A-Za-z][A-Za-z0-9]{0,5}\s+\S+/.test(t);
}

function isMaterialNuclideLine(text: string): boolean {
  if (!looksLikeNuclideLine(text)) return false;
  if (isPinIsotopeListLine(text)) return false;
  const parts = text.trim().split(/\s+/);
  const label = parts[0].toUpperCase();
  const second = parts[1] ?? "";
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?$/.test(second)) return false;
  // PTYPE 1, ORCT 0 — карты регистрации, не нуклиды
  if (isKnownMcuLabel(label) && !/[.Ee]/.test(second)) return false;
  return true;
}

function isPinIsotopeListLine(text: string): boolean {
  if (!looksLikeNuclideLine(text)) return false;
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return false;
  return PIN_ISOTOPE_CARDS.has(parts[0].toUpperCase()) && /^[A-Za-z]+\d+$/.test(parts[1]);
}

function classifyLineStart(text: string, fragment: string | null): SemanticHighlightKind | null {
  const label = text.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (!label) return null;

  if (BODY_KEYS.has(label)) return "body";

  if (fragment === "geometry" && looksLikeZoneStatement(text)) return "zone";

  if (isMaterialNuclideLine(text)) return "nuclide";

  if (isPinIsotopeListLine(text)) return "card";

  if (isKnownMcuLabel(label) && !(fragment === "geometry" && looksLikeZoneStatement(text))) {
    return "card";
  }

  if (/^[A-Za-z]/.test(label)) return "zone";
  return null;
}

function pushToken(spans: SemanticTokenSpan[], token: Token, kind: SemanticHighlightKind): void {
  spans.push({
    line: token.line,
    char: token.column,
    length: token.value.length,
    kind,
  });
}

function lexerKind(token: Token): SemanticHighlightKind | null {
  switch (token.type) {
    case "number":
      return "number";
    case "comment":
      return "comment";
    default:
      return null;
  }
}

/** Контекстная подсветка: карта / зона / тело / нуклид (поверх TextMate). */
export function buildSemanticTokenSpans(ast: DocumentAst, text: string): SemanticTokenSpan[] {
  const { lines } = lexDocument(text);
  const spans: SemanticTokenSpan[] = [];

  const zoneLine = new Map<number, string>();
  for (const z of ast.zones) zoneLine.set(z.range.start.line, z.name.toUpperCase());

  const bodyLine = new Map<number, string>();
  for (const b of ast.bodies) bodyLine.set(b.range.start.line, b.bodyType.toUpperCase());

  const nuclideLines = new Set<number>();
  for (const m of ast.materials) {
    for (const n of m.nuclides) nuclideLines.add(n.range.start.line);
  }

  const stmtFragment = new Map<number, string | null>();
  for (const s of ast.statements) {
    for (let ln = s.range.start.line; ln <= s.range.end.line; ln++) {
      if (!stmtFragment.has(ln)) stmtFragment.set(ln, s.fragment ?? null);
    }
  }

  for (const line of lines) {
    const fragment = stmtFragment.get(line.lineNo) ?? null;
    const trimmed = line.text.trim();
    const startKind =
      !line.isContinuation && trimmed
        ? zoneLine.has(line.lineNo)
          ? "zone"
          : bodyLine.has(line.lineNo)
            ? "body"
            : nuclideLines.has(line.lineNo) || isMaterialNuclideLine(trimmed)
              ? "nuclide"
              : classifyLineStart(trimmed, fragment)
        : null;

    let firstWordDone = line.isContinuation;

    for (const token of line.tokens) {
      const lk = lexerKind(token);
      if (lk === "comment" || lk === "number") {
        pushToken(spans, token, lk);
        continue;
      }

      if (!firstWordDone && (token.type === "card" || token.type === "label" || token.type === "identifier")) {
        firstWordDone = true;
        const kind = startKind;
        if (kind) {
          pushToken(spans, token, kind);
          continue;
        }
      }

      if (nuclideLines.has(line.lineNo) && token.type === "identifier") {
        const nuclideRe = /^[A-Za-z][A-Za-z0-9]{0,5}$/;
        if (nuclideRe.test(token.value) && !isKnownMcuLabel(token.value)) {
          pushToken(spans, token, "nuclide");
          continue;
        }
      }

      if (isPinIsotopeListLine(trimmed) && token.type === "identifier" && /^[A-Za-z]+\d+$/.test(token.value)) {
        pushToken(spans, token, "zone");
        continue;
      }
    }
  }

  return spans;
}

export const SEMANTIC_TOKEN_LEGEND: SemanticHighlightKind[] = [
  "card",
  "body",
  "zone",
  "nuclide",
  "number",
  "comment",
];

export function semanticKindToIndex(kind: SemanticHighlightKind): number {
  return SEMANTIC_TOKEN_LEGEND.indexOf(kind);
}
