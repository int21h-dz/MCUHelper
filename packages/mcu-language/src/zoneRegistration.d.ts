import type { ZoneNode, ZoneTailHash, ZoneTailLegacy } from "./ast";
export interface ResolvedZoneNumbers {
    materialNum?: number;
    regNum: number;
    objNum: number;
}
/** Разрешение хвоста зоны с учётом кэша reg → mat (формы /reg:mat и /reg[/obj]). */
export declare function resolveZoneTail(tail: ZoneTailLegacy | ZoneTailHash | null | undefined, regMatCache: Map<number, number>): ResolvedZoneNumbers | null;
/** По порядку объявления зон в документе. */
export declare function buildZoneRegistrationMap(zones: ZoneNode[]): Map<string, ResolvedZoneNumbers>;
export declare function resolveZoneNumbers(zone: ZoneNode, regMatCache: Map<number, number>): ResolvedZoneNumbers | null;
