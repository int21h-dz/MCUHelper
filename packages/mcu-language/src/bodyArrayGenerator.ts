import { allocateBodyName, buildBodyStatement, isValidBodyName, sanitizeBodyName } from "./bodyGenerator";

export const TRANSF_FORBIDDEN_FOR_ARRAY = new Set(["RPP", "SBOX", "SHEX", "PLX", "PLY", "UCX", "UCY"]);

export function patternCanUseTransf(bodyType: string, useTransfCandidate: boolean): { ok: boolean; reason: string } {
  if (!useTransfCandidate) {
    return { ok: false, reason: "TRANSF недоступен: этот паттерн — сдвиг, не поворот/зеркало." };
  }
  const t = (bodyType || "").toUpperCase();
  if (t === "TRANSF") {
    return { ok: false, reason: "TRANSF недоступен: исходник уже TRANSF (каскад запрещён)." };
  }
  if (TRANSF_FORBIDDEN_FOR_ARRAY.has(t)) {
    return { ok: false, reason: `TRANSF недоступен: тип ${t} не может быть прототипом (UserGuide §9.1.3.22).` };
  }
  return { ok: true, reason: "" };
}
/** Макс. экземпляров за одну вставку (127 = типичная ТВС, rings=6). */
export const MAX_BODY_ARRAY_COUNT = 128;
export const BODY_ARRAY_WARN_COUNT = 32;

/** Число позиций в заполненной гексагональной решётке (как ТВС): N = 1 + 3·R·(R+1). */
export function hexLatticeInstanceCount(rings: number): number {
  if (!Number.isFinite(rings) || rings < 0) return 0;
  const r = Math.round(rings);
  return 1 + 3 * r * (r + 1);
}

export type PatternPose =
  | { kind: "T"; dx: number; dy: number; dz: number }
  | { kind: "R"; A: number; B: number; f: number }
  | { kind: "M"; A: number; B: number; f: number };

export interface PatternInstance {
  index: number;
  pose: PatternPose;
}

export type BodyPatternGroup = "none" | "array" | "curve" | "mirror";
export type BodyPatternMode =
  | "linear"
  | "rect"
  | "hexRings"
  | "segment"
  | "ring"
  | "trianglePerimeter"
  | "hexPerimeter"
  | "mirror";

export interface BuildPatternInput {
  group: BodyPatternGroup;
  mode?: BodyPatternMode;
  values?: Record<string, number | string | boolean | undefined>;
  seedAnchor?: { x: number; y: number; z: number };
}

export interface BuildPatternResult {
  instances: PatternInstance[];
  warnings: string[];
  ok: boolean;
  useTransfCandidate: boolean;
  summary: string;
}

export interface EmitBodyArrayInput {
  seed: { bodyType: string; name: string; params: string[] };
  instances: PatternInstance[];
  expand: boolean;
  canUseTransf: boolean;
  existingNames?: Iterable<string>;
  transformExpanded?: (pose: PatternPose) => string[] | null;
}

export interface EmitBodyArrayResult {
  text: string;
  warnings: string[];
  okToInsert: boolean;
  summary: string;
  names: string[];
}

function num(values: Record<string, number | string | boolean | undefined> | undefined, key: string): number {
  const v = values?.[key];
  return typeof v === "number" ? v : Number(v);
}

function str(values: Record<string, number | string | boolean | undefined> | undefined, key: string): string {
  const v = values?.[key];
  return typeof v === "string" ? v : String(v ?? "");
}

function nonEmptyVec3(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Math.hypot(x, y, z) > 1e-12;
}

function isIdentityPose(pose: PatternPose): boolean {
  if (pose.kind === "T") return Math.hypot(pose.dx, pose.dy, pose.dz) < 1e-12;
  // R с нулевым углом не двигает тело; M всегда отражение.
  if (pose.kind === "R") return Math.abs(pose.f) < 1e-12;
  return false;
}

/** Угол TRANSF R относительно уже повёрнутого исходника (pose0). */
function relativeTransfPose(pose0: PatternPose | undefined, pose: PatternPose): PatternPose {
  if (!pose0 || pose0.kind !== "R" || pose.kind !== "R") return pose;
  if (Math.abs(pose0.A - pose.A) > 1e-12 || Math.abs(pose0.B - pose.B) > 1e-12) return pose;
  return { kind: "R", A: pose.A, B: pose.B, f: pose.f - pose0.f };
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.abs(n) < 1e-12 ? 0 : n;
  return Number(rounded.toFixed(9)).toString();
}

const PURE_NUMBER_RE = /^-?\d*\.?\d+(e[+-]?\d+)?$/i;

/** Сдвиг параметра с сохранением EQU/выражения: LG2 + 3 → LG2+3. */
export function formatParamWithDelta(base: string, delta: number): string {
  const t = String(base ?? "").trim();
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-12) return t || "0";
  if (t && PURE_NUMBER_RE.test(t)) {
    return fmtNum(Number(t) + delta);
  }
  const sign = delta >= 0 ? "+" : "-";
  return `${t || "0"}${sign}${fmtNum(Math.abs(delta))}`;
}

/**
 * Сдвиг параметров тела как translateBodyParams, но с сохранением исходных строк EQU.
 * Неизменённые поля (H, D, f…) копируются как есть.
 */
export function applyTranslateToBodyParamStrings(
  bodyType: string,
  params: string[],
  dx: number,
  dy: number,
  dz: number
): string[] | null {
  const t = bodyType.toUpperCase();
  const out = params.map((p) => String(p ?? "").trim());
  const addXYZ = (i: number) => {
    out[i] = formatParamWithDelta(out[i] ?? "0", dx);
    out[i + 1] = formatParamWithDelta(out[i + 1] ?? "0", dy);
    out[i + 2] = formatParamWithDelta(out[i + 2] ?? "0", dz);
  };
  switch (t) {
    case "SPH":
      if (out.length < 4) return null;
      addXYZ(0);
      return out;
    case "RCC":
      if (out.length < 7) return null;
      addXYZ(0);
      return out;
    case "RCZ":
      if (out.length < 5) return null;
      addXYZ(0);
      return out;
    case "UCZ":
      if (out.length < 3) return null;
      out[0] = formatParamWithDelta(out[0] ?? "0", dx);
      out[1] = formatParamWithDelta(out[1] ?? "0", dy);
      return out;
    case "UCX":
      if (out.length < 3) return null;
      out[0] = formatParamWithDelta(out[0] ?? "0", dy);
      out[1] = formatParamWithDelta(out[1] ?? "0", dz);
      return out;
    case "UCY":
      if (out.length < 3) return null;
      out[0] = formatParamWithDelta(out[0] ?? "0", dx);
      out[1] = formatParamWithDelta(out[1] ?? "0", dz);
      return out;
    case "HEX":
      if (out.length < 6) return null;
      addXYZ(0);
      return out;
    case "HEXX":
    case "HEXY":
      if (out.length < 5) return null;
      addXYZ(0);
      return out;
    case "HEXG":
      if (out.length < 9) return null;
      addXYZ(0);
      return out;
    case "BOX":
    case "WED":
      if (out.length < 12) return null;
      addXYZ(0);
      return out;
    case "ELL": {
      if (out.length < 7) return null;
      addXYZ(0);
      const focusRaw = out[6] ?? "0";
      const focusNum = Number(focusRaw);
      // Как translateBodyParams: второй центр двигаем, если focus ≥ 0 (или EQU — неизвестно, двигаем).
      const moveFocus = !PURE_NUMBER_RE.test(focusRaw) || (Number.isFinite(focusNum) && focusNum >= 0);
      if (moveFocus) addXYZ(3);
      return out;
    }
    case "SLA":
      if (out.length < 6) return null;
      addXYZ(0);
      return out;
    case "SLB": {
      if (out.length < 5) return null;
      const nx = Number(out[0]);
      const ny = Number(out[1]);
      const nz = Number(out[2]);
      if (![nx, ny, nz].every(Number.isFinite)) return null;
      const add = nx * dx + ny * dy + nz * dz;
      out[3] = formatParamWithDelta(out[3] ?? "0", add);
      out[4] = formatParamWithDelta(out[4] ?? "0", add);
      return out;
    }
    case "PLG": {
      if (out.length < 4) return null;
      const nx = Number(out[0]);
      const ny = Number(out[1]);
      const nz = Number(out[2]);
      if (![nx, ny, nz].every(Number.isFinite)) return null;
      out[3] = formatParamWithDelta(out[3] ?? "0", nx * dx + ny * dy + nz * dz);
      return out;
    }
    case "PLX":
      if (!out.length) return null;
      out[0] = formatParamWithDelta(out[0] ?? "0", dx);
      return out;
    case "PLY":
      if (!out.length) return null;
      out[0] = formatParamWithDelta(out[0] ?? "0", dy);
      return out;
    case "PLZ":
      if (!out.length) return null;
      out[0] = formatParamWithDelta(out[0] ?? "0", dz);
      return out;
    case "TRC":
      if (out.length < 8) return null;
      addXYZ(0);
      return out;
    case "REC":
      if (out.length < 12) return null;
      addXYZ(0);
      return out;
    case "RPP":
      if (out.length < 6) return null;
      out[0] = formatParamWithDelta(out[0] ?? "0", dx);
      out[1] = formatParamWithDelta(out[1] ?? "0", dx);
      out[2] = formatParamWithDelta(out[2] ?? "0", dy);
      out[3] = formatParamWithDelta(out[3] ?? "0", dy);
      out[4] = formatParamWithDelta(out[4] ?? "0", dz);
      out[5] = formatParamWithDelta(out[5] ?? "0", dz);
      return out;
    case "SBOX":
      if (out.length < 9) return null;
      if (Math.hypot(dx, dy, dz) < 1e-12) return out;
      return null;
    case "SHEX":
      return null;
    default:
      return null;
  }
}

/**
 * После поворота/зеркала: поля, численно не изменившиеся, оставляем исходными строками (EQU).
 */
export function mergePreservedParamStrings(
  seedParams: string[],
  resolvedNums: number[],
  nextNums: number[]
): string[] {
  return nextNums.map((n, i) => {
    const orig = resolvedNums[i];
    if (Number.isFinite(orig) && Number.isFinite(n) && Math.abs(n - orig) < 1e-9) {
      const s = String(seedParams[i] ?? "").trim();
      return s || fmtNum(n);
    }
    return fmtNum(n);
  });
}

function parseCount(raw: number, warnings: string[], label: string, min = 1): number {
  if (!Number.isFinite(raw)) {
    warnings.push(`${label}: ожидалось число.`);
    return 0;
  }
  const n = Math.round(raw);
  if (Math.abs(n - raw) > 1e-9) warnings.push(`${label}: будет округлено до ${n}.`);
  if (n < min) {
    warnings.push(`${label}: должно быть ≥ ${min}.`);
    return 0;
  }
  if (n > MAX_BODY_ARRAY_COUNT) {
    warnings.push(`${label}: лимит ${MAX_BODY_ARRAY_COUNT} экземпляров для одной вставки.`);
    return 0;
  }
  if (n > BODY_ARRAY_WARN_COUNT) {
    warnings.push(`${label}: ${n} экземпляров — превью и вставка будут тяжёлыми.`);
  }
  return n;
}

function parseRings(raw: number, warnings: string[]): number {
  if (!Number.isFinite(raw)) {
    warnings.push("rings: ожидалось число.");
    return -1;
  }
  const n = Math.round(raw);
  if (Math.abs(n - raw) > 1e-9) warnings.push(`rings: будет округлено до ${n}.`);
  if (n < 0) {
    warnings.push("rings: должно быть ≥ 0.");
    return -1;
  }
  return n;
}

function samplePolyline(vertices: Array<{ x: number; y: number }>, count: number): Array<{ x: number; y: number }> {
  const pts = vertices.slice();
  if (pts.length < 2) return [];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLens.push(len);
    total += len;
  }
  if (!(total > 1e-12)) return [];
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    let t = (total * i) / count;
    let seg = 0;
    while (seg < segLens.length - 1 && t > segLens[seg]!) {
      t -= segLens[seg]!;
      seg++;
    }
    const a = pts[seg]!;
    const b = pts[(seg + 1) % pts.length]!;
    const len = segLens[seg]!;
    const k = len > 1e-12 ? t / len : 0;
    out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  }
  return out;
}

function regularPolygonVertices(
  sides: number,
  cx: number,
  cy: number,
  size: number,
  sizeMode: string,
  phiDeg: number
): Array<{ x: number; y: number }> {
  const phi = (phiDeg * Math.PI) / 180;
  let radius = size;
  if (sizeMode === "side") {
    radius = sides === 3 ? size / Math.sqrt(3) : size;
  } else if (sizeMode === "flat" && sides === 6) {
    radius = size / Math.sqrt(3);
  }
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < sides; i++) {
    const a = phi + (2 * Math.PI * i) / sides;
    out.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return out;
}

/**
 * Заполненная гексагональная решётка (close-packed): центр + все ячейки в радиусе rings.
 * Ориентация flat-top как HEXX f=0: соседи по ±X на расстоянии pitch (центр–центр).
 * Перебор axial (q,r) в шестиугольнике радиуса rings — симметрично вокруг (0,0).
 */
function buildHexLatticeOffsets(rings: number, pitch: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
  if (rings <= 0 || !(pitch > 0)) return out;
  const axialToXy = (q: number, r: number) => ({
    x: pitch * (q + r / 2),
    y: pitch * (Math.sqrt(3) / 2) * r,
  });
  for (let q = -rings; q <= rings; q++) {
    const rMin = Math.max(-rings, -q - rings);
    const rMax = Math.min(rings, -q + rings);
    for (let r = rMin; r <= rMax; r++) {
      if (q === 0 && r === 0) continue;
      out.push(axialToXy(q, r));
    }
  }
  return out;
}

export function buildPatternInstances(input: BuildPatternInput): BuildPatternResult {
  const warnings: string[] = [];
  const values = input.values ?? {};
  const mode = input.group === "mirror" ? "mirror" : input.mode;
  if (input.group === "none" || !mode) {
    return {
      instances: [{ index: 0, pose: { kind: "T", dx: 0, dy: 0, dz: 0 } }],
      warnings,
      ok: true,
      useTransfCandidate: false,
      summary: "1×seed",
    };
  }

  const instances: PatternInstance[] = [{ index: 0, pose: { kind: "T", dx: 0, dy: 0, dz: 0 } }];
  let useTransfCandidate = false;
  let blocking = false;

  if (mode === "mirror") {
    const A = num(values, "A");
    const B = num(values, "B");
    const f = num(values, "f");
    if (![A, B, f].every(Number.isFinite)) {
      warnings.push("Зеркало: A, B и f должны быть числами.");
      blocking = true;
    } else {
      instances.push({ index: 1, pose: { kind: "M", A, B, f } });
      useTransfCandidate = true;
    }
  } else if (mode === "linear") {
    const n = parseCount(num(values, "count"), warnings, "N", 2);
    const stepMode = str(values, "stepMode") || "vector";
    let sx = 0;
    let sy = 0;
    let sz = 0;
    if (stepMode === "lengthDir") {
      const L = num(values, "length");
      const dx = num(values, "dirX");
      const dy = num(values, "dirY");
      const dz = num(values, "dirZ");
      if (!Number.isFinite(L) || !(L > 0)) {
        warnings.push("Линейный массив: длина шага должна быть > 0.");
        blocking = true;
      }
      if (!nonEmptyVec3(dx, dy, dz)) {
        warnings.push("Линейный массив: направление не должно быть нулевым.");
        blocking = true;
      }
      const len = Math.hypot(dx, dy, dz) || 1;
      sx = (L * dx) / len;
      sy = (L * dy) / len;
      sz = (L * dz) / len;
    } else {
      sx = num(values, "sx");
      sy = num(values, "sy");
      sz = num(values, "sz");
      if (!nonEmptyVec3(sx, sy, sz)) {
        warnings.push("Линейный массив: вектор шага не должен быть нулевым.");
        blocking = true;
      }
    }
    if (!blocking && n >= 2) {
      for (let i = 1; i < n; i++) instances.push({ index: i, pose: { kind: "T", dx: i * sx, dy: i * sy, dz: i * sz } });
    } else blocking = true;
  } else if (mode === "rect") {
    const n1 = parseCount(num(values, "n1"), warnings, "N1");
    const n2 = parseCount(num(values, "n2"), warnings, "N2");
    const ux = num(values, "ux");
    const uy = num(values, "uy");
    const uz = num(values, "uz");
    const vx = num(values, "vx");
    const vy = num(values, "vy");
    const vz = num(values, "vz");
    if (!nonEmptyVec3(ux, uy, uz) || !nonEmptyVec3(vx, vy, vz)) {
      warnings.push("Прямоугольный массив: оба вектора шага должны быть ненулевыми.");
      blocking = true;
    }
    if (n1 > 0 && n2 > 0 && n1 * n2 > MAX_BODY_ARRAY_COUNT) {
      warnings.push(`N1×N2: лимит ${MAX_BODY_ARRAY_COUNT} экземпляров для одной вставки.`);
      blocking = true;
    } else if (!blocking && n1 > 0 && n2 > 0) {
      let idx = 1;
      for (let j = 0; j < n2; j++) {
        for (let i = 0; i < n1; i++) {
          if (i === 0 && j === 0) continue;
          instances.push({
            index: idx++,
            pose: { kind: "T", dx: i * ux + j * vx, dy: i * uy + j * vy, dz: i * uz + j * vz },
          });
        }
      }
    } else blocking = true;
  } else if (mode === "hexRings") {
    const rings = parseRings(num(values, "rings"), warnings);
    const pitch = num(values, "pitch");
    if (!Number.isFinite(pitch) || !(pitch > 0)) {
      warnings.push("Гексагональная решётка: шаг должен быть > 0.");
      blocking = true;
    }
    const total = rings >= 0 ? hexLatticeInstanceCount(rings) : 0;
    if (total > MAX_BODY_ARRAY_COUNT) {
      warnings.push(`Гексагональная решётка: ${total} экземпляров превышает лимит ${MAX_BODY_ARRAY_COUNT}.`);
      blocking = true;
    }
    if (!blocking && rings > 0 && pitch > 0) {
      const pts = buildHexLatticeOffsets(rings, pitch);
      pts.slice(1).forEach((p, i) => instances.push({ index: i + 1, pose: { kind: "T", dx: p.x, dy: p.y, dz: 0 } }));
    } else if (rings === 0) {
      warnings.push("N: должно быть ≥ 2.");
      blocking = true;
    } else blocking = true;
  } else if (mode === "segment") {
    const n = parseCount(num(values, "count"), warnings, "N", 2);
    const x1 = num(values, "x1");
    const y1 = num(values, "y1");
    const z1 = num(values, "z1");
    const anchor = input.seedAnchor;
    if (!anchor) {
      warnings.push("Отрезок: не удалось определить опорную точку тела.");
      blocking = true;
    }
    if (![x1, y1, z1].every(Number.isFinite)) {
      warnings.push("Отрезок: конец (P1) должен быть числом (можно EQU).");
      blocking = true;
    }
    if (!blocking && anchor && n >= 2) {
      // Начало всегда центр исходника: копии равномерно до P1.
      for (let i = 1; i < n; i++) {
        const t = i / Math.max(1, n - 1);
        instances.push({
          index: i,
          pose: {
            kind: "T",
            dx: (x1 - anchor.x) * t,
            dy: (y1 - anchor.y) * t,
            dz: (z1 - anchor.z) * t,
          },
        });
      }
    } else blocking = true;
  } else if (mode === "ring") {
    const n = parseCount(num(values, "count"), warnings, "N", 2);
    const A = num(values, "cx");
    const B = num(values, "cy");
    const f0 = num(values, "f0");
    if (![A, B, f0].every(Number.isFinite) || n < 2) {
      if (![A, B, f0].every(Number.isFinite)) warnings.push("Кольцо: центр и стартовый угол должны быть числами.");
      blocking = true;
    } else {
      const step = 360 / n;
      // f0 поворачивает всё кольцо, включая исходник (абсолютные углы от исходного положения).
      if (Math.abs(f0) > 1e-12) {
        instances[0] = { index: 0, pose: { kind: "R", A, B, f: f0 } };
      }
      for (let i = 1; i < n; i++) {
        instances.push({ index: i, pose: { kind: "R", A, B, f: f0 + i * step } });
      }
      useTransfCandidate = true;
    }
  } else if (mode === "trianglePerimeter" || mode === "hexPerimeter") {
    const n = parseCount(num(values, "count"), warnings, "N", 2);
    const ref = str(values, "perimeterRef") === "seed" ? "seed" : "center";
    const phi = num(values, "phi");
    const size = num(values, "size");
    const sizeMode = str(values, "sizeMode") || (mode === "hexPerimeter" ? "flat" : "side");
    const anchor = input.seedAnchor;
    if (!anchor) {
      warnings.push("Периметр: не удалось определить опорную точку тела.");
      blocking = true;
    }
    if (!Number.isFinite(phi) || !Number.isFinite(size) || !(size > 0)) {
      warnings.push("Периметр: поворот и размер должны быть корректными.");
      blocking = true;
    }
    const cx = num(values, "cx");
    const cy = num(values, "cy");
    if (ref === "center" && (![cx, cy].every(Number.isFinite))) {
      warnings.push("Периметр: центр (cx, cy) должен быть числом (можно EQU).");
      blocking = true;
    }
    if (!blocking && anchor && n >= 2) {
      const sides = mode === "trianglePerimeter" ? 3 : 6;
      const verts =
        ref === "seed"
          ? (() => {
              const local = regularPolygonVertices(sides, 0, 0, size, sizeMode, phi);
              const v0 = local[0]!;
              return local.map((p) => ({ x: p.x + anchor.x - v0.x, y: p.y + anchor.y - v0.y }));
            })()
          : regularPolygonVertices(sides, cx, cy, size, sizeMode, phi);
      const samples = samplePolyline(verts, n);
      const origin = ref === "seed" ? samples[0]! : { x: anchor.x, y: anchor.y };
      if (ref === "center" && samples[0]) {
        instances[0] = {
          index: 0,
          pose: { kind: "T", dx: samples[0].x - anchor.x, dy: samples[0].y - anchor.y, dz: 0 },
        };
      }
      for (let i = 1; i < samples.length; i++) {
        instances.push({
          index: i,
          pose: {
            kind: "T",
            dx: samples[i]!.x - origin.x,
            dy: samples[i]!.y - origin.y,
            dz: 0,
          },
        });
      }
    } else blocking = true;
  } else {
    warnings.push(`Неподдерживаемый режим: ${mode}`);
    blocking = true;
  }

  if (!blocking && instances.length < 2) {
    warnings.push("N: должно быть ≥ 2.");
    blocking = true;
  }

  return {
    instances,
    warnings,
    ok: !blocking,
    useTransfCandidate,
    summary: `${instances.length}×seed`,
  };
}

/** Исключение копий массива (индексы ≥ 1). Исходник (0) всегда остаётся. */
export function applyPatternExclusions(
  instances: PatternInstance[],
  excludedIndices: readonly number[] | undefined
): {
  instances: PatternInstance[];
  excludedCount: number;
  warnings: string[];
  ok: boolean;
} {
  const excluded = new Set<number>();
  for (const raw of excludedIndices ?? []) {
    const i = Math.round(Number(raw));
    if (!Number.isFinite(i) || i < 1 || i >= instances.length) continue;
    excluded.add(i);
  }
  if (excluded.size === 0) {
    return { instances, excludedCount: 0, warnings: [], ok: true };
  }
  const filtered = instances.filter((_, i) => !excluded.has(i));
  if (filtered.length < 1) {
    return {
      instances,
      excludedCount: excluded.size,
      warnings: ["Исключены все элементы — нужен хотя бы исходник."],
      ok: false,
    };
  }
  return { instances: filtered, excludedCount: excluded.size, warnings: [], ok: true };
}

export function pruneExcludedIndices(excludedIndices: readonly number[] | undefined, instanceCount: number): number[] {
  return (excludedIndices ?? []).filter((raw) => {
    const i = Math.round(Number(raw));
    return Number.isFinite(i) && i >= 1 && i < instanceCount;
  });
}

function buildSummary(seedType: string, seedCount: number, transfCount: number, expand: boolean): string {
  if (seedCount <= 1) return `1×${seedType}`;
  if (transfCount > 0 && !expand) return `1×${seedType} + ${transfCount}×TRANSF`;
  return `${seedCount}×${seedType} (развёртка)`;
}

export function emitBodyArray(input: EmitBodyArrayInput): EmitBodyArrayResult {
  const warnings: string[] = [];
  const names: string[] = [];
  const used = new Set<string>();
  for (const n of input.existingNames ?? []) {
    const u = String(n ?? "").trim().toUpperCase();
    if (u) used.add(u);
  }
  const seedName = sanitizeBodyName(input.seed.name);
  if (!isValidBodyName(seedName) || seedName === "*") {
    return { text: "", warnings: ["Имя исходного тела недопустимо."], okToInsert: false, summary: "", names: [] };
  }
  let seedParams = input.seed.params;
  const pose0 = input.instances[0]?.pose;
  if (pose0 && !isIdentityPose(pose0)) {
    if (!input.transformExpanded) {
      return {
        text: "",
        warnings: ["Развёртка недоступна: нет функции преобразования параметров."],
        okToInsert: false,
        summary: "",
        names: [],
      };
    }
    const moved = input.transformExpanded(pose0);
    if (!moved) {
      return {
        text: "",
        warnings: ["Не удалось перенести исходник на контур."],
        okToInsert: false,
        summary: "",
        names: [],
      };
    }
    seedParams = moved;
  }
  const seedBuilt = buildBodyStatement({ ...input.seed, params: seedParams });
  if (!seedBuilt.okToInsert) {
    return { text: "", warnings: [...seedBuilt.warnings], okToInsert: false, summary: "", names: [] };
  }
  used.add(seedName.toUpperCase());
  names.push(seedName);
  const lines = [seedBuilt.text.trimEnd()];
  let transfCount = 0;

  for (let i = 1; i < input.instances.length; i++) {
    const pose = input.instances[i]!.pose;
    const nextName = allocateBodyName(input.seed.bodyType, used);
    used.add(nextName.toUpperCase());
    names.push(nextName);
    if (!input.expand && input.canUseTransf && pose.kind !== "T") {
      transfCount++;
      const emitPose = relativeTransfPose(pose0, pose);
      if (emitPose.kind === "R" || emitPose.kind === "M") {
        lines.push(
          `TRANSF ${nextName} ${seedName} ${emitPose.kind} ${fmtNum(emitPose.A)},${fmtNum(emitPose.B)} ${fmtNum(emitPose.f)}`.toUpperCase()
        );
      }
      continue;
    }
    if (!input.transformExpanded) {
      warnings.push("Развёртка недоступна: нет функции преобразования параметров.");
      return {
        text: "",
        warnings,
        okToInsert: false,
        summary: buildSummary(input.seed.bodyType, input.instances.length, transfCount, input.expand),
        names,
      };
    }
    const nextParams = input.transformExpanded(pose);
    if (!nextParams) {
      warnings.push(`Не удалось преобразовать экземпляр ${i} (${pose.kind}).`);
      return {
        text: "",
        warnings,
        okToInsert: false,
        summary: buildSummary(input.seed.bodyType, input.instances.length, transfCount, input.expand),
        names,
      };
    }
    const built = buildBodyStatement({ bodyType: input.seed.bodyType, name: nextName, params: nextParams });
    if (!built.okToInsert) {
      warnings.push(...built.warnings);
      return {
        text: "",
        warnings,
        okToInsert: false,
        summary: buildSummary(input.seed.bodyType, input.instances.length, transfCount, input.expand),
        names,
      };
    }
    lines.push(built.text.trimEnd());
  }

  return {
    text: lines.join("\n") + "\n",
    warnings: [...seedBuilt.warnings, ...warnings],
    okToInsert: true,
    summary: buildSummary(input.seed.bodyType, input.instances.length, transfCount, input.expand),
    names,
  };
}
