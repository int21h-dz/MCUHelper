import type { DocumentAst } from "./ast";
import { evaluateExpression } from "./expression";
import { formatBodyVolumeCm3 } from "./bodyVolume";
import { computeMaterialMassDensityGcm3, formatMassDensityGcm3 } from "./materialDensity";
import { parseStatementNumbers } from "./burnupLoad";

function findVolStatement(ast: DocumentAst): string | null {
  let last: string | null = null;
  for (const stmt of ast.statements) {
    if (stmt.label.toUpperCase() === "VOL") last = stmt.text;
  }
  return last;
}

/** Объёмы материалов (см³) по порядку номеров MATR: V1 → материал 1, … */
export function parseMaterialVolumes(ast: DocumentAst): number[] | null {
  const text = findVolStatement(ast);
  if (!text) return null;

  const vars = new Map<string, number>();
  for (const c of ast.constants) {
    const v = evaluateExpression(c.expression, vars);
    if (v !== null) vars.set(c.name, v);
  }

  const values = parseStatementNumbers(text, vars);
  return values.length ? values : null;
}

export function materialVolumeCm3(volumes: number[] | null | undefined, materialNumber: number): number | null {
  if (!volumes?.length || materialNumber < 1) return null;
  const idx = materialNumber - 1;
  if (idx >= volumes.length) return null;
  const v = volumes[idx];
  return Number.isFinite(v) && v > 0 ? v : null;
}

export interface MaterialMassRow {
  number: number;
  volumeCm3: number | null;
  massDensityGcm3: number | null;
  massG: number | null;
}

export function buildMaterialMassRows(ast: DocumentAst): MaterialMassRow[] {
  const volumes = parseMaterialVolumes(ast);
  const maxVolSlot = volumes?.length ?? 0;
  const maxMatNum = ast.materials.length ? Math.max(...ast.materials.map((m) => m.number)) : 0;
  const limit = Math.max(maxVolSlot, maxMatNum);

  const rows: MaterialMassRow[] = [];
  for (let n = 1; n <= limit; n++) {
    const mat = ast.materials.find((m) => m.number === n);
    const volumeCm3 = materialVolumeCm3(volumes, n);
    const vars = new Map<string, number>();
    for (const c of ast.constants) {
      const v = evaluateExpression(c.expression, vars);
      if (v !== null) vars.set(c.name, v);
    }
    const massDensityGcm3 = mat ? computeMaterialMassDensityGcm3(mat, vars) : null;
    const massG =
      volumeCm3 != null && massDensityGcm3 != null && massDensityGcm3 > 0
        ? volumeCm3 * massDensityGcm3
        : null;
    if (mat || volumeCm3 != null) {
      rows.push({ number: n, volumeCm3, massDensityGcm3, massG });
    }
  }
  return rows;
}

export function totalMaterialMassG(rows: MaterialMassRow[]): number {
  return rows.reduce((s, r) => s + (r.massG ?? 0), 0);
}

function fmtNum(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e4 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3)) return n.toPrecision(digits);
  return n.toPrecision(digits).replace(/\.?0+$/, "");
}

export function formatMassG(massG: number): string {
  if (!Number.isFinite(massG) || massG <= 0) return "—";
  if (massG >= 1000) return `${fmtNum(massG / 1000)} кг`;
  return `${fmtNum(massG)} г`;
}

/** Удельная энерговыработка: МВт·сут/кг (MW·d/kg). */
export function specificBurnupMwdPerKg(energyKwd: number, totalMassG: number): number | null {
  if (!Number.isFinite(energyKwd) || energyKwd <= 0) return null;
  if (!Number.isFinite(totalMassG) || totalMassG <= 0) return null;
  return energyKwd / totalMassG;
}

export function formatSpecificBurnupMwdPerKg(energyKwd: number, totalMassG: number): string | null {
  const v = specificBurnupMwdPerKg(energyKwd, totalMassG);
  if (v == null) return null;
  return `**${fmtNum(v)} МВт·сут/кг** (MW·d/kg)`;
}

export function formatMaterialMassTable(rows: MaterialMassRow[]): string {
  if (!rows.length) return "";

  const tableRows = rows.map((r) => {
    const vol = r.volumeCm3 != null ? formatBodyVolumeCm3(r.volumeCm3).replace(" см³", "") : "—";
    const rho = r.massDensityGcm3 != null ? formatMassDensityGcm3(r.massDensityGcm3).replace(" г/см³", "") : "—";
    const mass = r.massG != null ? formatMassG(r.massG) : "—";
    return `| ${r.number} | ${vol} | ${rho} | ${mass} |`;
  });

  const totalG = totalMaterialMassG(rows);
  const lines = [
    "",
    "| MATR | V, см³ | ρ, г/см³ | m |",
    "| --- | --- | --- | --- |",
    ...tableRows,
  ];
  if (totalG > 0) {
    lines.push("", `**Σm:** ${formatMassG(totalG)}`);
  }
  return lines.join("\n");
}

export function formatVolCardHover(ast: DocumentAst): string {
  const volumes = parseMaterialVolumes(ast);
  if (!volumes?.length) return "\n\n*Карта VOL не найдена в варианте.*";

  const rows = buildMaterialMassRows(ast);
  const lines = [
    "",
    "---",
    "### Объёмы и массы материалов (VOL)",
    "",
    `Задано **${volumes.length}** объём(ов) (см³) по порядку номеров MATR.`,
    formatMaterialMassTable(rows),
  ];
  return lines.join("\n");
}
