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
  SPH: 4, RCC: 7, ELL: 7, RPP: 6, RCZ: 5,
  /** HEX: center (3) + вектор Sx,Hx,Hy (3); HEXX/HEXY: center (3) + H + D + [f] */
  HEX: 6, HEXX: 6, HEXY: 6, HEXG: 9,
  BOX: 12, WED: 12,
  UCX: 3, UCY: 3, UCZ: 3,
  PLG: 4, PLX: 1, PLY: 1, PLZ: 1,
  SLA: 6, SLB: 5, REC: 12, TRC: 8,
  SBOX: 9, SHEX: 3, ARB: "var", QUAD: 10, TRANSF: 5,
};

/** UserGuide §9.1.3.22: эти типы не могут быть телами-прототипами TRANSF. */
export const TRANSF_FORBIDDEN_PROTO_TYPES = new Set([
  "RPP",
  "SBOX",
  "SHEX",
  "PLX",
  "PLY",
  "UCX",
  "UCY",
]);

export function getBodyParamCount(key: string): number | "var" | undefined {
  return BODY_PARAM_COUNTS[key.toUpperCase()];
}
