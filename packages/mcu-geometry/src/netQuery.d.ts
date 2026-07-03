import type { BodyNode, DocumentAst, NetNode, ZoneNode } from "@mcuhelper/mcu-language";
import type { Vec3 } from "./types";
export interface CellPitch {
    e1: Vec3;
    e2: Vec3;
    e3: Vec3;
}
/** Векторы шага ячейки сети из контейнера SBOX/RPP первого тела прототипа CELL. */
export declare function cellPitchFromContainer(body: BodyNode, vars: Map<string, number>): CellPitch | null;
export interface NetCellHit {
    net: NetNode;
    cellIndex: [number, number, number];
    prototype: string;
    cellOrigin: Vec3;
    localPoint: Vec3;
}
/** Найти ячейку сети, содержащую точку p (глобальные координаты). */
export declare function resolveNetCell(ast: DocumentAst, net: NetNode, p: Vec3): NetCellHit | null;
/** @deprecated используйте resolveNetCell */
export declare function findNetCellAtPoint(ast: DocumentAst, net: NetNode, p: Vec3, _prototypeName: string): NetCellHit | null;
/** Имя прототипа из картограммы T** (строка j, столбец i — 1-based). */
export declare function netPrototypeAt(net: NetNode, i: number, j: number, k?: number): string | null;
export declare function findNetForZone(ast: DocumentAst, netName: string): NetNode | undefined;
export declare function netCarrierZones(ast: DocumentAst): ZoneNode[];
