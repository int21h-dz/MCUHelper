import {
  BOUNDARY_CODES,
  FRAGMENT_DISPLAY,
  MODS_VALUES,
  formatCardHover,
  formatBodyHover,
  fragmentsForLabel,
  getBodyByKey,
  getCardByLabel,
  labelAllowedInFragment,
  type FragmentId,
} from "@mcuhelper/mcu-schema";
import {
  analyzeMaterialActivity,
  analyzeMaterialMassDensity,
  buildScopedVars,
  computeBodyVolumeCm3FromAst,
  computeNuclideActivityBqPerCm3,
  evaluateExpression,
  formatActivityBqPerCm3,
  formatBodyVolumeCm3,
  buildZoneRegistrationMap,
  formatBurnupLoadHover,
  formatVolCardHover,
  formatMassDensityGcm3,
  formatTotalHistoriesEstimate,
  formatSourceSpectrumHover,
  getBurnupLoadAnalysis,
  getTotalHistoriesEstimate,
  collectZoneBodyRefs,
  getCompositionLineParameterHover,
  getBodyLineParameterHover,
  looksLikeZoneStatement,
  mcuNuclideAtomicWeight,
  mcuNuclideToIaeaElement,
  getAwLibEntry,
  getAwLibTable,
  getDefaultPhyEntry,
  getDefaultPhyTable,
  formatAtomicWeightAmu,
  sumIsotopeForNuclide,
  isSumIsotopeCardLine,
  remapRangeToMainDocument,
  rangeCoversEditorLine,
  collectSourceSpectra,
  type DocumentIndex,
} from "@mcuhelper/mcu-language";
import { getCachedNuclideIaeaMarkdown, formatNaturalInsertHoverButton, prefetchNuclideIaeaHover, type NaturalInsertContext } from "./iaeaNds";
import { formatAwMismatchHoverLine, getAwMassMismatch } from "./awLibVerify";
import { formatParameteThrHoverLines } from "./parameteThrVerify";
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
  const zone = index.ast.zones.find((z) => rangeCoversEditorLine(z.range, pos.line, index.ast.includeLineMap));
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

function hoverForKeyword(word: string): string | null {
  const card = getCardByLabel(word);
  if (card) return formatCardHover(card);

  const body = getBodyByKey(word);
  if (body) return formatBodyHover(body);

  return null;
}

function resolveFragmentAtLine(index: DocumentIndex | null, line: number): FragmentId | undefined {
  if (!index) return undefined;
  const lineMap = index.ast.includeLineMap;
  const fromStmt = index.ast.statements.find((s) => rangeCoversEditorLine(s.range, line, lineMap))?.fragment;
  if (fromStmt) return fromStmt;
  const span = index.ast.fragments.find((f) => {
    const start = remapRangeToMainDocument(
      { start: { line: f.startLine, character: 0 }, end: { line: f.endLine, character: 0 } },
      lineMap
    );
    return start != null && start.start.line <= line && start.end.line >= line;
  });
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
const SUM_CARD_LABELS = new Set(["SI", "SINOT"]);

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
  const block = findSourceSpectrumAtEditorLine(index, line);
  if (!block) return base;
  return base + formatSourceSpectrumHover(block);
}

function appendSumCardListToHover(base: string, index: DocumentIndex, word: string, line: number): string {
  if (!SUM_CARD_LABELS.has(word.toUpperCase())) return base;
  const lineMap = index.ast.includeLineMap;
  const stmt = index.ast.statements.find((s) => rangeCoversEditorLine(s.range, line, lineMap));
  if (!stmt || stmt.fragment !== "physical" || stmt.label.toUpperCase() !== word.toUpperCase()) return base;
  // ⚠ АГЕНТАМ: `SI dens` — кремний, не карта SI list (siCardVsNuclide / isSumIsotopeCardLine).
  if (word.toUpperCase() === "SI" && !isSumIsotopeCardLine(stmt.text)) return base;
  const list = stmt.text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(1);
  if (!list.length) return `${base}\n\nСписок нуклидов пуст.`;
  const items = list.map((token) => `- \`${token}\``).join("\n");
  return `${base}

<details>
<summary>Нуклиды в карте ${word.toUpperCase()} (${list.length})</summary>

${items}
</details>`;
}

function findSourceSpectrumAtEditorLine(index: DocumentIndex, editorLine: number) {
  const lineMap = index.ast.includeLineMap;
  for (const block of collectSourceSpectra(index.ast)) {
    if (rangeCoversEditorLine(block.emesRange, editorLine, lineMap)) return block;
    if (block.eproRange && rangeCoversEditorLine(block.eproRange, editorLine, lineMap)) return block;
  }
  return null;
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
  out = appendSumCardListToHover(out, index, word, line);
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
  const lineMap = index.ast.includeLineMap;
  for (const m of index.ast.materials) {
    for (const n of m.nuclides) {
      if (n.name.toUpperCase() !== word || n.name.length !== rawWord.length) continue;
      if (rangeCoversEditorLine(n.range, pos.line, lineMap)) {
        return { materialNumber: m.number, concentration: n.density };
      }
    }
  }
  return null;
}

export interface HoverOptions {
  enableIaeaNuclide?: boolean;
}

type NuclideHoverSource =
  | { kind: "material"; materialNumber: number; concentration: string }
  | { kind: "sum-card"; cardLabel: "SI" | "SINOT" };

function findSumCardNuclideAtPosition(
  index: DocumentIndex,
  pos: Position,
  rawWord: string
): Extract<NuclideHoverSource, { kind: "sum-card" }> | null {
  const lineMap = index.ast.includeLineMap;
  const stmt = index.ast.statements.find((s) => rangeCoversEditorLine(s.range, pos.line, lineMap));
  if (!stmt || stmt.fragment !== "physical") return null;
  const label = stmt.label.toUpperCase();
  if (label !== "SI" && label !== "SINOT") return null;
  // ⚠ АГЕНТАМ: не считать `SI dens` (кремний) картой суммарного изотопа.
  if (label === "SI" && !isSumIsotopeCardLine(stmt.text)) return null;
  if (isOnStatementKeyword(fullLine({ getText: () => stmt.text }, pos), pos.character, rawWord)) return null;

  const tokens = stmt.text.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const list = tokens.slice(1);
  if (!list.some((token) => token.toUpperCase() === rawWord.toUpperCase())) return null;
  return { kind: "sum-card", cardLabel: label };
}

function findNuclideHoverSourceAtPosition(
  index: DocumentIndex,
  pos: Position,
  rawWord: string
): NuclideHoverSource | null {
  const materialHit = findNuclideAtPosition(index, pos, rawWord);
  if (materialHit) {
    return {
      kind: "material",
      materialNumber: materialHit.materialNumber,
      concentration: materialHit.concentration,
    };
  }
  return findSumCardNuclideAtPosition(index, pos, rawWord);
}

function formatNuclideHoverLocal(
  word: string,
  source: NuclideHoverSource,
  index: DocumentIndex
): string {
  const mat = source.kind === "material" ? index.ast.materials.find((m) => m.number === source.materialNumber) : null;
  const vars = mat
    ? buildScopedVars(index.ast.constants, mat.range.offset, "global")
    : new Map<string, number>();
  const density = mat ? analyzeMaterialMassDensity(mat, vars) : null;
  const awEntry = getAwLibEntry(word);
  const aw = awEntry?.atomicWeight ?? mcuNuclideAtomicWeight(word);
  const lines =
    source.kind === "material"
      ? [`Нуклид **${word}** в материале ${source.materialNumber}`, `Концентрация: **${source.concentration}** яд/см³`]
      : [`Нуклид **${word}** в списке карты ${source.cardLabel}`];
  if (aw != null) {
    const awStr = formatAtomicWeightAmu(aw);
    if (awEntry) {
      const aNote = awEntry.a != null ? `A=${awEntry.a}, ` : "";
      lines.push(`Атомная масса: **${awStr}** а.е.м. (${aNote}AW.LIB)`);
      const mismatch = getAwMassMismatch(word);
      if (mismatch) lines.push(formatAwMismatchHoverLine(mismatch));
    } else {
      lines.push(`Атомная масса: **${awStr}** а.е.м.`);
    }
  }
  lines.push(...formatParameteThrHoverLines(word));
  if (mat) {
    const nuclAct = computeNuclideActivityBqPerCm3(mat, word, vars);
    const matAct = analyzeMaterialActivity(mat, vars);
    if (nuclAct) {
      let nuclActLine = `Объёмная активность: **${formatActivityBqPerCm3(nuclAct.activityBqPerCm3)}**`;
      if (matAct.totalBqPerCm3 != null && matAct.totalBqPerCm3 > 0) {
        const sharePct = (nuclAct.activityBqPerCm3 / matAct.totalBqPerCm3) * 100;
        const shareText =
          sharePct >= 0.01 && sharePct < 99.995
            ? sharePct.toPrecision(4).replace(/\.?0+$/, "").replace(/(\.\d*?)0+$/, "$1")
            : sharePct.toFixed(2).replace(/\.?0+$/, "");
        nuclActLine += ` _(вклад в А мат.: ${shareText}% )_`;
      } else {
        nuclActLine += ` _(по T½ PARAMETE.THR)_`;
      }
      lines.push(nuclActLine);
    }
    if (matAct.totalBqPerCm3 != null && matAct.usedCount > 0) {
      lines.push(`Активность материала: **${formatActivityBqPerCm3(matAct.totalBqPerCm3)}**`);
    }
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
  if (mat && source.kind === "material") {
    const sum = sumIsotopeForNuclide(index.ast, mat, {
      name: word,
      density: source.concentration,
    });
    if (sum.inSum) {
      lines.push(`_${sum.reasons.join("; ")}_`);
    }
  }
  return lines.join("\n\n");
}

/** Нуклид рекомендован к явному SI: нет в AW.LIB и/или DEFAULT.PHY и не покрыт SI/SINOT. */
export function shouldSuggestAddToSumIsotope(
  index: DocumentIndex,
  materialNumber: number,
  nuclideName: string,
  concentration: string
): boolean {
  const mat = index.ast.materials.find((m) => m.number === materialNumber);
  if (!mat) return false;
  const sum = sumIsotopeForNuclide(index.ast, mat, {
    name: nuclideName,
    density: concentration,
  });
  if (sum.kinds.includes("si") || sum.kinds.includes("sinot")) return false;

  const awLoaded = Boolean(getAwLibTable()?.entryCount);
  const phyLoaded = Boolean(getDefaultPhyTable()?.entryCount);
  if (!awLoaded && !phyLoaded) return false;

  const missingAw = awLoaded && !getAwLibEntry(nuclideName);
  const missingPhy = phyLoaded && !getDefaultPhyEntry(nuclideName);
  return Boolean(missingAw || missingPhy);
}

export function formatAddToSumIsotopeHoverButton(args: {
  uri: string;
  line: number;
  nuclideName: string;
}): string {
  const query = encodeURIComponent(JSON.stringify([args]));
  return `\n\n**[+ Добавить в суммарный изотоп](command:mcuhelper.addToSumIsotope?${query})**`;
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
    const nuclSource = findNuclideHoverSourceAtPosition(index, pos, rawWord);
    if (nuclSource && (fragmentAtLine === "physical" || fragmentAtLine == null)) {
      const nuclName = rawWord.toUpperCase();
      const base = formatNuclideHoverLocal(nuclName, nuclSource, index);
      // IAEA NDS в hover по нуклидам — всегда (настройка снята).
      const isNatural = mcuNuclideToIaeaElement(nuclName) != null;
      const insert: NaturalInsertContext | undefined =
        nuclSource.kind === "material" && isNatural && documentUri
          ? {
              uri: documentUri,
              line: pos.line,
              character: pos.character,
              nuclideName: nuclName,
              concentration: nuclSource.concentration,
            }
          : undefined;

      const addToSi =
        nuclSource.kind === "material" &&
        documentUri &&
        shouldSuggestAddToSumIsotope(index, nuclSource.materialNumber, nuclName, nuclSource.concentration)
          ? formatAddToSumIsotopeHoverButton({
              uri: documentUri,
              line: pos.line,
              nuclideName: nuclName,
            })
          : "";

      if (options.enableIaeaNuclide === false) {
        // Тесты могут отключить сеть/IAEA; кнопка ICE для природных всё равно нужна.
        let out = base;
        if (insert) out += `\n\n${formatNaturalInsertHoverButton(insert).replace(/^\n+/, "")}`;
        if (addToSi) out += addToSi;
        return out;
      }

      const iaea = getCachedNuclideIaeaMarkdown(rawWord, insert);
      if (iaea) return `${base}\n\n${iaea.replace(/^\n+/, "")}${addToSi}`;
      prefetchNuclideIaeaHover(rawWord, insert);
      if (insert) return `${base}\n\n${formatNaturalInsertHoverButton(insert).replace(/^\n+/, "")}${addToSi}`;
      return addToSi ? `${base}${addToSi}` : base;
    }
  }

  // ⚠ АГЕНТАМ: SI dens (кремний) не блокирует composition hover как «карта SI».
  const onCardKeyword =
    Boolean(rawWord && isOnStatementKeyword(line, pos.character, rawWord) && getCardByLabel(rawWord)) &&
    !(rawWord!.toUpperCase() === "SI" && !isSumIsotopeCardLine(line));
  let paramHover =
    !onCardKeyword && fragmentAtLine === "physical"
      ? getCompositionLineParameterHover(line, pos.character)
      : null;
  if (
    !paramHover &&
    (fragmentAtLine === "geometry" || fragmentAtLine == null) &&
    !(rawWord && isOnStatementKeyword(line, pos.character, rawWord) && getBodyByKey(rawWord))
  ) {
    paramHover = getBodyLineParameterHover(line, pos.character);
  }
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
  // ⚠ АГЕНТАМ: SI dens (кремний) — не карта SI; не показывать card hover / wrong-fragment.
  const onKeyword =
    isOnStatementKeyword(line, pos.character, rawWord) &&
    !(word === "SI" && !isSumIsotopeCardLine(line));
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
          const bodyOnLine = index.ast.bodies.find((b) =>
            rangeCoversEditorLine(b.range, pos.line, index.ast.includeLineMap)
          );
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
    const specBlock = findSourceSpectrumAtEditorLine(index, pos.line);
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

  const nuclSource = findNuclideHoverSourceAtPosition(index, pos, rawWord);
  if (nuclSource && (fragmentAtLine === "physical" || fragmentAtLine == null)) {
    return formatNuclideHoverLocal(word, nuclSource, index);
  }

  if (!onKeyword) {
    // ⚠ АГЕНТАМ: `SI dens` (кремний) — не карта SI. Не подсовывать card hover по getCardByLabel("SI").
    if (word === "SI" && !isSumIsotopeCardLine(line)) return null;
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
