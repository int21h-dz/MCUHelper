import type { DocumentAst } from "@mcuhelper/mcu-language";
import { buildZoneRegistrationMap, parseNumbers } from "@mcuhelper/mcu-language";
import { colorForBody, colorForZone } from "./colors";
import { buildPrimitive, buildVars, bboxUnion, emptyBbox, isGlobalScope } from "./primitives";
import { collectBodyRefs, parseZoneExpression } from "./zoneExpression";
import type {
  GeometryScene,
  LatticeInstance,
  MaterialInfo,
  NetInstance,
  PrimitiveSolid,
  ZoneSolid,
} from "./types";

function bodyZoneHint(bodyName: string, zones: ZoneSolid[]): string | undefined {
  const matches = zones.filter((z) => z.bodyRefs.includes(bodyName));
  if (matches.length === 1) return matches[0].name;
  return undefined;
}

export function buildScene(ast: DocumentAst): GeometryScene {
  const vars = buildVars(ast);

  const primitives: PrimitiveSolid[] = [];
  let sceneBbox = emptyBbox();
  let first = true;

  for (const b of ast.bodies) {
    if (!isGlobalScope(b.scope)) continue;
    const p = buildPrimitive(b.bodyType, b.name, b.params, vars, b.scope);
    if (p) {
      primitives.push(p);
      sceneBbox = first ? p.bbox : bboxUnion(sceneBbox, p.bbox);
      first = false;
    }
  }

  const zoneReg = buildZoneRegistrationMap(ast.zones);
  const zones: ZoneSolid[] = ast.zones
    .filter((z) => isGlobalScope(z.scope))
    .map((z, idx) => {
      const r = zoneReg.get(z.name);
      const parsedExpression = parseZoneExpression(z.expression) ?? undefined;
      const bodyRefs = parsedExpression ? collectBodyRefs(parsedExpression) : [];
      return {
        name: z.name,
        expression: z.expression,
        materialNum: r?.materialNum,
        regNum: r?.regNum,
        objNum: r?.objNum,
        bodyRefs,
        color: colorForZone(idx),
        scope: z.scope,
        parsedExpression,
      };
    });

  for (const p of primitives) {
    const hint = bodyZoneHint(p.name, zones);
    p.zoneHint = hint;
    p.color = hint
      ? zones.find((z) => z.name === hint)?.color ?? colorForBody(p.name)
      : colorForBody(p.name);
  }

  const materials: MaterialInfo[] = ast.materials.map((m) => ({
    number: m.number,
    nuclides: m.nuclides.map((n) => ({ name: n.name, density: n.density })),
    temperature: m.temperature,
  }));

  const nets: NetInstance[] = [];
  for (const net of ast.nets) {
    const rootParts = parseNumbers([net.root], vars);
    const origin = { x: rootParts[0] ?? 0, y: rootParts[1] ?? 0, z: rootParts[2] ?? 0 };
    for (let j = 0; j < net.rows; j++) {
      for (let i = 0; i < net.cols; i++) {
        const proto = net.typeMap[j]?.[i] ?? net.typeMap[0]?.[0] ?? "A";
        nets.push({
          netName: net.name,
          cellIndex: [i + 1, j + 1, 1],
          prototype: proto,
          origin: { x: origin.x + i * 2, y: origin.y + j * 2, z: origin.z },
          zones: zones.filter((zn) => zn.name.includes(proto)),
        });
      }
    }
  }

  const lattices: LatticeInstance[] = ast.lattices.map((lat) => ({
    latticeName: lat.latticeType,
    elementName: lat.elements[0] ?? "",
    transform: [],
    zones: zones.filter((zn) => (lat.zoneNames?.length ? lat.zoneNames : [lat.zoneName]).includes(zn.name)),
  }));

  if (first) {
    sceneBbox = { min: { x: -10, y: -10, z: -10 }, max: { x: 10, y: 10, z: 10 } };
  }

  return {
    primitives,
    zones,
    nets,
    lattices,
    bbox: sceneBbox,
    cameraPresets: ast.cameraPresets,
    materials,
    activeScope: "global",
  };
}

/** @deprecated Используйте buildSliceGrid из query.ts */
export function sliceAtZ(
  scene: GeometryScene,
  z: number
): { type: string; name: string; x: number; y: number; r?: number; color: string }[] {
  const shapes: { type: string; name: string; x: number; y: number; r?: number; color: string }[] = [];
  for (const p of scene.primitives) {
    if (z < p.bbox.min.z || z > p.bbox.max.z) continue;
    const col = p.color ?? "#6699cc";
    if (p.type === "RCZ" || p.type === "SPH") {
      const [cx, cy] = p.params;
      const rr = p.type === "RCZ" ? (p.params[4] ?? 1) : p.params[3];
      shapes.push({ type: "circle", name: p.name, x: cx, y: cy, r: rr, color: col });
    } else if (p.type === "RPP") {
      const [x1, xs, y1, ys] = p.params;
      shapes.push({ type: "rect", name: p.name, x: (x1 + xs) / 2, y: (y1 + ys) / 2, color: col });
    }
  }
  return shapes;
}
