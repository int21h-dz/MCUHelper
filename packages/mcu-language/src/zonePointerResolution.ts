/**
 * Условные указатели УРУ/УОУ/УМУ (UserGuide §9.1.4, §9.2.3, §9.2.5).
 * Slash: отрицательные = conditional; Hash: #IZ/#IO/#IM = conditional (положительные).
 */
import type { LatticeNode, NetNode, ZoneNode, ZoneTailHash, ZoneTailLegacy } from "./ast";
import { cartogramValueAt } from "./netCartogram";

export type ZonePointer =
  | { kind: "absolute"; value: number }
  | { kind: "conditional"; index: number };

export interface ZonePointerSpec {
  reg: ZonePointer;
  obj: ZonePointer;
  mat: ZonePointer | null;
  bcType?: string;
  inheritMat?: boolean;
}

export interface ResolvedZoneNumbers {
  materialNum?: number;
  regNum?: number;
  objNum?: number;
  regPointerIndex?: number;
  objPointerIndex?: number;
  matPointerIndex?: number;
  hasConditionalPointers?: boolean;
}

function absPointer(n: number): ZonePointer {
  if (n < 0) return { kind: "conditional", index: Math.abs(n) };
  return { kind: "absolute", value: n };
}

function pointerIndexOf(p: ZonePointer | null | undefined): number | undefined {
  return p?.kind === "conditional" ? p.index : undefined;
}

function hasConditional(spec: ZonePointerSpec): boolean {
  return (
    spec.reg.kind === "conditional" ||
    spec.obj.kind === "conditional" ||
    (spec.mat != null && spec.mat.kind === "conditional")
  );
}

/** AST хвост → спецификация указателей. */
export function zoneTailToPointerSpec(
  tail: ZoneTailLegacy | ZoneTailHash | null | undefined,
  regMatCache: Map<number, number>
): ZonePointerSpec | null {
  if (!tail) return null;

  if (tail.kind === "hash") {
    const reg: ZonePointer =
      tail.iz != null && Number.isFinite(tail.iz)
        ? { kind: "conditional", index: Math.abs(tail.iz) }
        : { kind: "absolute", value: tail.z ?? 1 };
    const obj: ZonePointer =
      tail.io != null && Number.isFinite(tail.io)
        ? { kind: "conditional", index: Math.abs(tail.io) }
        : { kind: "absolute", value: tail.o ?? 1 };
    let mat: ZonePointer | null = null;
    if (tail.im != null && Number.isFinite(tail.im)) {
      mat = { kind: "conditional", index: Math.abs(tail.im) };
    } else if (tail.m != null && Number.isFinite(tail.m)) {
      mat = { kind: "absolute", value: tail.m };
      if (reg.kind === "absolute") regMatCache.set(reg.value, tail.m);
    }
    return { reg, obj, mat };
  }

  if (tail.bcType) return { reg: { kind: "absolute", value: 1 }, obj: { kind: "absolute", value: 1 }, mat: null, bcType: tail.bcType };

  if (tail.inheritMat && tail.reg != null) {
    const reg = absPointer(tail.reg);
    const obj = tail.obj != null ? absPointer(tail.obj) : { kind: "absolute" as const, value: 1 };
    let mat: ZonePointer | null = null;
    if (reg.kind === "absolute") {
      const cached = regMatCache.get(reg.value);
      if (cached != null) mat = { kind: "absolute", value: cached };
    }
    return { reg, obj, mat, inheritMat: true };
  }

  if (tail.defaultRegObj || (tail.mat != null && tail.reg == null)) {
    const mat = tail.mat != null ? absPointer(tail.mat) : null;
    const obj = tail.obj != null ? absPointer(tail.obj) : { kind: "absolute" as const, value: 1 };
    const reg: ZonePointer = { kind: "absolute", value: 1 };
    if (mat?.kind === "absolute") regMatCache.set(1, mat.value);
    return { reg, obj, mat };
  }

  if (tail.reg != null && tail.mat != null) {
    const reg = absPointer(tail.reg);
    const mat = absPointer(tail.mat);
    const obj = tail.obj != null ? absPointer(tail.obj) : { kind: "absolute" as const, value: 1 };
    if (reg.kind === "absolute" && mat.kind === "absolute") {
      regMatCache.set(reg.value, mat.value);
    }
    return { reg, obj, mat };
  }

  if (tail.reg != null) {
    const reg = absPointer(tail.reg);
    const obj = tail.obj != null ? absPointer(tail.obj) : { kind: "absolute" as const, value: 1 };
    return { reg, obj, mat: null };
  }

  return null;
}

/** Глобальный resolve: absolute → числа; conditional → только индексы. */
export function resolvePointerSpecGlobal(spec: ZonePointerSpec): ResolvedZoneNumbers {
  const out: ResolvedZoneNumbers = {
    hasConditionalPointers: hasConditional(spec),
    regPointerIndex: pointerIndexOf(spec.reg),
    objPointerIndex: pointerIndexOf(spec.obj),
    matPointerIndex: pointerIndexOf(spec.mat),
  };
  if (spec.reg.kind === "absolute") out.regNum = spec.reg.value;
  if (spec.obj.kind === "absolute") out.objNum = spec.obj.value;
  if (spec.mat?.kind === "absolute") out.materialNum = spec.mat.value;
  return out;
}

function parseCartogramNumber(raw: string | null): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return undefined;
  return n;
}

/**
 * Перекодировка в ячейке NET через картограммы P/O/M.
 * Absolute указатели не трогаем; conditional → lookup; вложенные отриц. в P/O = УРУ элемента (не здесь).
 */
export function resolveZoneAtNetCell(
  spec: ZonePointerSpec,
  net: NetNode,
  cellIndex: [number, number, number],
  regMatCache: Map<number, number>
): ResolvedZoneNumbers {
  const [i, j, k] = cellIndex;
  const base = resolvePointerSpecGlobal(spec);

  const resolveOne = (
    p: ZonePointer,
    cartogram: NetNode["regCartogram"]
  ): { absolute?: number; nestedConditional?: number } => {
    if (p.kind === "absolute") return { absolute: p.value };
    const raw = cartogramValueAt(cartogram, p.index, i, j, k, net.cols);
    const n = parseCartogramNumber(raw);
    if (n == null) return {};
    if (n < 0) return { nestedConditional: Math.abs(n) };
    return { absolute: n };
  };

  const regR = resolveOne(spec.reg, net.regCartogram);
  const objR = resolveOne(spec.obj, net.objCartogram);
  let matR: { absolute?: number; nestedConditional?: number } = {};
  if (spec.mat) {
    matR = resolveOne(spec.mat, net.matCartogram);
  } else if (regR.absolute != null) {
    const cached = regMatCache.get(regR.absolute);
    if (cached != null) matR = { absolute: cached };
  }

  const out: ResolvedZoneNumbers = {
    hasConditionalPointers: true,
    regPointerIndex: base.regPointerIndex ?? (regR.nestedConditional != null ? regR.nestedConditional : undefined),
    objPointerIndex: base.objPointerIndex ?? (objR.nestedConditional != null ? objR.nestedConditional : undefined),
    matPointerIndex: base.matPointerIndex ?? (matR.nestedConditional != null ? matR.nestedConditional : undefined),
  };
  if (regR.absolute != null) out.regNum = regR.absolute;
  else if (spec.reg.kind === "absolute") out.regNum = spec.reg.value;

  if (objR.absolute != null) out.objNum = objR.absolute;
  else if (spec.obj.kind === "absolute") out.objNum = spec.obj.value;

  if (matR.absolute != null) out.materialNum = matR.absolute;
  else if (spec.mat?.kind === "absolute") out.materialNum = spec.mat.value;

  if (out.regNum != null && out.materialNum != null) {
    regMatCache.set(out.regNum, out.materialNum);
  }
  return out;
}

/**
 * LATT / LCELL: §9.2.5 — Npm/Nom.
 * УРУ k → Npm+k; УОУ k → Nom+k.
 * УМУ в LCELL не описан — оставляем absolute mat как есть.
 */
export function resolveZoneAtLatticeElement(
  spec: ZonePointerSpec,
  npm: number,
  nom: number,
  regMatCache: Map<number, number>
): ResolvedZoneNumbers {
  const out: ResolvedZoneNumbers = {
    hasConditionalPointers: hasConditional(spec),
    regPointerIndex: pointerIndexOf(spec.reg),
    objPointerIndex: pointerIndexOf(spec.obj),
    matPointerIndex: pointerIndexOf(spec.mat),
  };

  if (spec.reg.kind === "absolute") {
    out.regNum = spec.reg.value;
  } else {
    out.regNum = npm + spec.reg.index;
  }

  if (spec.obj.kind === "absolute") {
    out.objNum = spec.obj.value;
  } else {
    out.objNum = nom + spec.obj.index;
  }

  if (spec.mat?.kind === "absolute") {
    out.materialNum = spec.mat.value;
  } else if (spec.mat?.kind === "conditional") {
    // УМУ в LATT не описан — сохраняем индекс, без числа
  } else if (out.regNum != null && spec.inheritMat) {
    out.materialNum = regMatCache.get(out.regNum);
  }

  if (out.regNum != null && out.materialNum != null) {
    regMatCache.set(out.regNum, out.materialNum);
  }
  return out;
}

/** Макс. абсолютный reg/obj среди зон (для Npm/Nom). */
export function computeNpmNom(zones: readonly ZoneNode[]): { npm: number; nom: number } {
  let npm = 0;
  let nom = 0;
  const cache = new Map<number, number>();
  for (const z of zones) {
    const spec = zoneTailToPointerSpec(z.tail, cache);
    if (!spec) continue;
    if (spec.reg.kind === "absolute" && spec.reg.value > npm) npm = spec.reg.value;
    if (spec.obj.kind === "absolute" && spec.obj.value > nom) nom = spec.obj.value;
  }
  return { npm, nom };
}

/** Макс. УРУ/УОУ в наборе зон (для инкремента Npm после элемента). */
export function maxConditionalIndices(zones: readonly ZoneNode[]): { maxUru: number; maxUou: number } {
  let maxUru = 0;
  let maxUou = 0;
  const cache = new Map<number, number>();
  for (const z of zones) {
    const spec = zoneTailToPointerSpec(z.tail, cache);
    if (!spec) continue;
    if (spec.reg.kind === "conditional" && spec.reg.index > maxUru) maxUru = spec.reg.index;
    if (spec.obj.kind === "conditional" && spec.obj.index > maxUou) maxUou = spec.obj.index;
  }
  return { maxUru, maxUou };
}

/**
 * Resolve зоны с опциональным NET/LATT контекстом.
 * Без контекста — global (conditional без чисел).
 */
export function resolveZoneNumbersInContext(
  zone: ZoneNode,
  regMatCache: Map<number, number>,
  ctx?:
    | { kind: "net"; net: NetNode; cellIndex: [number, number, number] }
    | { kind: "lattice"; npm: number; nom: number }
): ResolvedZoneNumbers | null {
  const spec = zoneTailToPointerSpec(zone.tail, regMatCache);
  if (!spec || spec.bcType) return null;
  if (!ctx) return resolvePointerSpecGlobal(spec);
  if (ctx.kind === "net") return resolveZoneAtNetCell(spec, ctx.net, ctx.cellIndex, regMatCache);
  return resolveZoneAtLatticeElement(spec, ctx.npm, ctx.nom, regMatCache);
}

/** Есть ли у зоны условные указатели (для UI). */
export function zoneHasConditionalPointers(zone: ZoneNode): boolean {
  const cache = new Map<number, number>();
  const spec = zoneTailToPointerSpec(zone.tail, cache);
  return spec != null && hasConditional(spec);
}

/** Заглушка: LATT typeMap не используется для P/O/M (см. §9.2.5). */
export function latticeHasPointerCartograms(_lat: LatticeNode): boolean {
  return false;
}
