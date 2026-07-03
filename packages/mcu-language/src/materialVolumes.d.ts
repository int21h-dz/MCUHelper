import type { DocumentAst } from "./ast";
/** Объёмы материалов (см³) по порядку номеров MATR: V1 → материал 1, … */
export declare function parseMaterialVolumes(ast: DocumentAst): number[] | null;
export declare function materialVolumeCm3(volumes: number[] | null | undefined, materialNumber: number): number | null;
export interface MaterialMassRow {
    number: number;
    volumeCm3: number | null;
    massDensityGcm3: number | null;
    massG: number | null;
}
export declare function buildMaterialMassRows(ast: DocumentAst): MaterialMassRow[];
export declare function totalMaterialMassG(rows: MaterialMassRow[]): number;
export declare function formatMassG(massG: number): string;
/** Удельная энерговыработка: МВт·сут/кг (MW·d/kg). */
export declare function specificBurnupMwdPerKg(energyKwd: number, totalMassG: number): number | null;
export declare function formatSpecificBurnupMwdPerKg(energyKwd: number, totalMassG: number): string | null;
export declare function formatMaterialMassTable(rows: MaterialMassRow[]): string;
export declare function formatVolCardHover(ast: DocumentAst): string;
