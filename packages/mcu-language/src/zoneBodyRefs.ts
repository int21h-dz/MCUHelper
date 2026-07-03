const BODY_NAME = /^[A-Za-z][A-Za-z0-9]{0,5}$/;
const BODY_NUM = /^\d+$/;

function readBodyToken(text: string, start: number): { token: string; len: number } | null {
  const num = text.slice(start).match(/^(\d+)/);
  if (num) return { token: num[1], len: num[1].length };
  const name = text.slice(start).match(/^([A-Za-z][A-Za-z0-9]{0,5})/);
  if (name && name[1].toUpperCase() !== "U") return { token: name[1], len: name[1].length };
  return null;
}

function tokenizeIntersect(part: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < part.length) {
    while (i < part.length && part[i] === " ") i++;
    if (i >= part.length) break;
    if (part[i] === "-") {
      let j = i + 1;
      while (j < part.length && part[j] === " ") j++;
      const body = readBodyToken(part, j);
      if (body) {
        tokens.push("-" + body.token);
        i = j + body.len;
      } else {
        i++;
      }
    } else {
      const body = readBodyToken(part, i);
      if (body) {
        tokens.push(body.token);
        i += body.len;
      } else {
        i++;
      }
    }
  }
  return tokens;
}

function splitUnion(expr: string): string[] {
  const parts: string[] = [];
  let current = "";
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === " " && expr.slice(i, i + 3) === " U ") {
      parts.push(current.trim());
      current = "";
      i += 3;
      continue;
    }
    current += expr[i];
    i++;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function isBodyToken(token: string): boolean {
  const name = token.startsWith("-") ? token.slice(1) : token;
  return BODY_NAME.test(name) || BODY_NUM.test(name);
}

/** Имена тел в булевом выражении зоны (без знака дополнения). */
export function collectZoneBodyRefs(expression: string): string[] {
  const cleaned = expression
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  const refs: string[] = [];
  for (const part of splitUnion(cleaned)) {
    for (const token of tokenizeIntersect(part)) {
      if (!isBodyToken(token)) continue;
      refs.push(token.startsWith("-") ? token.slice(1) : token);
    }
  }
  return refs;
}

/** UserGuide §9.1.4: первая ссылка 0 — всё пространство («0 -KOP1»), не тело N0. */
export function isAllSpaceZoneRef(expression: string, ref: string): boolean {
  if (ref !== "0") return false;
  return collectZoneBodyRefs(expression)[0] === "0";
}
