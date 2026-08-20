import {
  ALL_CARDS,
  BODY_TYPES,
  BOUNDARY_CODES,
  MCU_LABEL_ALIASES,
  MODS_VALUES,
  formatCardHover,
  formatBodyHover,
  getCardByLabel,
  labelAllowedInFragment,
  parseCardArgContext,
  type CardArgContext,
  type CardArgEnumValue,
  type CardSchema,
  type FragmentId,
} from "@mcuhelper/mcu-schema";
import type { DocumentIndex } from "@mcuhelper/mcu-language";
import {
  formatTotalHistoriesEstimate,
  getTotalHistoriesEstimate,
  resolveIncludeFileUri,
  remapRangeToMainDocument,
} from "@mcuhelper/mcu-language";
import { formatBurnupLoadHover, formatVolCardHover, formatSourceSpectrumHover, findSourceSpectrumAtLine, getBurnupLoadAnalysis } from "@mcuhelper/mcu-language";
import {
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
  Position,
  Range,
} from "vscode-languageserver";
import { fullLine, wordAtPosition } from "./hover";
import { uriToBaseDir } from "./serverHandlers";
import { getScopedDefinition } from "./symbolRefs";

export { getHover, getHoverAsync, getHoverContent } from "./hover";

function linePrefix(doc: { getText: (r: { start: Position; end: Position }) => string }, pos: Position): string {
  const line = doc.getText({ start: { line: pos.line, character: 0 }, end: pos });
  return line;
}

function fragmentAtLine(index: DocumentIndex, line: number): FragmentId | null {
  for (const f of index.ast.fragments) {
    if (line >= f.startLine && line <= f.endLine) return f.id;
  }
  return null;
}

function cardDocumentation(card: CardSchema, index?: DocumentIndex, line?: number) {
  let value = formatCardHover(card);
  if (index && (card.label === "NTOT" || card.label === "MAXS")) {
    const estimate = getTotalHistoriesEstimate(index.ast);
    if (estimate) value += `\n\n${formatTotalHistoriesEstimate(estimate)}`;
  }
  if (index && (card.label === "POWE" || card.label === "STEP" || card.label === "POWER")) {
    const load = getBurnupLoadAnalysis(index.ast);
    if (load) value += formatBurnupLoadHover(load, index.ast);
  }
  if (index && card.label === "VOL") {
    value += formatVolCardHover(index.ast);
  }
  if (index && (card.label === "EMES" || card.label === "EPRO") && line != null) {
    const block = findSourceSpectrumAtLine(index.ast, line);
    if (block) value += formatSourceSpectrumHover(block);
  }
  return { kind: MarkupKind.Markdown, value };
}

function bodyDocumentation(body: (typeof BODY_TYPES)[number]) {
  return {
    kind: MarkupKind.Markdown,
    value: formatBodyHover(body),
  };
}

/** Все метки карт с описанием (канон + алиасы вроде MAXSER, CONTEN). */
function buildKeywordCompletionIndex(): Map<string, CardSchema> {
  const map = new Map<string, CardSchema>();
  for (const card of ALL_CARDS) {
    map.set(card.label.toUpperCase(), card);
  }
  for (const alias of Object.keys(MCU_LABEL_ALIASES)) {
    const u = alias.toUpperCase();
    if (map.has(u)) continue;
    const card = getCardByLabel(u);
    if (card) map.set(u, card);
  }
  return map;
}

const KEYWORD_CARDS = buildKeywordCompletionIndex();

function matchesKeywordPrefix(label: string, prefix: string): boolean {
  if (!prefix) return true;
  return label.toUpperCase().startsWith(prefix.toUpperCase());
}

function cardAllowedInFragment(card: CardSchema, fragment: FragmentId | null): boolean {
  if (!fragment) return true;
  return labelAllowedInFragment(card.label, fragment);
}

function firstLineToken(prefix: string): string {
  return prefix.trim().split(/\s+/)[0] ?? "";
}

function isLineStartKeywordInput(prefix: string): boolean {
  const trimmed = prefix.trim();
  if (!trimmed) return true;
  return !/\s/.test(trimmed);
}

/** Диапазон замены первого токена строки (для textEdit подсказок). */
function lineStartTokenRange(prefix: string, pos: Position): Range {
  const lead = prefix.length - prefix.trimStart().length;
  const token = firstLineToken(prefix);
  const startChar = token ? lead : pos.character;
  return {
    start: { line: pos.line, character: startChar },
    end: { line: pos.line, character: pos.character },
  };
}

function withLineStartTextEdit(item: CompletionItem, prefix: string, pos: Position, newText: string): CompletionItem {
  return {
    ...item,
    textEdit: { range: lineStartTokenRange(prefix, pos), newText },
  };
}

export interface CompletionResult {
  items: CompletionItem[];
  isIncomplete: boolean;
}

function enumArgCompletions(
  ctx: CardArgContext,
  values: CardArgEnumValue[]
): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const v of values) {
    if (ctx.usedValues.has(v.value)) continue;
    if (ctx.partial && !v.value.startsWith(ctx.partial)) continue;
    items.push({
      label: v.value,
      kind: CompletionItemKind.EnumMember,
      detail: v.title,
      documentation: {
        kind: MarkupKind.Markdown,
        value: `**${v.value}** — ${v.title}\n\nКарта \`${ctx.card}\`.`,
      },
      sortText: `0_${v.value}`,
    });
  }
  return items;
}

function materialArgCompletions(ctx: CardArgContext, index: DocumentIndex, title: string): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const m of index.ast.materials) {
    const label = String(m.number);
    if (ctx.usedValues.has(label)) continue;
    if (ctx.partial && !label.startsWith(ctx.partial)) continue;
    items.push({
      label,
      kind: CompletionItemKind.Value,
      detail: `${title} · MATR ${m.number}`,
      sortText: `0_${label.padStart(4, "0")}`,
    });
  }
  return items;
}

function buildCardArgCompletions(ctx: CardArgContext, index: DocumentIndex): CompletionItem[] {
  if (ctx.spec.kind === "enum") {
    return enumArgCompletions(ctx, ctx.spec.values);
  }
  if (ctx.spec.kind === "materialNumbers") {
    return materialArgCompletions(ctx, index, ctx.spec.title);
  }
  return [];
}

function collectMaterialGroups(index: DocumentIndex): string[] {
  const groups = new Set<string>();
  for (const m of index.ast.materials) {
    if (m.group) groups.add(m.group);
  }
  return [...groups].sort();
}

function buildMatrHeaderCompletions(prefix: string, index: DocumentIndex): CompletionItem[] | null {
  if (!/^MATR\s+\d/i.test(prefix.trim())) return null;

  const groupAssign = prefix.match(/GROUP\s*=\s*(\w*)$/i);
  if (groupAssign) {
    const partial = groupAssign[1] ?? "";
    const items: CompletionItem[] = [];
    for (const g of collectMaterialGroups(index)) {
      if (partial && !g.toUpperCase().startsWith(partial.toUpperCase())) continue;
      items.push({
        label: g,
        kind: CompletionItemKind.EnumMember,
        insertText: g,
        detail: "GROUP — имя группы",
        documentation: {
          kind: MarkupKind.Markdown,
          value: `**GROUP=${g}** — символьное имя группы материалов в геометрии.`,
        },
      });
    }
    return items;
  }

  if (!/\s$/.test(prefix)) return null;

  const tail = prefix.trimEnd();
  const items: CompletionItem[] = [];
  if (!/\bT\s*=/i.test(tail)) {
    items.push({
      label: "T=300.",
      insertText: "T=300.",
      kind: CompletionItemKind.Property,
      detail: "Температура, K",
    });
  }
  if (!/\bGROUP\s*=/i.test(tail)) {
    items.push({
      label: "GROUP=",
      insertText: "GROUP=",
      kind: CompletionItemKind.Property,
      detail: "Имя группы (произвольный идентификатор)",
      documentation: {
        kind: MarkupKind.Markdown,
        value:
          "**GROUP=имя** — произвольное символьное имя (fuel, MOD, clad…). Материалы с одной GROUP используются в геометрии по имени группы.",
      },
    });
  }
  if (!/\bNAME\s*=/i.test(tail)) {
    items.push({
      label: "NAME=MCU",
      insertText: "NAME=MCU",
      kind: CompletionItemKind.Property,
      detail: "Формат имён нуклидов",
    });
  }
  return items.length ? items : null;
}

export function getCompletions(
  doc: { getText: (r: { start: Position; end: Position }) => string },
  pos: Position,
  index: DocumentIndex
): CompletionResult {
  const prefix = linePrefix(doc, pos);
  const trimmed = prefix.trim();
  const firstWord = firstLineToken(prefix);
  const firstUpper = firstWord.toUpperCase();
  const fragment = fragmentAtLine(index, pos.line);
  const typingLineStartKeyword = isLineStartKeywordInput(prefix) && firstWord.length > 0;

  const argCtx = parseCardArgContext(prefix);
  if (argCtx) {
    return { items: buildCardArgCompletions(argCtx, index), isIncomplete: Boolean(argCtx.partial) };
  }

  const matrItems = buildMatrHeaderCompletions(prefix, index);
  if (matrItems) return { items: matrItems, isIncomplete: false };

  const items: CompletionItem[] = [];

  if (isLineStartKeywordInput(prefix)) {
    for (const [label, card] of KEYWORD_CARDS) {
      if (!matchesKeywordPrefix(label, firstWord)) continue;
      if (!cardAllowedInFragment(card, fragment)) continue;
      const inFragment = fragment && card.fragment === fragment ? "0" : "1";
      const exact = label === firstUpper ? "0" : "1";
      items.push(
        withLineStartTextEdit(
          {
            label,
            kind: CompletionItemKind.Keyword,
            detail: card.title,
            documentation: cardDocumentation(card, index, pos.line),
            sortText: `${exact}${inFragment}_${label}`,
          },
          prefix,
          pos,
          label
        )
      );
    }

    if (fragment === "geometry") {
      for (const body of BODY_TYPES) {
        if (firstWord && !body.key.startsWith(firstUpper)) continue;
        items.push(
          withLineStartTextEdit(
            {
              label: body.key,
              filterText: body.key,
              kind: CompletionItemKind.Struct,
              detail: body.title,
              documentation: bodyDocumentation(body),
              insertText: body.snippet,
              insertTextFormat: InsertTextFormat.Snippet,
              sortText: `2_${body.key}`,
            },
            prefix,
            pos,
            body.snippet
          )
        );
      }
    }
  }

  if (/MODS\s*=\s*$/i.test(prefix) || /MODS=/i.test(prefix)) {
    for (const m of MODS_VALUES) {
      items.push({
        label: m,
        kind: CompletionItemKind.EnumMember,
        detail: "MODS model",
        documentation: { kind: MarkupKind.Markdown, value: `**MODS=${m}** — модель рассеяния в области термализации.` },
      });
    }
  }

  if (/\bCONT\s/i.test(prefix) || trimmed.endsWith("CONT")) {
    for (const bc of BOUNDARY_CODES) {
      items.push({
        label: bc.code,
        kind: CompletionItemKind.Enum,
        detail: bc.title,
        documentation: { kind: MarkupKind.Markdown, value: `**${bc.title}**\n\nКод граничного условия в карте CONT.` },
      });
    }
  }

  if (/#\s*m?\s*=?$/i.test(prefix) || /#\s*$/.test(prefix)) {
    items.push(
      { label: "m=1", kind: CompletionItemKind.Property, detail: "Материальный номер (безусловный)" },
      { label: "z=1", kind: CompletionItemKind.Property, detail: "Регистрационный номер (безусловный)" },
      { label: "o=1", kind: CompletionItemKind.Property, detail: "Объектный номер (безусловный)" },
      { label: "im=1", kind: CompletionItemKind.Property, detail: "УМУ — условный материальный указатель" },
      { label: "iz=1", kind: CompletionItemKind.Property, detail: "УРУ — условный рег. указатель" },
      { label: "io=1", kind: CompletionItemKind.Property, detail: "УОУ — условный объектный указатель" }
    );
  }

  if (/\/-?$/.test(prefix) || /\/-\d*$/.test(prefix)) {
    items.push(
      {
        label: "/-1:1/-1",
        kind: CompletionItemKind.Snippet,
        detail: "УРУ/мат/УОУ (условные указатели)",
        insertText: "/-${1:1}:${2:1}/-${3:1}",
        insertTextFormat: InsertTextFormat.Snippet,
      },
      {
        label: "/-1:1",
        kind: CompletionItemKind.Snippet,
        detail: "УРУ + материал",
        insertText: "/-${1:1}:${2:1}",
        insertTextFormat: InsertTextFormat.Snippet,
      }
    );
  }

  if (!typingLineStartKeyword) {
    for (const b of index.ast.bodies) {
      if (b.name !== "*") {
        items.push({ label: b.name, kind: CompletionItemKind.Variable, detail: `Тело ${b.bodyType}` });
      }
    }

    for (const c of index.ast.constants) {
      items.push({ label: c.name, kind: CompletionItemKind.Constant, detail: c.expression });
    }

    for (const m of index.ast.materials) {
      items.push({
        label: `MAT${m.number}`,
        kind: CompletionItemKind.Module,
        detail: `Материал ${m.number}`,
        insertText: String(m.number),
      });
    }

    items.push({
      label: "zone-snippet",
      kind: CompletionItemKind.Snippet,
      filterText: "ZONE",
      insertText: "${1:ZON1} ${2:BODY} # m=${3:1} z=${4:1} o=${5:1}",
      insertTextFormat: InsertTextFormat.Snippet,
      detail: "Зона (формат #, безусловные)",
    });
    items.push({
      label: "zone-conditional-snippet",
      kind: CompletionItemKind.Snippet,
      filterText: "ZONEC",
      insertText: "${1:ZON1} ${2:BODY} /-${3:1}:${4:1}/-${5:1}",
      insertTextFormat: InsertTextFormat.Snippet,
      detail: "Зона с УРУ/УОУ (slash)",
    });
    items.push({
      label: "zone-hash-conditional-snippet",
      kind: CompletionItemKind.Snippet,
      filterText: "ZONECI",
      insertText: "${1:ZON1} ${2:BODY} # im=${3:1} iz=${4:1} io=${5:1}",
      insertTextFormat: InsertTextFormat.Snippet,
      detail: "Зона с УМУ/УРУ/УОУ (hash)",
    });

    items.push({
      label: "trx-cell",
      kind: CompletionItemKind.Snippet,
      filterText: "TRX",
      insertText: [
        "HEAD 3 0",
        "CONT T T M M M M M M",
        "HEX C 0,0,0 1.806,0,100",
        "RCZ FU 0,0,0 100 0.4915",
        "RCZ ZA 0,0,0 100 0.5042",
        "RCZ CL 0,0,0 100 0.5753",
        "END",
        "FUEL FU /1:1",
        "SPACE ZA -FU /2:4",
        "CLAD CL -ZA /3:3",
        "WATR C -CL /4:2",
        "END",
        "FINISH",
      ].join("\n"),
      detail: "Пример ячейки TRX (UserGuide А.44)",
    });
  }

  return {
    items,
    isIncomplete: typingLineStartKeyword && firstWord.length > 0 && firstWord.length < 6,
  };
}

export function getDefinition(
  doc: { getText: (r: { start: Position; end: Position }) => string },
  pos: Position,
  index: DocumentIndex
): { uri: string; range: import("@mcuhelper/mcu-language").SourceRange } | null {
  for (const inc of index.ast.includes) {
    const r = inc.range;
    if (
      pos.line === r.start.line &&
      pos.character >= r.start.character &&
      pos.character < r.end.character
    ) {
      return {
        uri: resolveIncludeFileUri(uriToBaseDir(index.uri), inc.path),
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          offset: 0,
          endOffset: 0,
        },
      };
    }
  }

  const scoped = getScopedDefinition(doc, pos, index);
  if (scoped) {
    return {
      uri: scoped.uri,
      range: {
        start: scoped.range.start,
        end: scoped.range.end,
        offset: 0,
        endOffset: 0,
      },
    };
  }

  const line = fullLine(doc, pos);
  const word = wordAtPosition(line, pos.character);
  if (!word) return null;

  const lineMap = index.ast.includeLineMap;
  const asEditorDef = (range: import("@mcuhelper/mcu-language").SourceRange) => {
    const mapped = remapRangeToMainDocument(range, lineMap);
    if (mapped) return { uri: index.uri, range: { ...range, start: mapped.start, end: mapped.end } };
    const entry = lineMap?.[range.start.line];
    if (entry?.source === "include" && entry.includeUri != null && entry.includeLine != null) {
      return {
        uri: entry.includeUri,
        range: {
          ...range,
          start: { line: entry.includeLine, character: range.start.character },
          end: { line: entry.includeLine, character: range.end.character },
        },
      };
    }
    return null;
  };

  // MATR number / fallback без scope (материалы глобальны).
  const mat = index.ast.materials.find((m) => m.number === parseInt(word.replace(/\D/g, ""), 10));
  if (mat) return asEditorDef(mat.range);

  return null;
}
