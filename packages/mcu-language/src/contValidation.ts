import type { BodyNode, DiagnosticMessage, DocumentAst, SourceRange, StatementNode } from "./ast";

/** Типы контейнера по UserGuide §9.1.2 (плюс альтернативы HEX/BOX). */
export const OFFICIAL_CONTAINER_TYPES = new Set(["SPH", "RPP", "HEX", "RCZ", "BOX"]);

/** Число граничных поверхностей (UserGuide §9.1.3). */
export const CONTAINER_FACE_COUNT: Record<string, number> = {
  SPH: 1,
  RPP: 6,
  HEX: 8,
  HEXX: 8,
  HEXY: 8,
  HEXG: 8,
  SHEX: 8,
  RCZ: 3,
  BOX: 6,
  SBOX: 6,
};

/** Пары противоположных граней (0-based) для согласованности T. */
const OPPOSITE_FACE_PAIRS: Record<string, Array<[number, number]>> = {
  RPP: [
    [0, 1],
    [2, 4],
    [3, 5],
  ],
  BOX: [
    [0, 1],
    [2, 4],
    [3, 5],
  ],
  SBOX: [
    [0, 1],
    [2, 4],
    [3, 5],
  ],
  HEX: [
    [0, 1],
    [2, 5],
    [3, 6],
    [4, 7],
  ],
  HEXX: [
    [0, 1],
    [2, 5],
    [3, 6],
    [4, 7],
  ],
  HEXY: [
    [0, 1],
    [2, 5],
    [3, 6],
    [4, 7],
  ],
  HEXG: [
    [0, 1],
    [2, 5],
    [3, 6],
    [4, 7],
  ],
  SHEX: [
    [0, 1],
    [2, 5],
    [3, 6],
    [4, 7],
  ],
  RCZ: [[0, 1]],
};

export const CONT_SYMMETRY_ANGLES = new Set([180, 90, 60, 45, 30]);

const BC_TOKEN_RE = /^([BWMCT])(?:\(([^)]*)\)|\[([^\]]*)\])?$/i;
const SYM_TOKEN_RE = /^(S|PRS)(180|90|60|45|30)$/i;

export interface ContBcFragment {
  code: string;
  probability?: number;
  raw: string;
  index: number;
}

export interface ContSymmetry {
  kind: "S" | "PRS";
  angle: number;
  rotate?: number;
  raw: string;
  index: number;
}

export interface ParsedContCard {
  bc: ContBcFragment[];
  symmetries: ContSymmetry[];
  unknown: Array<{ raw: string; index: number }>;
}

function tokenSubrange(text: string, range: SourceRange, token: string, occurrence = 0): SourceRange {
  let from = 0;
  let found = -1;
  for (let i = 0; i <= occurrence; i++) {
    found = text.indexOf(token, from);
    if (found < 0) return range;
    from = found + token.length;
  }
  return {
    start: { line: range.start.line, character: range.start.character + found },
    end: { line: range.start.line, character: range.start.character + found + token.length },
    offset: range.offset + found,
    endOffset: range.offset + found + token.length,
  };
}

function splitContTokens(text: string): string[] {
  return text
    .replace(/^CONT\b/i, "")
    .replace(/;.*/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Разбор карты CONT: BC-фрагменты, затем S/PRS. */
export function parseContCard(text: string): ParsedContCard {
  const tokens = splitContTokens(text);
  const bc: ContBcFragment[] = [];
  const symmetries: ContSymmetry[] = [];
  const unknown: Array<{ raw: string; index: number }> = [];
  let i = 0;
  let phase: "bc" | "sym" = "bc";

  while (i < tokens.length) {
    const raw = tokens[i]!;
    const sym = raw.match(SYM_TOKEN_RE);
    if (sym) {
      phase = "sym";
      const kind = sym[1]!.toUpperCase() as "S" | "PRS";
      const angle = parseInt(sym[2]!, 10);
      let rotate: number | undefined;
      const next = tokens[i + 1];
      if (next != null && !SYM_TOKEN_RE.test(next) && !BC_TOKEN_RE.test(next) && /^-?\d+(?:\.\d+)?$/.test(next)) {
        rotate = Number(next);
        symmetries.push({ kind, angle, rotate, raw: `${raw} ${next}`, index: i });
        i += 2;
        continue;
      }
      symmetries.push({ kind, angle, raw, index: i });
      i += 1;
      continue;
    }

    if (phase === "sym") {
      unknown.push({ raw, index: i });
      i += 1;
      continue;
    }

    const bcM = raw.match(BC_TOKEN_RE);
    if (bcM) {
      const code = bcM[1]!.toUpperCase();
      const probRaw = bcM[2] ?? bcM[3];
      let probability: number | undefined;
      if (probRaw != null && probRaw !== "") {
        probability = Number(probRaw);
      }
      bc.push({ code, probability, raw, index: i });
      i += 1;
      continue;
    }

    unknown.push({ raw, index: i });
    i += 1;
  }

  return { bc, symmetries, unknown };
}

function isGlobalBody(body: BodyNode): boolean {
  return !body.scope || body.scope === "global";
}

/** Первое тело глобальной геометрии — контейнер (UserGuide §9.1.2). */
export function findContainerBody(ast: DocumentAst): BodyNode | undefined {
  return ast.bodies.find(isGlobalBody);
}

function parseProbabilityIssue(code: string, probability: number | undefined, raw: string): string | null {
  if (probability == null) return null;
  if (code === "B" || code === "T") {
    return `${raw}: у кода ${code} вероятность не задаётся`;
  }
  if (!Number.isFinite(probability) || !(probability > 0 && probability < 1)) {
    return `${raw}: вероятность отражения должна быть в интервале (0, 1)`;
  }
  return null;
}

function approxZero(expr: string): boolean {
  const t = expr.trim();
  if (/^0(?:\.0*)?$/i.test(t) || /^0\./.test(t)) return true;
  const n = Number(t);
  return Number.isFinite(n) && Math.abs(n) < 1e-12;
}

function sphereCenterAtOrigin(body: BodyNode): boolean | null {
  if (body.params.length < 3) return null;
  const [x, y, z] = body.params;
  if ([x, y, z].some((p) => /[A-Za-z_]/.test(p ?? ""))) return null;
  return approxZero(x!) && approxZero(y!) && approxZero(z!);
}

function validateContStatement(stmt: StatementNode, container: BodyNode | undefined): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  const parsed = parseContCard(stmt.text);
  const text = stmt.text;
  const range = stmt.range;

  for (const u of parsed.unknown) {
    diags.push({
      severity: "error",
      message: `CONT: недопустимый фрагмент «${u.raw}» (ожидаются B|W|M|C|T[, вероятность], Sα, PRSα)`,
      code: "cont-token",
      range: tokenSubrange(text, range, u.raw),
    });
  }

  for (const frag of parsed.bc) {
    const probIssue = parseProbabilityIssue(frag.code, frag.probability, frag.raw);
    if (probIssue) {
      diags.push({
        severity: "error",
        message: `CONT: ${probIssue}`,
        code: "cont-prob",
        range: tokenSubrange(text, range, frag.raw),
      });
    }
  }

  for (const sym of parsed.symmetries) {
    if (!CONT_SYMMETRY_ANGLES.has(sym.angle)) {
      diags.push({
        severity: "error",
        message: `CONT: угол ${sym.kind}${sym.angle} недопустим (допустимы 180, 90, 60, 45, 30)`,
        code: "cont-sym-angle",
        range: tokenSubrange(text, range, sym.raw.split(/\s+/)[0]!),
      });
    }
  }

  if (!container) {
    if (parsed.bc.length === 0 && parsed.symmetries.length === 0) {
      diags.push({
        severity: "warning",
        message: "CONT: нет граничных условий и не найдено тело-контейнер",
        code: "cont-empty",
        range,
      });
    }
    return diags;
  }

  const bodyType = container.bodyType.toUpperCase();
  const faceCount = CONTAINER_FACE_COUNT[bodyType];

  if (faceCount == null) {
    diags.push({
      severity: "error",
      message: `CONT: тело «${container.name}» типа ${bodyType} не может быть контейнером (допустимы SPH, RPP, HEX, RCZ, BOX)`,
      code: "cont-body-type",
      range,
    });
    return diags;
  }

  if (!OFFICIAL_CONTAINER_TYPES.has(bodyType) && bodyType !== "HEXX" && bodyType !== "HEXY") {
    diags.push({
      severity: "warning",
      message: `CONT: тип ${bodyType} не в списке UserGuide (SPH, RPP, HEX, RCZ, BOX); проверка граней по аналогии`,
      code: "cont-body-type-warn",
      range,
    });
  }

  if (parsed.bc.length !== faceCount) {
    diags.push({
      severity: "warning",
      message: `CONT: для контейнера ${bodyType} «${container.name}» нужно ${faceCount} граничных условий, задано ${parsed.bc.length}`,
      code: "cont-bc-count",
      range,
    });
  }

  const hasSym = parsed.symmetries.length > 0;
  const topBottomOnlyTypes = new Set(["RPP", "HEX", "HEXX", "HEXY", "HEXG", "SHEX", "RCZ"]);

  for (let fi = 0; fi < parsed.bc.length; fi++) {
    const frag = parsed.bc[fi]!;
    if (frag.code === "C") {
      const ok = bodyType === "RCZ" && fi === 2;
      if (!ok) {
        diags.push({
          severity: "warning",
          message: `CONT: код C допустим только на боковой поверхности RCZ (3-я грань), грань ${fi + 1}`,
          code: "cont-c-face",
          range: tokenSubrange(text, range, frag.raw),
        });
      }
    }
    if (frag.code === "T" && hasSym && topBottomOnlyTypes.has(bodyType) && fi > 1) {
      diags.push({
        severity: "warning",
        message: `CONT: при S/PRS трансляция T допустима только на нижней и верхней гранях (${bodyType}), грань ${fi + 1}`,
        code: "cont-t-sym",
        range: tokenSubrange(text, range, frag.raw),
      });
    }
  }

  if (bodyType === "SPH" && parsed.bc.some((b) => b.code === "T")) {
    const atOrigin = sphereCenterAtOrigin(container);
    if (atOrigin === false) {
      diags.push({
        severity: "warning",
        message: `CONT: T на SPH допустима, если центр шара в начале координат («${container.name}»)`,
        code: "cont-t-sph",
        range,
      });
    }
  }

  const pairs = OPPOSITE_FACE_PAIRS[bodyType] ?? [];
  for (const [a, b] of pairs) {
    const fa = parsed.bc[a];
    const fb = parsed.bc[b];
    if (!fa || !fb) continue;
    const ta = fa.code === "T";
    const tb = fb.code === "T";
    if (ta !== tb) {
      diags.push({
        severity: "warning",
        message: `CONT: трансляция T должна быть согласована на противоположных гранях ${a + 1} и ${b + 1} (${fa.raw} / ${fb.raw})`,
        code: "cont-t-pair",
        range: tokenSubrange(text, range, fa.raw),
      });
    }
  }

  return diags;
}

function validateCntandStatement(stmt: StatementNode, contStmt: StatementNode | undefined): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  const tokens = stmt.text
    .replace(/^CNTAND\b/i, "")
    .replace(/;.*/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    // параметр отсутствует → по умолчанию включено — ок
  } else if (tokens.length === 1 && (tokens[0] === "0" || tokens[0] === "1")) {
    // ok
  } else {
    diags.push({
      severity: "error",
      message: `CNTAND: ожидается 0 или 1 (задано «${tokens.join(" ")}»)`,
      code: "cntand-arg",
      range: stmt.range,
    });
  }

  if (contStmt && stmt.range.offset > contStmt.range.offset) {
    diags.push({
      severity: "warning",
      message: "CNTAND должна стоять перед картой CONT (UserGuide §9.1.2)",
      code: "cntand-order",
      range: stmt.range,
    });
  }

  return diags;
}

/** Семантика CONT / CNTAND (UserGuide §9.1.2). */
export function analyzeContCards(ast: DocumentAst): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [];
  const contStmts = ast.statements.filter((s) => s.label?.toUpperCase() === "CONT");
  const cntandStmts = ast.statements.filter((s) => s.label?.toUpperCase() === "CNTAND");
  const container = findContainerBody(ast);

  if (contStmts.length > 1) {
    for (const extra of contStmts.slice(1)) {
      diags.push({
        severity: "warning",
        message: "CONT: ожидается одна карта контейнера в геометрии",
        code: "cont-dup",
        range: extra.range,
      });
    }
  }

  for (const stmt of contStmts) {
    diags.push(...validateContStatement(stmt, container));
  }

  const primaryCont = contStmts[0];
  for (const stmt of cntandStmts) {
    diags.push(...validateCntandStatement(stmt, primaryCont));
  }

  return diags;
}
