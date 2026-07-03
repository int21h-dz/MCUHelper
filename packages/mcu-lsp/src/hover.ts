import {
  BOUNDARY_CODES,
  MODS_VALUES,
  formatCardHover,
  getBodyByKey,
  getCardByLabel,
  type BodyTypeSchema,
} from "@mcuhelper/mcu-schema";
import {
  computeBodyVolumeCm3FromAst,
  computeMaterialMassDensityGcm3,
  evaluateExpression,
  formatBodyVolumeCm3,
  buildZoneRegistrationMap,
  formatBurnupLoadHover,
  formatVolCardHover,
  formatMassDensityGcm3,
  formatTotalHistoriesEstimate,
  formatSourceSpectrumHover,
  getBurnupLoadAnalysis,
  getTotalHistoriesEstimate,
  findSourceSpectrumAtLine,
  getCompositionLineParameterHover,
  mcuNuclideAtomicWeight,
  mcuNuclideToIaeaElement,
  type DocumentIndex,
} from "@mcuhelper/mcu-language";
import { getCachedNuclideIaeaMarkdown, formatNaturalInsertHoverButton, prefetchNuclideIaeaHover, type NaturalInsertContext } from "./iaeaNds";
import type { Position } from "vscode-languageserver";

export function fullLine(
  doc: { getText: (r: { start: Position; end: Position }) => string },
  pos: Position
): string {
  return doc.getText({ start: { line: pos.line, character: 0 }, end: { line: pos.line, character: 1_000_000 } });
}

/** Идентификатор под курсором (целиком). */
export function wordAtPosition(line: string, character: number): string | null {
  const re = /[A-Za-z][A-Za-z0-9]{0,5}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (character >= start && character < end) return match[0];
  }
  return null;
}

/** Курсор на метке карты в начале строки (PIN, MATR, RCZ как тип тела, …). */
export function isOnStatementKeyword(line: string, character: number, word: string): boolean {
  const code = line.replace(/;.*/, "");
  const trimmed = code.trimStart();
  const lead = code.length - trimmed.length;
  const first = trimmed.split(/\s+/)[0];
  if (!first || first.toUpperCase() !== word.toUpperCase()) return false;
  const start = lead;
  const end = start + first.length;
  return character >= start && character < end;
}

function constantValue(index: DocumentIndex, name: string): number | null {
  const vars = new Map<string, number>();
  for (const c of index.ast.constants) {
    const v = evaluateExpression(c.expression, vars);
    if (v !== null) vars.set(c.name, v);
    if (c.name.toUpperCase() === name.toUpperCase()) return v;
  }
  return null;
}

function formatBodyHover(body: BodyTypeSchema): string {
  return `**${body.title}** (\`${body.key}\`)\n\n${body.description}\n\nПараметры: ${body.paramNames.join(", ")}`;
}

function hoverForKeyword(word: string): string | null {
  const card = getCardByLabel(word);
  if (card) return formatCardHover(card);

  const body = getBodyByKey(word);
  if (body) return formatBodyHover(body);

  return null;
}

const HISTORY_CARD_LABELS = new Set(["NTOT", "MAXS", "MAXSER"]);
const BURNUP_LOAD_LABELS = new Set(["POWER", "POWE", "STEP"]);
const VOL_LABELS = new Set(["VOL"]);
const SOURCE_SPECTRUM_LABELS = new Set(["EMES", "EPRO"]);

function appendBurnupLoadToKeywordHover(base: string, index: DocumentIndex, word: string): string {
  if (!BURNUP_LOAD_LABELS.has(word.toUpperCase())) return base;
  const analysis = getBurnupLoadAnalysis(index.ast);
  if (!analysis) return base;
  return base + formatBurnupLoadHover(analysis, index.ast);
}

function appendVolToKeywordHover(base: string, index: DocumentIndex, word: string): string {
  if (!VOL_LABELS.has(word.toUpperCase())) return base;
  return base + formatVolCardHover(index.ast);
}

function appendTotalHistoriesToKeywordHover(base: string, index: DocumentIndex, word: string): string {
  if (!HISTORY_CARD_LABELS.has(word.toUpperCase())) return base;
  const estimate = getTotalHistoriesEstimate(index.ast);
  if (!estimate) return base;
  return `${base}\n\n${formatTotalHistoriesEstimate(estimate)}`;
}

function appendSourceSpectrumToHover(base: string, index: DocumentIndex, line: number): string {
  const block = findSourceSpectrumAtLine(index.ast, line);
  if (!block) return base;
  return base + formatSourceSpectrumHover(block);
}

function appendKeywordExtrasToHover(base: string, index: DocumentIndex, word: string, line: number): string {
  let out = appendBurnupLoadToKeywordHover(appendTotalHistoriesToKeywordHover(base, index, word), index, word);
  out = appendVolToKeywordHover(out, index, word);
  if (SOURCE_SPECTRUM_LABELS.has(word.toUpperCase())) {
    out = appendSourceSpectrumToHover(out, index, line);
  }
  return out;
}

function hoverContextual(line: string, word: string): string | null {
  const bc = BOUNDARY_CODES.find((b) => b.code === word);
  if (bc && /\bCONT\b/i.test(line)) {
    return `**${bc.title}**\n\nКод граничного условия в карте CONT.`;
  }

  if (MODS_VALUES.includes(word) && /MODS\s*=/i.test(line)) {
    return `**MODS=${word}** — модель рассеяния в области термализации.`;
  }

  if (word === "MODS") {
    return `**MODS** — модель рассеяния в тепловой области:\n\n${MODS_VALUES.join(", ")}`;
  }

  const hashHints: Record<string, string> = {
    M: "m — материальный номер (MATR)",
    Z: "z — регистрационный номер зоны",
    O: "o — объектный номер",
    IM: "im — материал для импорта",
    IZ: "iz — рег. зона для импорта",
    IO: "io — объект для импорта",
    G: "g — группа материалов",
  };
  if (line.includes("#") && hashHints[word]) {
    return `**#${word.toLowerCase()}=** — ${hashHints[word]}`;
  }

  return null;
}

/** Нуклид под курсором — по строке в AST, не по первому совпадению имени. */
export function findNuclideAtPosition(
  index: DocumentIndex,
  pos: Position,
  rawWord: string
): { materialNumber: number; concentration: string } | null {
  const word = rawWord.toUpperCase();
  for (const m of index.ast.materials) {
    for (const n of m.nuclides) {
      if (n.name.toUpperCase() !== word || n.name.length !== rawWord.length) continue;
      if (n.range.start.line <= pos.line && n.range.end.line >= pos.line) {
        return { materialNumber: m.number, concentration: n.density };
      }
    }
  }
  return null;
}

export interface HoverOptions {
  enableIaeaNuclide?: boolean;
}

function formatNuclideHoverLocal(
  word: string,
  nuclHit: { materialNumber: number; concentration: string },
  index: DocumentIndex
): string {
  const mat = index.ast.materials.find((m) => m.number === nuclHit.materialNumber);
  const rho = mat ? computeMaterialMassDensityGcm3(mat) : null;
  const aw = mcuNuclideAtomicWeight(word);
  const lines = [
    `Нуклид **${word}** в материале ${nuclHit.materialNumber}`,
    `Ядерная концентрация: **${nuclHit.concentration}** яд/см³`,
  ];
  if (aw != null) {
    lines.push(`Атомная масса ≈ **${aw}** а.е.м.`);
  }
  if (rho != null) {
    lines.push(`Массовая плотность материала ≈ **${formatMassDensityGcm3(rho)}**`);
  }
  return lines.join("\n\n");
}

/**
 * Hover для LSP: локальные данные сразу; IAEA — только из кэша + фоновый prefetch.
 */
export function getHoverContent(
  doc: { getText: (r: { start: Position; end: Position }) => string },
  pos: Position,
  index: DocumentIndex | null,
  options: HoverOptions = {},
  documentUri?: string
): string | null {
  const line = fullLine(doc, pos);
  const rawWord = wordAtPosition(line, pos.character);

  if (index && rawWord) {
    const nuclHit = findNuclideAtPosition(index, pos, rawWord);
    if (nuclHit) {
      const nuclName = rawWord.toUpperCase();
      const base = formatNuclideHoverLocal(nuclName, nuclHit, index);
      if (options.enableIaeaNuclide === false) return base;

      const isNatural = mcuNuclideToIaeaElement(nuclName) != null;
      const insert: NaturalInsertContext | undefined =
        isNatural && documentUri
          ? {
              uri: documentUri,
              line: pos.line,
              character: pos.character,
              nuclideName: nuclName,
              concentration: nuclHit.concentration,
            }
          : undefined;

      const iaea = getCachedNuclideIaeaMarkdown(rawWord, insert);
      if (iaea) return base + iaea;
      prefetchNuclideIaeaHover(rawWord, insert);
      if (insert) return base + formatNaturalInsertHoverButton(insert);
      return base;
    }
  }

  let paramHover = getCompositionLineParameterHover(line, pos.character);
  if (paramHover && index && /GROUP/i.test(paramHover)) {
    const known = [
      ...new Set(index.ast.materials.map((m) => m.group).filter((g): g is string => Boolean(g))),
    ].sort();
    if (known.length) {
      paramHover += `\n\n**Уже в файле:** ${known.map((g) => `\`${g}\``).join(", ")}`;
    } else {
      paramHover += "\n\nПроизвольный идентификатор, напр. `fuel`, `MOD`, `clad`.";
    }
  }
  if (paramHover) return paramHover;

  return getHover(doc, pos, index);
}

/** @deprecated Используйте getHoverContent — не блокирует ответ сетью. */
export async function getHoverAsync(
  doc: { getText: (r: { start: Position; end: Position }) => string },
  pos: Position,
  index: DocumentIndex | null,
  options: HoverOptions = {}
): Promise<string | null> {
  return getHoverContent(doc, pos, index, options);
}

export function getHover(
  doc: { getText: (r: { start: Position; end: Position }) => string },
  pos: Position,
  index: DocumentIndex | null
): string | null {
  const line = fullLine(doc, pos);
  const rawWord = wordAtPosition(line, pos.character);
  if (!rawWord) return null;
  const word = rawWord.toUpperCase();
  const onKeyword = isOnStatementKeyword(line, pos.character, rawWord);

  const contextual = hoverContextual(line, word);
  if (contextual) return contextual;

  if (onKeyword) {
    const kw = hoverForKeyword(word);
    if (kw) {
      if (index && getBodyByKey(word)) {
        const bodyOnLine = index.ast.bodies.find((b) => b.range.start.line === pos.line);
        if (bodyOnLine) {
          const vol = computeBodyVolumeCm3FromAst(bodyOnLine, index.ast);
          if (vol != null) {
            return `${kw}\n\nОбъём **${bodyOnLine.name}** ≈ **${formatBodyVolumeCm3(vol)}**`;
          }
        }
      }
      return index ? appendKeywordExtrasToHover(kw, index, word, pos.line) : kw;
    }
  } else {
    const body = getBodyByKey(word);
    if (body) return formatBodyHover(body);
  }

  if (index) {
    const specBlock = findSourceSpectrumAtLine(index.ast, pos.line);
    if (specBlock && !onKeyword) {
      const base =
        hoverForKeyword("EMES") ??
        `**Спектр источника**\n\nУзлы **EMES** (энергия, эВ) и **EPRO** (вероятности).`;
      return appendSourceSpectrumToHover(base, index, pos.line);
    }
  }

  if (!index) {
    if (!onKeyword) return hoverForKeyword(word);
    return null;
  }

  const konst = index.ast.constants.find((c) => c.name.toUpperCase() === word);
  if (konst) {
    const val = constantValue(index, konst.name);
    const valText = val !== null ? `\n\nЗначение: **${val}**` : "";
    return `**${konst.mutable ? "SET" : "EQU"} ${konst.name}**\n\n\`${konst.expression}\`${valText}`;
  }

  const bodyNode = index.ast.bodies.find((b) => b.name.toUpperCase() === word);
  if (bodyNode) {
    const vol = computeBodyVolumeCm3FromAst(bodyNode, index.ast);
    const lines = [
      `Тело **${bodyNode.name}** типа ${bodyNode.bodyType}`,
      `Параметры: ${bodyNode.params.join(", ")}`,
    ];
    if (vol != null) {
      lines.push(`Объём ≈ **${formatBodyVolumeCm3(vol)}**`);
    }
    return lines.join("\n\n");
  }

  const zone = index.ast.zones.find((z) => z.name.toUpperCase() === word);
  if (zone) {
    const reg = buildZoneRegistrationMap(index.ast.zones).get(zone.name);
    const lines = [`Зона **${zone.name}**`, "", `Выражение: \`${zone.expression}\``];
    if (reg) {
      lines.push(
        "",
        `Материал **${reg.materialNum ?? "—"}** · рег. зона **${reg.regNum}** · объект **${reg.objNum}**`
      );
    }
    return lines.join("\n");
  }

  const nuclHit = findNuclideAtPosition(index, pos, rawWord);
  if (nuclHit) {
    return formatNuclideHoverLocal(word, nuclHit, index);
  }

  if (!onKeyword) {
    const card = getCardByLabel(word);
    if (card) return formatCardHover(card);
  }

  return null;
}
