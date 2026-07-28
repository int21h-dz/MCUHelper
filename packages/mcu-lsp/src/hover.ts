import {
  BOUNDARY_CODES,
  FRAGMENT_DISPLAY,
  MODS_VALUES,
  formatCardHover,
  fragmentsForLabel,
  getBodyByKey,
  getCardByLabel,
  labelAllowedInFragment,
  type BodyTypeSchema,
  type FragmentId,
} from "@mcuhelper/mcu-schema";
import {
  analyzeMaterialMassDensity,
  buildScopedVars,
  computeBodyVolumeCm3FromAst,
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
  collectZoneBodyRefs,
  getCompositionLineParameterHover,
  looksLikeZoneStatement,
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

function numericTokenAtPosition(line: string, character: number): string | null {
  const re = /-?\d+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (character >= start && character < end) return match[0];
  }
  return null;
}

/** Хвост регистрации на текущей строке (#M=…, /reg:mat, …) — не body-ref. */
function registrationTailStart(line: string): number {
  return line.search(/(?:#|\/-\d+:|\/\d+:|\/\d+(?:\/\d+)?:|\/[BWMCR]\d|(?<![A-Za-z0-9]):\d+)/);
}

function findBodyByNumericZoneRef(
  index: DocumentIndex,
  line: string,
  pos: Position
): DocumentIndex["ast"]["bodies"][number] | null {
  const zone = index.ast.zones.find((z) => z.range.start.line <= pos.line && z.range.end.line >= pos.line);
  if (!zone) return null;

  const token = numericTokenAtPosition(line, pos.character);
  if (!token) return null;
  const num = Math.abs(parseInt(token, 10));
  if (!Number.isFinite(num) || num <= 0) return null;

  // Многострочное выражение: полное zone.expression не обязано целиком лежать на текущей строке.
  // Не цепляемся к номерам в хвосте регистрации (/reg:mat, #M=…).
  const tailStart = registrationTailStart(line);
  if (tailStart >= 0 && pos.character >= tailStart) return null;

  const refs = collectZoneBodyRefs(zone.expression);
  if (!refs.some((ref) => ref === String(num))) return null;

  const scope = zone.scope ?? "global";
  return (
    index.ast.bodies.find((b) => b.name.toUpperCase() === `N${num}` && (b.scope ?? "global") === scope) ?? null
  );
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

function resolveFragmentAtLine(index: DocumentIndex | null, line: number): FragmentId | undefined {
  if (!index) return undefined;
  const fromStmt = index.ast.statements.find(
    (s) => s.range.start.line <= line && s.range.end.line >= line
  )?.fragment;
  if (fromStmt) return fromStmt;
  const span = index.ast.fragments.find((f) => f.startLine <= line && f.endLine >= line);
  return span?.id;
}

/** Hover для карты не из текущего фрагмента — без чужого описания. */
function formatWrongFragmentHover(cardLabel: string, fragmentAtLine: FragmentId): string {
  const allowed = fragmentsForLabel(cardLabel)
    .map((f) => FRAGMENT_DISPLAY[f] ?? f)
    .join(", ");
  const lineFrag = FRAGMENT_DISPLAY[fragmentAtLine] ?? fragmentAtLine;
  return [
    `**${cardLabel}** — карта другого модуля`,
    "",
    `Недопустима во «${lineFrag}».`,
    allowed ? `Допустима: ${allowed}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function cardHoverAllowed(word: string, fragmentAtLine: FragmentId | undefined): boolean {
  if (fragmentAtLine == null) return true;
  return labelAllowedInFragment(word, fragmentAtLine);
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

function appendKeywordExtrasToHover(
  base: string,
  index: DocumentIndex,
  word: string,
  line: number,
  fragmentAtLine: FragmentId | undefined
): string {
  if (fragmentAtLine != null && !labelAllowedInFragment(word, fragmentAtLine)) return base;
  let out = appendBurnupLoadToKeywordHover(appendTotalHistoriesToKeywordHover(base, index, word), index, word);
  out = appendVolToKeywordHover(out, index, word);
  if (SOURCE_SPECTRUM_LABELS.has(word.toUpperCase()) && (fragmentAtLine == null || fragmentAtLine === "source")) {
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
    return `**MODS=${word}**\n\nМодель рассеяния в тепловой области.`;
  }

  if (word === "MODS") {
    return `**MODS**\n\nМодель рассеяния в тепловой области.\n\n${MODS_VALUES.join(", ")}`;
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
    return `**#${word.toLowerCase()}=**\n\n${hashHints[word]}`;
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
  const vars = mat
    ? buildScopedVars(index.ast.constants, mat.range.offset, "global")
    : new Map<string, number>();
  const density = mat ? analyzeMaterialMassDensity(mat, vars) : null;
  const aw = mcuNuclideAtomicWeight(word);
  const lines = [
    `Нуклид **${word}** в материале ${nuclHit.materialNumber}`,
    `Концентрация: **${nuclHit.concentration}** яд/см³`,
  ];
  if (aw != null) {
    lines.push(`Атомная масса: **${aw}** а.е.м.`);
  }
  if (density?.rho != null) {
    let rhoLine = `Плотность материала: **${formatMassDensityGcm3(density.rho)}**`;
    if (density.skipped.length) {
      const badConc = density.skipped.filter((s) => s.reason === "bad-conc").map((s) => s.name);
      const badMass = density.skipped.filter((s) => s.reason === "unknown-mass").map((s) => s.name);
      const notes: string[] = [`по ${density.usedCount} из ${mat!.nuclides.length} нуклидов`];
      if (badConc.length) notes.push(`без концентраций: ${badConc.join(", ")}`);
      if (badMass.length) notes.push(`без атомных масс: ${badMass.join(", ")}`);
      rhoLine += `\n\n_${notes.join("; ")}_`;
    }
    lines.push(rhoLine);
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
  const fragmentAtLine = resolveFragmentAtLine(index, pos.line);

  if (!rawWord && index) {
    const numericHover = getHover(doc, pos, index);
    if (numericHover) return numericHover;
  }

  if (index && rawWord) {
    const nuclHit = findNuclideAtPosition(index, pos, rawWord);
    if (nuclHit && (fragmentAtLine === "physical" || fragmentAtLine == null)) {
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

  let paramHover =
    !(rawWord && isOnStatementKeyword(line, pos.character, rawWord) && getCardByLabel(rawWord)) &&
    fragmentAtLine === "physical"
      ? getCompositionLineParameterHover(line, pos.character)
      : null;
  if (paramHover && index && /GROUP/i.test(paramHover)) {
    const known = [
      ...new Set(index.ast.materials.map((m) => m.group).filter((g): g is string => Boolean(g))),
    ].sort();
    if (known.length) {
      paramHover += `\n\n**Уже используется:** ${known.map((g) => `\`${g}\``).join(", ")}`;
    } else {
      paramHover += "\n\nПроизвольный идентификатор, например `fuel`, `MOD`, `clad`.";
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
  if (!rawWord) {
    if (!index) return null;
    const numericBodyNode = findBodyByNumericZoneRef(index, line, pos);
    if (!numericBodyNode) return null;
    const vol = computeBodyVolumeCm3FromAst(numericBodyNode, index.ast);
    const lines = [
      `Тело **${numericBodyNode.name}** типа ${numericBodyNode.bodyType}`,
      `Параметры: ${numericBodyNode.params.join(", ")}`,
    ];
    if (vol != null) {
      lines.push(`Объём ≈ **${formatBodyVolumeCm3(vol)}**`);
    }
    return lines.join("\n\n");
  }
  const word = rawWord.toUpperCase();
  const onKeyword = isOnStatementKeyword(line, pos.character, rawWord);
  const fragmentAtLine = resolveFragmentAtLine(index, pos.line);

  const contextual = hoverContextual(line, word);
  if (contextual) {
    if (word === "MODS" || /MODS\s*=/i.test(line)) {
      if (fragmentAtLine != null && fragmentAtLine !== "physical") return null;
    }
    if (/\bCONT\b/i.test(line) && BOUNDARY_CODES.some((b) => b.code === word)) {
      if (fragmentAtLine != null && fragmentAtLine !== "geometry") return null;
    }
    return contextual;
  }

  if (
    onKeyword &&
    getCardByLabel(word) &&
    fragmentAtLine != null &&
    !cardHoverAllowed(word, fragmentAtLine) &&
    !(fragmentAtLine === "geometry" && looksLikeZoneStatement(line))
  ) {
    return formatWrongFragmentHover(word, fragmentAtLine);
  }

  if (onKeyword) {
    const kw = hoverForKeyword(word);
    if (kw) {
      if (index && getBodyByKey(word)) {
        if (fragmentAtLine != null && fragmentAtLine !== "geometry") {
          // Тип тела как keyword вне геометрии — не показываем body-схему.
          if (getCardByLabel(word)) {
            /* fall through to card hover below */
          } else {
            return null;
          }
        } else {
          const bodyOnLine = index.ast.bodies.find((b) => b.range.start.line === pos.line);
          if (bodyOnLine) {
            const vol = computeBodyVolumeCm3FromAst(bodyOnLine, index.ast);
            if (vol != null) {
              return `${kw}\n\nОбъём тела **${bodyOnLine.name}**: **${formatBodyVolumeCm3(vol)}**`;
            }
          }
        }
      }
      return index ? appendKeywordExtrasToHover(kw, index, word, pos.line, fragmentAtLine) : kw;
    }
  } else if (fragmentAtLine == null || fragmentAtLine === "geometry") {
    const body = getBodyByKey(word);
    if (body) return formatBodyHover(body);
  }

  if (index) {
    const specBlock = findSourceSpectrumAtLine(index.ast, pos.line);
    if (specBlock && !onKeyword && (fragmentAtLine == null || fragmentAtLine === "source")) {
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
  if (nuclHit && (fragmentAtLine === "physical" || fragmentAtLine == null)) {
    return formatNuclideHoverLocal(word, nuclHit, index);
  }

  if (!onKeyword) {
    const card = getCardByLabel(word);
    if (card) {
      if (fragmentAtLine != null && !cardHoverAllowed(word, fragmentAtLine)) {
        return formatWrongFragmentHover(word, fragmentAtLine);
      }
      return formatCardHover(card);
    }
  }

  return null;
}
