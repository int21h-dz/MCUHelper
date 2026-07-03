export declare function isMatrHeaderLinePrefix(prefix: string): boolean;
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
/** Hover по активному параметру строки MATR или нуклида. */
export declare function getCompositionLineParameterHover(line: string, cursorCharacter: number): string | null;
/** @deprecated Используйте getCompositionLineParameterHover */
export declare function getNuclideLineParameterHover(line: string, cursorCharacter: number): string | null;
/** Подсказка параметров для текущей позиции курсора в строке. */
export declare function getParameterSignatureHelp(line: string, cursorCharacter: number): ParameterSignatureHelp | null;
/** Имя активного параметра для списка completion. */
export declare function getActiveParameterHint(line: string, cursorCharacter: number): ParameterHintParameter | null;
