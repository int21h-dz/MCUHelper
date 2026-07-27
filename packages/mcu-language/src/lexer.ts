export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  offset: number;
}

export type TokenType =
  | "label"
  | "card"
  | "number"
  | "identifier"
  | "string"
  | "operator"
  | "comma"
  | "slash"
  | "hash"
  | "equals"
  | "lparen"
  | "rparen"
  | "repeat_open"
  | "repeat_close"
  | "pipe"
  | "newline"
  | "eof"
  | "comment"
  | "include";

import { isKnownMcuLabel } from "./schemaBridge";
import { parseIncludeLine } from "./includeResolve";

const LABEL_RE = /^[A-Za-z][A-Za-z0-9]{0,5}/;
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([Ee][+-]?\d+)?/;
const IDENT_RE = /^[A-Za-z][A-Za-z0-9]*/;

export function tokenizeLine(
  line: string,
  lineNo: number,
  startOffset: number,
  isContinuation: boolean
): Token[] {
  const tokens: Token[] = [];
  let col = 0;
  let offset = startOffset;

  if (!isContinuation && line.length > 0) {
    if (line[0] === "*") {
      tokens.push({ type: "comment", value: line, line: lineNo, column: 0, offset });
      return tokens;
    }
    if (line.startsWith("C=") || line.startsWith("C=C")) {
      tokens.push({ type: "comment", value: line, line: lineNo, column: 0, offset });
      return tokens;
    }
  }

  if (isContinuation) {
    if (line.length === 0 || line[0] !== " ") {
      // invalid continuation handled by parser
    }
  }

  let i = isContinuation ? 1 : 0;
  let firstToken = !isContinuation;

  while (i < line.length && i < 200) {
    const ch = line[i];
    if (ch === " " || ch === "\t") {
      if (ch === "\t") {
        tokens.push({ type: "operator", value: "\t", line: lineNo, column: i, offset: offset + i });
      }
      i++;
      continue;
    }

    if (ch === ";") {
      tokens.push({ type: "comment", value: line.slice(i), line: lineNo, column: i, offset: offset + i });
      break;
    }

    const rest = line.slice(i);

    if ((firstToken && rest.startsWith("#include")) || rest.startsWith("#INCLUDE")) {
      const parsed = parseIncludeLine(line);
      if (parsed) {
        tokens.push({
          type: "include",
          value: parsed.path,
          line: lineNo,
          column: parsed.pathStart,
          offset: offset + parsed.pathStart,
        });
        break;
      }
    }

    if (firstToken && LABEL_RE.test(rest)) {
      const m = rest.match(LABEL_RE)!;
      const word = m[0];
      const tokenType = isKnownMcuLabel(word) ? "card" : "label";
      tokens.push({ type: tokenType, value: word, line: lineNo, column: i, offset: offset + i });
      i += m[0].length;
      firstToken = false;
      continue;
    }

    if (rest.startsWith("[")) {
      tokens.push({ type: "repeat_open", value: "[", line: lineNo, column: i, offset: offset + i });
      i++;
      firstToken = false;
      continue;
    }
    if (ch === "]") {
      tokens.push({ type: "repeat_close", value: "]", line: lineNo, column: i, offset: offset + i });
      i++;
      continue;
    }
    if (ch === "|") {
      tokens.push({ type: "pipe", value: "|", line: lineNo, column: i, offset: offset + i });
      i++;
      continue;
    }

    if (NUMBER_RE.test(rest)) {
      const m = rest.match(NUMBER_RE)!;
      tokens.push({ type: "number", value: m[0], line: lineNo, column: i, offset: offset + i });
      i += m[0].length;
      firstToken = false;
      continue;
    }

    if (IDENT_RE.test(rest)) {
      const m = rest.match(IDENT_RE)!;
      tokens.push({ type: "identifier", value: m[0], line: lineNo, column: i, offset: offset + i });
      i += m[0].length;
      firstToken = false;
      continue;
    }

    if (ch === ",") {
      tokens.push({ type: "comma", value: ",", line: lineNo, column: i, offset: offset + i });
      i++;
      firstToken = false;
      continue;
    }
    if (ch === "/") {
      tokens.push({ type: "slash", value: "/", line: lineNo, column: i, offset: offset + i });
      i++;
      firstToken = false;
      continue;
    }
    if (ch === "#") {
      tokens.push({ type: "hash", value: "#", line: lineNo, column: i, offset: offset + i });
      i++;
      firstToken = false;
      continue;
    }
    if (ch === "=") {
      tokens.push({ type: "equals", value: "=", line: lineNo, column: i, offset: offset + i });
      i++;
      firstToken = false;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen", value: "(", line: lineNo, column: i, offset: offset + i });
      i++;
      firstToken = false;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ")", line: lineNo, column: i, offset: offset + i });
      i++;
      firstToken = false;
      continue;
    }
    if (ch === "-" || ch === "+" || ch === "U") {
      tokens.push({ type: "operator", value: ch, line: lineNo, column: i, offset: offset + i });
      i++;
      firstToken = false;
      continue;
    }

    tokens.push({ type: "operator", value: ch, line: lineNo, column: i, offset: offset + i });
    i++;
    firstToken = false;
  }

  return tokens;
}

export interface LineInfo {
  text: string;
  lineNo: number;
  offset: number;
  isContinuation: boolean;
  tokens: Token[];
}

/** Строка целиком комментарий (`**…`, `C=…`). */
function isFullCommentLine(raw: string): boolean {
  const t = raw.trimStart();
  return t.length > 0 && (t[0] === "*" || t.startsWith("C=") || t.startsWith("C=C"));
}

/** Табуляция в этой позиции строки допустима (комментарий). */
function isTabInCommentArea(raw: string, tabIdx: number): boolean {
  if (isFullCommentLine(raw)) return true;
  const semi = raw.indexOf(";");
  return semi >= 0 && tabIdx >= semi;
}

export function lexDocument(text: string): { lines: LineInfo[]; diagnostics: import("./ast").DiagnosticMessage[] } {
  const diagnostics: import("./ast").DiagnosticMessage[] = [];
  const rawLines = text.split(/\r?\n/);
  const lines: LineInfo[] = [];
  let offset = 0;
  let pendingContinuation = false;

  for (let idx = 0; idx < rawLines.length; idx++) {
    const lineNo = idx;
    const raw = rawLines[idx];
    const isContinuation = pendingContinuation || (raw.length > 0 && raw[0] === " " && !raw.startsWith(" C="));

    if (raw.includes("\t")) {
      for (let tabIdx = raw.indexOf("\t"); tabIdx >= 0; tabIdx = raw.indexOf("\t", tabIdx + 1)) {
        if (isTabInCommentArea(raw, tabIdx)) continue;
        diagnostics.push({
          severity: "error",
          message: "Символ табуляции запрещён в исходных данных MCU-NR",
          code: "no-tabs",
          range: {
            start: { line: lineNo, character: tabIdx },
            end: { line: lineNo, character: tabIdx + 1 },
            offset: offset + tabIdx,
            endOffset: offset + tabIdx + 1,
          },
        });
      }
    }

    if (raw.length > 200) {
      diagnostics.push({
        severity: "warning",
        message: "Строка длиннее 200 символов — хвост будет проигнорирован",
        code: "line-length",
        range: {
          start: { line: lineNo, character: 200 },
          end: { line: lineNo, character: raw.length },
          offset: offset + 200,
          endOffset: offset + raw.length,
        },
      });
    }

    const tokens = tokenizeLine(raw, lineNo, offset, isContinuation && raw[0] === " ");
    lines.push({ text: raw, lineNo, offset, isContinuation: isContinuation && raw[0] === " ", tokens });

    const trimmed = raw.trimEnd();
    const endsStatement =
      trimmed.includes(";") ||
      (tokens.length > 0 && (tokens[0].type === "label" || tokens[0].type === "card") && !tokens.some((t) => t.type === "comment"));

  pendingContinuation =
      raw.length > 0 &&
      raw[0] !== " " &&
      raw[0] !== "*" &&
      !raw.startsWith("C=") &&
      !trimmed.includes(";") &&
      tokens.length > 0 &&
      (tokens[0].type === "label" || tokens[0].type === "card") &&
      !["END", "FINISH", "ENDL", "ENDXCL"].includes(tokens[0].value.toUpperCase());

    if (trimmed.endsWith(";")) pendingContinuation = false;

    offset += raw.length + 1;
  }

  return { lines, diagnostics };
}
