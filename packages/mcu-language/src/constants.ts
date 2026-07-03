import type { FragmentId } from "./ast";

export const FRAGMENT_ORDER: FragmentId[] = [
  "physical",
  "geometry",
  "source",
  "registration",
  "burnupRegistration",
  "trajectory",
  "calculationControl",
  "burnup",
];

const BODY_PARAM_COUNTS: Record<string, number | "var"> = {
  SPH: 4, RCC: 7, RPP: 6, RCZ: 5,
  /** HEX: center (3) + вектор Sx,Hx,Hy (3); HEXX/HEXY: center (3) + H + D + [f] */
  HEX: 6, HEXX: 6, HEXY: 6,
  BOX: 12,
  PLG: 4, PLX: 1, PLY: 1, PLZ: 1, SBOX: 9, SHEX: 3, ARB: "var", QUAD: 10,
};

export function getBodyParamCount(key: string): number | "var" | undefined {
  return BODY_PARAM_COUNTS[key.toUpperCase()];
}
