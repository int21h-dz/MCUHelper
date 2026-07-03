import type {
  BodySummary,
  ConstantSummary,
  DocumentAst,
  DiagnosticMessage,
  LatticeSummary,
  MaterialSummary,
  NetNode,
  NetSummary,
  ObjectSummary,
  ZoneSummary,
} from "./ast";
import { computeBodyVolumeCm3 } from "./bodyVolume";
import { evaluateExpression } from "./expression";
import { analyzeBodyParameterCounts } from "./bodyParamValidation";
import { analyzeEnergyGroupStatements } from "./energyGroups";
import { analyzeMatrCardParams } from "./matrCardValidation";
import { analyzeNuclideParameterCounts } from "./nuclideParamValidation";
import { analyzePositiveQuantities } from "./positiveQuantities";
import { analyzeUndefinedVariables } from "./variableRefs";
import { computeMaterialMassDensityGcm3 } from "./materialDensity";
import { materialVolumeCm3, parseMaterialVolumes } from "./materialVolumes";
import { buildZoneRegistrationMap } from "./zoneRegistration";
import { buildScopedVars, constScopeKey } from "./constantScope";
import { collectZoneBodyRefs, isAllSpaceZoneRef } from "./zoneBodyRefs";

export function analyzeSemantics(ast: DocumentAst): DiagnosticMessage[] {
  const diags: DiagnosticMessage[] = [...ast.diagnostics];
  const bodyNames = new Map<string, { type: string; range: import("./ast").SourceRange }>();
  const zoneNames = new Set<string>();
  const constNames = new Map<string, number>();
  const vars = new Map<string, number>();

  for (const c of ast.constants) {
    const scope = c.scope ?? "global";
    const key = constScopeKey(scope, c.name);
    const scopedVars = buildScopedVars(ast.constants, c.range.offset, scope);
    const v = evaluateExpression(c.expression, scopedVars);
    if (v !== null) {
      if (!c.mutable && constNames.has(key)) {
        diags.push({
          severity: "error",
          message: `Переопределение константы EQU ${c.name}${scope !== "global" ? ` (${scope})` : ""}`,
          code: "const-redef",
          range: c.range,
        });
      }
      constNames.set(key, c.range.start.line);
      vars.set(c.name, v);
    }
  }

  const bodyKey = (name: string, scope?: string) => `${scope ?? "global"}::${name}`;

  function hasBodyInScope(name: string, scope: string): boolean {
    return bodyNames.has(bodyKey(name, scope));
  }

  /** Ссылка на тело в зоне: имя, сокращение N<число> или 0 как всё пространство (UserGuide §9.1.4). */
  function resolveZoneBodyRef(ref: string, scope: string, expression: string): boolean {
    if (isAllSpaceZoneRef(expression, ref)) return true;
    if (hasBodyInScope(ref, scope)) return true;
    if (/^\d+$/.test(ref)) return hasBodyInScope(`N${ref}`, scope);
    return false;
  }

  for (const b of ast.bodies) {
    if (b.name !== "*") {
      const key = bodyKey(b.name, b.scope);
      if (bodyNames.has(key)) {
        diags.push({
          severity: "error",
          message: `Дублирующееся имя тела: ${b.name}${b.scope && b.scope !== "global" ? ` (${b.scope})` : ""}`,
          code: "body-dup",
          range: b.range,
        });
      }
      bodyNames.set(key, { type: b.bodyType, range: b.range });
    }

    if (b.transf && b.protoName) {
      const protoScope = b.scope ?? "global";
      if (!hasBodyInScope(b.protoName, protoScope)) {
        diags.push({
          severity: "error",
          message: `TRANSF: неизвестное тело-прототип ${b.protoName}`,
          code: "transf-ref",
          range: b.range,
        });
      }
    }
  }

  const matNumbers = new Set(ast.materials.map((m) => m.number));
  const maxMat = ast.materials.length > 0 ? Math.max(...ast.materials.map((m) => m.number)) : 0;
  for (let n = 1; n <= maxMat; n++) {
    if (!matNumbers.has(n)) {
      diags.push({
        severity: "error",
        message: `Пропущен номер материала MATR ${n}`,
        code: "matr-gap",
        range: ast.materials[0]?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, offset: 0, endOffset: 0 },
      });
    }
  }

  const zoneKey = (name: string, scope?: string) => `${scope ?? "global"}::${name}`;

  const zoneReg = buildZoneRegistrationMap(ast.zones);

  for (const z of ast.zones) {
    const zk = zoneKey(z.name, z.scope);
    if (zoneNames.has(zk)) {
      diags.push({
        severity: "error",
        message: `Дублирующееся имя зоны: ${z.name}${z.scope && z.scope !== "global" ? ` (${z.scope})` : ""}`,
        code: "zone-dup",
        range: z.range,
      });
    }
    zoneNames.add(zk);

    const scopePrefix = z.scope ?? "global";
    const refs = collectZoneBodyRefs(z.expression);
    for (const ref of refs) {
      if (ref.toUpperCase() === "U") continue;
      if (z.netCarrier && ref === z.netCarrier) continue;
      if (!resolveZoneBodyRef(ref, scopePrefix, z.expression)) {
        diags.push({
          severity: "error",
          message: `Зона ${z.name}: неизвестное тело «${ref}»`,
          code: "zone-body",
          range: z.range,
        });
      }
    }

    const resolved = zoneReg.get(z.name);
    if (maxMat > 0 && resolved?.materialNum != null && resolved.materialNum > maxMat) {
      diags.push({
        severity: "warning",
        message: `Зона ${z.name}: материальный номер ${resolved.materialNum} > числа материалов (${maxMat})`,
        code: "zone-mat",
        range: z.range,
      });
    }
  }

  for (const net of ast.nets) {
    const cellNames = new Set(ast.cells.map((c) => c.name));
    for (const row of net.typeMap) {
      for (const cell of row) {
        if (cell && !cellNames.has(cell)) {
          diags.push({
            severity: "warning",
            message: `NET ${net.name}: прототип ячейки «${cell}» не описан`,
            code: "net-cell",
            range: net.range,
          });
        }
      }
    }
  }

  for (const lat of ast.lattices) {
    const elNames = new Set(ast.latticeElements.map((e) => e.name));
    for (const el of lat.elements) {
      if (el && !elNames.has(el)) {
        diags.push({
          severity: "warning",
          message: `LATT: элемент «${el}» не описан в LCELL`,
          code: "latt-el",
          range: lat.range,
        });
      }
    }
  }

  diags.push(...analyzeEnergyGroupStatements(ast));
  diags.push(...analyzePositiveQuantities(ast));
  diags.push(...analyzeUndefinedVariables(ast));
  diags.push(...analyzeBodyParameterCounts(ast));
  diags.push(...analyzeNuclideParameterCounts(ast));
  diags.push(...analyzeMatrCardParams(ast));

  return diags;
}

export function buildConstantSummaries(ast: DocumentAst): ConstantSummary[] {
  const out: ConstantSummary[] = [];
  for (const c of ast.constants) {
    const scope = c.scope ?? "global";
    const vars = buildScopedVars(ast.constants, c.range.offset, scope);
    const value = evaluateExpression(c.expression, vars);
    out.push({
      name: c.name,
      expression: c.expression,
      value,
      mutable: c.mutable,
      scope,
      range: c.range,
    });
  }
  return out;
}

function netPrototypeName(raw: string): string | null {
  let s = raw.replace(/^\d+\*/, "").trim();
  if (!s) return null;
  if (s.startsWith("-")) s = s.slice(1);
  if (s === "0") return null;
  return s;
}

function uniqueNetPrototypes(net: NetNode): string[] {
  const set = new Set<string>();
  for (const row of net.typeMap) {
    for (const raw of row) {
      const name = netPrototypeName(raw);
      if (name) set.add(name);
    }
  }
  return [...set].sort();
}

function buildNetSummaries(ast: DocumentAst): NetSummary[] {
  return ast.nets.map((net) => ({
    name: net.name,
    root: net.root,
    cols: net.cols,
    rows: net.rows,
    layers: net.layers,
    typeMapRowCount: net.typeMap.length,
    cartogram: net.typeMap.map((row, idx) => ({
      row: idx + 1,
      label: `T${String(idx + 1).padStart(2, "0")}`,
      prototypes: row,
    })),
    carrierZones: ast.zones
      .filter((z) => z.netCarrier === net.name)
      .map((z) => ({ name: z.name, range: z.range })),
    prototypes: uniqueNetPrototypes(net).map((name) => ({
      name,
      range: ast.cells.find((c) => c.name === name)?.range,
    })),
    range: net.range,
  }));
}

function buildLatticeSummaries(ast: DocumentAst): LatticeSummary[] {
  return ast.lattices.map((lat) => {
    const posText = lat.positions.join(" ");
    return {
      latticeType: lat.latticeType,
      zoneNames: lat.zoneNames?.length ? lat.zoneNames : lat.zoneName ? [lat.zoneName] : [],
      elements: lat.elements.map((name) => ({
        name,
        range: ast.latticeElements.find((e) => e.name === name)?.range,
      })),
      positionsPreview: posText.length > 56 ? `${posText.slice(0, 53)}…` : posText,
      range: lat.range,
    };
  });
}

export function buildSummaries(ast: DocumentAst): {
  materials: MaterialSummary[];
  zones: ZoneSummary[];
  objects: ObjectSummary[];
  constants: ConstantSummary[];
  bodies: BodySummary[];
  nets: NetSummary[];
  lattices: LatticeSummary[];
} {
  const volumes = parseMaterialVolumes(ast);
  const materials: MaterialSummary[] = ast.materials.map((m) => {
    const massDensityGcm3 = computeMaterialMassDensityGcm3(m);
    const volumeCm3 = materialVolumeCm3(volumes, m.number);
    const massG =
      volumeCm3 != null && massDensityGcm3 != null && massDensityGcm3 > 0
        ? volumeCm3 * massDensityGcm3
        : null;
    return {
      number: m.number,
      group: m.group,
      temperature: m.temperature,
      nuclideCount: m.nuclides.length,
      nuclidesPreview: m.nuclides.map((n) => n.name).slice(0, 5).join(", ") + (m.nuclides.length > 5 ? "…" : ""),
      massDensityGcm3,
      volumeCm3,
      massG,
      nuclides: m.nuclides.map((n) => ({
        name: n.name,
        concentration: n.density,
        range: n.range,
      })),
      range: m.range,
    };
  });

  const zoneReg = buildZoneRegistrationMap(ast.zones);
  const zones: ZoneSummary[] = ast.zones.map((z) => {
    const resolved = zoneReg.get(z.name);
    return {
      name: z.name,
      expression: z.expression.length > 40 ? z.expression.slice(0, 37) + "…" : z.expression,
      materialNum: resolved?.materialNum,
      regNum: resolved?.regNum,
      objNum: resolved?.objNum,
      range: z.range,
    };
  });

  const objMap = new Map<number, ObjectSummary>();
  for (const z of zones) {
    const o = z.objNum ?? 1;
    if (!objMap.has(o)) {
      objMap.set(o, { objectNum: o, zoneNames: [], materialNums: [] });
    }
    const entry = objMap.get(o)!;
    entry.zoneNames.push(z.name);
    if (z.materialNum && !entry.materialNums.includes(z.materialNum)) {
      entry.materialNums.push(z.materialNum);
    }
  }

  const vars = new Map<string, number>();
  for (const c of ast.constants) {
    const scope = c.scope ?? "global";
    const scopedVars = buildScopedVars(ast.constants, c.range.offset, scope);
    const v = evaluateExpression(c.expression, scopedVars);
    if (v !== null) vars.set(c.name, v);
  }

  return {
    materials,
    zones,
    objects: Array.from(objMap.values()).sort((a, b) => a.objectNum - b.objectNum),
    constants: buildConstantSummaries(ast),
    bodies: ast.bodies
      .slice()
      .sort((a, b) => a.range.start.line - b.range.start.line)
      .map((b) => {
        const params = b.params.join(", ");
        const bodyVars = buildScopedVars(ast.constants, b.range.offset, b.scope ?? "global");
        return {
          name: b.name,
          bodyType: b.bodyType,
          paramsPreview: params.length > 48 ? `${params.slice(0, 45)}…` : params,
          volumeCm3: computeBodyVolumeCm3(b, bodyVars, ast.bodies),
          scope: b.scope,
          transf: b.transf,
          protoName: b.protoName,
          range: b.range,
        };
      }),
    nets: buildNetSummaries(ast),
    lattices: buildLatticeSummaries(ast),
  };
}
