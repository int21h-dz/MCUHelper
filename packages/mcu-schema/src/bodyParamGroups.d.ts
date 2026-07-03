/** Логические группы параметров тел (как в строке исходника, не по одному числу). */
export interface BodyParamGroup {
    label: string;
    documentation: string;
}
export declare const BODY_PARAM_GROUPS: Record<string, BodyParamGroup[]>;
export declare function getBodyParamGroups(bodyKey: string): BodyParamGroup[] | undefined;
