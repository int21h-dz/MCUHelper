import type { IncludeLineMapEntry } from "./ast";
export interface IncludeExpandError {
    message: string;
    includePath: string;
    mainLine: number;
}
export interface ExpandIncludesResult {
    text: string;
    includes: string[];
    errors: IncludeExpandError[];
    lineMap: IncludeLineMapEntry[];
}
export declare function expandIncludes(text: string, baseDir: string): ExpandIncludesResult;
export declare function expandRepeats(text: string): string;
