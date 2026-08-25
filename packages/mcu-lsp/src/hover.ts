import {
  BOUNDARY_CODES,
  CONT_SYMMETRY_SUGGESTIONS,
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
  formatActivityBqPerG,
  specificActivityBqPerG,
  formatBodyVolumeCm3,
  buildZoneRegistrationMap,
  getResolvedZoneNumbers,
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
  listVisibleConstants,
  mapMainLineToExpanded,
  resolveScopeAtPosition,
  mcuNuclideAtomicWeight,
  mcuNuclideToIaeaElement,
  resolveNuclideConcentration,
  computeNuclideMassFractionInMaterial,
  getAwLibEntry,
  getAwLibTable,
  getDefaultPhyEntry,
  getDefaultPhyTable,
  formatAtomicWeightAmu,
  sumIsotopeForNuclide,
  isIceExpandBlockedForMaterial,
  isSumIsotopeCardLine,
  remapRangeToMainDocument,
  rangeCoversEditorLine,
  collectSourceSpectra,
  type DocumentIndex,
  type MaterialNode,
  type SourceRange,
} from "@mcuhelper/mcu-language";
import { getCachedNuclideIaeaMarkdown, formatNaturalInsertHoverButton, prefetchNuclideIaeaHover, type NaturalInsertContext } from "./iaeaNds";
import { formatAwMismatchHoverLine, getAwMassMismatch } from "./awLibVerify";
import { formatParameteThrHoverLines } from "./parameteThrVerify";
import type { Position } from "vscode-languageserver";

const MATERIAL_NUCLIDE_PREVIEW_MAX = 8;

/** Expanded range → URI+range для command:mcuhelper.revealEditorRange (без импорта symbolRefs — цикл). */
function materialRevealLocation(
  index: DocumentIndex,
  range: SourceRange
): { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } } | null {
  const lineMap = index.ast.includeLineMap;
  const mapped = remapRangeToMainDocument(range, lineMap);
  if (mapped) {
    return { uri: index.uri, range: { start: mapped.start, end: mapped.end } };
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
  if (!lineMap?.length) {
    return { uri: index.uri, range: { start: range.start, end: range.end } };
  }
  if (entry?.source === "include") {
    const mainLine = entry.mainIncludeLine ?? entry.mainLine;
    if (mainLine != null) {
      return {
        uri: index.uri,
        range: { start: { line: mainLine, character: 0 }, end: { line: mainLine, character: 120 } },
      };
    }
  }
  // Не отдаём expanded-координаты на main URI — прыжок будет мимо.
  return null;
}

export function formatRevealMaterialHoverLink(index: DocumentIndex, material: MaterialNode): string | null {
  const loc = materialRevealLocation(index, material.range);
  if (!loc) return null;
  const query = encodeURIComponent(JSON.stringify([loc.uri, loc.range]));
  return `**[↗ Открыть MATR ${material.number}](command:mcuhelper.revealEditorRange?${query})**`;
}

/** Краткая карточка материала для zone/хвост/MATR-номер hover. */
export function formatMaterialBriefHover(index: DocumentIndex, materialNumber: number): string {
  const mat = index.ast.materials.find((m) => m.number === materialNumber);
  if (!mat) {
    return `_MATR ${materialNumber} не найден в задаче_`;
  }
  const vars = buildScopedVars(index.ast.constants, mat.range.offset, "global");
  const density = analyzeMaterialMassDensity(mat, vars);
  const meta: string[] = [];
  if (mat.group) meta.push(`GROUP=\`${mat.group}\``);
  if (mat.nameLib) meta.push(`NAME=\`${mat.nameLib}\``);
  if (mat.libMaterialName) meta.push(`код=\`${mat.libMaterialName}\``);
  if (mat.temperature != null) meta.push(`T=${mat.temperature}`);
  if (density?.rho != null && density.rho > 0) {
    meta.push(`ρ ≈ **${formatMassDensityGcm3(density.rho)}**`);
  } else if (mat.densParam && mat.densValue != null) {
    meta.push(`${mat.densParam}=${mat.densValue}`);
  }

  const names = mat.libMaterialName
    ? [mat.libMaterialName, ...mat.nuclides.map((n) => n.name)]
    : mat.nuclides.map((n) => n.name);
  const preview =
    names.length === 0
      ? null
      : names.length <= MATERIAL_NUCLIDE_PREVIEW_MAX
        ? names.join(", ")
        : `${names.slice(0, MATERIAL_NUCLIDE_PREVIEW_MAX).join(", ")} … (+${names.length - MATERIAL_NUCLIDE_PREVIEW_MAX})`;

  const lines = [`**MATR ${mat.number}**`];
  if (meta.length) lines.push(meta.join(" · "));
  lines.push(preview ? `Нуклиды: ${preview}` : "_Нуклиды не заданы_");
  const link = formatRevealMaterialHoverLink(index, mat);
  if (link) lines.push("", link);
  return lines.join("\n");
}

/**
 * Номер материала под курсором в хвосте регистрации зоны (`/reg:mat`, `#M=`, `#IM=`).
 * Не путать с рег./объектным номером.
 */
function materialNumberAtRegistrationTail(line: string, character: number): number | null {
  const covers = (start: number, len: number) => character >= start && character < start + len;

  const slashRe = /\/(-?\d+):(-?\d+)(?:\/(-?\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = slashRe.exec(line)) !== null) {
    const matTok = m[2];
    const matStart = m.index + 1 + m[1].length + 1; // после "/reg:"
    if (covers(matStart, matTok.length)) return parseInt(matTok, 10);
  }

  const bareColonRe = /(?<![A-Za-z0-9/]):(-?\d+)/g;
  while ((m = bareColonRe.exec(line)) !== null) {
    const matTok = m[1];
    const matStart = m.index + 1;
    if (covers(matStart, matTok.length)) return parseInt(matTok, 10);
  }

  const hashRe = /#(IM|M)\s*=\s*(-?\d+)/gi;
  while ((m = hashRe.exec(line)) !== null) {
    const matTok = m[2];
    const matStart = m.index + m[0].length - matTok.length;
    if (covers(matStart, matTok.length)) return parseInt(matTok, 10);
  }

  return null;
}

function formatMaterialHoverAtNumericToken(
  index: DocumentIndex,
  line: string,
  pos: Position,
  _editorUri?: string
): string | null {
  const token = numericTokenAtPosition(line, pos.character);
  if (!token) return null;

  const matFromTail = materialNumberAtRegistrationTail(line, pos.character);
  if (matFromTail != null) {
    if (matFromTail < 0) {
      return [
        `УМУ **−${Math.abs(matFromTail)}**`,
        "",
        "_Конкретный номер материала зависит от картограммы M (NET) или контекста._",
      ].join("\n");
    }
    return formatMaterialBriefHover(index, matFromTail);
  }

  // Номер на строке MATR N …
  if (/^\s*MATR\b/i.test(line)) {
    const matrNum = line.match(/^\s*MATR\s+(\d+)\b/i);
    if (matrNum) {
      const start = line.indexOf(matrNum[1]);
      if (pos.character >= start && pos.character < start + matrNum[1].length) {
        return formatMaterialBriefHover(index, parseInt(matrNum[1], 10));
      }
    }
  }

  return null;
}

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
  pos: Position,
  editorUri?: string
): DocumentIndex["ast"]["bodies"][number] | null {
  const zone = index.ast.zones.find((z) =>
    rangeCoversEditorLine(z.range, pos.line, index.ast.includeLineMap, editorUri)
  );
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

/** Числовой литерал (в т.ч. 1.E-3): выражение уже и есть значение — не дублировать. */
function expressionIsNumericLiteral(expr: string, value: number): boolean {
  const s = expr.replace(/\s+/g, "");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/.test(s)) return false;
  const n = Number(s);
  return Number.isFinite(n) && n === value;
}

function lastConstantByName(
  index: DocumentIndex,
  name: string
): { name: string; expression: string; mutable: boolean; value: number | null } | null {
  const want = name.toUpperCase();
  const vars = new Map<string, number>();
  let last: { name: string; expression: string; mutable: boolean; value: number | null } | null = null;
  for (const c of index.ast.constants) {
    const v = evaluateExpression(c.expression, vars);
    if (v !== null) {
      vars.set(c.name, v);
      vars.set(c.name.toUpperCase(), v);
    }
    if (c.name.toUpperCase() === want) {
      last = { name: c.name, expression: c.expression, mutable: c.mutable, value: v };
    }
  }
  return last;
}

/** EQU/SET под курсором: выражение + вычисленное значение в текущем scope. */
function formatConstantHoverAt(
  index: DocumentIndex,
  name: string,
  editorLine: number,
  character: number
): string | null {
  const expandedLine = mapMainLineToExpanded(index.ast.includeLineMap, editorLine);
  const scope = resolveScopeAtPosition(index.ast, expandedLine, character);
  const vis = listVisibleConstants(index.ast.constants, scope, expandedLine, character + 1);
  const want = name.toUpperCase();
  const found =
    vis.filter((c) => c.name.toUpperCase() === want).pop() ?? lastConstantByName(index, name);
  if (!found) return null;
  const showValue =
    found.value !== null &&
    Number.isFinite(found.value) &&
    !expressionIsNumericLiteral(found.expression, found.value);
  const valText = showValue ? `\n\nЗначение: **${found.value}**` : "";
  return `**${found.mutable ? "SET" : "EQU"} ${found.name}**\n\n\`${found.expression}\`${valText}`;
}

function hoverForKeyword(word: string): string | null {
  const card = getCardByLabel(word);
  if (card) return formatCardHover(card);

  const body = getBodyByKey(word);
  if (body) return formatBodyHover(body);

  return null;
}

function resolveFragmentAtLine(
  index: DocumentIndex | null,
  line: number,
  editorUri?: string
): FragmentId | undefined {
  if (!index) return undefined;
  const lineMap = index.ast.includeLineMap;
  const fromStmt = index.ast.statements.find((s) =>
    rangeCoversEditorLine(s.range, line, lineMap, editorUri)
  )?.fragment;
  if (fromStmt) return fromStmt;
  const span = index.ast.fragments.find((f) => {
    const start = remapRangeToMainDocument(
      { start: { line: f.startLine, character: 0 }, end: { line: f.endLine, character: 0 } },
      lineMap
    );
    if (start != null && start.start.line <= line && start.end.line >= line) return true;
    if (!editorUri || !lineMap?.length) return false;
    return rangeCoversEditorLine(
      { start: { line: f.startLine }, end: { line: f.endLine } },
      line,
      lineMap,
      editorUri
    );
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
const ICE_CARD_LABELS = new Set(["ICE", "ICENOT"]);
const LIST_CARD_LABELS = new Set([...SUM_CARD_LABELS, ...ICE_CARD_LABELS]);

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

function appendSourceSpectrumToHover(
  base: string,
  index: DocumentIndex,
  line: number,
  editorUri?: string
): string {
  const block = findSourceSpectrumAtEditorLine(index, line, editorUri);
  if (!block) return base;
  return base + formatSourceSpectrumHover(block);
}

function appendSumCardListToHover(
  base: string,
  index: DocumentIndex,
  word: string,
  line: number,
  editorUri?: string
): string {
  if (!LIST_CARD_LABELS.has(word.toUpperCase())) return base;
  const lineMap = index.ast.includeLineMap;
  const stmt = index.ast.statements.find((s) => rangeCoversEditorLine(s.range, line, lineMap, editorUri));
  if (!stmt || stmt.fragment !== "physical" || stmt.label.toUpperCase() !== word.toUpperCase()) return base;
  // ⚠ АГЕНТАМ: `SI dens` — кремний, не карта SI list (siCardVsNuclide / isSumIsotopeCardLine).
  if (word.toUpperCase() === "SI" && !isSumIsotopeCardLine(stmt.text)) return base;
  const list = stmt.text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(1);
  const itemKind = ICE_CARD_LABELS.has(word.toUpperCase()) ? "Элементы" : "Нуклиды";
  if (!list.length) return `${base}\n\nСписок пуст.`;
  const items = list.map((token) => `- \`${token}\``).join("\n");
  return `${base}

<details>
<summary>${itemKind} в карте ${word.toUpperCase()} (${list.length})</summary>

${items}
</details>`;
}

function findSourceSpectrumAtEditorLine(index: DocumentIndex, editorLine: number, editorUri?: string) {
  const lineMap = index.ast.includeLineMap;
  for (const block of collectSourceSpectra(index.ast)) {
    if (rangeCoversEditorLine(block.emesRange, editorLine, lineMap, editorUri)) return block;
    if (block.eproRange && rangeCoversEditorLine(block.eproRange, editorLine, lineMap, editorUri)) return block;
  }
  return null;
}

function appendKeywordExtrasToHover(
  base: string,
  index: DocumentIndex,
  word: string,
  line: number,
  fragmentAtLine: FragmentId | undefined,
  editorUri?: string
): string {
  if (fragmentAtLine != null && !labelAllowedInFragment(word, fragmentAtLine)) return base;
  let out = appendBurnupLoadToKeywordHover(appendTotalHistoriesToKeywordHover(base, index, word), index, word);
  out = appendVolToKeywordHover(out, index, word);
  out = appendSumCardListToHover(out, index, word, line, editorUri);
  if (SOURCE_SPECTRUM_LABELS.has(word.toUpperCase()) && (fragmentAtLine == null || fragmentAtLine === "source")) {
    out = appendSourceSpectrumToHover(out, index, line, editorUri);
  }
  return out;
}

/** Токен CONT под курсором: W(0.5), S90, PRS60, … */
export function contTokenAtPosition(line: string, character: number): string | null {
  const re = /(?:PRS|S)(?:180|90|60|45|30)|[BWMCT](?:\([^)]*\)|\[[^\]]*\])?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (character >= start && character < end) return match[0];
  }
  return null;
}

function hoverContToken(token: string): string | null {
  const upper = token.toUpperCase();
  const sym = CONT_SYMMETRY_SUGGESTIONS.find((s) => s.code === upper);
  if (sym) {
    const kind = upper.startsWith("PRS") ? "PRS" : "S";
    return (
      `**${sym.code}** — ${sym.title}\n\n` +
      `Угол зеркальной симметрии в карте CONT. Допустимы 180, 90, 60, 45, 30. ` +
      (kind === "PRS"
        ? "Плоскости симметричны относительно OXZ."
        : "Отсчёт от плоскости OXZ.") +
      ` После токена можно указать поворот вокруг OZ (градусы).`
    );
  }

  const bcM = token.match(/^([BWMCT])(?:\(([^)]*)\)|\[([^\]]*)\])?$/i);
  if (!bcM) return null;
  const code = bcM[1]!.toUpperCase();
  const bc = BOUNDARY_CODES.find((b) => b.code === code);
  if (!bc) return null;
  const prob = bcM[2] ?? bcM[3];
  const probLine =
    prob != null && prob !== ""
      ? `\n\nВероятность отражения: **${prob}** (интервал (0,1); иначе поглощение).`
      : code === "W" || code === "M" || code === "C"
        ? "\n\nБез вероятности — всегда отражение. Можно задать `W(0.5)` / `M[0.8]`."
        : "";
  const desc = "description" in bc && typeof bc.description === "string" ? bc.description : "Код граничного условия в карте CONT.";
  return `**${bc.title}** (\`${code}\`)\n\n${desc}${probLine}`;
}

function hoverContextual(line: string, word: string, character?: number): string | null {
  if (/\bCONT\b/i.test(line)) {
    const contTok = character != null ? contTokenAtPosition(line, character) : null;
    const fromCont = contTok ? hoverContToken(contTok) : hoverContToken(word);
    if (fromCont) return fromCont;
  }

  if (MODS_VALUES.includes(word) && /MODS\s*=/i.test(line)) {
    return `**MODS=${word}**\n\nМодель рассеяния в тепловой области.`;
  }

  if (word === "MODS") {
    return `**MODS**\n\nМодель рассеяния в тепловой области.\n\n${MODS_VALUES.join(", ")}`;
  }

  const hashHints: Record<string, string> = {
    M: "m — материальный номер (MATR), безусловный",
    Z: "z — регистрационный номер зоны, безусловный",
    O: "o — объектный номер, безусловный",
    IM: "im — УМУ (условный материальный указатель), положительный индекс → картограмма M**",
    IZ: "iz — УРУ (условный рег. указатель), положительный индекс → картограмма P** / Npm в LATT",
    IO: "io — УОУ (условный объектный указатель), положительный индекс → картограмма O** / Nom в LATT",
    G: "g — группа материалов",
  };
  if (line.includes("#") && hashHints[word]) {
    return `**#${word.toLowerCase()}=**\n\n${hashHints[word]}`;
  }

  const cart = word.match(/^([POM])(\d{2})(?:ALL|LAY|(\d{2}))?$/i);
  if (cart) {
    const letter = cart[1]!.toUpperCase();
    const ptr = parseInt(cart[2]!, 10);
    const kind =
      letter === "P" ? "регистрационных номеров (УРУ)" : letter === "O" ? "объектных номеров (УОУ)" : "материальных номеров (УМУ)";
    const upper = word.toUpperCase();
    if (upper.endsWith("ALL")) {
      return `**${word}**\n\nКартограмма ${kind}: указатель **${ptr}**, значение на всю сеть (ALL).`;
    }
    if (upper.endsWith("LAY")) {
      return `**${word}**\n\nЗаголовок слоя картограммы ${kind} для указателя **${ptr}**.`;
    }
    const row = cart[3] ? parseInt(cart[3], 10) : 1;
    return `**${word}**\n\nКартограмма ${kind}: указатель **${ptr}**, строка сети **${row}** (UserGuide §9.2.3).`;
  }

  return null;
}

/** Нуклид под курсором — по строке в AST, не по первому совпадению имени. */
export function findNuclideAtPosition(
  index: DocumentIndex,
  pos: Position,
  rawWord: string,
  editorUri?: string
): { materialNumber: number; concentration: string } | null {
  const word = rawWord.toUpperCase();
  const lineMap = index.ast.includeLineMap;
  for (const m of index.ast.materials) {
    for (const n of m.nuclides) {
      if (n.name.toUpperCase() !== word || n.name.length !== rawWord.length) continue;
      if (rangeCoversEditorLine(n.range, pos.line, lineMap, editorUri)) {
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
  | { kind: "list-card"; cardLabel: "SI" | "SINOT" | "ICE" | "ICENOT" };

function findListCardTokenAtPosition(
  index: DocumentIndex,
  pos: Position,
  rawWord: string,
  editorUri?: string
): Extract<NuclideHoverSource, { kind: "list-card" }> | null {
  const lineMap = index.ast.includeLineMap;
  const stmt = index.ast.statements.find((s) =>
    rangeCoversEditorLine(s.range, pos.line, lineMap, editorUri)
  );
  if (!stmt || stmt.fragment !== "physical") return null;
  const label = stmt.label.toUpperCase();
  if (!LIST_CARD_LABELS.has(label)) return null;
  // ⚠ АГЕНТАМ: не считать `SI dens` (кремний) картой суммарного изотопа.
  if (label === "SI" && !isSumIsotopeCardLine(stmt.text)) return null;
  if (isOnStatementKeyword(fullLine({ getText: () => stmt.text }, pos), pos.character, rawWord)) return null;

  const tokens = stmt.text.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const list = tokens.slice(1);
  if (!list.some((token) => token.toUpperCase() === rawWord.toUpperCase())) return null;
  return { kind: "list-card", cardLabel: label as "SI" | "SINOT" | "ICE" | "ICENOT" };
}

function findNuclideHoverSourceAtPosition(
  index: DocumentIndex,
  pos: Position,
  rawWord: string,
  editorUri?: string
): NuclideHoverSource | null {
  const materialHit = findNuclideAtPosition(index, pos, rawWord, editorUri);
  if (materialHit) {
    return {
      kind: "material",
      materialNumber: materialHit.materialNumber,
      concentration: materialHit.concentration,
    };
  }
  return findListCardTokenAtPosition(index, pos, rawWord, editorUri);
}

function formatSharePercent(share01: number): string {
  const sharePct = share01 * 100;
  return sharePct >= 0.01 && sharePct < 99.995
    ? sharePct.toPrecision(4).replace(/\.?0+$/, "").replace(/(\.\d*?)0+$/, "$1")
    : sharePct.toFixed(2).replace(/\.?0+$/, "");
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
      : ICE_CARD_LABELS.has(source.cardLabel)
        ? [`Элемент **${word}** в списке карты ${source.cardLabel}`]
        : [`Нуклид **${word}** в списке карты ${source.cardLabel}`];

  if (mat && source.kind === "material") {
    const enrichLines: string[] = [];
    const raw = word.trim().toUpperCase();
    // 1) Содержание изотопа в элементе — только для имён с массовым числом (U235, CS33).
    const elementKey = /\d/.test(raw) ? raw.match(/^([A-Z]{1,2})/)?.[1] : null;
    if (elementKey) {
      const concThis = resolveNuclideConcentration(source.concentration, vars);

      const isotopeRows = mat.nuclides.filter((n) => {
        const r = n.name.trim().toUpperCase();
        if (!/\d/.test(r)) return false; // игнорируем строки "U"/"HF" без массы
        const m = r.match(/^([A-Z]{1,2})/);
        return m?.[1] === elementKey;
      });

      const concs = isotopeRows.map((n) => resolveNuclideConcentration(n.density, vars));
      const knownConcs: number[] | null = concs.every((v): v is number => v != null && Number.isFinite(v))
        ? concs
        : null;
      const total = knownConcs != null ? knownConcs.reduce((s, v) => s + v, 0) : null;

      if (concThis != null && Number.isFinite(concThis) && total != null && total > 0 && concThis >= 0) {
        enrichLines.push(
          `Обогащение: **${formatSharePercent(concThis / total)}%** (содержание в элементе ${elementKey})`
        );
      }
    }

    // 2) Массовая доля данного нуклида во всём материале.
    const massFrac = computeNuclideMassFractionInMaterial(mat, word, vars);
    if (massFrac != null && Number.isFinite(massFrac) && massFrac >= 0) {
      enrichLines.push(`Обогащение: **${formatSharePercent(massFrac)}%** (массовая доля в материале)`);
    }

    if (enrichLines.length) {
      // Сразу после строки "Концентрация: ..."
      lines.splice(2, 0, ...enrichLines);
    }
  }

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
  if (mat && density?.rho != null && density.rho > 0) {
    const nuclAct = computeNuclideActivityBqPerCm3(mat, word, vars);
    const matAct = analyzeMaterialActivity(mat, vars);
    const rho = density.rho;
    if (nuclAct) {
      const nuclSpec = specificActivityBqPerG(nuclAct.activityBqPerCm3, rho);
      if (nuclSpec != null) {
        let nuclActLine = `Удельная активность: **${formatActivityBqPerG(nuclSpec)}**`;
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
    }
    if (matAct.totalBqPerCm3 != null && matAct.usedCount > 0) {
      const matSpec = specificActivityBqPerG(matAct.totalBqPerCm3, rho);
      if (matSpec != null) {
        lines.push(`Удельная активность материала: **${formatActivityBqPerG(matSpec)}**`);
      }
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
  // Причины SI/SIDEN — только в decoration hover (sumIsotopeHoverMessage),
  // иначе VS Code склеивает курсивную строку и маркированный список.
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
  const editorUri = documentUri;
  const fragmentAtLine = resolveFragmentAtLine(index, pos.line, editorUri);

  if (!rawWord && index) {
    const numericHover = getHover(doc, pos, index, editorUri);
    if (numericHover) return numericHover;
  }

  if (index && rawWord) {
    const nuclSource = findNuclideHoverSourceAtPosition(index, pos, rawWord, editorUri);
    if (nuclSource && (fragmentAtLine === "physical" || fragmentAtLine == null)) {
      const nuclName = rawWord.toUpperCase();
      const base = formatNuclideHoverLocal(nuclName, nuclSource, index);
      // IAEA NDS в hover по нуклидам — всегда (настройка снята).
      const isNatural = mcuNuclideToIaeaElement(nuclName) != null;
      const matForIce =
        nuclSource.kind === "material"
          ? index.ast.materials.find((m) => m.number === nuclSource.materialNumber)
          : undefined;
      // ICENOT / пустой ICE|ICENOT — MCU не разлагает; кнопку ICE в hover не показываем.
      const iceBlocked =
        Boolean(matForIce) && isIceExpandBlockedForMaterial(index.ast, matForIce!, nuclName);
      const insert: NaturalInsertContext | undefined =
        nuclSource.kind === "material" && isNatural && documentUri && !iceBlocked
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
  const constHover =
    index && rawWord ? formatConstantHoverAt(index, rawWord, pos.line, pos.character) : null;
  if (paramHover && constHover) return `${paramHover}\n\n---\n\n${constHover}`;
  if (paramHover) return paramHover;

  return getHover(doc, pos, index, editorUri);
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
  index: DocumentIndex | null,
  editorUri?: string
): string | null {
  const line = fullLine(doc, pos);
  const rawWord = wordAtPosition(line, pos.character);
  if (!rawWord) {
    if (!index) return null;
    const matNumeric = formatMaterialHoverAtNumericToken(index, line, pos, editorUri);
    if (matNumeric) return matNumeric;
    const numericBodyNode = findBodyByNumericZoneRef(index, line, pos, editorUri);
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
  const fragmentAtLine = resolveFragmentAtLine(index, pos.line, editorUri);

  const contextual = hoverContextual(line, word, pos.character);
  if (contextual) {
    if (word === "MODS" || /MODS\s*=/i.test(line)) {
      if (fragmentAtLine != null && fragmentAtLine !== "physical") return null;
    }
    if (/\bCONT\b/i.test(line) && (BOUNDARY_CODES.some((b) => b.code === word) || contTokenAtPosition(line, pos.character))) {
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
            rangeCoversEditorLine(b.range, pos.line, index.ast.includeLineMap, editorUri)
          );
          if (bodyOnLine) {
            const vol = computeBodyVolumeCm3FromAst(bodyOnLine, index.ast);
            if (vol != null) {
              return `${kw}\n\nОбъём тела **${bodyOnLine.name}**: **${formatBodyVolumeCm3(vol)}**`;
            }
          }
        }
      }
      return index ? appendKeywordExtrasToHover(kw, index, word, pos.line, fragmentAtLine, editorUri) : kw;
    }
  } else if (fragmentAtLine == null || fragmentAtLine === "geometry") {
    const body = getBodyByKey(word);
    if (body) return formatBodyHover(body);
  }

  if (index) {
    const specBlock = findSourceSpectrumAtEditorLine(index, pos.line, editorUri);
    if (specBlock && !onKeyword && (fragmentAtLine == null || fragmentAtLine === "source")) {
      const base =
        hoverForKeyword("EMES") ??
        `**Спектр источника**\n\nУзлы **EMES** (энергия, эВ) и **EPRO** (вероятности).`;
      return appendSourceSpectrumToHover(base, index, pos.line, editorUri);
    }
  }

  if (!index) {
    if (!onKeyword) return hoverForKeyword(word);
    return null;
  }

  const konstHover = formatConstantHoverAt(index, rawWord, pos.line, pos.character);
  if (konstHover) return konstHover;

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

  const zone =
    index.ast.zones.find(
      (z) =>
        z.name.toUpperCase() === word &&
        rangeCoversEditorLine(z.range, pos.line, index.ast.includeLineMap, editorUri)
    ) ??
    (() => {
      const sameName = index.ast.zones.filter((z) => z.name.toUpperCase() === word);
      return sameName.length === 1 ? sameName[0] : undefined;
    })();
  if (zone) {
    const reg = getResolvedZoneNumbers(buildZoneRegistrationMap(index.ast.zones), zone);
    const lines = [`Зона **${zone.name}**`, "", `Выражение: \`${zone.expression}\``];
    if (zone.scope && zone.scope !== "global") {
      lines.push("", `Scope: \`${zone.scope}\``);
    }
    if (reg) {
      const regPart =
        reg.regPointerIndex != null
          ? `УРУ **−${reg.regPointerIndex}**`
          : `рег. зона **${reg.regNum ?? "—"}**`;
      const objPart =
        reg.objPointerIndex != null
          ? `УОУ **−${reg.objPointerIndex}**`
          : `объект **${reg.objNum ?? "—"}**`;
      const matPart =
        reg.matPointerIndex != null
          ? `УМУ **−${reg.matPointerIndex}**`
          : `материал **${reg.materialNum ?? "—"}**`;
      lines.push("", `${matPart} · ${regPart} · ${objPart}`);
      if (reg.hasConditionalPointers) {
        lines.push("", "_Условные указатели перекодируются через картограммы P/O/M (NET) или Npm/Nom (LATT)._");
      }
      if (reg.materialNum != null) {
        lines.push("", formatMaterialBriefHover(index, reg.materialNum));
      } else if (reg.matPointerIndex != null) {
        lines.push(
          "",
          "_УМУ — конкретный номер материала зависит от картограммы M (NET) или контекста._"
        );
      }
    }
    return lines.join("\n");
  }

  const nuclSource = findNuclideHoverSourceAtPosition(index, pos, rawWord, editorUri);
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
