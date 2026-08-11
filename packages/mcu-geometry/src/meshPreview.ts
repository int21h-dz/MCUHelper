import type { BoundingBox, GeometryScene, PrimitiveSolid, Vec3 } from "./types";

/** Типы тел с явным wireframe/mesh в 3D-превью. */
export const MESH_PREVIEW_SUPPORTED = new Set([
  "RPP",
  "RCZ",
  "SPH",
  "HEX",
  "HEXX",
  "HEXY",
  "RCC",
  "BOX",
  "SBOX",
  "SHEX",
  "PLX",
  "PLY",
  "PLZ",
  "PLG",
]);

/** Типы, которые в сцене есть, но в 3D не рисуем (бейдж «не в 3D»). */
export const MESH_PREVIEW_UNSUPPORTED = new Set(["ARB", "QUAD"]);

export const MESH_PREVIEW_BODY_CAP = 500;

export type MeshKind = "box" | "sphere" | "cylinder" | "hex" | "orientedBox" | "plane" | "bbox";

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
