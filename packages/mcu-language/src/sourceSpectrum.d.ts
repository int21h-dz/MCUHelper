import type { DocumentAst, SourceRange } from "./ast";
export interface SourceSpectrumBlock {
    /** Имя спектра из предшествующей карты ANGLEN. */
    name?: string;
    energies: number[];
    probabilities: number[];
    emesRange: SourceRange;
    eproRange?: SourceRange;
}
/** Все пары EMES+EPRO в порядке следования (модуль источников). */
export declare function collectSourceSpectra(ast: DocumentAst): SourceSpectrumBlock[];
/** Спектр, к которому относится строка (EMES, EPRO или продолжение). */
export declare function findSourceSpectrumAtLine(ast: DocumentAst, line: number): SourceSpectrumBlock | null;
