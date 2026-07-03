export interface Token {
    type: TokenType;
    value: string;
    line: number;
    column: number;
    offset: number;
}
export type TokenType = "label" | "card" | "number" | "identifier" | "string" | "operator" | "comma" | "slash" | "hash" | "equals" | "lparen" | "rparen" | "repeat_open" | "repeat_close" | "pipe" | "newline" | "eof" | "comment" | "include";
export declare function tokenizeLine(line: string, lineNo: number, startOffset: number, isContinuation: boolean): Token[];
export interface LineInfo {
    text: string;
    lineNo: number;
    offset: number;
    isContinuation: boolean;
    tokens: Token[];
}
export declare function lexDocument(text: string): {
    lines: LineInfo[];
    diagnostics: import("./ast").DiagnosticMessage[];
};
