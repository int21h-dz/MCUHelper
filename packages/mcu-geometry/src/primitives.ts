import { evaluateExpression, parseNumbers } from "@mcuhelper/mcu-language";
import type { DocumentAst } from "@mcuhelper/mcu-language";
import type { BoundingBox, PrimitiveSolid } from "./types";
import { hexBboxXY, hexFlatToFlat, hexKeyAngle } from "./hex2d";

export function emptyBbox(): BoundingBox {
  return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
}

export function bboxUnion(a: BoundingBox, b: BoundingBox): BoundingBox {
  return {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
  };
}

function bboxFromRpp(nums: number[]): BoundingBox {
  return {
    min: { x: nums[0], y: nums[2], z: nums[4] },
    max: { x: nums[1], y: nums[3], z: nums[5] },
  };
}

function bboxFromRcz(nums: number[]): BoundingBox {
  const [x, y, z, h, r] = nums;
  return {
    min: { x: x - r, y: y - r, z },
    max: { x: x + r, y: y + r, z: z + h },
  };
}

function bboxFromSph(nums: number[]): BoundingBox {
  const [x, y, z, r] = nums;
  return {
    min: { x: x - r, y: y - r, z: z - r },
    max: { x: x + r, y: y + r, z: z + r },
  };
}

function bboxFromHex(nums: number[], bodyType: string): BoundingBox {
  const cx = nums[0] ?? 0;
  const cy = nums[1] ?? 0;
  const cz = nums[2] ?? 0;
  const t = bodyType.toUpperCase();
  let vx: number;
  let vy: number;
  let vz: number;
  if (t === "HEXX" && nums.length >= 5) {
    const h = nums[3] ?? 1;
    const d = nums[4] ?? 1;
    const f = ((nums[5] ?? 0) * Math.PI) / 180;
    vx = d * Math.cos(f);
    vy = d * Math.sin(f);
    vz = h;
  } else if (t === "HEXY" && nums.length >= 5) {
    const h = nums[3] ?? 1;
    const d = nums[4] ?? 1;
    const f = ((nums[5] ?? 0) * Math.PI) / 180;
    vx = -d * Math.sin(f);
    vy = d * Math.cos(f);
    vz = h;
  } else {
    vx = nums[3] ?? 1;
    vy = nums[4] ?? 0;
    vz = nums[5] ?? 1;
  }
  const D = hexFlatToFlat(vx, vy) || 1;
  const phi = hexKeyAngle(vx, vy);
  const xy = hexBboxXY(cx, cy, D, phi);
  return {
    min: { x: xy.minX, y: xy.minY, z: cz },
    max: { x: xy.maxX, y: xy.maxY, z: cz + Math.abs(vz) },
  };
}

export function buildPrimitive(
  bodyType: string,
  name: string,
  params: string[],
  vars: Map<string, number>,
  scope?: string
): PrimitiveSolid | null {
  const nums = parseNumbers(params, vars);
  let bbox = emptyBbox();
  const t = bodyType.toUpperCase();
  if (t === "RPP" && nums.length >= 6) bbox = bboxFromRpp(nums);
  else if (t === "RCZ" && nums.length >= 5) bbox = bboxFromRcz(nums);
  else if (t === "SPH" && nums.length >= 4) bbox = bboxFromSph(nums);
  else if ((t === "HEX" || t === "HEXX" || t === "HEXY") && nums.length >= 3) bbox = bboxFromHex(nums, t);
  else if (nums.length >= 2)
    bbox = {
      min: { x: nums[0] - 1, y: nums[1] - 1, z: nums[2] ?? 0 },
      max: { x: nums[0] + 1, y: nums[1] + 1, z: (nums[2] ?? 0) + (nums[3] ?? 1) },
    };
  else return null;
  return { type: t, name, params: nums, bbox, scope };
}

export function buildVars(ast: DocumentAst): Map<string, number> {
  const vars = new Map<string, number>();
  for (const c of ast.constants) {
    const v = evaluateExpression(c.expression, vars);
    if (v !== null) vars.set(c.name, v);
  }
  return vars;
}

export function isGlobalScope(scope?: string): boolean {
  return !scope || scope === "global";
}
