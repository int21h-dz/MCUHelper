export interface NuclideLineParamHint {
    label: string;
    documentation: string;
}
/** Параметры одной записи нуклида в MATR (UserGuide §8.2). */
export declare const NUCLIDE_LINE_PARAM_GROUPS: NuclideLineParamHint[];
export declare function getNuclideLineParamGroups(): NuclideLineParamHint[];
