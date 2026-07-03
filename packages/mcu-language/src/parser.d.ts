import { FRAGMENT_ORDER } from "./constants";
import type { DocumentAst } from "./ast";
export interface ParseOptions {
    uri: string;
    baseDir?: string;
    expandInclude?: boolean;
}
export declare function parseDocument(text: string, options: ParseOptions): DocumentAst;
export { FRAGMENT_ORDER };
