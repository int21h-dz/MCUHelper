import {
  getBodyByKey,
  getBodyParamGroups,
  getCardByLabel,
  getCardArgSpec,
  getCardLineParamGroups,
  getNuclideLineParamGroups,
  normalizeMcuLabel,
  parseCardArgContext,
  parseSyntaxRequiredPart,
  type CardArgEnumValue,
} from "./schemaBridge";
import { isNuclideCompositionLinePrefix, OPTIONAL_PARAM_KEYS } from "./nuclideParamValidation";

const MATR_OPTIONAL_KEYS = [
  "T",
  "GROUP",
  "NAME",
  "DENSAA",
  "DENSWA",
  "DENSAW",
  "DENSWW",
  "VOL",
  "BUR",
] as const;

export function isMatrHeaderLinePrefix(prefix: string): boolean {
  return /^\s*MATR\s+\d/i.test(prefix.trim());
}

export interface ParameterHintParameter {
  label: string;
  documentation?: string;
}

export interface ParameterSignatureHelp {
  label: string;
  documentation?: string;
  parameters: ParameterHintParameter[];
  activeParameter: number;
}

function linePrefixBeforeCursor(line: string, cursorCharacter: number): string {
  return line.slice(0, Math.min(cursorCharacter, line.length));
}

function splitTokens(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function activeArgIndex(tokenCountAfterHead: number, endsWithSpace: boolean): number {
  if (tokenCountAfterHead <= 0) return 0;
  return endsWithSpace ? tokenCountAfterHead : tokenCountAfterHead - 1;
}

function buildSignature(
  head: string,
  groups: ParameterHintParameter[],
  active: number,
  documentation?: string
): ParameterSignatureHelp {
  const clamped = Math.max(0, Math.min(active, Math.max(0, groups.length - 1)));
  const label = `${head} ${groups.map((g) => g.label).join(" ")}`.trim();
  return { label, documentation, parameters: groups, activeParameter: clamped };
}

function bodySignature(linePrefix: string): ParameterSignatureHelp | null {
  const code = linePrefix.replace(/;.*/, "");
  const tokens = splitTokens(code);
  if (!tokens.length) return null;

  const head = tokens[0].toUpperCase();
  let bodyKey = head;
  let argStart = 1;

  if (!getBodyParamGroups(head) && tokens.length > 1) {
    const second = tokens[1].toUpperCase();
    if (getBodyParamGroups(second)) {
      bodyKey = second;
      argStart = 2;
    }
  }

  const groups = getBodyParamGroups(bodyKey);
  if (!groups) return null;

  const body = getBodyByKey(bodyKey);
  const args = tokens.slice(argStart);
  const endsWithSpace = /\s$/.test(code);
  const active = activeArgIndex(args.length, endsWithSpace);

  return buildSignature(
    bodyKey,
    groups.map((g) => ({ label: g.label, documentation: g.documentation })),
    active,
    body ? `${body.title}. ${body.description}` : undefined
  );
}

function enumCardSignature(linePrefix: string): ParameterSignatureHelp | null {
  const ctx = parseCardArgContext(linePrefix);
  if (!ctx || ctx.spec.kind !== "enum") return null;

  const card = getCardByLabel(ctx.card);
  const params: ParameterHintParameter[] = ctx.spec.values.map((v: CardArgEnumValue) => ({
    label: v.value,
    documentation: v.title,
  }));

  const code = linePrefix.replace(/;.*/, "");
  const endsWithSpace = /\s$/.test(code);
  const tokens = splitTokens(code);
  const afterCard = tokens.slice(1);
  let active = activeArgIndex(afterCard.length, endsWithSpace);

  if (!ctx.spec.multi && afterCard.length >= 1 && !endsWithSpace && !ctx.partial) {
    active = 0;
  }

  return buildSignature(
    ctx.card,
    params,
    active,
    card?.description ?? `Аргументы карты ${ctx.card}`
  );
}

const NUMERIC_PAIR_CARDS = new Set([
  "POWER",
  "POWE",
  "STEP",
  "DSTP",
  "TIMP",
  "TSEC",
  "TMIN",
  "THOU",
  "TDAY",
  "TYEA",
]);

function numericPairCardSignature(linePrefix: string, cardLabel: string): ParameterSignatureHelp | null {
  if (!NUMERIC_PAIR_CARDS.has(cardLabel)) return null;

  const code = linePrefix.replace(/;.*/, "");
  const tokens = splitTokens(code);
  if (tokens[0]?.toUpperCase() !== cardLabel) return null;

  const isPower = cardLabel === "POWER" || cardLabel === "POWE";
  const pairLabels = isPower
    ? [
        { label: "Q", documentation: "Мощность, кВт" },
        { label: "t", documentation: "Время, сут (верхняя граница интервала)" },
      ]
    : [
        { label: "t", documentation: "Время, сут" },
        { label: "n", documentation: "Число шагов на интервале" },
      ];

  const maxPairs = 12;
  const params: ParameterHintParameter[] = [];
  for (let i = 0; i < maxPairs; i++) {
    params.push(pairLabels[i % 2]);
  }

  const after = tokens.slice(1);
  const endsWithSpace = /\s$/.test(code);
  const active = activeArgIndex(after.length, endsWithSpace);

  const card = getCardByLabel(cardLabel);
  return buildSignature(cardLabel, params, active, card?.description);
}

function genericCardSignature(linePrefix: string): ParameterSignatureHelp | null {
  const code = linePrefix.replace(/;.*/, "");
  const tokens = splitTokens(code);
  if (tokens.length < 1) return null;

  const cardLabel = normalizeMcuLabel(tokens[0]);
  // ⚠ АГЕНТАМ: `SI dens` — signature нуклида (nuclideLineSignature выше), не карта SI list.
  if (cardLabel === "SI" && tokens.length >= 2 && /^[+\-.(0-9]/.test(tokens[1]!)) return null;
  if (cardLabel === "MATR" || getCardArgSpec(cardLabel) || getBodyParamGroups(cardLabel)) return null;

  const card = getCardByLabel(cardLabel);
  if (!card) return null;

  const dedicated = getCardLineParamGroups(cardLabel);
  const placeholders = dedicated
    ? dedicated.map((p) => p.label)
    : parseSyntaxRequiredPart(card.syntax);

  const params: ParameterHintParameter[] =
    dedicated ??
    (placeholders.length > 0
      ? placeholders.map((p) => ({ label: p, documentation: card.title }))
      : [{ label: "…", documentation: card.syntax }]);

  const after = tokens.slice(1);
  const endsWithSpace = /\s$/.test(code);
  const active = activeArgIndex(after.length, endsWithSpace);

  return buildSignature(cardLabel, params, active, `${card.title}\n\n${card.description}`);
}

function matrOptionalGroupIndex(key: string): number {
  const idx = MATR_OPTIONAL_KEYS.indexOf(key as (typeof MATR_OPTIONAL_KEYS)[number]);
  return idx >= 0 ? idx + 1 : 1;
}

function matrActiveParameter(tokens: string[], endsWithSpace: boolean): number {
  if (tokens.length <= 1) return 0;
  if (tokens.length === 2 && !endsWithSpace) return 0;
  if (tokens.length === 2 && endsWithSpace) return 1;

  const tail = tokens.slice(2);
  const present = new Set<string>();
  for (const part of tail) {
    const key = part.match(/^([A-Za-z]+)=/)?.[1]?.toUpperCase();
    if (key) present.add(key);
  }

  const last = tail[tail.length - 1] ?? "";
  const lastKey = last.match(/^([A-Za-z]+)=/)?.[1]?.toUpperCase();
  if (lastKey) return matrOptionalGroupIndex(lastKey);

  if (!endsWithSpace && last && !last.includes("=")) {
    const prev = tail[tail.length - 2] ?? "";
    if (/^GROUP=/i.test(prev) || /^GROUP=/i.test(last)) {
      return matrOptionalGroupIndex("GROUP");
    }
  }

  for (let i = 0; i < MATR_OPTIONAL_KEYS.length; i++) {
    if (!present.has(MATR_OPTIONAL_KEYS[i])) return i + 1;
  }
  return MATR_OPTIONAL_KEYS.length;
}

function matrHeaderSignature(linePrefix: string): ParameterSignatureHelp | null {
  if (!isMatrHeaderLinePrefix(linePrefix)) return null;

  const code = linePrefix.replace(/;.*/, "");
  const tokens = splitTokens(code);
  const groups =
    getCardLineParamGroups("MATR")?.map((g) => ({
      label: g.label,
      documentation: g.documentation,
    })) ?? [];
  if (!groups.length) return null;

  const endsWithSpace = /\s$/.test(code);
  const active = matrActiveParameter(tokens, endsWithSpace);
  const card = getCardByLabel("MATR");

  return buildSignature(
    "MATR",
    groups,
    active,
    card ? `${card.title}\n\n${card.description}` : "Карта MATR — заголовок материала"
  );
}

function nuclideActiveParameter(tokens: string[], endsWithSpace: boolean): number {
  if (tokens.length === 1) return endsWithSpace ? 1 : 0;
  if (tokens.length === 2 && !endsWithSpace) return 1;
  if (tokens.length === 2 && endsWithSpace) return 2;

  const present = new Set<string>();
  for (let i = 2; i < tokens.length; i++) {
    const key = tokens[i].match(/^([A-Za-z]+)=/)?.[1]?.toUpperCase();
    if (key) present.add(key);
  }

  const last = tokens[tokens.length - 1] ?? "";
  const lastKey = last.match(/^([A-Za-z]+)=/)?.[1]?.toUpperCase();
  if (lastKey) {
    const idx = OPTIONAL_PARAM_KEYS.indexOf(lastKey as (typeof OPTIONAL_PARAM_KEYS)[number]);
    if (idx >= 0) return 2 + idx;
  }

  if (!endsWithSpace && last && !last.includes("=")) {
    const partial = last.toUpperCase();
    const idx = OPTIONAL_PARAM_KEYS.findIndex((k) => k.startsWith(partial));
    if (idx >= 0) return 2 + idx;
  }

  for (let i = 0; i < OPTIONAL_PARAM_KEYS.length; i++) {
    if (!present.has(OPTIONAL_PARAM_KEYS[i])) return 2 + i;
  }
  return 2 + OPTIONAL_PARAM_KEYS.length - 1;
}

function nuclideLineSignature(linePrefix: string): ParameterSignatureHelp | null {
  if (!isNuclideCompositionLinePrefix(linePrefix)) return null;

  const code = linePrefix.replace(/;.*/, "");
  const tokens = splitTokens(code);
  if (!tokens.length) return null;

  const groups = getNuclideLineParamGroups().map((g) => ({
    label: g.label,
    documentation: g.documentation,
  }));
  const endsWithSpace = /\s$/.test(code);
  const active = nuclideActiveParameter(tokens, endsWithSpace);

  return buildSignature(
    tokens[0],
    groups,
    active,
    "Строка состава MATR — имя нуклида, концентрация и опциональные ACE/MODS/DTEM/PHT"
  );
}

/** Hover по активному параметру строки тела (BOX, RCZ, …). */
export function getBodyLineParameterHover(line: string, cursorCharacter: number): string | null {
  const prefix = linePrefixBeforeCursor(line, cursorCharacter);
  const trimmed = prefix.trim();
  if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("C=")) return null;

  const tokens = splitTokens(trimmed.replace(/;.*/, ""));
  if (!tokens.length) return null;
  const head = tokens[0].toUpperCase();
  let bodyKey = head;
  if (!getBodyParamGroups(head) && tokens.length > 1) {
    const second = tokens[1].toUpperCase();
    if (getBodyParamGroups(second)) bodyKey = second;
  }
  if (!getBodyParamGroups(bodyKey)) return null;

  const help = getParameterSignatureHelp(line, cursorCharacter);
  if (!help) return null;
  const p = help.parameters[help.activeParameter];
  if (!p) return null;
  return `**Параметр:** \`${p.label}\`\n\n${p.documentation ?? ""}`;
}

/** Hover по активному параметру строки MATR или нуклида. */
export function getCompositionLineParameterHover(line: string, cursorCharacter: number): string | null {
  const prefix = linePrefixBeforeCursor(line, cursorCharacter);
  if (!isMatrHeaderLinePrefix(prefix) && !isNuclideCompositionLinePrefix(prefix)) return null;

  const help = getParameterSignatureHelp(line, cursorCharacter);
  if (!help) return null;
  const p = help.parameters[help.activeParameter];
  if (!p) return null;
  return `**Параметр:** \`${p.label}\`\n\n${p.documentation ?? ""}`;
}

/** @deprecated Используйте getCompositionLineParameterHover */
export function getNuclideLineParameterHover(line: string, cursorCharacter: number): string | null {
  return getCompositionLineParameterHover(line, cursorCharacter);
}

/** Подсказка параметров для текущей позиции курсора в строке. */
export function getParameterSignatureHelp(line: string, cursorCharacter: number): ParameterSignatureHelp | null {
  const prefix = linePrefixBeforeCursor(line, cursorCharacter);
  const trimmed = prefix.trim();
  if (!trimmed || trimmed.startsWith("*") || trimmed.startsWith("C=")) return null;

  const matr = matrHeaderSignature(prefix);
  if (matr) return matr;

  const nuclide = nuclideLineSignature(prefix);
  if (nuclide) return nuclide;

  const first = splitTokens(trimmed.replace(/;.*/, ""))[0]?.toUpperCase() ?? "";

  const body = bodySignature(prefix);
  if (body) return body;

  const enumSig = enumCardSignature(prefix);
  if (enumSig) return enumSig;

  if (NUMERIC_PAIR_CARDS.has(first)) {
    const pair = numericPairCardSignature(prefix, first);
    if (pair) return pair;
  }

  return genericCardSignature(prefix);
}

/** Имя активного параметра для списка completion. */
export function getActiveParameterHint(line: string, cursorCharacter: number): ParameterHintParameter | null {
  const help = getParameterSignatureHelp(line, cursorCharacter);
  if (!help?.parameters.length) return null;
  const p = help.parameters[help.activeParameter];
  return p ?? null;
}
