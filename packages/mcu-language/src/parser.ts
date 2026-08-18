import type { FragmentId } from "./ast";
import { FRAGMENT_ORDER } from "./constants";
import type {
  BodyNode,
  CameraPreset,
  CellPrototypeNode,
  ConstantNode,
  DiagnosticMessage,
  DocumentAst,
  FragmentSpan,
  IncludeNode,
  IncludeLineMapEntry,
  LatticeElementNode,
  LatticeNode,
  MaterialNode,
  NetNode,
  NuclideEntry,
  SourceRange,
  StatementNode,
  ZoneNode,
  ZoneTailHash,
  ZoneTailLegacy,
} from "./ast";
import { lexDocument, type LineInfo } from "./lexer";
import { mergeTrailingMultiplyOperands } from "./expression";
import { expandCartogramTokens } from "./netCartogram";
import { collectIncludesFromSource, resolveIncludeFilePath, resolveIncludeFileUri } from "./includeResolve";
import { expandIncludes, expandRepeats } from "./preprocessor";
import { applyGeometryScopeTransition, initialGeometryScopeState } from "./geometryScope";
import { isG2mpCartogramRow, latticeTypeUsesCartogram, looksLikeZoneOverridingFragment, looksLikeZoneStatement } from "./zoneStatement";
import {
  detectFragmentFromLabel,
  FRAGMENT_DISPLAY,
  fragmentsForLabel,
  isKnownMcuLabel,
  labelAllowedInFragment,
  isGeoBodyLabel,
  GEO_BODY_KEYS,
} from "./schemaBridge";

const BODY_KEYS = GEO_BODY_KEYS;

/**
 * dens: число, имя EQU/SET или выражение без пробелов (`2*DENSU`).
 * Не захватывает `/` — разделитель нескольких нуклидов на строке (`U235 1 /U238 2`).
 */
const NUCLIDE_DENS_TOKEN = String.raw`[^\s/]+`;

function rangeFromLine(line: LineInfo, startCol = 0, endCol?: number): SourceRange {
  const end = endCol ?? line.text.length;
  return {
    start: { line: line.lineNo, character: startCol },
    end: { line: line.lineNo, character: end },
    offset: line.offset + startCol,
    endOffset: line.offset + end,
  };
}

function mergeStatementLines(lines: LineInfo[], start: number): { text: string; end: number; range: SourceRange } {
  let text = lines[start].text.trim();
  let end = start;
  while (end + 1 < lines.length && lines[end + 1].isContinuation) {
    end++;
    text += " " + lines[end].text.trim();
  }
  const semi = text.indexOf(";");
  if (semi >= 0) text = text.slice(0, semi);
  return {
    text,
    end,
    range: {
      start: { line: lines[start].lineNo, character: 0 },
      end: { line: lines[end].lineNo, character: lines[end].text.length },
      offset: lines[start].offset,
      endOffset: lines[end].offset + lines[end].text.length,
    },
  };
}

function detectFragment(label: string, current: FragmentId | null, stmtText: string): FragmentId | null {
  const next = detectFragmentFromLabel(label, current);
  // Зона с именем-картой (GRBL … /1:2) остаётся в geometry; NPS 1 / PROB 1 — карты источника.
  if (
    current === "geometry" &&
    next !== "geometry" &&
    next !== null &&
    looksLikeZoneOverridingFragment(stmtText)
  ) {
    return "geometry";
  }
  return next;
}

function parseZoneTail(text: string): ZoneTailLegacy | ZoneTailHash | null {
  const hashIdx = text.indexOf("#");
  if (hashIdx >= 0) {
    const tail: ZoneTailHash = { kind: "hash" };
    const part = text.slice(hashIdx + 1);
    const re = /([MmZzOo]|IM|im|IZ|iz|IO|io|G|g)\s*=\s*(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(part))) {
      const k = m[1].toLowerCase();
      const v = m[2];
      if (k === "m") tail.m = parseInt(v, 10);
      else if (k === "z") tail.z = parseInt(v, 10);
      else if (k === "o") tail.o = parseInt(v, 10);
      else if (k === "im") tail.im = parseInt(v, 10);
      else if (k === "iz") tail.iz = parseInt(v, 10);
      else if (k === "io") tail.io = parseInt(v, 10);
      else if (k === "g") tail.g = v;
    }
    return tail;
  }

  const slashRegMat = text.match(/\/(\d+):(\d+)(?:\/(\d+))?/);
  if (slashRegMat) {
    return {
      kind: "legacy",
      reg: parseInt(slashRegMat[1], 10),
      mat: parseInt(slashRegMat[2], 10),
      obj: slashRegMat[3] ? parseInt(slashRegMat[3], 10) : undefined,
    };
  }

  const slashColonMat = text.match(/\/:(\d+)(?:\/(\d+))?/);
  if (slashColonMat) {
    return {
      kind: "legacy",
      mat: parseInt(slashColonMat[1], 10),
      obj: slashColonMat[2] ? parseInt(slashColonMat[2], 10) : undefined,
      defaultRegObj: true,
    };
  }

  const bc = text.match(/\/([BWMCR]\d*)/);
  if (bc) {
    return { kind: "legacy", bcType: bc[1] };
  }

  const slashRegOnly = text.match(/\/(\d+)(?:\/(\d+))?(?!\s*:)/);
  if (slashRegOnly) {
    return {
      kind: "legacy",
      reg: parseInt(slashRegOnly[1], 10),
      obj: slashRegOnly[2] ? parseInt(slashRegOnly[2], 10) : undefined,
      inheritMat: true,
    };
  }

  const colonOnly = text.match(/:(\d+)/);
  if (colonOnly) {
    return {
      kind: "legacy",
      mat: parseInt(colonOnly[1], 10),
      defaultRegObj: true,
    };
  }
  return null;
}

function parseMaterial(stmt: string, range: SourceRange): MaterialNode | null {
  const m = stmt.match(/^MATR\s+(\d+)(.*)/i);
  if (!m) return null;
  const number = parseInt(m[1], 10);
  const rest = m[2];
  const tempM = rest.match(/T\s*=\s*([\d.Ee+-]+)/i);
  const groupM = rest.match(/GROUP\s*=\s*(\S+)/i);
  const nameM = rest.match(/NAME\s*=\s*(\S+)/i);
  const densM = rest.match(/(DENSAA|DENSWA|DENSAW|DENSWW)\s*=\s*([\d.Ee+-]+)/i);

  const nuclides: NuclideEntry[] = [];
  const nuclideRe = new RegExp(`\\/?([A-Za-z][A-Za-z0-9]{0,5})\\s+(${NUCLIDE_DENS_TOKEN})`, "g");
  let nm: RegExpExecArray | null;
  const body = stmt.replace(/^MATR\s+\d+[^\n]*/i, "");
  while ((nm = nuclideRe.exec(body))) {
    if (
      ["MODS", "ACE", "DTEM", "PHT", "T", "GROUP", "NAME", "DENSAA", "DENSWA", "DENSAW", "DENSWW", "BUR", "VOL"].some(
        (x) => nm![1].toUpperCase().startsWith(x)
      )
    ) {
      continue;
    }
    const mods = body.match(new RegExp(nm[1] + `\\s+${NUCLIDE_DENS_TOKEN}\\s+MODS=(\\S+)`, "i"));
    nuclides.push({
      name: nm[1],
      density: nm[2],
      mods: mods?.[1],
      range,
    });
  }

  return {
    kind: "material",
    number,
    label: "MATR",
    temperature: tempM ? parseFloat(tempM[1]) : undefined,
    group: groupM?.[1],
    nameLib: nameM?.[1],
    densParam: densM?.[1],
    densValue: densM ? parseFloat(densM[2]) : undefined,
    nuclides,
    range,
  };
}

function normalizeTransfModeToken(raw: string): string {
  const u = raw.trim().toUpperCase();
  return u === "M" || u === "R" ? u : raw.trim();
}

function transfBody(
  name: string,
  protoName: string | undefined,
  modeTok: string | undefined,
  rest: string[],
  range: SourceRange
): BodyNode {
  return {
    kind: "body",
    bodyType: "TRANSF",
    name,
    params: mergeTrailingMultiplyOperands(rest),
    range,
    transf: true,
    protoName,
    transfMode: modeTok ? normalizeTransfModeToken(modeTok) : undefined,
  };
}

function parseBody(stmt: string, range: SourceRange): BodyNode | null {
  const transf = stmt.match(/^TRANSF\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/i);
  if (transf) {
    const rest = transf[4] ? transf[4].split(/[\s,]+/).filter(Boolean) : [];
    return transfBody(transf[1]!, transf[2], transf[3], rest, range);
  }

  const parts = stmt.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const typeKey = parts[1].toUpperCase();
  if (!BODY_KEYS.has(typeKey) && !BODY_KEYS.has(parts[0].toUpperCase())) return null;

  let bodyType: string;
  let name: string;
  let paramsStart: number;

  if (BODY_KEYS.has(typeKey)) {
    bodyType = typeKey;
    name = parts[0] === typeKey ? "*" : parts[0];
    paramsStart = 2;
    if (parts[0].toUpperCase() === typeKey) {
      name = "*";
      paramsStart = 1;
    }
  } else {
    bodyType = parts[0].toUpperCase();
    name = parts[1];
    paramsStart = 2;
  }

  const params = mergeTrailingMultiplyOperands(
    parts.slice(paramsStart).join(" ").split(/[\s,]+/).filter(Boolean)
  );
  if (bodyType === "TRANSF") {
    return transfBody(name, params[0], params[1], params.slice(2), range);
  }
  return { kind: "body", bodyType, name, params, range };
}

function parseZone(stmt: string, range: SourceRange): ZoneNode | null {
  const parts = stmt.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const name = parts[0];
  if (!/^[A-Za-z]/.test(name)) return null;

  let netCarrier: string | undefined;
  let idx = 1;
  const netM = stmt.match(/\((\w+)\)/);
  if (netM) netCarrier = netM[1];

  let searchType: string | undefined;
  if (parts[idx] === "T") {
    searchType = "T";
    idx++;
  } else if (parts[idx]?.startsWith("/")) {
    searchType = parts[idx];
    idx++;
  }

  const tailIdx = stmt.search(/(?:#|\/-\d+:|\/\d+:|\/\d+(?:\/\d+)?:|\/[BWMCR]\d|(?<![A-Za-z0-9]):\d+)/);
  const exprEnd = tailIdx >= 0 ? tailIdx : stmt.length;
  let expression = stmt.slice(stmt.indexOf(name) + name.length, exprEnd).trim();
  if (netCarrier) {
    const netParen = `(${netCarrier})`;
    if (expression.startsWith(netParen)) {
      expression = expression.slice(netParen.length).trim();
    }
  }

  return {
    kind: "zone",
    name,
    expression,
    searchType,
    netCarrier,
    tail: parseZoneTail(stmt),
    range,
  };
}

const NUCLIDE_INLINE_KEYWORDS = new Set(["MODS", "ACE", "DTEM", "PHT"]);

/** Не путать строку состава с зоной (R001 4 :1, /reg:mat). Слеш `/U235` — разделитель нуклидов на одной строке. */
function isExcludedNuclideLikeLine(text: string): boolean {
  const t = text.trim();
  if (/[#()]/.test(t)) return true;
  // Союз «U» в выражении зоны (`A 1 U 2`), но НЕ природный уран `U dens`.
  if (/\bU\b/.test(t) && !/^[Uu]\s+\S+/.test(t)) return true;
  if (/\s:\d+(\s|$)/.test(t)) return true;
  if (/\s\/\d/.test(t)) return true;
  if (/\/-\d+/.test(t)) return true;
  if (/\/\d+:/.test(t)) return true;
  if (/\/\d+(?:\/\d+)?:/.test(t)) return true;
  return false;
}

/**
 * Строка состава MATR: U235 1.10E-03 | ZR CZR | U238 owl.… (опечатка → matr-nuclide-conc).
 * ⚠ АГЕНТАМ: `SI dens` (`SI 0.00055`) — нуклид кремния, НЕ карта SI list (siCardVsNuclide.ts).
 */
function isNuclideLine(text: string): boolean {
  const t = text.trim();
  if (isExcludedNuclideLikeLine(t)) return false;
  return new RegExp(`^[A-Za-z][A-Za-z0-9]{0,5}\\s+${NUCLIDE_DENS_TOKEN}`).test(t);
}

/** Похожа на нуклид (имя + dens-токен). */
function looksLikeNuclideLine(text: string): boolean {
  const t = text.trim();
  if (!t || isExcludedNuclideLikeLine(t)) return false;
  return isNuclideLine(t);
}

function parseNuclidesFromLine(
  text: string,
  range: SourceRange
): { nuclides: NuclideEntry[]; diagnostic?: DiagnosticMessage } {
  const nuclides: NuclideEntry[] = [];
  if (!isNuclideLine(text)) {
    return { nuclides };
  }

  // Опциональный `/` перед именем — разделитель на одной строке
  const nuclideRe = new RegExp(`\\/?([A-Za-z][A-Za-z0-9]{0,5})\\s+(${NUCLIDE_DENS_TOKEN})`, "g");
  let nm: RegExpExecArray | null;
  while ((nm = nuclideRe.exec(text))) {
    if (NUCLIDE_INLINE_KEYWORDS.has(nm[1].toUpperCase())) continue;
    const mods = text.match(
      new RegExp(nm[1] + `\\s+${NUCLIDE_DENS_TOKEN}\\s+MODS=(\\S+)`, "i")
    );
    nuclides.push({ name: nm[1], density: nm[2], mods: mods?.[1], range });
  }
  return { nuclides };
}

/** Служебная/комментарная строка (MATR ** dens…, **EQU черновики, C=, *). */
function isIgnorableAuxLine(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.startsWith("C=")) return true;
  if (t.startsWith("*")) return true;
  return false;
}

function parseCameraPreset(line: string, lineNo: number): CameraPreset | null {
  const m = line.match(
    /\*\s*interesting\s+section\s+left\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+right\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+dir\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i
  );
  if (!m) return null;
  return {
    name: `section L${lineNo}`,
    left: [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])],
    right: [parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6])],
    dir: [parseFloat(m[7]), parseFloat(m[8]), parseFloat(m[9])],
    line: lineNo,
  };
}

export interface ParseOptions {
  uri: string;
  baseDir?: string;
  expandInclude?: boolean;
  /** Открытые буферы include: normalizeIncludeFsKey(fsPath) → текст. */
  includeTextOverrides?: import("./preprocessor").IncludeTextOverrides;
}

/** `#include` из исходного текста — до expandIncludes, чтобы LSP сохранил ссылки на строки редактора. */
function includeNodesFromSource(text: string, baseDir?: string): IncludeNode[] {
  const lines = text.split(/\r?\n/);
  const lineStarts: number[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts[i] = offset;
    offset += lines[i]!.length + 1;
  }
  return collectIncludesFromSource(text).map((span) => {
    const startOffset = lineStarts[span.line]! + span.pathStart;
    const len = span.pathEnd - span.pathStart;
    const resolved = baseDir ? resolveIncludeFilePath(baseDir, span.path) : undefined;
    return {
      kind: "include" as const,
      path: span.path,
      fsPath: resolved?.fsPath,
      uri: baseDir ? resolveIncludeFileUri(baseDir, span.path) : undefined,
      exists: resolved?.exists,
      range: {
        start: { line: span.line, character: span.pathStart },
        end: { line: span.line, character: span.pathEnd },
        offset: startOffset,
        endOffset: startOffset + len,
      },
    };
  });
}

export function parseDocument(text: string, options: ParseOptions): DocumentAst {
  const includes = includeNodesFromSource(text, options.baseDir);
  let sourceText = expandRepeats(text);
  const diagnostics: DiagnosticMessage[] = [];
  let includeLineMap: IncludeLineMapEntry[] | undefined;
  const originalLines = text.split(/\r?\n/);

  if (options.expandInclude !== false && options.baseDir) {
    const expanded = expandIncludes(sourceText, options.baseDir, options.includeTextOverrides);
    sourceText = expanded.text;
    includeLineMap = expanded.lineMap;
    for (const err of expanded.errors) {
      const lineNo = Math.max(0, Math.min(err.mainLine, originalLines.length - 1));
      const lineText = originalLines[lineNo] ?? "";
      diagnostics.push({
        severity: "error",
        message: err.message,
        code: "include",
        range: {
          start: { line: lineNo, character: 0 },
          end: { line: lineNo, character: lineText.length },
          offset: 0,
          endOffset: 0,
        },
      });
    }
  }

  const { lines, diagnostics: lexDiag } = lexDocument(sourceText);
  diagnostics.push(...lexDiag);

  const statements: StatementNode[] = [];
  const materials: MaterialNode[] = [];
  const bodies: BodyNode[] = [];
  const zones: ZoneNode[] = [];
  const constants: ConstantNode[] = [];
  const cells: CellPrototypeNode[] = [];
  const nets: NetNode[] = [];
  const latticeElements: LatticeElementNode[] = [];
  const lattices: LatticeNode[] = [];
  const cameraPresets: CameraPreset[] = [];

  let currentFragment: FragmentId | null = null;
  const fragmentStarts: { id: FragmentId; line: number }[] = [];
  let finishCount = 0;
  let finishedAll = false;
  const scopeState = initialGeometryScopeState();
  let currentScope = scopeState.scope;
  let inMaterialBlock = false;
  let inG2mpCartogram = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const cam = parseCameraPreset(line.text, line.lineNo);
    if (cam) cameraPresets.push(cam);

    if (line.tokens.some((t) => t.type === "include")) {
      i++;
      continue;
    }

    if (line.tokens.length === 0 || line.tokens[0].type === "comment") {
      i++;
      continue;
    }

    if (line.isContinuation) {
      i++;
      continue;
    }

    const stmt = mergeStatementLines(lines, i);
    if (finishedAll) {
      i = stmt.end + 1;
      continue;
    }
    const label = stmt.text.split(/\s+/)[0]?.toUpperCase() ?? "";
    const prevFragment: FragmentId | null = currentFragment;
    currentFragment = detectFragment(label, currentFragment, stmt.text);

    if (currentFragment && currentFragment !== prevFragment) {
      if (!fragmentStarts.find((f) => f.id === currentFragment)) {
        fragmentStarts.push({ id: currentFragment!, line: line.lineNo });
      }
    }

    if (label) {
      statements.push({
        kind: "statement",
        label,
        text: stmt.text,
        range: stmt.range,
        fragment: currentFragment ?? "physical",
      });

      const frag = currentFragment ?? "physical";
      // В geometry имена зон часто совпадают с картами регистрации (GROU, CROD, GZAZI…).
      const zoneHomonym =
        frag === "geometry" && looksLikeZoneStatement(stmt.text);
      // ⚠ АГЕНТАМ: `SI dens` — кремний в MATR, не карта SI (siCardVsNuclide.ts).
      const siSiliconHomonym =
        label === "SI" && looksLikeNuclideLine(stmt.text);
      if (
        isKnownMcuLabel(label) &&
        !labelAllowedInFragment(label, frag) &&
        !zoneHomonym &&
        !siSiliconHomonym
      ) {
        const allowedFrags = fragmentsForLabel(label);
        const allowedNames = allowedFrags
          .map((f) => FRAGMENT_DISPLAY[f as keyof typeof FRAGMENT_DISPLAY] ?? f)
          .join(", ");
        const lineFrag = FRAGMENT_DISPLAY[frag as keyof typeof FRAGMENT_DISPLAY] ?? frag;
        diagnostics.push({
          severity: "error",
          message: `Карта ${label} недопустима во «${lineFrag}»${allowedNames ? ` (допустима: ${allowedNames})` : ""}`,
          code: "card-wrong-fragment",
          range: stmt.range,
        });
      }
    }

    if (label === "FINISH") {
      finishCount++;
      inG2mpCartogram = false;
      if (currentFragment === "physical") inMaterialBlock = false;
      if (/\bALL\b/i.test(stmt.text)) finishedAll = true;
    }

    if (label === "EQU" || label === "SET") {
      const em = stmt.text.match(/^(EQU|SET)\s+(\w+)\s*=\s*(.+)/i);
      if (em) {
        constants.push({
          kind: "constant",
          name: em[2],
          expression: em[3],
          mutable: em[1].toUpperCase() === "SET",
          scope: currentScope,
          range: stmt.range,
        });
      }
    }

    if (label === "MATR") {
      inMaterialBlock = true;
      const mat = parseMaterial(stmt.text, stmt.range);
      if (mat) {
        /** Continuation-строки MATR склеиваются в один stmt без `\n` — range иначе у всех = заголовок, серое SI не находит имя. */
        const fromLines: NuclideEntry[] = [];
        for (let k = i; k <= stmt.end; k++) {
          const line = lines[k]!;
          const raw = k === i ? line.text.replace(/^\s*MATR\s+\d+/i, "") : line.text;
          if (isIgnorableAuxLine(raw)) continue;
          if (!looksLikeNuclideLine(raw)) continue;
          const parsed = parseNuclidesFromLine(raw, rangeFromLine(line));
          if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
          fromLines.push(...parsed.nuclides);
        }
        if (fromLines.length) mat.nuclides = fromLines;
        let j = stmt.end + 1;
        while (j < lines.length) {
          const nextStmt = mergeStatementLines(lines, j);
          const nl = nextStmt.text.split(/\s+/)[0]?.toUpperCase() ?? "";
          if (["MATR", "END", "FINISH", "DEF", "TEMPR", "PIN"].includes(nl)) break;
          if (isIgnorableAuxLine(nextStmt.text)) {
            j = nextStmt.end + 1;
            continue;
          }
          if (looksLikeNuclideLine(nextStmt.text)) {
            const parsed = parseNuclidesFromLine(nextStmt.text, nextStmt.range);
            if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
            mat.nuclides.push(...parsed.nuclides);
            j = nextStmt.end + 1;
          } else break;
        }
        materials.push(mat);
      }
    }

    if (label === "LCELL" || label === "ENDL" || label === "CELL" || label === "ENDXCL" || label === "END") {
      applyGeometryScopeTransition(scopeState, label, stmt.text);
      currentScope = scopeState.scope;
    }
    if (label === "END" && inMaterialBlock && currentFragment === "physical") {
      inMaterialBlock = false;
    }

    const isBodyStmt =
      BODY_KEYS.has(label) || stmt.text.match(/^TRANSF/i) || BODY_KEYS.has(stmt.text.split(/\s+/)[1]?.toUpperCase() ?? "");
    if (isBodyStmt) {
      const body = parseBody(stmt.text, stmt.range);
      if (body) {
        body.scope = currentScope;
        bodies.push(body);
      }
    }

    if (label === "CELL") {
      const cm = stmt.text.match(/^CELL\s+(\w+)(?:\s+EXTEND)?/i);
      if (cm) {
        cells.push({
          kind: "cell",
          name: cm[1],
          extend: /EXTEND/i.test(stmt.text),
          bodies: [],
          zones: [],
          lattices: [],
          range: stmt.range,
        });
      }
    }

    if (label === "NET") {
      const nm = stmt.text.match(/^NET\s+(\w+)\s+([-\d.,\s]+)\s+(\d+)\s+(\d+)(?:\s+(\d+))?/i);
      if (nm) {
        nets.push({
          kind: "net",
          name: nm[1],
          root: nm[2].trim(),
          cols: parseInt(nm[3], 10),
          rows: parseInt(nm[4], 10),
          layers: nm[5] ? parseInt(nm[5], 10) : undefined,
          typeMap: [],
          range: stmt.range,
        });
      }
    }

    if (label === "LCELL") {
      const lm = stmt.text.match(/^LCELL\s+(\w+)/i);
      if (lm) {
        latticeElements.push({
          kind: "lcell",
          name: lm[1],
          bodies: [],
          zones: [],
          nets: [],
          range: stmt.range,
        });
      }
    }

    if (label === "LATT") {
      inG2mpCartogram = false;
      const latticeType = stmt.text.split(/\s+/)[1] ?? "GLTL";
      const zonePart = stmt.text.replace(/^LATT\s+\S+\s*/i, "").trim();
      const zoneNames = zonePart
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && /^[A-Za-z]/.test(s));
      lattices.push({
        kind: "lattice",
        latticeType,
        zoneName: zoneNames[0] ?? "",
        zoneNames,
        elements: [],
        positions: [],
        range: stmt.range,
      });
    }

    if (label === "LISTEL" && lattices.length > 0) {
      const raw = stmt.text.replace(/^LISTEL\s*/i, "").trim();
      const names = raw
        .split(/\s+/)
        .map((s) => {
          const m = s.match(/^([A-Za-z][A-Za-z0-9]{0,5})/);
          return m ? m[1] : "";
        })
        .filter(Boolean);
      const last = lattices[lattices.length - 1]!;
      last.elements.push(...names);
    }

    if (label === "PARM" && lattices.length > 0) {
      const raw = stmt.text.replace(/^PARM\s*/i, "").trim();
      const last = lattices[lattices.length - 1]!;
      if (raw) last.positions.push(raw);
      if (latticeTypeUsesCartogram(last.latticeType)) inG2mpCartogram = true;
    }

    if (inG2mpCartogram && isG2mpCartogramRow(label) && lattices.length > 0) {
      const vals = stmt.text.split(/\s+/).slice(1);
      const last = lattices[lattices.length - 1]!;
      if (!last.typeMap) last.typeMap = [];
      last.typeMap.push(vals);
    }

    if (
      inG2mpCartogram &&
      label &&
      !isG2mpCartogramRow(label) &&
      !isIgnorableAuxLine(stmt.text) &&
      !["PARM", "LISTEL", "LATT", "LFIXSO", "LBLACK"].includes(label)
    ) {
      inG2mpCartogram = false;
    }

    const skipAsZone =
      label === "EQU" ||
      label === "SET" ||
      label === "PARM" ||
      label === "LISTEL" ||
      label === "LATT" ||
      label === "LFIXSO" ||
      label === "LBLACK" ||
      ((inMaterialBlock || currentFragment === "physical") && looksLikeNuclideLine(stmt.text)) ||
      currentFragment !== "geometry" ||
      (isKnownMcuLabel(label) && !looksLikeZoneStatement(stmt.text)) ||
      /^T\d+/i.test(label) ||
      /^P\d+/i.test(label) ||
      /^O\d+/i.test(label) ||
      /^M\d+/i.test(label) ||
      /^E-?\d+/i.test(label) ||
      /^I-?\d+/i.test(label) ||
      /^F-?\d+/i.test(label) ||
      (inG2mpCartogram && isG2mpCartogramRow(label));
    const isZoneStmt = !BODY_KEYS.has(label) && /^[A-Za-z]/.test(label) && !skipAsZone;
    if (isZoneStmt) {
      const zone = parseZone(stmt.text, stmt.range);
      if (zone && zone.expression.length > 0) {
        zone.scope = currentScope;
        zones.push(zone);
      }
    }

    // NET cartograms T01, P0101, O0101, M0156
    if (/^T\d+/i.test(label) && nets.length > 0) {
      const vals = stmt.text.split(/\s+/).slice(1);
      nets[nets.length - 1].typeMap.push(vals);
    }
    if (/^P\d+/i.test(label) && nets.length > 0) {
      const vals = expandCartogramTokens(stmt.text.split(/\s+/).slice(1));
      if (!nets[nets.length - 1].regMaps) nets[nets.length - 1].regMaps = [];
      nets[nets.length - 1].regMaps!.push([vals]);
    }
    if (/^O\d+/i.test(label) && nets.length > 0) {
      const vals = expandCartogramTokens(stmt.text.split(/\s+/).slice(1));
      if (!nets[nets.length - 1].objMaps) nets[nets.length - 1].objMaps = [];
      nets[nets.length - 1].objMaps!.push([vals]);
    }
    if (/^M\d+/i.test(label) && nets.length > 0) {
      const vals = expandCartogramTokens(stmt.text.split(/\s+/).slice(1));
      if (!nets[nets.length - 1].matMaps) nets[nets.length - 1].matMaps = [];
      nets[nets.length - 1].matMaps!.push([vals]);
    }

    const isKnownSpecialLine =
      isKnownMcuLabel(label) ||
      isBodyStmt ||
      isZoneStmt ||
      isIgnorableAuxLine(stmt.text) ||
      ((inMaterialBlock || currentFragment === "physical") && looksLikeNuclideLine(stmt.text)) ||
      /^T\d+/i.test(label) ||
      /^P\d+/i.test(label) ||
      /^O\d+/i.test(label) ||
      /^M\d+/i.test(label) ||
      /^E-?\d+/i.test(label) ||
      /^I-?\d+/i.test(label) ||
      /^F-?\d+/i.test(label) ||
      (inG2mpCartogram && isG2mpCartogramRow(label));
    if (label && !isKnownSpecialLine) {
      diagnostics.push({
        severity: "error",
        message: `Неизвестная строка: ${stmt.text}`,
        code: "unknown-statement",
        range: stmt.range,
      });
    }

    i = stmt.end + 1;
  }

  // Fragment order validation
  const fragments: FragmentSpan[] = [];
  for (let fi = 0; fi < fragmentStarts.length; fi++) {
    const start = fragmentStarts[fi];
    const endLine = fi + 1 < fragmentStarts.length ? fragmentStarts[fi + 1].line - 1 : lines.length - 1;
    fragments.push({ id: start.id, startLine: start.line, endLine });
    const expectedIdx = FRAGMENT_ORDER.indexOf(start.id);
    if (fi > 0) {
      const prevIdx = FRAGMENT_ORDER.indexOf(fragmentStarts[fi - 1].id);
      if (expectedIdx < prevIdx) {
        diagnostics.push({
          severity: "error",
          message: `Нарушен порядок фрагментов: ${start.id} после ${fragmentStarts[fi - 1].id}`,
          code: "fragment-order",
          range: {
            start: { line: start.line, character: 0 },
            end: { line: start.line, character: 10 },
            offset: lines[start.line]?.offset ?? 0,
            endOffset: (lines[start.line]?.offset ?? 0) + 10,
          },
        });
      }
    }
  }

  if (finishCount === 0 && materials.length > 0) {
    diagnostics.push({
      severity: "warning",
      message: "Не найдена карта FINISH",
      code: "no-finish",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, offset: 0, endOffset: 0 },
    });
  }

  return {
    uri: options.uri,
    statements,
    materials,
    bodies,
    zones,
    constants,
    cells,
    nets,
    latticeElements,
    lattices,
    includes,
    includeLineMap,
    fragments,
    diagnostics,
    cameraPresets,
  };
}

export { FRAGMENT_ORDER };
