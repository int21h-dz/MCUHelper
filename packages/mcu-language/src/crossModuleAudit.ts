/**
 * P1a: аудит связей регистрация/выгорание ↔ геометрия/материалы.
 * UserGuide §11 / MCU-NR_Reference: list — диапазоны `1, 3-5, 7`; `0` — все области типа.
 */
import type { DiagnosticMessage, DocumentAst, SourceRange } from "./ast";
import { parseMaterialVolumes } from "./materialVolumes";
import { buildZoneRegistrationMap } from "./zoneRegistration";

export type RegistrationListKind = "material" | "zone" | "object";

export type CrossModuleDiagCode =
  | "reg-mat-unknown"
  | "reg-zone-unknown"
  | "reg-obj-unknown"
  | "brg-vol-short"
  | "zone-mat";

/** Основные list-карты регистратора: M* → материал, Z* → рег.зона, O* → объект. */
const REG_LIST_CARDS: Readonly<Record<string, RegistrationListKind>> = {
  MNEN: "material",
  ZNEN: "zone",
  ONEN: "object",
  MPHEN: "material",
  ZPHEN: "zone",
  OPHEN: "object",
  MELEN: "material",
  ZELEN: "zone",
  OELEN: "object",
  MFLU: "material",
  ZFLU: "zone",
  OFLU: "object",
  MRCT: "material",
  ZRCT: "zone",
  ORCT: "object",
  MDOS: "material",
  ZDOS: "zone",
  ODOS: "object",
};

export function registrationListKind(label: string): RegistrationListKind | null {
  return REG_LIST_CARDS[label.toUpperCase()] ?? null;
}

export interface ParsedRegistrationList {
  /** `0` — все области данного типа; проверки ссылок не нужны. */
  all: boolean;
  numbers: number[];
}

/**
 * Разбор хвоста list после метки карты.
 * `1, 3-5, 7` → [1,3,4,5,7]; одиночный `0` → all.
 */
export function parseRegistrationList(text: string): ParsedRegistrationList {
  const rest = text.trim().replace(/^\S+\s*/, "").trim();
  if (!rest) return { all: false, numbers: [] };

  const parts = rest.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 1 && parts[0] === "0") {
    return { all: true, numbers: [] };
  }

  const numbers: number[] = [];
  for (const part of parts) {
    if (part === "0") {
      return { all: true, numbers: [] };
    }
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let n = lo; n <= hi; n++) numbers.push(n);
      continue;
    }
    if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n > 0) numbers.push(n);
    }
  }
  return { all: false, numbers };
}

function diagCodeForKind(kind: RegistrationListKind): CrossModuleDiagCode {
  if (kind === "material") return "reg-mat-unknown";
  if (kind === "zone") return "reg-zone-unknown";
  return "reg-obj-unknown";
}

function kindLabelRu(kind: RegistrationListKind): string {
  if (kind === "material") return "материал";
  if (kind === "zone") return "рег. зона";
  return "объект";
}

function collectGeometryNumbers(ast: DocumentAst): {
  materials: Set<number>;
  zones: Set<number>;
  objects: Set<number>;
} {
  const materials = new Set(ast.materials.map((m) => m.number));
  const zones = new Set<number>();
  const objects = new Set<number>();
  const zoneReg = buildZoneRegistrationMap(ast.zones);
  for (const resolved of zoneReg.values()) {
    if (resolved.regNum > 0) zones.add(resolved.regNum);
    if (resolved.objNum > 0) objects.add(resolved.objNum);
  }
  return { materials, zones, objects };
}

function knownSetForKind(
  kind: RegistrationListKind,
  sets: ReturnType<typeof collectGeometryNumbers>
): Set<number> {
  if (kind === "material") return sets.materials;
  if (kind === "zone") return sets.zones;
  return sets.objects;
}

function findVolRange(ast: DocumentAst): SourceRange | null {
  let last: SourceRange | null = null;
  for (const stmt of ast.statements) {
    if (stmt.label.toUpperCase() === "VOL") last = stmt.range;
  }
  return last;
}

function hasBurnupRegistrationHeader(ast: DocumentAst): boolean {
  return ast.statements.some((s) => {
    const u = s.label.toUpperCase();
    return u === "BRG" || u === "BRGD";
  });
}

/** Усиление zone-mat: номер должен существовать в MATR, не только ≤ max. */
export function analyzeZoneMaterialLinks(ast: DocumentAst): DiagnosticMessage[] {
  const matNumbers = new Set(ast.materials.map((m) => m.number));
  if (matNumbers.size === 0) return [];

  const diags: DiagnosticMessage[] = [];
  const zoneReg = buildZoneRegistrationMap(ast.zones);
  for (const z of ast.zones) {
    const resolved = zoneReg.get(z.name);
    if (resolved?.materialNum == null) continue;
    if (matNumbers.has(resolved.materialNum)) continue;
    diags.push({
      severity: "warning",
      message: `Зона ${z.name}: материальный номер ${resolved.materialNum} не описан (MATR)`,
      code: "zone-mat",
      range: z.range,
    });
  }
  return diags;
}

export function analyzeRegistrationListLinks(ast: DocumentAst): DiagnosticMessage[] {
  const sets = collectGeometryNumbers(ast);
  const diags: DiagnosticMessage[] = [];
  const reported = new Set<string>();

  for (const stmt of ast.statements) {
    const label = stmt.label.toUpperCase();
    const kind = registrationListKind(label);
    if (!kind) continue;

    const known = knownSetForKind(kind, sets);
    if (known.size === 0) continue;

    const parsed = parseRegistrationList(stmt.text);
    if (parsed.all) continue;

    for (const n of parsed.numbers) {
      if (known.has(n)) continue;
      const key = `${label}:${kind}:${n}:${stmt.range.start.line}`;
      if (reported.has(key)) continue;
      reported.add(key);
      diags.push({
        severity: "warning",
        message: `${label}: неизвестный ${kindLabelRu(kind)} №${n}`,
        code: diagCodeForKind(kind),
        range: stmt.range,
      });
    }
  }
  return diags;
}

/** VOL в контексте BRG короче max номера MATR — предупреждение (слоты V1…Vn). */
export function analyzeBrgVolLength(ast: DocumentAst): DiagnosticMessage[] {
  if (!hasBurnupRegistrationHeader(ast)) return [];
  if (ast.materials.length === 0) return [];
  const matCount = Math.max(...ast.materials.map((m) => m.number));

  const volumes = parseMaterialVolumes(ast);
  if (!volumes || volumes.length >= matCount) return [];

  const range = findVolRange(ast);
  if (!range) return [];

  return [
    {
      severity: "warning",
      message: `VOL (BRG): задано ${volumes.length} объём(ов) при ${matCount} материалах — список короче`,
      code: "brg-vol-short",
      range,
    },
  ];
}

export function analyzeCrossModuleLinks(ast: DocumentAst): DiagnosticMessage[] {
  return [
    ...analyzeZoneMaterialLinks(ast),
    ...analyzeRegistrationListLinks(ast),
    ...analyzeBrgVolLength(ast),
  ];
}
