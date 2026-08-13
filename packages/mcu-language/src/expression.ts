const DEG = Math.PI / 180;
const BUILTIN_FUNCS = new Set(["SIN", "COS", "TG", "SQRT", "LN", "LOG", "FUNH"]);

/** MCU: имена EQU/SET не зависят от регистра. */
export function lookupVar(vars: Map<string, number>, name: string): number | undefined {
  if (vars.has(name)) return vars.get(name);
  const u = name.toUpperCase();
  if (vars.has(u)) return vars.get(u);
  for (const [k, v] of vars) {
    if (k.toUpperCase() === u) return v;
  }
  return undefined;
}

/**
 * Параметр, оканчивающийся на `*` (DF-1*, 2*), и следующий токен — один операнд умножения.
 * «DF-1* DELT» → «DF-1*DELT» (DF − 1·DELT).
 */
export function mergeTrailingMultiplyOperands(params: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < params.length; i++) {
    let p = params[i]!;
    while (/.+\*$/.test(p) && !p.endsWith("**") && i + 1 < params.length) {
      i++;
      p += params[i]!;
    }
    out.push(p);
  }
  return out;
}

export function evaluateExpression(expr: string, vars: Map<string, number>): number | null {
  try {
    return evalExpr(expr.replace(/\s+/g, ""), vars);
  } catch {
    return null;
  }
}

/** Имена пользовательских констант/переменных, на которые ссылается выражение (без встроенных функций). */
export function collectVariableReferences(expr: string): string[] {
  try {
    return collectRefs(expr.replace(/\s+/g, ""));
  } catch {
    return [];
  }
}

export function findUndefinedVariables(expr: string, vars: Map<string, number>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of collectVariableReferences(expr)) {
    if (lookupVar(vars, name) === undefined && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

function collectRefs(expr: string): string[] {
  let pos = 0;
  const refs: string[] = [];

  function peek() {
    return expr[pos] ?? "";
  }

  function consume(ch?: string) {
    if (ch && expr[pos] !== ch) throw new Error("expected " + ch);
    return expr[pos++];
  }

  function parseNumber(): void {
    const m = expr.slice(pos).match(/^(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?/);
    if (!m) throw new Error("number");
    pos += m[0].length;
  }

  function parseIdent(): string {
    const m = expr.slice(pos).match(/^[A-Za-z][A-Za-z0-9]*/);
    if (!m) throw new Error("ident");
    pos += m[0].length;
    return m[0];
  }

  function parsePrimary(): void {
    if (peek() === "(") {
      consume("(");
      parseAdd();
      consume(")");
      return;
    }
    if (/[\d.]/.test(peek())) {
      parseNumber();
      return;
    }
    const id = parseIdent();
    if (peek() === "(" && BUILTIN_FUNCS.has(id.toUpperCase())) {
      consume("(");
      parseAdd();
      consume(")");
      return;
    }
    refs.push(id);
  }

  function parseUnary(): void {
    if (peek() === "-" || peek() === "+") {
      consume();
      parseUnary();
      return;
    }
    parsePrimary();
  }

  function parseMul(): void {
    parseUnary();
    while (peek() === "*" || peek() === "/") {
      consume();
      parseUnary();
    }
  }

  function parseAdd(): void {
    parseMul();
    while (peek() === "+" || peek() === "-") {
      consume();
      parseMul();
    }
  }

  if (!expr) return [];
  parseAdd();
  if (pos !== expr.length) throw new Error("trailing");
  return refs;
}

function evalExpr(expr: string, vars: Map<string, number>): number {
  let pos = 0;

  function peek() {
    return expr[pos] ?? "";
  }

  function consume(ch?: string) {
    if (ch && expr[pos] !== ch) throw new Error("expected " + ch);
    return expr[pos++];
  }

  function parseNumber(): number {
    const m = expr.slice(pos).match(/^(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?/);
    if (!m) throw new Error("number");
    pos += m[0].length;
    return parseFloat(m[0]);
  }

  function parseIdent(): string {
    const m = expr.slice(pos).match(/^[A-Za-z][A-Za-z0-9]*/);
    if (!m) throw new Error("ident");
    pos += m[0].length;
    return m[0];
  }

  function parsePrimary(): number {
    if (peek() === "(") {
      consume("(");
      const v = parseAdd();
      consume(")");
      return v;
    }
    if (/[\d.]/.test(peek())) return parseNumber();
    const id = parseIdent();
    const upper = id.toUpperCase();
    if (peek() === "(") {
      consume("(");
      const arg = parseAdd();
      consume(")");
      if (upper === "SIN") return Math.sin(arg * DEG);
      if (upper === "COS") return Math.cos(arg * DEG);
      if (upper === "TG") return Math.tan(arg * DEG);
      if (upper === "SQRT") return Math.sqrt(arg);
      if (upper === "LN" || upper === "LOG") return Math.log(arg);
      if (upper === "FUNH") return arg < 0 ? 0 : 1;
      throw new Error("fn");
    }
    const val = lookupVar(vars, id);
    if (val === undefined) throw new Error("undef " + id);
    return val;
  }

  function parseUnary(): number {
    if (peek() === "-") {
      consume("-");
      return -parseUnary();
    }
    if (peek() === "+") {
      consume("+");
      return parseUnary();
    }
    return parsePrimary();
  }

  function parseMul(): number {
    let v = parseUnary();
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const r = parseUnary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }

  function parseAdd(): number {
    let v = parseMul();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const r = parseMul();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const result = parseAdd();
  if (pos !== expr.length) throw new Error("trailing");
  return result;
}

export function parseNumbers(
  params: string[],
  vars: Map<string, number>
): number[] {
  const out: number[] = [];
  for (const p of mergeTrailingMultiplyOperands(params)) {
    const cleaned = p.replace(/,/g, " ").trim();
    if (!cleaned) continue;
    const parts = cleaned.split(/\s+/);
    for (const part of parts) {
      const v = evaluateExpression(part, vars);
      if (v !== null) out.push(v);
      else {
        const n = parseFloat(part);
        if (!isNaN(n)) out.push(n);
      }
    }
  }
  return out;
}
