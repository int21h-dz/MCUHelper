import { evaluateExpression, parseNumbers } from "@mcuhelper/mcu-language";
import type { LatticeNode } from "@mcuhelper/mcu-language";
import type { Vec3 } from "./types";

export interface GltlPlacement {
  protoIndex: number;
  offset: Vec3;
}

/** Парсинг PARM для генератора GLTL: [/n] x,y,z с пропуском /RZG, /2 и т.п. */
export function parseGltlPlacements(lattice: LatticeNode, vars: Map<string, number>): GltlPlacement[] {
  const text = lattice.positions.join(" ");
  if (!text.trim()) return [];

  const placements: GltlPlacement[] = [];
  let pendingProto = 1;
  const tokens = text.replace(/,/g, " ").trim().split(/\s+/).filter(Boolean);
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i]!;

    if (/^\/\d+$/.test(tok)) {
      pendingProto = parseInt(tok.slice(1), 10) || 1;
      i++;
      continue;
    }

    if (/^\/[A-Za-z]/.test(tok) || tok === "/2" || tok === "/3") {
      i++;
      while (i < tokens.length && !/^\/\d+$/.test(tokens[i]!) && !looksLikeNumber(tokens[i]!)) {
        i++;
      }
      continue;
    }

    const nums = readNumericTriple(tokens, i, vars);
    if (!nums) {
      i++;
      continue;
    }

    placements.push({
      protoIndex: pendingProto,
      offset: { x: nums[0], y: nums[1], z: nums[2] },
    });
    pendingProto = 1;
    i = nums.next;
  }

  return placements;
}

function looksLikeNumber(s: string): boolean {
  return /^[-+]?(\d+|\d*\.\d+)([eE][-+]?\d+)?$/.test(s) || /^[A-Za-z]/.test(s);
}

function readNumericTriple(
  tokens: string[],
  start: number,
  vars: Map<string, number>
): { 0: number; 1: number; 2: number; next: number } | null {
  const chunk: string[] = [];
  let i = start;
  while (i < tokens.length && chunk.length < 3) {
    if (/^\/\d+$/.test(tokens[i]!) || /^\/[A-Za-z]/.test(tokens[i]!)) break;
    chunk.push(tokens[i]!);
    i++;
  }
  if (chunk.length === 0) return null;

  const nums = parseNumbers(chunk, vars);
  if (nums.length >= 3) {
    return { 0: nums[0]!, 1: nums[1]!, 2: nums[2]!, next: i };
  }
  return null;
}

export function translatePoint(p: Vec3, dx: number, dy: number, dz: number): Vec3 {
  return { x: p.x - dx, y: p.y - dy, z: p.z - dz };
}

export function latticeHostZones(lat: LatticeNode): string[] {
  if (lat.zoneNames?.length) return lat.zoneNames;
  return lat.zoneName ? [lat.zoneName] : [];
}
