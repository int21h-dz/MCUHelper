/**
 * Find references + rename для имён MCU: тела, зоны, EQU/SET.
 * Scope: global | cell:NAME | lcell:NAME (geometryScope / constantScope).
 */
import type { DocumentIndex, SourceRange } from "@mcuhelper/mcu-language";
import {
  collectVariableReferences,
  mapMainLineToExpanded,
  remapRangeToMainDocument,
  resolveScopeAtLine,
} from "@mcuhelper/mcu-language";
import type { Position } from "vscode-languageserver";
import { wordAtPosition, fullLine } from "./hover";

/** MCU id: буква + до 5 alnum → ≤6 символов (UserGuide / zoneBodyRefs BODY_NAME). */
export const MCU_ID_RE = /^[A-Za-z][A-Za-z0-9]{0,5}$/;

export type McuSymbolKind = "body" | "zone" | "constant";

export interface McuResolvedSymbol {
  kind: McuSymbolKind;
  name: string;
  /** global | cell:NAME | lcell:NAME */
  scope: string;
  /** Expanded-координаты имени на определении */
  nameRange: SourceRange;
}

export interface McuLocation {
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export interface McuTextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

export interface McuWorkspaceEdit {
  changes: Record<string, McuTextEdit[]>;
}

export function isValidMcuId(name: string): boolean {
  return MCU_ID_RE.test(name);
}

function sameName(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

function scopeOf(node: { scope?: string }): string {
  return node.scope ?? "global";
}

/** Позиция в statement.text (trim) → character на строке range (character 0 = начало raw-строки). */
function identRangesInText(text: string, name: string): { start: number; end: number }[] {
  const re = /[A-Za-z][A-Za-z0-9]{0,5}/g;
  const out: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (sameName(m[0], name)) out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function makeNameRange(base: SourceRange, startChar: number, endChar: number): SourceRange {
  return {
    start: { line: base.start.line, character: startChar },
    end: { line: base.start.line, character: endChar },
    offset: base.offset + startChar,
    endOffset: base.offset + endChar,
  };
}

function bodyNameRange(stmtText: string, range: SourceRange, name: string): SourceRange | null {
  if (name === "*") return null;
  const hits = identRangesInText(stmtText, name);
  if (!hits.length) return null;
  // «N1 SHEX …» — имя первое; «SHEX N1 …» / TRANSF — имя после типа/метки.
  const hit = hits[0]!;
  return makeNameRange(range, hit.start, hit.end);
}

function zoneNameRange(stmtText: string, range: SourceRange, name: string): SourceRange | null {
  const hits = identRangesInText(stmtText, name);
  if (!hits.length) return null;
  const hit = hits[0]!;
  return makeNameRange(range, hit.start, hit.end);
}

function constantNameRange(stmtText: string, range: SourceRange, name: string): SourceRange | null {
  const m = stmtText.match(/^(EQU|SET)\s+(\w+)/i);
  if (!m || !sameName(m[2], name)) {
    const hits = identRangesInText(stmtText, name);
    if (!hits.length) return null;
    return makeNameRange(range, hits[0]!.start, hits[0]!.end);
  }
  const start = stmtText.indexOf(m[2], m[1].length);
  if (start < 0) return null;
  return makeNameRange(range, start, start + m[2].length);
}

function statementTextAt(index: DocumentIndex, line: number): string | null {
  const stmt = index.ast.statements.find((s) => s.range.start.line === line);
  return stmt?.text ?? null;
}

/**
 * Expanded SourceRange → Location в координатах редактора (main) или include URI.
 */
export function rangeToEditorLocation(index: DocumentIndex, range: SourceRange): McuLocation | null {
  const lineMap = index.ast.includeLineMap;
  const mapped = remapRangeToMainDocument(range, lineMap);
  if (mapped) {
    return {
      uri: index.uri,
      range: { start: mapped.start, end: mapped.end },
    };
  }
  const entry = lineMap?.[range.start.line];
  if (entry?.source === "include" && entry.includeUri != null && entry.includeLine != null) {
    return {
      uri: entry.includeUri,
      range: {
        start: { line: entry.includeLine, character: range.start.character },
        end: { line: entry.includeLine, character: range.end.character },
      },
    };
  }
  // Без lineMap — как есть (source-only документ).
  if (!lineMap?.length) {
    return {
      uri: index.uri,
      range: { start: range.start, end: range.end },
    };
  }
  return null;
}

function expandedLineForEditor(index: DocumentIndex, editorLine: number): number {
  return mapMainLineToExpanded(index.ast.includeLineMap, editorLine);
}

function locationCoversPosition(loc: McuLocation, pos: Position): boolean {
  if (pos.line !== loc.range.start.line) return false;
  return pos.character >= loc.range.start.character && pos.character < loc.range.end.character;
}

function resolveDefinitionSymbol(
  index: DocumentIndex,
  word: string,
  scope: string,
  preferKind?: McuSymbolKind
): McuResolvedSymbol | null {
  const tryBody = (): McuResolvedSymbol | null => {
    const body = index.ast.bodies.find((b) => sameName(b.name, word) && scopeOf(b) === scope);
    if (!body || body.name === "*") return null;
    const text = statementTextAt(index, body.range.start.line) ?? `${body.name}`;
    const nameRange = bodyNameRange(text, body.range, body.name);
    if (!nameRange) return null;
    return { kind: "body", name: body.name, scope: scopeOf(body), nameRange };
  };
  const tryZone = (): McuResolvedSymbol | null => {
    const zone = index.ast.zones.find((z) => sameName(z.name, word) && scopeOf(z) === scope);
    if (!zone) return null;
    const text = statementTextAt(index, zone.range.start.line) ?? zone.name;
    const nameRange = zoneNameRange(text, zone.range, zone.name);
    if (!nameRange) return null;
    return { kind: "zone", name: zone.name, scope: scopeOf(zone), nameRange };
  };
  const tryConst = (): McuResolvedSymbol | null => {
    let c = index.ast.constants.find((x) => sameName(x.name, word) && scopeOf(x) === scope);
    if (!c && scope !== "global") {
      c = index.ast.constants.find((x) => sameName(x.name, word) && scopeOf(x) === "global");
    }
    if (!c) return null;
    const text = statementTextAt(index, c.range.start.line) ?? `EQU ${c.name}`;
    const nameRange = constantNameRange(text, c.range, c.name);
    if (!nameRange) return null;
    return { kind: "constant", name: c.name, scope: scopeOf(c), nameRange };
  };

  const order: McuSymbolKind[] =
    preferKind === "constant"
      ? ["constant", "body", "zone"]
      : preferKind === "zone"
        ? ["zone", "body", "constant"]
        : ["body", "zone", "constant"];

  for (const k of order) {
    const hit = k === "body" ? tryBody() : k === "zone" ? tryZone() : tryConst();
    if (hit) return hit;
  }
  return null;
}

/**
 * Символ под курсором: тело / зона / EQU|SET в geometry scope строки.
 */
export function resolveSymbolAtPosition(
  doc: { getText: (r: { start: Position; end: Position }) => string },
  pos: Position,
  index: DocumentIndex
): McuResolvedSymbol | null {
  const line = fullLine(doc, pos);
  const word = wordAtPosition(line, pos.character);
  if (!word || !isValidMcuId(word)) return null;

  const expLine = expandedLineForEditor(index, pos.line);
  const scope = resolveScopeAtLine(index.ast.statements, expLine);

  // Если курсор точно на имени определения — берём его (даже при омонимах kinds).
  for (const kind of ["body", "zone", "constant"] as McuSymbolKind[]) {
    const cand = resolveDefinitionSymbol(index, word, scope, kind);
    if (!cand || cand.kind !== kind) continue;
    const loc = rangeToEditorLocation(index, cand.nameRange);
    if (loc && locationCoversPosition(loc, pos)) return cand;
  }

  return resolveDefinitionSymbol(index, word, scope);
}

/** Все expanded-ranges вхождений символа (определение + ссылки в том же scope). */
export function collectSymbolNameRanges(index: DocumentIndex, symbol: McuResolvedSymbol): SourceRange[] {
  const ranges: SourceRange[] = [];
  const pushUnique = (r: SourceRange) => {
    if (
      ranges.some(
        (x) =>
          x.start.line === r.start.line &&
          x.start.character === r.start.character &&
          x.end.line === r.end.line &&
          x.end.character === r.end.character
      )
    ) {
      return;
    }
    ranges.push(r);
  };

  pushUnique(symbol.nameRange);

  if (symbol.kind === "body") {
    for (const z of index.ast.zones) {
      if (scopeOf(z) !== symbol.scope) continue;
      const text = statementTextAt(index, z.range.start.line);
      if (!text) continue;
      // Ссылки на тело в выражении зоны (не имя самой зоны).
      const nameEnd = zoneNameRange(text, z.range, z.name);
      const exprStartChar = nameEnd ? nameEnd.end.character : 0;
      for (const hit of identRangesInText(text, symbol.name)) {
        if (hit.start < exprStartChar) continue;
        pushUnique(makeNameRange(z.range, hit.start, hit.end));
      }
    }
    for (const b of index.ast.bodies) {
      if (scopeOf(b) !== symbol.scope) continue;
      if (b.transf && b.protoName && sameName(b.protoName, symbol.name)) {
        const text = statementTextAt(index, b.range.start.line);
        if (!text) continue;
        // TRANSF name proto … — proto обычно второй идентификатор после имени.
        const hits = identRangesInText(text, symbol.name);
        for (const hit of hits) {
          // Пропускаем собственное имя тела, если переименовываем другое.
          if (sameName(b.name, symbol.name) && hit === hits[0]) continue;
          pushUnique(makeNameRange(b.range, hit.start, hit.end));
        }
      }
    }
    return ranges;
  }

  if (symbol.kind === "zone") {
    for (const z of index.ast.zones) {
      if (scopeOf(z) !== symbol.scope || !sameName(z.name, symbol.name)) continue;
      const text = statementTextAt(index, z.range.start.line) ?? z.name;
      const nr = zoneNameRange(text, z.range, z.name);
      if (nr) pushUnique(nr);
    }
    return ranges;
  }

  // constant: определение + использования в EQU/SET RHS и params тел (с учётом shadow).
  for (const c of index.ast.constants) {
    if (scopeOf(c) !== symbol.scope) continue;
    if (sameName(c.name, symbol.name)) {
      const text = statementTextAt(index, c.range.start.line) ?? `EQU ${c.name}`;
      const nr = constantNameRange(text, c.range, c.name);
      if (nr) pushUnique(nr);
    }
    if (!collectVariableReferences(c.expression).some((n) => sameName(n, symbol.name))) continue;
    const text = statementTextAt(index, c.range.start.line);
    if (!text) continue;
    const eq = text.indexOf("=");
    if (eq < 0) continue;
    const rhs = text.slice(eq + 1);
    for (const hit of identRangesInText(rhs, symbol.name)) {
      pushUnique(makeNameRange(c.range, eq + 1 + hit.start, eq + 1 + hit.end));
    }
  }

  for (const b of index.ast.bodies) {
    const bs = scopeOf(b);
    if (symbol.scope === "global") {
      const shadowed = index.ast.constants.some(
        (c) => sameName(c.name, symbol.name) && scopeOf(c) === bs && bs !== "global"
      );
      if (shadowed) continue;
    } else if (bs !== symbol.scope) {
      continue;
    }

    const uses = b.params.some((p) => collectVariableReferences(p).some((n) => sameName(n, symbol.name)));
    if (!uses) continue;
    const text = statementTextAt(index, b.range.start.line);
    if (!text) continue;
    const bodyNr = bodyNameRange(text, b.range, b.name);
    for (const hit of identRangesInText(text, symbol.name)) {
      if (bodyNr && hit.start === bodyNr.start.character) continue;
      pushUnique(makeNameRange(b.range, hit.start, hit.end));
    }
  }

  return ranges;
}

export function findReferences(
  doc: { getText: (r: { start: Position; end: Position }) => string },
  pos: Position,
  index: DocumentIndex
): McuLocation[] {
  const symbol = resolveSymbolAtPosition(doc, pos, index);
  if (!symbol) return [];
  const out: McuLocation[] = [];
  for (const r of collectSymbolNameRanges(index, symbol)) {
    const loc = rangeToEditorLocation(index, r);
    if (loc) out.push(loc);
  }
  return out;
}

export function prepareRename(
  doc: { getText: (r: { start: Position; end: Position }) => string },
  pos: Position,
  index: DocumentIndex
): { range: McuLocation["range"]; placeholder: string } | null {
  const symbol = resolveSymbolAtPosition(doc, pos, index);
  if (!symbol) return null;
  const loc = rangeToEditorLocation(index, symbol.nameRange);
  if (!loc) return null;
  if (!locationCoversPosition(loc, pos)) {
    // Rename допустим и со ссылки — range имени под курсором из списка вхождений.
    const refs = findReferences(doc, pos, index);
    const at = refs.find((l) => locationCoversPosition(l, pos));
    if (!at) return { range: loc.range, placeholder: symbol.name };
    return { range: at.range, placeholder: symbol.name };
  }
  return { range: loc.range, placeholder: symbol.name };
}

/**
 * WorkspaceEdit для rename. null / пустой changes — отказ (невалидное имя или нет символа).
 */
export function renameSymbol(
  doc: { getText: (r: { start: Position; end: Position }) => string },
  pos: Position,
  index: DocumentIndex,
  newName: string
): McuWorkspaceEdit | null {
  if (!isValidMcuId(newName)) return null;
  const symbol = resolveSymbolAtPosition(doc, pos, index);
  if (!symbol) return null;
  if (sameName(symbol.name, newName) && symbol.name === newName) {
    return { changes: {} };
  }

  const changes: Record<string, McuTextEdit[]> = {};
  for (const r of collectSymbolNameRanges(index, symbol)) {
    const loc = rangeToEditorLocation(index, r);
    if (!loc) continue;
    const list = changes[loc.uri] ?? (changes[loc.uri] = []);
    if (
      list.some(
        (e) =>
          e.range.start.line === loc.range.start.line &&
          e.range.start.character === loc.range.start.character
      )
    ) {
      continue;
    }
    list.push({ range: loc.range, newText: newName });
  }
  return { changes };
}

/** Definition Location с учётом scope (для getDefinition). */
export function getScopedDefinition(
  doc: { getText: (r: { start: Position; end: Position }) => string },
  pos: Position,
  index: DocumentIndex
): McuLocation | null {
  const symbol = resolveSymbolAtPosition(doc, pos, index);
  if (!symbol) return null;
  return rangeToEditorLocation(index, symbol.nameRange);
}
