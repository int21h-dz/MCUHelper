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
  SourceRange,
  ZoneSummary,
} from "./ast";
import { computeBodyVolumeCm3 } from "./bodyVolume";
import { evaluateExpression } from "./expression";
import { analyzeBodyParameterCounts } from "./bodyParamValidation";
import { TRANSF_FORBIDDEN_PROTO_TYPES } from "./constants";
import { analyzeEnergyGroupStatements } from "./energyGroups";
import { analyzeBurnupSemantics } from "./burnupSemantics";
import { analyzeMatrCardParams } from "./matrCardValidation";
import {
  getDbmLibRoot,
  getDbmMaterial,
  isDbmLibraryName,
  remapDensParamForType,
  resolveDbmFilePath,
} from "./dbmLib";
import { analyzeNuclideParameterCounts } from "./nuclideParamValidation";
import { analyzePositiveQuantities } from "./positiveQuantities";
import { analyzeUndefinedVariables } from "./variableRefs";
import { analyzeMaterialMassDensity } from "./materialDensity";
import { analyzeMaterialActivity } from "./materialActivity";
import { getAwLibEntry, getAwLibTable } from "./awLib";
import {
  buildSumIsotopeStatesByOffset,
  evaluateSumIsotopeMembership,
  isSumIsotopeMember,
} from "./sumIsotope";
import { materialVolumeCm3, parseMaterialVolumes } from "./materialVolumes";
import { buildZoneRegistrationMap, getResolvedZoneNumbers } from "./zoneRegistration";
import { zoneTailToPointerSpec } from "./zonePointerResolution";
import { buildScopedVars, constScopeKey } from "./constantScope";
import { collectZoneBodyRefs, isAllSpaceZoneRef } from "./zoneBodyRefs";
import { formatExpandedLineRef } from "./includeLineMap";
import { analyzeCrossModuleLinks } from "./crossModuleAudit";
import { analyzeIdentifierNames } from "./identifierValidation";
import {
  cpmBlockByMaterialIndex,
  expandCpmMaterialNumbers,
} from "./cpmBlocks";

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
      } else {
        const proto = bodyNames.get(bodyKey(b.protoName, protoScope));
        const protoType = proto?.type.toUpperCase() ?? "";
        if (TRANSF_FORBIDDEN_PROTO_TYPES.has(protoType)) {
          diags.push({
            severity: "error",
            message: `TRANSF: ${protoType} не может быть прототипом (UserGuide §9.1.3.22: не RPP, SBOX, SHEX, PLX, PLY, UCX, UCY)`,
            code: "transf-proto",
            range: b.range,
          });
        }
      }
      const mode = (b.transfMode ?? "").toUpperCase();
      if (mode && mode !== "M" && mode !== "R") {
        diags.push({
          severity: "error",
          message: `TRANSF: тип преобразования «${b.transfMode}» — ожидается M (отражение) или R (поворот)`,
          code: "transf-mode",
          range: b.range,
        });
      }
    }
  }

  // UserGuide §8.2: number = порядковый номер следования в разделе с 1, пропуски запрещены.
  // GROUP=… — номер внутренний для группы; глобально материал перенумеровывается по порядку.
  // CPM n … CPMEND (UserGuide §8.8): блок из k материалов повторяется n раз → занимает n·Δ номеров.
  // Ссылка «ранее на …» — через includeLineMap (строка редактора или path:line в `#include`).
  const sumStatesByMat = buildSumIsotopeStatesByOffset(
    ast.statements,
    ast.materials.map((m) => m.range.offset),
    ast.constants
  );
  const matSeen = new Map<string, SourceRange>();
  const matCpm = cpmBlockByMaterialIndex(ast.cpmBlocks ?? []);
  const cpmGapDone = new Set<(typeof ast.cpmBlocks)[number]>();
  let nextExpectedMat = 1;
  for (let i = 0; i < ast.materials.length; i++) {
    const m = ast.materials[i]!;
    const groupKey = (m.group ?? "").toUpperCase();
    const uniqKey = `${groupKey}#${m.number}`;
    const prevRange = matSeen.get(uniqKey);
    if (prevRange != null) {
      const groupHint = groupKey ? ` (GROUP=${m.group})` : "";
      const priorRef = formatExpandedLineRef(ast.includeLineMap, prevRange.start.line);
      diags.push({
        severity: "error",
        message: `Переопределение материала MATR ${m.number}${groupHint} (ранее на ${priorRef})`,
        code: "matr-redef",
        range: m.range,
        related: [{ message: "Первое определение", range: prevRange }],
      });
    } else {
      matSeen.set(uniqKey, m.range);
      if (!m.group) {
        const cpm = matCpm.get(i);
        if (cpm && !cpmGapDone.has(cpm)) {
          cpmGapDone.add(cpm);
          const blockStart = nextExpectedMat;
          const blockSize = cpm.materialIndexes.length;
          if (blockSize > 0) {
            for (let k = 0; k < blockSize; k++) {
              const idx = cpm.materialIndexes[k]!;
              const mat = ast.materials[idx]!;
              if (mat.group) continue;
              const expected = blockStart + k;
              if (mat.number !== expected) {
                diags.push({
                  severity: "error",
                  message: `MATR ${mat.number}: номер должен быть равен порядковому номеру следования (${expected}) с учётом CPM`,
                  code: "matr-gap",
                  range: mat.range,
                });
              }
            }
            nextExpectedMat = blockStart + cpm.repetitions * blockSize;
          }
        } else if (!cpm) {
          const expected = nextExpectedMat;
          if (m.number !== expected) {
            diags.push({
              severity: "error",
              message: `MATR ${m.number}: номер должен быть равен порядковому номеру следования (${expected})`,
              code: "matr-gap",
              range: m.range,
            });
          }
          nextExpectedMat = Math.max(nextExpectedMat, m.number) + 1;
        }
      }
      // MCU error :55: пустой материал или все нуклиды ушли в суммарный изотоп (SI/SINOT/SIDEN).
      // §8.11: материал из .DBM задаётся кодовым именем — не пустой.
      if (isDbmLibraryName(m.nameLib) && m.libMaterialName) {
        const libRoot = getDbmLibRoot();
        if (libRoot) {
          const resolved = resolveDbmFilePath(libRoot, m.nameLib!);
          if (!resolved.exists) {
            diags.push({
              severity: "warning",
              message: `MATR ${m.number}: файл ${m.nameLib}.DBM не найден в MDBNR`,
              code: "matr-dbm-missing",
              range: m.range,
            });
          } else {
            const entry = getDbmMaterial(m.nameLib!, m.libMaterialName);
            if (!entry) {
              diags.push({
                severity: "warning",
                message: `MATR ${m.number}: материал «${m.libMaterialName}» отсутствует в ${m.nameLib}.DBM`,
                code: "matr-dbm-unknown",
                range: m.libMaterialRange ?? m.range,
              });
            }
          }
        }
      } else if (m.nuclides.length === 0) {
        diags.push({
          severity: "error",
          message: `MATR ${m.number}: материал пуст (нет нуклидов)`,
          code: "matr-empty",
          range: m.range,
        });
      } else {
        const sumState = sumStatesByMat.get(m.range.offset) ?? {
          listMode: "none" as const,
          list: new Set<string>(),
          siden: null,
        };
        const matVars = buildScopedVars(ast.constants, m.range.offset, "global");
        let allInSum = true;
        const kindSet = new Set<string>();
        for (const n of m.nuclides) {
          const x = evaluateSumIsotopeMembership(n, sumState, matVars);
          if (!x.inSum) {
            allInSum = false;
            break;
          }
          for (const k of x.kinds) kindSet.add(k);
        }
        if (allInSum) {
          const kinds = [...kindSet].map((k) => k.toUpperCase());
          diags.push({
            severity: "error",
            message: `MATR ${m.number}: материал пуст — все нуклиды в суммарном изотопе (${kinds.join("/")})`,
            code: "matr-empty",
            range: m.range,
          });
        }
      }
    }
  }

  const matNumbers = new Set(ast.materials.map((m) => m.number));
  const maxMat = ast.materials.length > 0 ? Math.max(...ast.materials.map((m) => m.number)) : 0;

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

    const resolved = getResolvedZoneNumbers(zoneReg, z);
    if (maxMat > 0 && resolved?.materialNum != null && resolved.materialNum > maxMat) {
      diags.push({
        severity: "warning",
        message: `Зона ${z.name}: материальный номер ${resolved.materialNum} > числа материалов (${maxMat})`,
        code: "zone-mat",
        range: z.range,
      });
    }
  }

  // Условные указатели: картограммы P/O/M проверяем только для зон прототипов этой NET
  // (и netCarrier), иначе УРУ из LATT/другой сети даёт ложные warning.
  {
    for (const net of ast.nets) {
      const haveP = new Set((net.regCartogram ?? []).map((r) => r.pointerIndex));
      const haveO = new Set((net.objCartogram ?? []).map((r) => r.pointerIndex));
      const haveM = new Set((net.matCartogram ?? []).map((r) => r.pointerIndex));
      if (haveP.size === 0 && haveO.size === 0 && haveM.size === 0) continue;

      const used = collectConditionalPointersForNet(ast, net);
      for (const n of used.uru) {
        if (haveP.size > 0 && !haveP.has(n)) {
          diags.push({
            severity: "warning",
            message: `NET ${net.name}: УРУ ${n} используется в зонах прототипов, но нет картограммы P${String(n).padStart(2, "0")}**`,
            code: "conditional-pointer-missing",
            range: net.range,
          });
        }
      }
      for (const n of used.uou) {
        if (haveO.size > 0 && !haveO.has(n)) {
          diags.push({
            severity: "warning",
            message: `NET ${net.name}: УОУ ${n} используется в зонах прототипов, но нет картограммы O${String(n).padStart(2, "0")}**`,
            code: "conditional-pointer-missing",
            range: net.range,
          });
        }
      }
      for (const n of used.umu) {
        if (haveM.size > 0 && !haveM.has(n)) {
          diags.push({
            severity: "warning",
            message: `NET ${net.name}: УМУ ${n} используется в зонах прототипов, но нет картограммы M${String(n).padStart(2, "0")}**`,
            code: "conditional-pointer-missing",
            range: net.range,
          });
        }
      }
    }
  }

  for (const net of ast.nets) {
    const cellNames = new Set(ast.cells.map((c) => c.name));
    for (const row of net.typeMap) {
      for (const raw of row) {
        const cell = netPrototypeName(raw);
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

    if (net.matMaps && matNumbers.size > 0) {
      const seen = new Set<number>();
      for (const layer of net.matMaps) {
        for (const row of layer) {
          for (const cell of row) {
            const n = Number(cell);
            if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
            seen.add(n);
            if (!matNumbers.has(n)) {
              diags.push({
                severity: "warning",
                message: `NET ${net.name}: материальный номер ${n} в картограмме M** не описан (MATR)`,
                code: "net-mat",
                range: net.range,
              });
            }
          }
        }
      }
    }

    // Абсолютные reg/obj из P/O — предупреждение только для «странных» отрицательных nested позже;
    // здесь проверяем размер строки vs cols
    for (const row of [...(net.regCartogram ?? []), ...(net.objCartogram ?? []), ...(net.matCartogram ?? [])]) {
      if (row.all) continue;
      if (row.values.length > 0 && row.values.length !== net.cols && row.values.length < net.cols) {
        diags.push({
          severity: "warning",
          message: `NET ${net.name}: ${row.label} — ${row.values.length} знач., ожидается ${net.cols} (cols)`,
          code: "cartogram-dim-mismatch",
          range: net.range,
        });
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
  diags.push(...analyzeIdentifierNames(ast));
  diags.push(...analyzeBodyParameterCounts(ast));
  diags.push(...analyzeNuclideParameterCounts(ast));
  diags.push(...analyzeMatrCardParams(ast));
  diags.push(...analyzeBurnupSemantics(ast));
  diags.push(...analyzeCrossModuleLinks(ast));

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

/** УРУ/УОУ/УМУ только из зон прототипов NET (cell:/lcell:) или netCarrier. */
function collectConditionalPointersForNet(
  ast: DocumentAst,
  net: NetNode
): { uru: Set<number>; uou: Set<number>; umu: Set<number> } {
  const proto = new Set(uniqueNetPrototypes(net).map((n) => n.toUpperCase()));
  const netName = net.name.toUpperCase();
  const cache = new Map<number, number>();
  const uru = new Set<number>();
  const uou = new Set<number>();
  const umu = new Set<number>();
  for (const z of ast.zones) {
    const scope = z.scope ?? "global";
    let related = Boolean(z.netCarrier && z.netCarrier.toUpperCase() === netName);
    if (!related && scope.startsWith("cell:")) {
      related = proto.has(scope.slice(5).toUpperCase());
    } else if (!related && scope.startsWith("lcell:")) {
      related = proto.has(scope.slice(6).toUpperCase());
    }
    if (!related) continue;
    const spec = zoneTailToPointerSpec(z.tail, cache);
    if (!spec) continue;
    if (spec.reg.kind === "conditional") uru.add(spec.reg.index);
    if (spec.obj.kind === "conditional") uou.add(spec.obj.index);
    if (spec.mat?.kind === "conditional") umu.add(spec.mat.index);
  }
  return { uru, uou, umu };
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

function previewCartogramValues(values: string[]): string {
  const joined = values.join(" ");
  return joined.length > 40 ? `${joined.slice(0, 37)}…` : joined;
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
    regCartogram: (net.regCartogram ?? []).map((r) => ({
      pointerIndex: r.pointerIndex,
      label: r.label,
      rowIndex: r.rowIndex,
      layer: r.layer,
      all: r.all,
      valuesPreview: previewCartogramValues(r.values),
    })),
    objCartogram: (net.objCartogram ?? []).map((r) => ({
      pointerIndex: r.pointerIndex,
      label: r.label,
      rowIndex: r.rowIndex,
      layer: r.layer,
      all: r.all,
      valuesPreview: previewCartogramValues(r.values),
    })),
    matCartogram: (net.matCartogram ?? []).map((r) => ({
      pointerIndex: r.pointerIndex,
      label: r.label,
      rowIndex: r.rowIndex,
      layer: r.layer,
      all: r.all,
      valuesPreview: previewCartogramValues(r.values),
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
  const hasAwLib = Boolean(getAwLibTable()?.entryCount);
  const volumes = parseMaterialVolumes(ast);
  const sumStates = buildSumIsotopeStatesByOffset(
    ast.statements,
    ast.materials.map((m) => m.range.offset),
    ast.constants
  );
  const matCpm = cpmBlockByMaterialIndex(ast.cpmBlocks ?? []);
  /** Полный список нуклидов в summaries раздувает JSON/память на full-core; счётчики оставляем. */
  const totalNuc = ast.materials.reduce((n, m) => n + m.nuclides.length, 0);
  const keepNuclideRows = totalNuc <= 2_000;
  const materials: MaterialSummary[] = ast.materials.map((m, matIndex) => {
    const vars = buildScopedVars(ast.constants, m.range.offset, "global");
    const dbmMode = isDbmLibraryName(m.nameLib) && Boolean(m.libMaterialName);
    const dbmEntry =
      dbmMode && m.nameLib && m.libMaterialName
        ? getDbmMaterial(m.nameLib, m.libMaterialName)
        : null;

    /** Для ρ: состав из .DBM + переименование DENSxY по densType. */
    let densityMat = m;
    if (dbmEntry && m.nuclides.length === 0) {
      const remappedDens =
        m.densParam != null ? remapDensParamForType(m.densParam, dbmEntry.densType) : undefined;
      densityMat = {
        ...m,
        densParam: remappedDens ?? m.densParam,
        nuclides: dbmEntry.nuclides.map((n) => ({
          name: n.name,
          density: n.density,
          mods: n.mods === "A" ? undefined : n.mods,
          range: m.libMaterialRange ?? m.range,
        })),
      };
    }

    const density = analyzeMaterialMassDensity(densityMat, vars);
    const massDensityGcm3 = density.rho;
    const volumeCm3 = materialVolumeCm3(volumes, m.number);
    const massG =
      volumeCm3 != null && massDensityGcm3 != null && massDensityGcm3 > 0
        ? volumeCm3 * massDensityGcm3
        : null;
    const sumState = sumStates.get(m.range.offset) ?? {
      listMode: "none" as const,
      list: new Set<string>(),
      siden: null,
    };
    let usedNuclideCount = density.usedCount;
    let sumIsotopeCount = 0;
    let sumIsotopeUsedCount = 0;
    let sumIsotopeMissingAwLibCount = 0;

    const sourceNuclides =
      m.nuclides.length > 0
        ? m.nuclides
        : dbmEntry
          ? dbmEntry.nuclides.map((n) => ({
              name: n.name,
              density: n.density,
              mods: n.mods === "A" ? undefined : n.mods,
              range: m.libMaterialRange ?? m.range,
            }))
          : [];

    const nuclides = keepNuclideRows
      ? sourceNuclides.map((n) => {
          const sum = evaluateSumIsotopeMembership(n, sumState, vars);
          const inAwLib = hasAwLib ? Boolean(getAwLibEntry(n.name)) : undefined;
          if (sum.inSum) {
            sumIsotopeCount++;
            if (hasAwLib) {
              if (inAwLib) sumIsotopeUsedCount++;
              else sumIsotopeMissingAwLibCount++;
            }
          }
          return {
            name: n.name,
            concentration: n.density,
            range: n.range,
            ...(sum.inSum ? { sumIsotope: { reasons: sum.reasons, ...(hasAwLib ? { inAwLib } : {}) } } : {}),
          };
        })
      : [];
    if (!keepNuclideRows) {
      const needScan = sumState.listMode === "si" || sumState.siden != null;
      if (needScan) {
        for (const n of sourceNuclides) {
          if (!isSumIsotopeMember(n, sumState, vars)) continue;
          sumIsotopeCount++;
          if (hasAwLib) {
            if (getAwLibEntry(n.name)) sumIsotopeUsedCount++;
            else sumIsotopeMissingAwLibCount++;
          }
        }
      }
    }
    const activity = analyzeMaterialActivity(densityMat, vars);
    const activityBqPerG =
      activity.totalBqPerCm3 != null && massDensityGcm3 != null && massDensityGcm3 > 0
        ? activity.totalBqPerCm3 / massDensityGcm3
        : null;
    const cpm = matCpm.get(matIndex);
    const cpmSummary = cpm
      ? {
          repetitions: cpm.repetitions,
          expandedNumbers: expandCpmMaterialNumbers(
            m.number,
            cpm.materialIndexes.map((idx) => ast.materials[idx]!.number),
            cpm.repetitions
          ),
          range: cpm.range,
        }
      : undefined;

    let dbmSummary: MaterialSummary["dbm"] | undefined;
    if (dbmMode && m.nameLib && m.libMaterialName) {
      const libRoot = getDbmLibRoot();
      const resolved = libRoot
        ? resolveDbmFilePath(libRoot, m.nameLib)
        : { fsPath: `${m.nameLib}.DBM`, exists: false };
      const headerLine = dbmEntry?.headerLine ?? 0;
      dbmSummary = {
        library: m.nameLib,
        material: m.libMaterialName,
        fsPath: resolved.fsPath,
        exists: resolved.exists,
        range: {
          start: { line: headerLine, character: 0 },
          end: { line: headerLine, character: m.libMaterialName.length },
          offset: 0,
          endOffset: 0,
        },
      };
    }

    return {
      number: m.number,
      group: m.group,
      temperature: m.temperature,
      nameLib: m.nameLib,
      libMaterialName: m.libMaterialName,
      libMaterialRange: m.libMaterialRange,
      ...(dbmSummary ? { dbm: dbmSummary } : {}),
      nuclideCount: sourceNuclides.length,
      usedNuclideCount,
      sumIsotopeCount,
      sumIsotopeUsedCount,
      sumIsotopeMissingAwLibCount,
      nuclidesPreview:
        (m.libMaterialName
          ? m.libMaterialName
          : sourceNuclides.map((n) => n.name).slice(0, 5).join(", ")) +
        (!m.libMaterialName && sourceNuclides.length > 5 ? "…" : ""),
      massDensityGcm3,
      volumeCm3,
      massG,
      activityBqPerG,
      nuclides,
      range: m.range,
      ...(cpmSummary ? { cpm: cpmSummary } : {}),
    };
  });

  const zoneReg = buildZoneRegistrationMap(ast.zones);
  const zones: ZoneSummary[] = ast.zones.map((z) => {
    const resolved = getResolvedZoneNumbers(zoneReg, z);
    return {
      name: z.name,
      expression: z.expression.length > 40 ? z.expression.slice(0, 37) + "…" : z.expression,
      materialNum: resolved?.materialNum,
      regNum: resolved?.regNum,
      objNum: resolved?.objNum,
      regPointerIndex: resolved?.regPointerIndex,
      objPointerIndex: resolved?.objPointerIndex,
      matPointerIndex: resolved?.matPointerIndex,
      hasConditionalPointers: resolved?.hasConditionalPointers,
      range: z.range,
    };
  });

  const objMap = new Map<number, ObjectSummary>();
  for (const z of zones) {
    // Условные без абсолютного obj не попадают в «Объект 1» по умолчанию
    if (z.objNum == null) continue;
    const o = z.objNum;
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

  // На огромных моделях computeBodyVolumeCm3 на каждое тело — O(n·cost); UI важнее точных объёмов.
  const skipBodyVolumes = ast.bodies.length > 4_000;

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
          volumeCm3: skipBodyVolumes ? null : computeBodyVolumeCm3(b, bodyVars, ast.bodies),
          scope: b.scope,
          transf: b.transf,
          protoName: b.protoName,
          transfMode: b.transfMode,
          range: b.range,
        };
      }),
    nets: buildNetSummaries(ast),
    lattices: buildLatticeSummaries(ast),
  };
}
