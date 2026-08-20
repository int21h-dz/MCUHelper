import type { BoundingBox, GeometryScene, PrimitiveSolid, Vec3 } from "./types";

/** Типы тел с явным wireframe/mesh в 3D-превью. */
export const MESH_PREVIEW_SUPPORTED = new Set([
  "RPP",
  "RCZ",
  "SPH",
  "HEX",
  "HEXX",
  "HEXY",
  "HEXG",
  "RCC",
  "BOX",
  "SBOX",
  "SHEX",
  "PLX",
  "PLY",
  "PLZ",
  "PLG",
  "ELL",
  "WED",
  "UCX",
  "UCY",
  "UCZ",
  "SLA",
  "SLB",
  "REC",
  "TRC",
]);

/** Типы, которые в сцене есть, но в 3D не рисуем (бейдж «не в 3D»). */
export const MESH_PREVIEW_UNSUPPORTED = new Set(["ARB", "QUAD"]);

export const MESH_PREVIEW_BODY_CAP = 500;

export type MeshKind =
  | "box"
  | "sphere"
  | "cylinder"
  | "hex"
  | "orientedHex"
  | "orientedBox"
  | "plane"
  | "bbox"
  | "ellipsoid"
  | "wedge"
  | "cone"
  | "ellipticCylinder";

export interface MeshDescriptor {
  name: string;
  bodyType: string;
  kind: MeshKind;
  color?: string;
  zoneHint?: string;
  /** Центр (или опорная точка для plane). */
  center: Vec3;
  /** Размеры AABB / цилиндра (height по axis). */
  size?: Vec3;
  radius?: number;
  height?: number;
  /** Ось цилиндра (единичный или сырой вектор высоты). */
  axis?: Vec3;
  /** BOX/SBOX: угол + три ребра. */
  corner?: Vec3;
  edges?: [Vec3, Vec3, Vec3];
  /** HEX: flat-to-flat и угол поворота в рад. */
  flatToFlat?: number;
  rotation?: number;
  /** Плоскость: нормаль и смещение (точка на плоскости = center). */
  normal?: Vec3;
  /** ELL: полуось вдоль axis (a) и экваториальная (b). */
  semiA?: number;
  semiB?: number;
  /** TRC: радиусы нижнего и верхнего оснований. */
  r1?: number;
  r2?: number;
  /** REC: полуоси эллипса в плоскости основания. */
  axisU?: Vec3;
  axisV?: Vec3;
}

export interface UnsupportedMeshBody {
  name: string;
  bodyType: string;
  reason: "не в 3D";
}

export interface MeshPreviewOptions {
  /** Если true — для тел сверх cap не строим детальные меши (только bbox-сцена). */
  skipDetail?: boolean;
  /** Лимит детальных мешей (по умолчанию MESH_PREVIEW_BODY_CAP). */
  bodyCap?: number;
  /** BBox сцены для отрисовки плоскостей PL*. */
  sceneBbox?: BoundingBox;
}

export interface MeshPreviewResult {
  meshes: MeshDescriptor[];
  unsupported: UnsupportedMeshBody[];
  totalBodies: number;
  detailSkipped: boolean;
  bodyCap: number;
}

function mid(a: number, b: number): number {
  return (a + b) / 2;
}

function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

function normalize(x: number, y: number, z: number): Vec3 {
  const L = len3(x, y, z) || 1;
  return { x: x / L, y: y / L, z: z / L };
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale3(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function perpBasis(n: Vec3): [Vec3, Vec3] {
  const nn = normalize(n.x, n.y, n.z);
  const tmp = Math.abs(nn.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const c = cross3(nn, tmp);
  const e1 = normalize(c.x, c.y, c.z);
  return [e1, cross3(nn, e1)];
}

function infSpan(r: number): number {
  return Math.max(24, Math.abs(r) * 10);
}

function aabbFromPts(pts: Vec3[]): BoundingBox {
  return {
    min: {
      x: Math.min(...pts.map((q) => q.x)),
      y: Math.min(...pts.map((q) => q.y)),
      z: Math.min(...pts.map((q) => q.z)),
    },
    max: {
      x: Math.max(...pts.map((q) => q.x)),
      y: Math.max(...pts.map((q) => q.y)),
      z: Math.max(...pts.map((q) => q.z)),
    },
  };
}

type EllGeom = { center: Vec3; axis: Vec3; a: number; b: number };

function ellFromParams(p: number[]): EllGeom | null {
  if (p.length < 7) return null;
  const c1 = { x: p[0], y: p[1], z: p[2] };
  const c2 = { x: p[3], y: p[4], z: p[5] };
  const D = p[6];
  if (D < 0) {
    const a = len3(c2.x, c2.y, c2.z);
    const b = Math.abs(D);
    if (!(a > 0 && b > 0)) return null;
    return { center: c1, axis: c2, a, b };
  }
  const axis = sub3(c2, c1);
  const c = 0.5 * len3(axis.x, axis.y, axis.z);
  const b = Math.abs(D);
  const a = Math.sqrt(c * c + b * b);
  if (!(a > 0 && b > 0)) return null;
  return {
    center: { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2, z: (c1.z + c2.z) / 2 },
    axis,
    a,
    b,
  };
}

function spheroidAabb(g: EllGeom): BoundingBox {
  const n = normalize(g.axis.x, g.axis.y, g.axis.z);
  const ext = (ni: number) => Math.sqrt((g.a * g.a - g.b * g.b) * ni * ni + g.b * g.b);
  const ex = ext(n.x);
  const ey = ext(n.y);
  const ez = ext(n.z);
  return {
    min: { x: g.center.x - ex, y: g.center.y - ey, z: g.center.z - ez },
    max: { x: g.center.x + ex, y: g.center.y + ey, z: g.center.z + ez },
  };
}

type HexgFrame = {
  C: Vec3;
  H: Vec3;
  n: Vec3;
  u: Vec3;
  w: Vec3;
  R: number;
  D: number;
  verts: Vec3[];
};

function hexgFrame(p: number[]): HexgFrame | null {
  if (p.length < 9) return null;
  const C = { x: p[0], y: p[1], z: p[2] };
  const H = { x: p[3], y: p[4], z: p[5] };
  const V = { x: p[6], y: p[7], z: p[8] };
  const hLen = len3(H.x, H.y, H.z);
  if (hLen < 1e-12) return null;
  const n = normalize(H.x, H.y, H.z);
  const vDot = V.x * n.x + V.y * n.y + V.z * n.z;
  let vp = { x: V.x - n.x * vDot, y: V.y - n.y * vDot, z: V.z - n.z * vDot };
  let D = len3(vp.x, vp.y, vp.z);
  if (D < 1e-12) {
    const [e1] = perpBasis(n);
    D = len3(V.x, V.y, V.z) || 1;
    vp = scale3(e1, D);
  }
  const u = normalize(vp.x, vp.y, vp.z);
  const w = cross3(n, u);
  const R = D / Math.sqrt(3);
  const verts: Vec3[] = [];
  for (const t of [0, 1]) {
    const base = add3(C, scale3(H, t));
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      verts.push(add3(base, add3(scale3(u, R * Math.cos(a)), scale3(w, R * Math.sin(a)))));
    }
  }
  return { C, H, n, u, w, R, D, verts };
}

const HEXG_EDGES: number[][] = (() => {
  const idx: number[][] = [];
  for (let i = 0; i < 6; i++) {
    idx.push([i, (i + 1) % 6]);
    idx.push([6 + i, 6 + ((i + 1) % 6)]);
    idx.push([i, 6 + i]);
  }
  return idx;
})();

function bboxCenterSize(bbox: BoundingBox): { center: Vec3; size: Vec3 } {
  return {
    center: {
      x: mid(bbox.min.x, bbox.max.x),
      y: mid(bbox.min.y, bbox.max.y),
      z: mid(bbox.min.z, bbox.max.z),
    },
    size: {
      x: Math.max(0, bbox.max.x - bbox.min.x),
      y: Math.max(0, bbox.max.y - bbox.min.y),
      z: Math.max(0, bbox.max.z - bbox.min.z),
    },
  };
}

export function isMeshPreviewSupported(bodyType: string): boolean {
  return MESH_PREVIEW_SUPPORTED.has(bodyType.toUpperCase());
}

export function isMeshPreviewUnsupported(bodyType: string): boolean {
  return !isMeshPreviewSupported(bodyType);
}

/**
 * Преобразует одно тело сцены в простой mesh-дескриптор (центр/размер/ось).
 * Возвращает null, если тип не поддерживается или параметров недостаточно.
 */
export function bodyToMeshDescriptor(
  body: PrimitiveSolid,
  sceneBbox?: BoundingBox
): MeshDescriptor | null {
  const t = body.type.toUpperCase();
  const p = body.params;
  const base = {
    name: body.name,
    bodyType: t,
    color: body.color,
    zoneHint: body.zoneHint,
  };

  if (t === "RPP" && p.length >= 6) {
    const { center, size } = bboxCenterSize(body.bbox);
    return { ...base, kind: "box", center, size };
  }

  if (t === "SPH" && p.length >= 4) {
    return {
      ...base,
      kind: "sphere",
      center: { x: p[0], y: p[1], z: p[2] },
      radius: Math.abs(p[3]),
    };
  }

  if (t === "RCZ" && p.length >= 5) {
    const h = p[3];
    return {
      ...base,
      kind: "cylinder",
      center: { x: p[0], y: p[1], z: p[2] + h / 2 },
      radius: Math.abs(p[4]),
      height: Math.abs(h),
      axis: { x: 0, y: 0, z: h >= 0 ? 1 : -1 },
    };
  }

  if (t === "RCC" && p.length >= 7) {
    const dx = p[3];
    const dy = p[4];
    const dz = p[5];
    const h = len3(dx, dy, dz);
    const ax = normalize(dx, dy, dz);
    return {
      ...base,
      kind: "cylinder",
      center: { x: p[0] + dx / 2, y: p[1] + dy / 2, z: p[2] + dz / 2 },
      radius: Math.abs(p[6]),
      height: h,
      axis: ax,
    };
  }

  if (t === "BOX" && p.length >= 12) {
    const corner = { x: p[0], y: p[1], z: p[2] };
    const e1 = { x: p[3], y: p[4], z: p[5] };
    const e2 = { x: p[6], y: p[7], z: p[8] };
    const e3 = { x: p[9], y: p[10], z: p[11] };
    return {
      ...base,
      kind: "orientedBox",
      center: {
        x: corner.x + (e1.x + e2.x + e3.x) / 2,
        y: corner.y + (e1.y + e2.y + e3.y) / 2,
        z: corner.z + (e1.z + e2.z + e3.z) / 2,
      },
      corner,
      edges: [e1, e2, e3],
      size: {
        x: len3(e1.x, e1.y, e1.z),
        y: len3(e2.x, e2.y, e2.z),
        z: len3(e3.x, e3.y, e3.z),
      },
    };
  }

  if (t === "SBOX" && p.length >= 9) {
    const corner = { x: 0, y: 0, z: 0 };
    const e1 = { x: p[0], y: p[1], z: p[2] };
    const e2 = { x: p[3], y: p[4], z: p[5] };
    const e3 = { x: p[6], y: p[7], z: p[8] };
    return {
      ...base,
      kind: "orientedBox",
      center: {
        x: (e1.x + e2.x + e3.x) / 2,
        y: (e1.y + e2.y + e3.y) / 2,
        z: (e1.z + e2.z + e3.z) / 2,
      },
      corner,
      edges: [e1, e2, e3],
      size: {
        x: len3(e1.x, e1.y, e1.z),
        y: len3(e2.x, e2.y, e2.z),
        z: len3(e3.x, e3.y, e3.z),
      },
    };
  }

  if ((t === "HEX" || t === "HEXX" || t === "HEXY" || t === "SHEX") && p.length >= 3) {
    const { center, size } = bboxCenterSize(body.bbox);
    let flatToFlat = 1;
    let rotation = 0;
    let height = size.z;
    if (t === "HEX") {
      flatToFlat = len3(p[3] ?? 1, p[4] ?? 0, 0) || 1;
      rotation = Math.atan2(p[4] ?? 0, p[3] ?? 1);
      height = Math.abs(p[5] ?? size.z);
    } else if (t === "HEXX" || t === "HEXY") {
      height = Math.abs(p[3] ?? size.z);
      flatToFlat = Math.abs(p[4] ?? 1);
      const fDeg = p[5] ?? 0;
      rotation = ((fDeg + (t === "HEXY" ? 90 : 0)) * Math.PI) / 180;
    } else {
      // SHEX: center at origin typically; params S H f — approximate
      height = Math.abs(p[1] ?? size.z);
      flatToFlat = Math.abs(p[0] ?? 1);
      rotation = ((p[2] ?? 0) * Math.PI) / 180;
    }
    return {
      ...base,
      kind: "hex",
      center: { x: center.x, y: center.y, z: body.bbox.min.z + height / 2 },
      size,
      height,
      flatToFlat,
      rotation,
    };
  }

  if (t === "HEXG") {
    const g = hexgFrame(p);
    if (g) {
      return {
        ...base,
        kind: "orientedHex",
        center: add3(g.C, scale3(g.H, 0.5)),
        axis: g.n,
        height: len3(g.H.x, g.H.y, g.H.z),
        flatToFlat: g.D,
        axisU: g.u,
        axisV: g.w,
        corner: g.C,
      };
    }
  }

  if (t === "PLX" || t === "PLY" || t === "PLZ" || t === "PLG") {
    const bb = sceneBbox ?? body.bbox;
    const { center: bc, size } = bboxCenterSize(bb);
    if (t === "PLX" && p.length >= 1) {
      return {
        ...base,
        kind: "plane",
        center: { x: p[0], y: bc.y, z: bc.z },
        normal: { x: 1, y: 0, z: 0 },
        size,
      };
    }
    if (t === "PLY" && p.length >= 1) {
      return {
        ...base,
        kind: "plane",
        center: { x: bc.x, y: p[0], z: bc.z },
        normal: { x: 0, y: 1, z: 0 },
        size,
      };
    }
    if (t === "PLZ" && p.length >= 1) {
      return {
        ...base,
        kind: "plane",
        center: { x: bc.x, y: bc.y, z: p[0] },
        normal: { x: 0, y: 0, z: 1 },
        size,
      };
    }
    if (t === "PLG" && p.length >= 4) {
      const nx = p[0];
      const ny = p[1];
      const nz = p[2];
      const q = p[3];
      const n = normalize(nx, ny, nz);
      const L = len3(nx, ny, nz) || 1;
      // точка на плоскости: n·r = q  →  r = (q/|n|) * unit(n)
      return {
        ...base,
        kind: "plane",
        center: { x: (q / L) * n.x, y: (q / L) * n.y, z: (q / L) * n.z },
        normal: n,
        size,
      };
    }
  }

  if (t === "ELL") {
    const g = ellFromParams(p);
    if (g) {
      return {
        ...base,
        kind: "ellipsoid",
        center: g.center,
        axis: g.axis,
        semiA: g.a,
        semiB: g.b,
      };
    }
  }

  if (t === "WED" && p.length >= 12) {
    const corner = { x: p[0], y: p[1], z: p[2] };
    const e1 = { x: p[3], y: p[4], z: p[5] };
    const e2 = { x: p[6], y: p[7], z: p[8] };
    const e3 = { x: p[9], y: p[10], z: p[11] };
    return {
      ...base,
      kind: "wedge",
      center: {
        x: corner.x + (e1.x + e2.x) / 3 + e3.x / 2,
        y: corner.y + (e1.y + e2.y) / 3 + e3.y / 2,
        z: corner.z + (e1.z + e2.z) / 3 + e3.z / 2,
      },
      corner,
      edges: [e1, e2, e3],
    };
  }

  if ((t === "UCX" || t === "UCY" || t === "UCZ") && p.length >= 3) {
    const r = Math.abs(p[2]);
    const bb = sceneBbox ?? body.bbox;
    if (t === "UCX") {
      return {
        ...base,
        kind: "cylinder",
        center: { x: mid(bb.min.x, bb.max.x), y: p[0], z: p[1] },
        radius: r,
        height: Math.max(bb.max.x - bb.min.x, infSpan(r)),
        axis: { x: 1, y: 0, z: 0 },
      };
    }
    if (t === "UCY") {
      return {
        ...base,
        kind: "cylinder",
        center: { x: p[0], y: mid(bb.min.y, bb.max.y), z: p[1] },
        radius: r,
        height: Math.max(bb.max.y - bb.min.y, infSpan(r)),
        axis: { x: 0, y: 1, z: 0 },
      };
    }
    return {
      ...base,
      kind: "cylinder",
      center: { x: p[0], y: p[1], z: mid(bb.min.z, bb.max.z) },
      radius: r,
      height: Math.max(bb.max.z - bb.min.z, infSpan(r)),
      axis: { x: 0, y: 0, z: 1 },
    };
  }

  if (t === "SLA" && p.length >= 6) {
    const C = { x: p[0], y: p[1], z: p[2] };
    const P = { x: p[3], y: p[4], z: p[5] };
    const thick = len3(P.x, P.y, P.z) || 1;
    const [e1u, e2u] = perpBasis(P);
    const span = infSpan(thick);
    const e1 = scale3(e1u, span);
    const e2 = scale3(e2u, span);
    const corner = {
      x: C.x - e1.x / 2 - e2.x / 2,
      y: C.y - e1.y / 2 - e2.y / 2,
      z: C.z - e1.z / 2 - e2.z / 2,
    };
    return {
      ...base,
      kind: "orientedBox",
      center: add3(C, scale3(P, 0.5)),
      corner,
      edges: [e1, e2, P],
      size: { x: span, y: span, z: thick },
    };
  }

  if (t === "SLB" && p.length >= 5) {
    const nraw = { x: p[0], y: p[1], z: p[2] };
    const A = p[3];
    const B = p[4];
    const nh = normalize(nraw.x, nraw.y, nraw.z);
    const P = scale3(nh, B - A);
    const C = scale3(nh, A);
    const thick = Math.abs(B - A) || 1;
    const [e1u, e2u] = perpBasis(nh);
    const span = infSpan(thick);
    const e1 = scale3(e1u, span);
    const e2 = scale3(e2u, span);
    const corner = {
      x: C.x - e1.x / 2 - e2.x / 2,
      y: C.y - e1.y / 2 - e2.y / 2,
      z: C.z - e1.z / 2 - e2.z / 2,
    };
    return {
      ...base,
      kind: "orientedBox",
      center: add3(C, scale3(P, 0.5)),
      corner,
      edges: [e1, e2, P],
      size: { x: span, y: span, z: thick },
    };
  }

  if (t === "TRC" && p.length >= 8) {
    const C = { x: p[0], y: p[1], z: p[2] };
    const H = { x: p[3], y: p[4], z: p[5] };
    const h = len3(H.x, H.y, H.z);
    return {
      ...base,
      kind: "cone",
      center: add3(C, scale3(H, 0.5)),
      axis: normalize(H.x, H.y, H.z),
      height: h,
      r1: Math.abs(p[6]),
      r2: Math.abs(p[7]),
      corner: C,
    };
  }

  if (t === "REC" && p.length >= 12) {
    const C = { x: p[0], y: p[1], z: p[2] };
    const H = { x: p[3], y: p[4], z: p[5] };
    const R1 = { x: p[6], y: p[7], z: p[8] };
    const R2 = { x: p[9], y: p[10], z: p[11] };
    const h = len3(H.x, H.y, H.z);
    return {
      ...base,
      kind: "ellipticCylinder",
      center: add3(C, scale3(H, 0.5)),
      axis: normalize(H.x, H.y, H.z),
      height: h,
      axisU: R1,
      axisV: R2,
      corner: C,
    };
  }

  return null;
}

/**
 * Собирает mesh-дескрипторы из GeometryScene для 3D-превью.
 * Неподдерживаемые типы (ARB/QUAD/…) попадают в `unsupported` с меткой «не в 3D».
 */
export function buildMeshPreview(
  scene: Pick<GeometryScene, "primitives" | "bbox">,
  options: MeshPreviewOptions = {}
): MeshPreviewResult {
  const bodyCap = options.bodyCap ?? MESH_PREVIEW_BODY_CAP;
  const skipDetail = options.skipDetail === true;
  const sceneBbox = options.sceneBbox ?? scene.bbox;
  const unsupported: UnsupportedMeshBody[] = [];
  const meshes: MeshDescriptor[] = [];
  const totalBodies = scene.primitives.length;

  for (const body of scene.primitives) {
    const t = body.type.toUpperCase();
    if (isMeshPreviewUnsupported(t)) {
      unsupported.push({ name: body.name, bodyType: t, reason: "не в 3D" });
    }
  }

  if (skipDetail) {
    return { meshes: [], unsupported, totalBodies, detailSkipped: true, bodyCap };
  }

  let detailCount = 0;
  for (const body of scene.primitives) {
    if (isMeshPreviewUnsupported(body.type)) continue;
    if (detailCount >= bodyCap) continue;
    const mesh = bodyToMeshDescriptor(body, sceneBbox);
    if (mesh) {
      meshes.push(mesh);
      detailCount++;
    } else {
      unsupported.push({
        name: body.name,
        bodyType: body.type.toUpperCase(),
        reason: "не в 3D",
      });
    }
  }

  const detailSkipped = totalBodies > bodyCap && meshes.length >= bodyCap;
  return { meshes, unsupported, totalBodies, detailSkipped, bodyCap };
}

/** Зазор между AABB (0 если пересекаются/касаются). */
export function bboxGap(a: BoundingBox, b: BoundingBox): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function bboxExtent(b: BoundingBox): number {
  return Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, 1e-9);
}

/** Грубая bbox по числовым параметрам (для черновика без полного AST). */
export function bboxFromBodyParams(bodyType: string, params: number[]): BoundingBox | null {
  const t = bodyType.toUpperCase();
  const p = params;
  if (t === "RPP" && p.length >= 6) {
    return {
      min: { x: Math.min(p[0], p[1]), y: Math.min(p[2], p[3]), z: Math.min(p[4], p[5]) },
      max: { x: Math.max(p[0], p[1]), y: Math.max(p[2], p[3]), z: Math.max(p[4], p[5]) },
    };
  }
  if (t === "RCZ" && p.length >= 5) {
    const [x, y, z, h, r] = p;
    const rr = Math.abs(r);
    return {
      min: { x: x - rr, y: y - rr, z: Math.min(z, z + h) },
      max: { x: x + rr, y: y + rr, z: Math.max(z, z + h) },
    };
  }
  if (t === "SPH" && p.length >= 4) {
    const [x, y, z, r] = p;
    const rr = Math.abs(r);
    return { min: { x: x - rr, y: y - rr, z: z - rr }, max: { x: x + rr, y: y + rr, z: z + rr } };
  }
  if (t === "RCC" && p.length >= 7) {
    const [x, y, z, dx, dy, dz, r] = p;
    const rr = Math.abs(r);
    const xs = [x, x + dx];
    const ys = [y, y + dy];
    const zs = [z, z + dz];
    return {
      min: { x: Math.min(...xs) - rr, y: Math.min(...ys) - rr, z: Math.min(...zs) - rr },
      max: { x: Math.max(...xs) + rr, y: Math.max(...ys) + rr, z: Math.max(...zs) + rr },
    };
  }
  if (t === "BOX" && p.length >= 12) {
    const corner = { x: p[0], y: p[1], z: p[2] };
    const e1 = { x: p[3], y: p[4], z: p[5] };
    const e2 = { x: p[6], y: p[7], z: p[8] };
    const e3 = { x: p[9], y: p[10], z: p[11] };
    const pts: Vec3[] = [];
    for (const a of [0, 1])
      for (const b of [0, 1])
        for (const c of [0, 1]) {
          pts.push({
            x: corner.x + a * e1.x + b * e2.x + c * e3.x,
            y: corner.y + a * e1.y + b * e2.y + c * e3.y,
            z: corner.z + a * e1.z + b * e2.z + c * e3.z,
          });
        }
    return {
      min: {
        x: Math.min(...pts.map((q) => q.x)),
        y: Math.min(...pts.map((q) => q.y)),
        z: Math.min(...pts.map((q) => q.z)),
      },
      max: {
        x: Math.max(...pts.map((q) => q.x)),
        y: Math.max(...pts.map((q) => q.y)),
        z: Math.max(...pts.map((q) => q.z)),
      },
    };
  }
  if (t === "SBOX" && p.length >= 9) {
    return bboxFromBodyParams("BOX", [0, 0, 0, ...p]);
  }
  if ((t === "HEX" || t === "HEXX" || t === "HEXY") && p.length >= 3) {
    const cx = p[0];
    const cy = p[1];
    const cz = p[2];
    let half = 1;
    let h = 1;
    if (t === "HEX" && p.length >= 6) {
      half = len3(p[3], p[4], 0) || 1;
      h = Math.abs(p[5] ?? 1);
    } else if ((t === "HEXX" || t === "HEXY") && p.length >= 5) {
      h = Math.abs(p[3] ?? 1);
      half = Math.abs(p[4] ?? 1);
    }
    const r = half;
    return {
      min: { x: cx - r, y: cy - r, z: cz },
      max: { x: cx + r, y: cy + r, z: cz + h },
    };
  }
  if (t === "SHEX" && p.length >= 2) {
    const s = Math.abs(p[0] ?? 1);
    const h = Math.abs(p[1] ?? 1);
    return { min: { x: -s, y: -s, z: 0 }, max: { x: s, y: s, z: h } };
  }
  if (t === "HEXG") {
    const g = hexgFrame(p);
    if (g) return aabbFromPts(g.verts);
  }
  if ((t === "PLX" || t === "PLY" || t === "PLZ") && p.length >= 1) {
    const v = p[0];
    if (t === "PLX") return { min: { x: v, y: -1, z: -1 }, max: { x: v, y: 1, z: 1 } };
    if (t === "PLY") return { min: { x: -1, y: v, z: -1 }, max: { x: 1, y: v, z: 1 } };
    return { min: { x: -1, y: -1, z: v }, max: { x: 1, y: 1, z: v } };
  }
  if (t === "PLG" && p.length >= 4) {
    return { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } };
  }
  if (t === "ELL") {
    const g = ellFromParams(p);
    if (g) return spheroidAabb(g);
  }
  if (t === "WED" && p.length >= 12) {
    const B = { x: p[0], y: p[1], z: p[2] };
    const e1 = { x: p[3], y: p[4], z: p[5] };
    const e2 = { x: p[6], y: p[7], z: p[8] };
    const e3 = { x: p[9], y: p[10], z: p[11] };
    const pts = [
      B,
      add3(B, e1),
      add3(B, e2),
      add3(B, e3),
      add3(add3(B, e1), e3),
      add3(add3(B, e2), e3),
    ];
    return aabbFromPts(pts);
  }
  if (t === "UCX" && p.length >= 3) {
    const y = p[0];
    const z = p[1];
    const r = Math.abs(p[2]);
    const L = infSpan(r) / 2;
    return { min: { x: -L, y: y - r, z: z - r }, max: { x: L, y: y + r, z: z + r } };
  }
  if (t === "UCY" && p.length >= 3) {
    const x = p[0];
    const z = p[1];
    const r = Math.abs(p[2]);
    const L = infSpan(r) / 2;
    return { min: { x: x - r, y: -L, z: z - r }, max: { x: x + r, y: L, z: z + r } };
  }
  if (t === "UCZ" && p.length >= 3) {
    const x = p[0];
    const y = p[1];
    const r = Math.abs(p[2]);
    const L = infSpan(r) / 2;
    return { min: { x: x - r, y: y - r, z: -L }, max: { x: x + r, y: y + r, z: L } };
  }
  if (t === "SLA" && p.length >= 6) {
    const C = { x: p[0], y: p[1], z: p[2] };
    const P = { x: p[3], y: p[4], z: p[5] };
    const thick = len3(P.x, P.y, P.z) || 1;
    const [e1u, e2u] = perpBasis(P);
    const s = infSpan(thick) / 2;
    const e1 = scale3(e1u, s);
    const e2 = scale3(e2u, s);
    return aabbFromPts([
      add3(add3(C, e1), e2),
      add3(sub3(C, e1), e2),
      add3(add3(C, e1), scale3(e2, -1)),
      add3(sub3(sub3(C, e1), e2), { x: 0, y: 0, z: 0 }),
      add3(add3(add3(C, P), e1), e2),
      add3(add3(sub3(C, e1), P), e2),
      add3(add3(add3(C, P), e1), scale3(e2, -1)),
      add3(add3(sub3(sub3(C, e1), e2), P), { x: 0, y: 0, z: 0 }),
    ]);
  }
  if (t === "SLB" && p.length >= 5) {
    const nh = normalize(p[0], p[1], p[2]);
    const A = p[3];
    const Bv = p[4];
    const P = scale3(nh, Bv - A);
    const C = scale3(nh, A);
    return bboxFromBodyParams("SLA", [C.x, C.y, C.z, P.x, P.y, P.z]);
  }
  if (t === "TRC" && p.length >= 8) {
    const C = { x: p[0], y: p[1], z: p[2] };
    const H = { x: p[3], y: p[4], z: p[5] };
    const r = Math.max(Math.abs(p[6]), Math.abs(p[7]));
    const xs = [C.x, C.x + H.x];
    const ys = [C.y, C.y + H.y];
    const zs = [C.z, C.z + H.z];
    return {
      min: { x: Math.min(...xs) - r, y: Math.min(...ys) - r, z: Math.min(...zs) - r },
      max: { x: Math.max(...xs) + r, y: Math.max(...ys) + r, z: Math.max(...zs) + r },
    };
  }
  if (t === "REC" && p.length >= 12) {
    const C = { x: p[0], y: p[1], z: p[2] };
    const H = { x: p[3], y: p[4], z: p[5] };
    const R1 = { x: p[6], y: p[7], z: p[8] };
    const R2 = { x: p[9], y: p[10], z: p[11] };
    const pts: Vec3[] = [];
    for (const a of [0, 1]) {
      for (const s1 of [-1, 1]) {
        for (const s2 of [-1, 1]) {
          pts.push({
            x: C.x + a * H.x + s1 * R1.x + s2 * R2.x,
            y: C.y + a * H.y + s1 * R1.y + s2 * R2.y,
            z: C.z + a * H.z + s1 * R1.z + s2 * R2.z,
          });
        }
      }
    }
    return aabbFromPts(pts);
  }
  if (p.length >= 2) {
    const x = p[0];
    const y = p[1];
    const z = p[2] ?? 0;
    return { min: { x: x - 1, y: y - 1, z }, max: { x: x + 1, y: y + 1, z: z + (p[3] ?? 1) } };
  }
  return null;
}

/** UserGuide §9.1.3.22: не могут быть прототипами TRANSF. */
export const TRANSF_FORBIDDEN_PROTOS = new Set(["RPP", "SBOX", "SHEX", "PLX", "PLY", "UCX", "UCY"]);

export function normalizeTransfMode(raw: string): "M" | "R" | null {
  const u = (raw ?? "").trim().toUpperCase();
  return u === "M" || u === "R" ? u : null;
}

function rot2(x: number, y: number, rad: number): { x: number; y: number } {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: c * x - s * y, y: s * x + c * y };
}

/** Точка: вертикальный поворот R или отражение M вокруг (A,B,0), угол f° к OX. */
export function transfPoint(p: Vec3, mode: "M" | "R", A: number, B: number, fDeg: number): Vec3 {
  const f = (fDeg * Math.PI) / 180;
  const px = p.x - A;
  const py = p.y - B;
  if (mode === "R") {
    const r = rot2(px, py, f);
    return { x: r.x + A, y: r.y + B, z: p.z };
  }
  const aligned = rot2(px, py, -f);
  const back = rot2(aligned.x, -aligned.y, f);
  return { x: back.x + A, y: back.y + B, z: p.z };
}

/** Вектор: линейная часть M/R (без сдвига). */
export function transfVec(v: Vec3, mode: "M" | "R", fDeg: number): Vec3 {
  return transfPoint(v, mode, 0, 0, fDeg);
}

function putPoint(out: number[], i: number, p: Vec3): void {
  out[i] = p.x;
  out[i + 1] = p.y;
  out[i + 2] = p.z;
}

function getPoint(p: number[], i: number): Vec3 {
  return { x: p[i] ?? 0, y: p[i + 1] ?? 0, z: p[i + 2] ?? 0 };
}

function transfTranslation(mode: "M" | "R", A: number, B: number, fDeg: number): Vec3 {
  const C = { x: A, y: B, z: 0 };
  const LC = transfVec(C, mode, fDeg);
  return { x: A - LC.x, y: B - LC.y, z: -LC.z };
}

/**
 * Новые числовые параметры тела после TRANSF. Тип не меняется (UserGuide §9.1.3.22).
 * null — запрещённый/неподдерживаемый прототип.
 */
export function applyTransfToBodyParams(
  bodyType: string,
  params: number[],
  mode: "M" | "R",
  A: number,
  B: number,
  f: number
): number[] | null {
  const t = bodyType.toUpperCase();
  if (TRANSF_FORBIDDEN_PROTOS.has(t)) return null;
  const out = params.slice();
  const P = (i: number) => putPoint(out, i, transfPoint(getPoint(params, i), mode, A, B, f));
  const V = (i: number) => putPoint(out, i, transfVec(getPoint(params, i), mode, f));

  switch (t) {
    case "SPH":
      if (out.length < 4) return null;
      P(0);
      return out;
    case "RCC":
      if (out.length < 7) return null;
      P(0);
      V(3);
      return out;
    case "RCZ":
      if (out.length < 5) return null;
      P(0);
      return out;
    case "UCZ": {
      if (out.length < 3) return null;
      const q = transfPoint({ x: params[0] ?? 0, y: params[1] ?? 0, z: 0 }, mode, A, B, f);
      out[0] = q.x;
      out[1] = q.y;
      return out;
    }
    case "HEX":
      if (out.length < 6) return null;
      P(0);
      V(3);
      return out;
    case "HEXX":
    case "HEXY": {
      if (out.length < 5) return null;
      P(0);
      const D = Math.abs(params[4] ?? 1);
      const f0 = params[5] ?? 0;
      const rad = (f0 * Math.PI) / 180;
      const vx = t === "HEXY" ? -D * Math.sin(rad) : D * Math.cos(rad);
      const vy = t === "HEXY" ? D * Math.cos(rad) : D * Math.sin(rad);
      const v = transfVec({ x: vx, y: vy, z: 0 }, mode, f);
      const D2 = Math.hypot(v.x, v.y) || D;
      out[4] = D2;
      out[5] = t === "HEXY" ? (Math.atan2(-v.x, v.y) * 180) / Math.PI : (Math.atan2(v.y, v.x) * 180) / Math.PI;
      return out;
    }
    case "HEXG":
      if (out.length < 9) return null;
      P(0);
      V(3);
      V(6);
      return out;
    case "BOX":
    case "WED":
      if (out.length < 12) return null;
      P(0);
      V(3);
      V(6);
      V(9);
      return out;
    case "ELL":
      if (out.length < 7) return null;
      P(0);
      if ((params[6] ?? 0) < 0) V(3);
      else P(3);
      return out;
    case "SLA":
      if (out.length < 6) return null;
      P(0);
      V(3);
      return out;
    case "SLB": {
      if (out.length < 5) return null;
      const n2 = transfVec(getPoint(params, 0), mode, f);
      putPoint(out, 0, n2);
      const tr = transfTranslation(mode, A, B, f);
      const add = n2.x * tr.x + n2.y * tr.y + n2.z * tr.z;
      out[3] = (params[3] ?? 0) + add;
      out[4] = (params[4] ?? 0) + add;
      return out;
    }
    case "PLG": {
      if (out.length < 4) return null;
      const n2 = transfVec({ x: params[0] ?? 0, y: params[1] ?? 0, z: params[2] ?? 0 }, mode, f);
      out[0] = n2.x;
      out[1] = n2.y;
      out[2] = n2.z;
      const tr = transfTranslation(mode, A, B, f);
      out[3] = (params[3] ?? 0) + n2.x * tr.x + n2.y * tr.y + n2.z * tr.z;
      return out;
    }
    case "PLZ":
      return out;
    case "TRC":
      if (out.length < 8) return null;
      P(0);
      V(3);
      return out;
    case "REC":
      if (out.length < 12) return null;
      P(0);
      V(3);
      V(6);
      V(9);
      return out;
    default:
      return null;
  }
}

export function applyTransfToPrimitive(
  proto: PrimitiveSolid,
  newName: string,
  mode: "M" | "R",
  A: number,
  B: number,
  f: number
): PrimitiveSolid | null {
  const params = applyTransfToBodyParams(proto.type, proto.params, mode, A, B, f);
  if (!params) return null;
  const bbox = bboxFromBodyParams(proto.type, params);
  if (!bbox) return null;
  return { type: proto.type.toUpperCase(), name: newName, params, bbox, scope: proto.scope };
}

export function bboxContains(outer: BoundingBox, inner: BoundingBox, eps = 1e-9): boolean {
  return (
    outer.min.x <= inner.min.x + eps &&
    outer.min.y <= inner.min.y + eps &&
    outer.min.z <= inner.min.z + eps &&
    outer.max.x >= inner.max.x - eps &&
    outer.max.y >= inner.max.y - eps &&
    outer.max.z >= inner.max.z - eps
  );
}

function padBbox(b: BoundingBox, factor = 0.28): BoundingBox {
  const dx = Math.max((b.max.x - b.min.x) * factor, 0.15);
  const dy = Math.max((b.max.y - b.min.y) * factor, 0.15);
  const dz = Math.max((b.max.z - b.min.z) * factor, 0.15);
  return {
    min: { x: b.min.x - dx, y: b.min.y - dy, z: b.min.z - dz },
    max: { x: b.max.x + dx, y: b.max.y + dy, z: b.max.z + dz },
  };
}

/** Типы, которыми MCU задаёт контейнер секции тел (UserGuide: первое тело). */
const CONTAINER_TYPES = new Set(["SPH", "RPP", "HEX", "HEXX", "HEXY", "HEXG", "RCZ", "BOX", "SBOX"]);
const PLANE_TYPES = new Set(["PLX", "PLY", "PLZ", "PLG"]);
const INFINITE_TYPES = new Set(["UCX", "UCY", "UCZ", "SLA", "SLB"]);

/** Первое контейнерное тело списка (порядок AST) + слишком большие оболочки и плоскости. */
export function isNeighborExcluded(body: PrimitiveSolid, focus: BoundingBox, isFirstContainer: boolean): boolean {
  const t = body.type.toUpperCase();
  if (PLANE_TYPES.has(t)) return true;
  if (INFINITE_TYPES.has(t)) return false;
  const contains = bboxContains(body.bbox, focus);
  if (isFirstContainer && contains) return true;
  if (contains && bboxExtent(body.bbox) > bboxExtent(focus) * 2.5) return true;
  return false;
}

export function firstContainerIndex(bodies: PrimitiveSolid[]): number {
  return bodies.findIndex((b) => CONTAINER_TYPES.has(b.type.toUpperCase()));
}

export interface NearbyBodiesOptions {
  /** Сколько ближайших тел показать (по умолчанию 12). */
  maxCount?: number;
  /**
   * Макс. зазор: множитель размера черновика (по умолчанию 4).
   * Тела дальше отсекаются, даже если входят в top-N.
   */
  maxGapFactor?: number;
  excludeName?: string;
}

/** Ближайшие тела по AABB-зазору (не вся сцена). */
export function rankNearbyBodies(
  focus: BoundingBox,
  bodies: PrimitiveSolid[],
  excludeName?: string
): Array<{ body: PrimitiveSolid; gap: number }> {
  const exclude = (excludeName ?? "").toUpperCase();
  return bodies
    .filter((b) => b.name.toUpperCase() !== exclude)
    .map((b) => ({ body: b, gap: neighborGap(focus, b) }))
    .sort((a, b) => a.gap - b.gap || a.body.name.localeCompare(b.body.name));
}

function neighborGap(focus: BoundingBox, body: PrimitiveSolid): number {
  const t = body.type.toUpperCase();
  const bb = body.bbox;
  if (t === "UCX") {
    return bboxGap(
      { min: { x: 0, y: focus.min.y, z: focus.min.z }, max: { x: 0, y: focus.max.y, z: focus.max.z } },
      { min: { x: 0, y: bb.min.y, z: bb.min.z }, max: { x: 0, y: bb.max.y, z: bb.max.z } }
    );
  }
  if (t === "UCY") {
    return bboxGap(
      { min: { x: focus.min.x, y: 0, z: focus.min.z }, max: { x: focus.max.x, y: 0, z: focus.max.z } },
      { min: { x: bb.min.x, y: 0, z: bb.min.z }, max: { x: bb.max.x, y: 0, z: bb.max.z } }
    );
  }
  if (t === "UCZ") {
    return bboxGap(
      { min: { x: focus.min.x, y: focus.min.y, z: 0 }, max: { x: focus.max.x, y: focus.max.y, z: 0 } },
      { min: { x: bb.min.x, y: bb.min.y, z: 0 }, max: { x: bb.max.x, y: bb.max.y, z: 0 } }
    );
  }
  return bboxGap(focus, bb);
}

export function selectNearbyBodies(
  focus: BoundingBox,
  bodies: PrimitiveSolid[],
  options: NearbyBodiesOptions = {}
): PrimitiveSolid[] {
  const maxCount = options.maxCount ?? 12;
  const maxGapFactor = options.maxGapFactor ?? 4;
  const maxGap = bboxExtent(focus) * maxGapFactor;
  const containerIdx = firstContainerIndex(bodies);
  return rankNearbyBodies(focus, bodies, options.excludeName)
    .filter((x) => {
      const idx = bodies.indexOf(x.body);
      return !isNeighborExcluded(x.body, focus, idx === containerIdx && containerIdx >= 0);
    })
    .filter((x) => x.gap <= maxGap)
    .slice(0, maxCount)
    .map((x) => x.body);
}

export const DRAFT_BODY_COLOR = "#3d9a8b";
export const NEIGHBOR_BODY_COLOR = "#585b70";

export interface DraftBodyPreviewInput {
  bodyType: string;
  name: string;
  params: number[];
  scenePrimitives: PrimitiveSolid[];
  sceneBbox?: BoundingBox;
  nearby?: NearbyBodiesOptions;
  /** Положение секущих плоскостей (иначе — центр focus-bbox). */
  slicePositions?: Partial<{ x: number; y: number; z: number }>;
  /** UserGuide §9.1.3.22: черновик TRANSF — прототип из сцены + M|R A B f. */
  transf?: {
    protoName: string;
    mode: string;
    A: number;
    B: number;
    f: number;
  };
}

export interface DraftBodyPreviewResult {
  meshes: MeshDescriptor[];
  focusName: string;
  neighborNames: string[];
  nearest?: { name: string; gap: number };
  /** Кадр превью (focus + соседи). */
  bbox: BoundingBox | null;
  /** BBox самого черновика — диапазон слайдеров секущих. */
  focusBbox: BoundingBox | null;
  unsupported: boolean;
  warnings: string[];
  /** Три сечения XY / XZ / YZ (через slicePositions или центр focus). */
  slices: BodySliceView[];
}

export type BodySliceAxis = "x" | "y" | "z";

export interface SlicePoint2d {
  u: number;
  v: number;
}

export interface SlicePolyline {
  points: SlicePoint2d[];
  closed: boolean;
  color: string;
  highlight: boolean;
  name: string;
}

export interface BodySliceView {
  axis: BodySliceAxis;
  title: string;
  position: number;
  uLabel: string;
  vLabel: string;
  bounds: { uMin: number; uMax: number; vMin: number; vMax: number };
  polylines: SlicePolyline[];
}

function fmtSlicePos(n: number): string {
  if (!Number.isFinite(n)) return "?";
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a >= 100) return n.toFixed(1);
  if (a >= 10) return n.toFixed(2);
  if (a >= 1) return n.toFixed(3);
  return n.toPrecision(3);
}

function axisValue(p: Vec3, axis: BodySliceAxis): number {
  return axis === "x" ? p.x : axis === "y" ? p.y : p.z;
}

function toUV(p: Vec3, axis: BodySliceAxis): SlicePoint2d {
  if (axis === "z") return { u: p.x, v: p.y };
  if (axis === "y") return { u: p.x, v: p.z };
  return { u: p.y, v: p.z };
}

function circlePoly(cu: number, cv: number, r: number, seg = 48): SlicePoint2d[] {
  const pts: SlicePoint2d[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push({ u: cu + r * Math.cos(a), v: cv + r * Math.sin(a) });
  }
  return pts;
}

function rectPoly(u0: number, v0: number, u1: number, v1: number): SlicePoint2d[] {
  return [
    { u: u0, v: v0 },
    { u: u1, v: v0 },
    { u: u1, v: v1 },
    { u: u0, v: v1 },
  ];
}

function hexPoly(cu: number, cv: number, flatToFlat: number, rotation: number): SlicePoint2d[] {
  const R = (flatToFlat || 1) / Math.sqrt(3);
  const pts: SlicePoint2d[] = [];
  for (let i = 0; i < 6; i++) {
    const a = rotation + (i * Math.PI) / 3;
    pts.push({ u: cu + R * Math.cos(a), v: cv + R * Math.sin(a) });
  }
  return pts;
}

function sliceAABB(center: Vec3, size: Vec3, axis: BodySliceAxis, pos: number): SlicePoint2d[] | null {
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  const min = { x: center.x - hx, y: center.y - hy, z: center.z - hz };
  const max = { x: center.x + hx, y: center.y + hy, z: center.z + hz };
  if (axis === "z") {
    if (pos < min.z || pos > max.z) return null;
    return rectPoly(min.x, min.y, max.x, max.y);
  }
  if (axis === "y") {
    if (pos < min.y || pos > max.y) return null;
    return rectPoly(min.x, min.z, max.x, max.z);
  }
  if (pos < min.x || pos > max.x) return null;
  return rectPoly(min.y, min.z, max.y, max.z);
}

function sliceOrientedBox(
  corner: Vec3,
  edges: [Vec3, Vec3, Vec3],
  axis: BodySliceAxis,
  pos: number
): SlicePoint2d[] | null {
  const e1 = edges[0];
  const e2 = edges[1];
  const e3 = edges[2];
  const at = (a: number, b: number, c: number): Vec3 => ({
    x: corner.x + a * e1.x + b * e2.x + c * e3.x,
    y: corner.y + a * e1.y + b * e2.y + c * e3.y,
    z: corner.z + a * e1.z + b * e2.z + c * e3.z,
  });
  const verts = [
    at(0, 0, 0),
    at(1, 0, 0),
    at(1, 1, 0),
    at(0, 1, 0),
    at(0, 0, 1),
    at(1, 0, 1),
    at(1, 1, 1),
    at(0, 1, 1),
  ];
  const idx = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const hits: SlicePoint2d[] = [];
  const eps = 1e-8;
  for (const [i, j] of idx) {
    const p0 = verts[i]!;
    const p1 = verts[j]!;
    const a = axisValue(p0, axis);
    const b = axisValue(p1, axis);
    if ((a - pos) * (b - pos) > eps) continue;
    if (Math.abs(b - a) < eps) {
      if (Math.abs(a - pos) < 1e-6) {
        hits.push(toUV(p0, axis), toUV(p1, axis));
      }
      continue;
    }
    const t = (pos - a) / (b - a);
    if (t >= -1e-6 && t <= 1 + 1e-6) {
      hits.push(
        toUV(
          {
            x: p0.x + t * (p1.x - p0.x),
            y: p0.y + t * (p1.y - p0.y),
            z: p0.z + t * (p1.z - p0.z),
          },
          axis
        )
      );
    }
  }
  const uniq: SlicePoint2d[] = [];
  for (const h of hits) {
    if (!uniq.some((q) => Math.abs(q.u - h.u) < 1e-7 && Math.abs(q.v - h.v) < 1e-7)) uniq.push(h);
  }
  if (uniq.length < 3) return null;
  const cu = uniq.reduce((s, p) => s + p.u, 0) / uniq.length;
  const cv = uniq.reduce((s, p) => s + p.v, 0) / uniq.length;
  uniq.sort((a, b) => Math.atan2(a.v - cv, a.u - cu) - Math.atan2(b.v - cv, b.u - cu));
  return uniq;
}

function sliceWedge(
  corner: Vec3,
  edges: [Vec3, Vec3, Vec3],
  axis: BodySliceAxis,
  pos: number
): SlicePoint2d[] | null {
  const e1 = edges[0];
  const e2 = edges[1];
  const e3 = edges[2];
  const B = corner;
  const verts = [
    B,
    add3(B, e1),
    add3(B, e2),
    add3(B, e3),
    add3(add3(B, e1), e3),
    add3(add3(B, e2), e3),
  ];
  const idx = [
    [0, 1],
    [0, 2],
    [1, 2],
    [3, 4],
    [3, 5],
    [4, 5],
    [0, 3],
    [1, 4],
    [2, 5],
  ];
  return clipEdgesToSlice(verts, idx, axis, pos);
}

function clipEdgesToSlice(
  verts: Vec3[],
  idx: number[][],
  axis: BodySliceAxis,
  pos: number
): SlicePoint2d[] | null {
  const hits: SlicePoint2d[] = [];
  const eps = 1e-8;
  for (const [i, j] of idx) {
    const p0 = verts[i]!;
    const p1 = verts[j]!;
    const a = axisValue(p0, axis);
    const b = axisValue(p1, axis);
    if ((a - pos) * (b - pos) > eps) continue;
    if (Math.abs(b - a) < eps) {
      if (Math.abs(a - pos) < 1e-6) hits.push(toUV(p0, axis), toUV(p1, axis));
      continue;
    }
    const t = (pos - a) / (b - a);
    if (t >= -1e-6 && t <= 1 + 1e-6) {
      hits.push(
        toUV(
          {
            x: p0.x + t * (p1.x - p0.x),
            y: p0.y + t * (p1.y - p0.y),
            z: p0.z + t * (p1.z - p0.z),
          },
          axis
        )
      );
    }
  }
  const uniq: SlicePoint2d[] = [];
  for (const h of hits) {
    if (!uniq.some((q) => Math.abs(q.u - h.u) < 1e-7 && Math.abs(q.v - h.v) < 1e-7)) uniq.push(h);
  }
  if (uniq.length < 3) return null;
  const cu = uniq.reduce((s, p) => s + p.u, 0) / uniq.length;
  const cv = uniq.reduce((s, p) => s + p.v, 0) / uniq.length;
  uniq.sort((a, b) => Math.atan2(a.v - cv, a.u - cu) - Math.atan2(b.v - cv, b.u - cu));
  return uniq;
}

function sliceSpheroid(
  center: Vec3,
  axisVec: Vec3,
  a: number,
  b: number,
  axis: BodySliceAxis,
  pos: number
): SlicePoint2d[] | null {
  const k =
    axis === "x" ? { x: 1, y: 0, z: 0 } : axis === "y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const e1 = axis === "x" ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const e2 = axis === "z" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const n = normalize(axisVec.x, axisVec.y, axisVec.z);
  const d = pos - axisValue(center, axis);
  const kn = n.x * k.x + n.y * k.y + n.z * k.z;
  const e1n = n.x * e1.x + n.y * e1.y + n.z * e1.z;
  const e2n = n.x * e2.x + n.y * e2.y + n.z * e2.z;
  const alpha = 1 / (a * a) - 1 / (b * b);
  const beta = 1 / (b * b);
  const pts: SlicePoint2d[] = [];
  const N = 48;
  for (let i = 0; i < N; i++) {
    const th = (i / N) * 2 * Math.PI;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const q = cs * e1n + sn * e2n;
    const p = d * kn;
    const A = alpha * q * q + beta;
    const Bco = 2 * alpha * p * q;
    const C = alpha * p * p + beta * d * d - 1;
    const disc = Bco * Bco - 4 * A * C;
    if (disc < 0 || Math.abs(A) < 1e-18) continue;
    const sdisc = Math.sqrt(disc);
    const rPos = (-Bco + sdisc) / (2 * A);
    const rNeg = (-Bco - sdisc) / (2 * A);
    const r = rPos > 1e-9 ? rPos : rNeg > 1e-9 ? rNeg : Math.max(rPos, rNeg);
    if (!(r > 0) || !Number.isFinite(r)) continue;
    pts.push(
      toUV(
        {
          x: center.x + d * k.x + r * (cs * e1.x + sn * e2.x),
          y: center.y + d * k.y + r * (cs * e1.y + sn * e2.y),
          z: center.z + d * k.z + r * (cs * e1.z + sn * e2.z),
        },
        axis
      )
    );
  }
  return pts.length >= 8 ? pts : null;
}

function ellipsePoly(cu: number, cv: number, au: number, av: number, bu: number, bv: number, seg = 48): SlicePoint2d[] {
  const pts: SlicePoint2d[] = [];
  for (let i = 0; i < seg; i++) {
    const th = (i / seg) * 2 * Math.PI;
    const c = Math.cos(th);
    const s = Math.sin(th);
    pts.push({ u: cu + au * c + bu * s, v: cv + av * c + bv * s });
  }
  return pts;
}

function vecToUV(v: Vec3, axis: BodySliceAxis): SlicePoint2d {
  if (axis === "z") return { u: v.x, v: v.y };
  if (axis === "y") return { u: v.x, v: v.z };
  return { u: v.y, v: v.z };
}

function sliceMesh(
  m: MeshDescriptor,
  axis: BodySliceAxis,
  pos: number,
  highlight: boolean
): SlicePolyline[] {
  const color = m.color || (highlight ? DRAFT_BODY_COLOR : NEIGHBOR_BODY_COLOR);
  const base = { closed: true as const, color, highlight, name: m.name };
  const out: SlicePolyline[] = [];
  const push = (points: SlicePoint2d[] | null | undefined) => {
    if (points && points.length >= 2) out.push({ ...base, points });
  };

  if (m.kind === "sphere" && m.radius != null) {
    const d = axisValue(m.center, axis) - pos;
    const r = m.radius;
    if (Math.abs(d) <= r) {
      const rr = Math.sqrt(Math.max(0, r * r - d * d));
      const c = toUV(m.center, axis);
      push(circlePoly(c.u, c.v, rr));
    }
    return out;
  }

  if (m.kind === "cylinder" && m.radius != null && m.height != null) {
    const ax = m.axis ?? { x: 0, y: 0, z: 1 };
    const n =
      axis === "x" ? { x: 1, y: 0, z: 0 } : axis === "y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    const L = len3(ax.x, ax.y, ax.z) || 1;
    const along = Math.abs(ax.x * n.x + ax.y * n.y + ax.z * n.z) / L;
    const h2 = m.height / 2;
    if (along > 0.92) {
      const d = axisValue(m.center, axis) - pos;
      if (Math.abs(d) <= h2 + 1e-9) {
        const c = toUV(m.center, axis);
        push(circlePoly(c.u, c.v, m.radius));
      }
      return out;
    }
    if (along < 0.2) {
      const d = axisValue(m.center, axis) - pos;
      if (Math.abs(d) > m.radius) return out;
      const half = Math.sqrt(Math.max(0, m.radius * m.radius - d * d));
      if (axis === "x") {
        push(rectPoly(m.center.y - half, m.center.z - h2, m.center.y + half, m.center.z + h2));
      } else if (axis === "y") {
        push(rectPoly(m.center.x - half, m.center.z - h2, m.center.x + half, m.center.z + h2));
      } else {
        push(rectPoly(m.center.x - half, m.center.y - h2, m.center.x + half, m.center.y + h2));
      }
      return out;
    }
    if (m.size) push(sliceAABB(m.center, m.size, axis, pos));
    else push(sliceAABB(m.center, { x: m.radius * 2, y: m.radius * 2, z: m.height }, axis, pos));
    return out;
  }

  if (m.kind === "hex") {
    const h = m.height ?? m.size?.z ?? 1;
    const h2 = h / 2;
    if (axis === "z") {
      if (Math.abs(pos - m.center.z) <= h2 + 1e-9) {
        push(hexPoly(m.center.x, m.center.y, m.flatToFlat ?? 1, m.rotation ?? 0));
      }
      return out;
    }
    if (m.size) push(sliceAABB(m.center, m.size, axis, pos));
    return out;
  }

  if (m.kind === "orientedHex" && m.corner && m.axis && m.axisU && m.axisV && m.height != null && m.flatToFlat != null) {
    const Hvec = scale3(m.axis, m.height);
    const denom = axisValue(add3(m.corner, Hvec), axis) - axisValue(m.corner, axis);
    const n =
      axis === "x" ? { x: 1, y: 0, z: 0 } : axis === "y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    const along = Math.abs(m.axis.x * n.x + m.axis.y * n.y + m.axis.z * n.z);
    if (along > 0.92 && Math.abs(denom) > 1e-12) {
      const t = (pos - axisValue(m.corner, axis)) / denom;
      if (t >= -1e-6 && t <= 1 + 1e-6) {
        const base = add3(m.corner, scale3(Hvec, Math.max(0, Math.min(1, t))));
        const R = m.flatToFlat / Math.sqrt(3);
        const pts: SlicePoint2d[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          pts.push(
            toUV(
              add3(base, add3(scale3(m.axisU, R * Math.cos(a)), scale3(m.axisV, R * Math.sin(a)))),
              axis
            )
          );
        }
        push(pts);
      }
      return out;
    }
    const verts: Vec3[] = [];
    for (const s of [0, 1]) {
      const base = add3(m.corner, scale3(Hvec, s));
      const R = m.flatToFlat / Math.sqrt(3);
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        verts.push(add3(base, add3(scale3(m.axisU, R * Math.cos(a)), scale3(m.axisV, R * Math.sin(a)))));
      }
    }
    push(clipEdgesToSlice(verts, HEXG_EDGES, axis, pos));
    return out;
  }

  if (m.kind === "orientedBox" && m.corner && m.edges) {
    push(sliceOrientedBox(m.corner, m.edges, axis, pos));
    return out;
  }

  if (m.kind === "wedge" && m.corner && m.edges) {
    push(sliceWedge(m.corner, m.edges, axis, pos));
    return out;
  }

  if (m.kind === "ellipsoid" && m.semiA != null && m.semiB != null && m.axis) {
    push(sliceSpheroid(m.center, m.axis, m.semiA, m.semiB, axis, pos));
    return out;
  }

  if (m.kind === "cone" && m.height != null && m.r1 != null && m.r2 != null && m.axis) {
    const ax = m.axis;
    const n =
      axis === "x" ? { x: 1, y: 0, z: 0 } : axis === "y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    const L = len3(ax.x, ax.y, ax.z) || 1;
    const along = Math.abs(ax.x * n.x + ax.y * n.y + ax.z * n.z) / L;
    const h2 = m.height / 2;
    if (along > 0.92) {
      const d = axisValue(m.center, axis) - pos;
      if (Math.abs(d) <= h2 + 1e-9) {
        const t = (d + h2) / Math.max(m.height, 1e-12);
        const rr = m.r1 + t * (m.r2 - m.r1);
        const c = toUV(m.center, axis);
        push(circlePoly(c.u, c.v, Math.abs(rr)));
      }
      return out;
    }
    if (along < 0.2) {
      const d = axisValue(m.center, axis) - pos;
      const rmax = Math.max(m.r1, m.r2);
      if (Math.abs(d) > rmax) return out;
      const half1 = Math.sqrt(Math.max(0, m.r1 * m.r1 - d * d));
      const half2 = Math.sqrt(Math.max(0, m.r2 * m.r2 - d * d));
      const c = m.center;
      if (axis === "x") {
        push([
          { u: c.y - half1, v: c.z - h2 },
          { u: c.y + half1, v: c.z - h2 },
          { u: c.y + half2, v: c.z + h2 },
          { u: c.y - half2, v: c.z + h2 },
        ]);
      } else if (axis === "y") {
        push([
          { u: c.x - half1, v: c.z - h2 },
          { u: c.x + half1, v: c.z - h2 },
          { u: c.x + half2, v: c.z + h2 },
          { u: c.x - half2, v: c.z + h2 },
        ]);
      } else {
        push([
          { u: c.x - half1, v: c.y - h2 },
          { u: c.x + half1, v: c.y - h2 },
          { u: c.x + half2, v: c.y + h2 },
          { u: c.x - half2, v: c.y + h2 },
        ]);
      }
      return out;
    }
    return out;
  }

  if (m.kind === "ellipticCylinder" && m.height != null && m.axis && m.axisU && m.axisV) {
    const ax = m.axis;
    const n =
      axis === "x" ? { x: 1, y: 0, z: 0 } : axis === "y" ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
    const L = len3(ax.x, ax.y, ax.z) || 1;
    const along = Math.abs(ax.x * n.x + ax.y * n.y + ax.z * n.z) / L;
    const h2 = m.height / 2;
    if (along > 0.92) {
      const d = axisValue(m.center, axis) - pos;
      if (Math.abs(d) <= h2 + 1e-9) {
        const c = toUV(m.center, axis);
        const u1 = vecToUV(m.axisU, axis);
        const u2 = vecToUV(m.axisV, axis);
        push(ellipsePoly(c.u, c.v, u1.u, u1.v, u2.u, u2.v));
      }
      return out;
    }
    if (m.size) push(sliceAABB(m.center, m.size, axis, pos));
    else {
      const ru = len3(m.axisU.x, m.axisU.y, m.axisU.z);
      const rv = len3(m.axisV.x, m.axisV.y, m.axisV.z);
      push(sliceAABB(m.center, { x: ru * 2, y: rv * 2, z: m.height }, axis, pos));
    }
    return out;
  }

  if (m.kind === "plane") return out;

  if (m.size) push(sliceAABB(m.center, m.size, axis, pos));
  return out;
}

function axisBounds2(
  bbox: BoundingBox,
  axis: BodySliceAxis
): { uMin: number; uMax: number; vMin: number; vMax: number } {
  if (axis === "z") return { uMin: bbox.min.x, uMax: bbox.max.x, vMin: bbox.min.y, vMax: bbox.max.y };
  if (axis === "y") return { uMin: bbox.min.x, uMax: bbox.max.x, vMin: bbox.min.z, vMax: bbox.max.z };
  return { uMin: bbox.min.y, uMax: bbox.max.y, vMin: bbox.min.z, vMax: bbox.max.z };
}

function boundsOfPolys(
  polys: SlicePolyline[],
  fallback: BoundingBox,
  axis: BodySliceAxis
): { uMin: number; uMax: number; vMin: number; vMax: number } {
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of polys) {
    for (const q of p.points) {
      uMin = Math.min(uMin, q.u);
      uMax = Math.max(uMax, q.u);
      vMin = Math.min(vMin, q.v);
      vMax = Math.max(vMax, q.v);
    }
  }
  if (!Number.isFinite(uMin)) return axisBounds2(fallback, axis);
  const du = Math.max(uMax - uMin, 0.2);
  const dv = Math.max(vMax - vMin, 0.2);
  const pad = 0.14;
  return {
    uMin: uMin - du * pad,
    uMax: uMax + du * pad,
    vMin: vMin - dv * pad,
    vMax: vMax + dv * pad,
  };
}

/** XY / XZ / YZ через slicePositions или центр focus. */
export function buildBodySlices(
  meshes: MeshDescriptor[],
  focusName: string,
  focusBbox: BoundingBox,
  frameBbox: BoundingBox,
  slicePositions?: Partial<{ x: number; y: number; z: number }>
): BodySliceView[] {
  const c = bboxCenterSize(focusBbox).center;
  const clampAxis = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const pos = {
    x: clampAxis(slicePositions?.x ?? c.x, focusBbox.min.x, focusBbox.max.x),
    y: clampAxis(slicePositions?.y ?? c.y, focusBbox.min.y, focusBbox.max.y),
    z: clampAxis(slicePositions?.z ?? c.z, focusBbox.min.z, focusBbox.max.z),
  };
  const specs: Array<{
    axis: BodySliceAxis;
    title: string;
    uLabel: string;
    vLabel: string;
    position: number;
  }> = [
    { axis: "z", title: `XY  Z=${fmtSlicePos(pos.z)}`, uLabel: "X", vLabel: "Y", position: pos.z },
    { axis: "y", title: `XZ  Y=${fmtSlicePos(pos.y)}`, uLabel: "X", vLabel: "Z", position: pos.y },
    { axis: "x", title: `YZ  X=${fmtSlicePos(pos.x)}`, uLabel: "Y", vLabel: "Z", position: pos.x },
  ];
  return specs.map((s) => {
    const polylines: SlicePolyline[] = [];
    for (const m of meshes) {
      polylines.push(...sliceMesh(m, s.axis, s.position, m.name === focusName));
    }
    return {
      ...s,
      polylines,
      bounds: boundsOfPolys(polylines, frameBbox, s.axis),
    };
  });
}

/**
 * Превью черновика тела + ближайшие соседи (серым).
 * Self-contained вместе с meshPreview — копируется в extension/vendor.
 */
export function buildDraftBodyPreview(input: DraftBodyPreviewInput): DraftBodyPreviewResult {
  const warnings: string[] = [];
  let t = input.bodyType.toUpperCase();
  let params = input.params;
  const name = input.name.trim() || "draft";

  if (t === "TRANSF") {
    const spec = input.transf;
    if (!spec) {
      return {
        meshes: [],
        focusName: name,
        neighborNames: [],
        nearest: undefined,
        bbox: null,
        focusBbox: null,
        unsupported: true,
        warnings: ["TRANSF: нет прототипа и M|R A B f (UserGuide §9.1.3.22)"],
        slices: [],
      };
    }
    const mode = normalizeTransfMode(spec.mode);
    if (!mode) {
      return {
        meshes: [],
        focusName: name,
        neighborNames: [],
        nearest: undefined,
        bbox: null,
        focusBbox: null,
        unsupported: true,
        warnings: [`TRANSF: тип «${spec.mode}» — ожидается M или R`],
        slices: [],
      };
    }
    const want = spec.protoName.trim().toUpperCase();
    const proto = input.scenePrimitives.find((p) => p.name.toUpperCase() === want);
    if (!proto) {
      return {
        meshes: [],
        focusName: name,
        neighborNames: [],
        nearest: undefined,
        bbox: null,
        focusBbox: null,
        unsupported: true,
        warnings: [
          `TRANSF: прототип «${spec.protoName}» не найден в текущей секции тел (должен быть описан раньше, UserGuide §9.1.3.22)`,
        ],
        slices: [],
      };
    }
    if (TRANSF_FORBIDDEN_PROTOS.has(proto.type.toUpperCase())) {
      return {
        meshes: [],
        focusName: name,
        neighborNames: [],
        nearest: undefined,
        bbox: null,
        focusBbox: null,
        unsupported: true,
        warnings: [
          `TRANSF: ${proto.type} не может быть прототипом (не RPP, SBOX, SHEX, PLX, PLY, UCX, UCY)`,
        ],
        slices: [],
      };
    }
    const next = applyTransfToBodyParams(proto.type, proto.params, mode, spec.A, spec.B, spec.f);
    if (!next) {
      return {
        meshes: [],
        focusName: name,
        neighborNames: [],
        nearest: undefined,
        bbox: null,
        focusBbox: null,
        unsupported: true,
        warnings: [`TRANSF: не удалось преобразовать прототип ${proto.type} ${proto.name}`],
        slices: [],
      };
    }
    t = proto.type.toUpperCase();
    params = next;
  }

  const bbox = bboxFromBodyParams(t, params);
  if (!bbox) {
    return {
      meshes: [],
      focusName: name,
      neighborNames: [],
      nearest: undefined,
      bbox: null,
      focusBbox: null,
      unsupported: isMeshPreviewUnsupported(t) || !isMeshPreviewSupported(t),
      warnings: ["Недостаточно параметров для bbox/превью"],
      slices: [],
    };
  }

  const draftSolid: PrimitiveSolid = {
    type: t,
    name,
    params,
    bbox,
    color: DRAFT_BODY_COLOR,
  };

  const ranked = rankNearbyBodies(bbox, input.scenePrimitives, name);
  const containerIdx = firstContainerIndex(input.scenePrimitives);
  const localRanked = ranked.filter((x) => {
    const idx = input.scenePrimitives.indexOf(x.body);
    return !isNeighborExcluded(x.body, bbox, idx === containerIdx && containerIdx >= 0);
  });
  const nearest = localRanked[0] ? { name: localRanked[0].body.name, gap: localRanked[0].gap } : undefined;
  const maxCount = input.nearby?.maxCount ?? 12;
  const maxGapFactor = input.nearby?.maxGapFactor ?? 4;
  const maxGap = bboxExtent(bbox) * maxGapFactor;
  const neighbors = localRanked.filter((x) => x.gap <= maxGap).slice(0, maxCount).map((x) => x.body);

  let previewBbox: BoundingBox = padBbox(bbox);
  for (const n of neighbors) {
    previewBbox = {
      min: {
        x: Math.min(previewBbox.min.x, n.bbox.min.x),
        y: Math.min(previewBbox.min.y, n.bbox.min.y),
        z: Math.min(previewBbox.min.z, n.bbox.min.z),
      },
      max: {
        x: Math.max(previewBbox.max.x, n.bbox.max.x),
        y: Math.max(previewBbox.max.y, n.bbox.max.y),
        z: Math.max(previewBbox.max.z, n.bbox.max.z),
      },
    };
  }
  const sceneBbox = previewBbox;

  const meshes: MeshDescriptor[] = [];
  if (isMeshPreviewUnsupported(t)) {
    warnings.push(`Тип ${t} не рисуется на сечениях`);
  } else {
    const draftMesh = bodyToMeshDescriptor(draftSolid, sceneBbox);
    if (draftMesh) {
      meshes.push({ ...draftMesh, color: DRAFT_BODY_COLOR });
    } else {
      warnings.push("Не удалось построить mesh черновика");
      meshes.push({
        name,
        bodyType: t,
        kind: "bbox",
        color: DRAFT_BODY_COLOR,
        ...bboxCenterSize(bbox),
      });
    }
  }

  for (const n of neighbors) {
    const m = bodyToMeshDescriptor({ ...n, color: NEIGHBOR_BODY_COLOR }, sceneBbox);
    if (m) meshes.push({ ...m, color: NEIGHBOR_BODY_COLOR });
    else {
      meshes.push({
        name: n.name,
        bodyType: n.type.toUpperCase(),
        kind: "bbox",
        color: NEIGHBOR_BODY_COLOR,
        ...bboxCenterSize(n.bbox),
      });
    }
  }

  return {
    meshes,
    focusName: name,
    neighborNames: neighbors.map((n) => n.name),
    nearest,
    bbox: previewBbox,
    focusBbox: bbox,
    unsupported: isMeshPreviewUnsupported(t),
    warnings,
    slices: buildBodySlices(meshes, name, bbox, previewBbox, input.slicePositions),
  };
}
