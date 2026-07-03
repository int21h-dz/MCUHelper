/**
 * Эвристическое определение исходника MCU-NR по содержимому (имя/расширение не важны).
 * Используется расширением VS Code для setTextDocumentLanguage('mcunr').
 */
export interface McunrDetectionResult {
    isMcunr: boolean;
    score: number;
    hits: string[];
}
export declare function scoreMcunrContent(text: string): McunrDetectionResult;
export declare function detectMcunrContent(text: string, threshold?: number): boolean;
