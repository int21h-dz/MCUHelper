import type { DiagnosticMessage, DocumentAst, SourceRange, StatementNode } from "./ast";
import { buildScopedVars } from "./constantScope";
import { resolveNuclideConcentration } from "./materialDensity";
import { getCardArgSpec, MODS_VALUES } from "./schemaBridge";

const NUCLIDE_OPTIONAL_PARAMS = new Set(["ACE", "MODS", "DTEM", "PHT"]);
const DENSITY_RE = /^[\d.Ee+-]+$/;
const OPTIONAL_PARAM_KEYS = ["ACE", "MODS", "DTEM", "PHT"] as const;

const NUCLIDE_LINE_EXCLUDED_HEADS = new Set([
  "MATR", "PIN", "HEAD", "TEMPR", "FINISH", "END", "DEF", "EQU", "SET", "VOL",
  "NTOT", "MAXS", "MAXSER", "POWER", "POWE", "STEP", "DSTP", "ENERGY", "ENERG",
  "CONT", "LCELL", "ENDL", "CELL", "ENDXCL", "NET", "LATT", "LISTEL", "PARM",
  "SPH", "RCC", "ELL", "BOX", "WED", "RPP", "HEX", "HEXX", "HEXY", "RCZ",
  "UCX", "UCY", "UCZ", "PLG", "PLX", "PLY", "PLZ", "SLA", "SLB", "REC",
  "TRC", "ARB", "SBOX", "SHEX", "HEXG", "QUAD", "TRANSF", "UPOLY",
  "EMES", "EPRO", "SRCD", "SRC", "RGS", "REGD", "PTYPE", "TTYPE", "NRET", "SPNT",
  "DELN", "NEUT", "EGRC", "KEFF", "RCT", "ZRCT", "ORCT", "MRCT", "ENERG", "ENERGY",
  "ACEPT", "ACERR", "PHOT", "WPHO", "IWPHN", "EGPH", "ELEC", "EGEL", "PSIN", "PSGR",
  "MATFIL", "MATPRN", "SIPRN", "DEFPRN", "MATWGT", "MATREP",
  // Суммарный изотоп / PIN (UserGuide §8.5) — иначе `SIDEN 1` маскируется под `nuclide dens`.
  // SI намеренно не здесь: в MATR бывает нуклид кремния `SI dens` (см. isSiCardListPrefix).
  "SINOT", "SIDEN", "ICE", "CPM", "CPMEND",
]);

function isExcludedNuclideLikeLine(text: string): boolean {
  const t = text.trim();
  if (/[#()]/.test(t)) return true;
  if (/\bU\b/.test(t)) return true;
  if (/\s:\d+(\s|$)/.test(t)) return true;
  if (/\s\/\d/.test(t)) return true;
  if (/\/-\d+/.test(t)) return true;
  if (/\/\d+:/.test(t)) return true;
  if (/\/\d+(?:\/\d+)?:/.test(t)) return true;
  return false;
}

function looksLikeNuclideLine(text: string): boolean {
  const t = text.trim();
  if (isExcludedNuclideLikeLine(t)) return false;
  return /^[A-Za-z][A-Za-z0-9]{0,5}\s+\S+/.test(t);
}

function isOptionalParamTokenOrPrefix(token: string, allowBarePrefix: boolean): boolean {
  const key = token.match(/^([A-Za-z]+)=/)?.[1]?.toUpperCase();
  if (key) return NUCLIDE_OPTIONAL_PARAMS.has(key);
  if (!allowBarePrefix || !/^[A-Za-z]+$/.test(token)) return false;
  const upper = token.toUpperCase();
  return OPTIONAL_PARAM_KEYS.some((k) => k.startsWith(upper));
}

/** Плотность нуклида: число / sci / выражение; имена вроде FP1 — это list карты SI. */
function looksLikeNuclideDensToken(token: string): boolean {
  if (DENSITY_RE.test(token)) return true;
  return /^[+\-.(0-9]/.test(token);
}

/**
 * Карта SI list vs нуклид SI dens.
 * `SI FP1` / `SI ` → карта; `SI 1.1E-2` → нуклид.
 * EQU-имя как dens (SI CONC) ошибочно уйдёт в карту — редкий кейс.
 */
function isSiCardListPrefix(tokens: string[]): boolean {
  if (tokens[0]?.toUpperCase() !== "SI") return false;
  if (tokens.length === 1) return true;
  return !looksLikeNuclideDensToken(tokens[1]);
}

export function isNuclideCompositionLinePrefix(prefix: string): boolean {
  const code = prefix.replace(/;.*/, "");
  const trimmed = code.trim();
  if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("C=")) return false;
  if (isExcludedNuclideLikeLine(trimmed)) return false;

  const segment = trimmed.split("/").pop()?.trim() ?? trimmed;
  const tokens = segment.split(/\s+/).filter(Boolean);
  if (!tokens.length || !/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(tokens[0])) return false;
  const head = tokens[0].toUpperCase();
  if (NUCLIDE_LINE_EXCLUDED_HEADS.has(head)) return false;
  // Системно исключаем карты со специальными аргументами (SUMZON/CONTEN/CODE/...),
  // иначе строка вида `CARD TOKEN` ошибочно маскируется под `nuclide dens`.
  if (getCardArgSpec(head)) return false;
  if (isSiCardListPrefix(tokens)) return false;

  const endsWithSpace = /\s$/.test(code);
  if (tokens.length === 1) return endsWithSpace;
  if (/^(ACE|MODS|DTEM|PHT)=/i.test(tokens[1])) return false;
  if (tokens.length === 2) return true;

  for (let i = 2; i < tokens.length; i++) {
    const allowBarePrefix = i === tokens.length - 1 && !endsWithSpace;
    if (!isOptionalParamTokenOrPrefix(tokens[i], allowBarePrefix)) return false;
  }
  return true;
}

function isIgnorableAuxLine(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.startsWith("C=")) return true;
  if (t.startsWith("*")) return true;
  return false;
}

function tokenSubrange(text: string, range: SourceRange, token: string): SourceRange {
  const idx = text.indexOf(token);
  if (idx < 0) return range;
  return {
    start: { line: range.start.line, character: range.start.character + idx },
    end: { line: range.start.line, character: range.start.character + idx + token.length },
    offset: range.offset + idx,
    endOffset: range.offset + idx + token.length,
  };
}

function isOptionalNuclideParam(token: string): boolean {
  const m = token.match(/^([A-Za-z]+)=(\S+)$/);
  return Boolean(m && NUCLIDE_OPTIONAL_PARAMS.has(m[1].toUpperCase()));
}

function validateOptionalParamValue(key: string, value: string): string | null {
  const k = key.toUpperCase();
  if (k === "MODS") {
    if (!MODS_VALUES.includes(value.toUpperCase())) {
      return `MODS=${value}: ожидается ${MODS_VALUES.join(", ")}`;
    }
    return null;
  }
  if (k === "DTEM") {
    if (!DENSITY_RE.test(value)) {
      return `DTEM=${value}: ожидается число (допуск по температуре, K)`;
    }
    return null;
  }
  if (k === "ACE" || k === "PHT") {
    if (DENSITY_RE.test(value) || /^[\d.,]+$/.test(value)) {
      return `${k}=${value}: ожидается имя файла библиотеки, не число`;
    }
    return null;
  }
  return null;
}

function findInvalidOptionalParamsInSegment(segment: string): { token: string; message: string }[] {
  const parts = segment.trim().replace(/;.*/, "").split(/\s+/).filter(Boolean);
  if (parts.length < 2 || !DENSITY_RE.test(parts[1])) return [];

  const invalid: { token: string; message: string }[] = [];
  for (let i = 2; i < parts.length; i++) {
    const m = parts[i].match(/^([A-Za-z]+)=(\S+)$/);
    if (!m || !NUCLIDE_OPTIONAL_PARAMS.has(m[1].toUpperCase())) continue;
    const msg = validateOptionalParamValue(m[1], m[2]);
    if (msg) invalid.push({ token: parts[i], message: msg });
  }
  return invalid;
}

function findExtraTokensInSegment(segment: string): string[] {
  const parts = segment.trim().replace(/;.*/, "").split(/\s+/).filter(Boolean);
  if (parts.length < 2 || !DENSITY_RE.test(parts[1])) return [];

  const extras: string[] = [];
  for (let i = 2; i < parts.length; i++) {
    if (!isOptionalNuclideParam(parts[i])) extras.push(parts[i]);
  }
  return extras;
}

export function findNuclideLineExtraTokens(text: string): string[] {
  const body = text.trim().replace(/;.*/, "");
  const extras: string[] = [];
  for (const segment of body.split(/\//)) {
    extras.push(...findExtraTokensInSegment(segment));
  }
  return extras;
}

export function validateNuclideLineExtras(
  text: string,
  range: SourceRange,
  matNumber: number
): DiagnosticMessage | null {
  const extras = findNuclideLineExtraTokens(text);
  if (!extras.length) return null;

  const name = text.trim().match(/^([A-Za-z][A-Za-z0-9]{0,5})/)?.[1] ?? "?";
  const listed = extras.slice(0, 3).map((t) => `«${t}»`).join(", ");
  const tail = extras.length > 3 ? ` (всего ${extras.length})` : "";

  return {
    severity: "error",
    message: `MATR ${matNumber}: ${name} — лишние параметры: ${listed}${tail}`,
    code: "matr-nuclide-extra",
    range: tokenSubrange(text, range, extras[0]),
  };
}

function validateNuclideLineOptionalParams(
  text: string,
  range: SourceRange,
  matNumber: number
): DiagnosticMessage[] {
  const name = text.trim().match(/^([A-Za-z][A-Za-z0-9]{0,5})/)?.[1] ?? "?";
  const diags: DiagnosticMessage[] = [];
  for (const segment of text.trim().replace(/;.*/, "").split(/\//)) {
    for (const bad of findInvalidOptionalParamsInSegment(segment)) {
      diags.push({
        severity: "error",
        message: `MATR ${matNumber}: ${name} — ${bad.message}`,
        code: "matr-nuclide-param",
        range: tokenSubrange(text, range, bad.token),
      });
    }
  }
  return diags;
}

function collectNuclideCompositionLines(ast: DocumentAst): { stmt: StatementNode; matNumber: number }[] {
  const sorted = [...ast.statements].sort((a, b) => a.range.start.line - b.range.start.line);
  const out: { stmt: StatementNode; matNumber: number }[] = [];
  let currentMat: number | null = null;

  for (const stmt of sorted) {
    const label = (stmt.label ?? "").toUpperCase();

    if (label === "MATR") {
      const m = stmt.text.match(/^MATR\s+(\d+)/i);
      currentMat = m ? parseInt(m[1], 10) : null;
      continue;
    }

    if (currentMat === null) continue;

    if (["MATR", "END", "FINISH", "DEF", "TEMPR", "PIN"].includes(label)) {
      if (label === "END" && stmt.fragment === "physical") currentMat = null;
      else if (label !== "END") currentMat = null;
      continue;
    }

    if (isIgnorableAuxLine(stmt.text)) continue;
    if (looksLikeNuclideLine(stmt.text)) {
      out.push({ stmt, matNumber: currentMat });
    }
  }

  return out;
}

export function analyzeDuplicateNuclides(ast: DocumentAst): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  for (const mat of ast.materials) {
    const seen = new Set<string>();
    for (const n of mat.nuclides) {
      const key = n.name.toUpperCase();
      if (seen.has(key)) {
        diags.push({
          severity: "error",
          message: `MATR ${mat.number}: нуклид ${n.name} задан повторно`,
          code: "matr-nuclide-dup",
          range: n.range,
        });
      } else {
        seen.add(key);
      }
    }
  }
  return diags;
}

/**
 * Концентрации нуклидов, которые нельзя вычислить как число (литерал / EQU).
 * Код: matr-nuclide-conc — чтобы в Problems было видно, какие строки выпали из ρ.
 */
export function analyzeNuclideConcentrations(ast: DocumentAst): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  for (const mat of ast.materials) {
    const vars = buildScopedVars(ast.constants, mat.range.offset, "global");
    for (const n of mat.nuclides) {
      const trimmed = n.density.trim();
      if (!trimmed) {
        diags.push({
          severity: "warning",
          message: `MATR ${mat.number}: у нуклида ${n.name} не указана концентрация`,
          code: "matr-nuclide-conc",
          range: n.range,
        });
        continue;
      }
      if (resolveNuclideConcentration(trimmed, vars) != null) continue;
      diags.push({
        severity: "warning",
        message: `MATR ${mat.number}: концентрация ${n.name} «${trimmed}» не распознана как число`,
        code: "matr-nuclide-conc",
        range: n.range,
      });
    }
  }
  return diags;
}

export function analyzeNuclideParameterCounts(ast: DocumentAst): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  for (const { stmt, matNumber } of collectNuclideCompositionLines(ast)) {
    const extra = validateNuclideLineExtras(stmt.text, stmt.range, matNumber);
    if (extra) diags.push(extra);
    diags.push(...validateNuclideLineOptionalParams(stmt.text, stmt.range, matNumber));
  }
  diags.push(...analyzeDuplicateNuclides(ast));
  diags.push(...analyzeNuclideConcentrations(ast));
  return diags;
}

export { OPTIONAL_PARAM_KEYS };
