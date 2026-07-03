import type { ZoneNode, ZoneTailHash, ZoneTailLegacy } from "./ast";

export interface ResolvedZoneNumbers {
  materialNum?: number;
  regNum: number;
  objNum: number;
}

/** Разрешение хвоста зоны с учётом кэша reg → mat (формы /reg:mat и /reg[/obj]). */
export function resolveZoneTail(
  tail: ZoneTailLegacy | ZoneTailHash | null | undefined,
  regMatCache: Map<number, number>
): ResolvedZoneNumbers | null {
  if (!tail) return null;

  if (tail.kind === "hash") {
    const regNum = tail.z ?? 1;
    const objNum = tail.o ?? 1;
    const materialNum = tail.m;
    if (materialNum != null) regMatCache.set(regNum, materialNum);
    return { materialNum, regNum, objNum };
  }

  if (tail.bcType) return null;

  if (tail.inheritMat) {
    const regNum = tail.reg!;
    const objNum = tail.obj ?? 1;
    const materialNum = regMatCache.get(regNum);
    return { materialNum, regNum, objNum };
  }

  if (tail.defaultRegObj || (tail.mat != null && tail.reg == null)) {
    const materialNum = tail.mat!;
    const regNum = 1;
    const objNum = tail.obj ?? 1;
    regMatCache.set(regNum, materialNum);
    return { materialNum, regNum, objNum };
  }

  if (tail.reg != null && tail.mat != null) {
    const regNum = tail.reg;
    const materialNum = tail.mat;
    const objNum = tail.obj ?? 1;
    regMatCache.set(regNum, materialNum);
    return { materialNum, regNum, objNum };
  }

  return null;
}

/** По порядку объявления зон в документе. */
export function buildZoneRegistrationMap(zones: ZoneNode[]): Map<string, ResolvedZoneNumbers> {
  const cache = new Map<number, number>();
  const out = new Map<string, ResolvedZoneNumbers>();
  for (const z of zones) {
    const resolved = resolveZoneTail(z.tail, cache);
    if (resolved) out.set(z.name, resolved);
  }
  return out;
}

export function resolveZoneNumbers(
  zone: ZoneNode,
  regMatCache: Map<number, number>
): ResolvedZoneNumbers | null {
  return resolveZoneTail(zone.tail, regMatCache);
}
