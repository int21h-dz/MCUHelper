import type { ZoneNode, ZoneTailHash, ZoneTailLegacy } from "./ast";
import {
  resolvePointerSpecGlobal,
  zoneTailToPointerSpec,
  type ResolvedZoneNumbers,
} from "./zonePointerResolution";

export type { ResolvedZoneNumbers } from "./zonePointerResolution";

/** Ключ регистрации: в CELL/LCELL имена зон часто повторяются (GROU, CLAD, …). */
export function zoneRegistrationKey(name: string, scope?: string): string {
  return `${scope ?? "global"}::${name}`;
}

export function zoneRegistrationKeyOf(zone: Pick<ZoneNode, "name" | "scope">): string {
  return zoneRegistrationKey(zone.name, zone.scope);
}

export function getResolvedZoneNumbers(
  map: Map<string, ResolvedZoneNumbers>,
  zone: Pick<ZoneNode, "name" | "scope">
): ResolvedZoneNumbers | undefined {
  return map.get(zoneRegistrationKeyOf(zone));
}

/** Разрешение хвоста зоны с учётом кэша reg → mat (формы /reg:mat и /reg[/obj]). */
export function resolveZoneTail(
  tail: ZoneTailLegacy | ZoneTailHash | null | undefined,
  regMatCache: Map<number, number>
): ResolvedZoneNumbers | null {
  const spec = zoneTailToPointerSpec(tail, regMatCache);
  if (!spec || spec.bcType) return null;
  return resolvePointerSpecGlobal(spec);
}

/**
 * По порядку объявления зон в документе.
 * Ключ — `scope::name`, иначе хвосты одноимённых зон в разных LCELL затирают друг друга.
 */
export function buildZoneRegistrationMap(zones: ZoneNode[]): Map<string, ResolvedZoneNumbers> {
  const cache = new Map<number, number>();
  const out = new Map<string, ResolvedZoneNumbers>();
  for (const z of zones) {
    const resolved = resolveZoneTail(z.tail, cache);
    if (resolved) out.set(zoneRegistrationKeyOf(z), resolved);
  }
  return out;
}

export function resolveZoneNumbers(
  zone: ZoneNode,
  regMatCache: Map<number, number>
): ResolvedZoneNumbers | null {
  return resolveZoneTail(zone.tail, regMatCache);
}
