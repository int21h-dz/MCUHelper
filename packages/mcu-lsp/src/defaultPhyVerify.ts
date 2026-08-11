/**
 * Загрузка DEFAULT.PHY из MDBNR и проверка наличия нуклидов варианта в банке.
 * Логика SI/SIDEN — как у AW.LIB (см. collectAwLibMissingDiagnostics).
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  clearDefaultPhyTable,
  getDefaultPhyEntry,
  getDefaultPhyTable,
  parseDefaultPhy,
  buildDefaultPhyTable,
  setDefaultPhyTable,
  buildSumIsotopeStatesByOffset,
  buildScopedVars,
  evaluateSumIsotopeMembership,
  type DocumentAst,
} from "@mcuhelper/mcu-language";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";

export interface DefaultPhyLoadResult {
  ok: boolean;
  path?: string;
  entryCount: number;
  message: string;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Ищет DEFAULT.PHY в корне MDBNR (и default.phy). */
export async function resolveDefaultPhyPath(constantsLibPath: string): Promise<string | null> {
  if (!constantsLibPath?.trim()) return null;
  const root = constantsLibPath.trim();
  for (const name of ["DEFAULT.PHY", "default.phy", "Default.phy"]) {
    const p = path.join(root, name);
    if (await fileExists(p)) return p;
  }
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isFile() && ent.name.toUpperCase() === "DEFAULT.PHY") {
        return path.join(root, ent.name);
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function loadDefaultPhyFromConstantsPath(
  constantsLibPath: string
): Promise<DefaultPhyLoadResult> {
  if (!constantsLibPath?.trim()) {
    clearDefaultPhyTable();
    return { ok: false, entryCount: 0, message: "Путь MDBNR не задан — DEFAULT.PHY не загружен" };
  }

  const phyPath = await resolveDefaultPhyPath(constantsLibPath);
  if (!phyPath) {
    clearDefaultPhyTable();
    return {
      ok: false,
      entryCount: 0,
      message: `DEFAULT.PHY не найден в ${constantsLibPath}`,
    };
  }

  try {
    const text = await fs.readFile(phyPath, "utf8");
    const doc = parseDefaultPhy(text);
    const table = buildDefaultPhyTable(doc, phyPath);
    setDefaultPhyTable(table);
    return {
      ok: true,
      path: phyPath,
      entryCount: table.entryCount,
      message: `DEFAULT.PHY: ${table.entryCount} записей (${phyPath})`,
    };
  } catch (e) {
    clearDefaultPhyTable();
    return {
      ok: false,
      path: phyPath,
      entryCount: 0,
      message: `Не удалось прочитать DEFAULT.PHY: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function locateNuclideTokenRange(
  doc: {
    getText: (r: { start: { line: number; character: number }; end: { line: number; character: number } }) => string;
    lineCount: number;
  },
  nuclide: { name: string; range: { start: { line: number; character: number } } }
): { start: { line: number; character: number }; end: { line: number; character: number } } | null {
  const line = nuclide.range.start.line;
  if (line < 0 || line >= doc.lineCount) return null;
  const lineText = doc.getText({
    start: { line, character: 0 },
    end: { line, character: 1_000_000 },
  });
  const upper = lineText.toUpperCase();
  const needle = nuclide.name.toUpperCase();
  let idx = upper.indexOf(needle);
  while (idx >= 0) {
    const before = idx === 0 || /[\s,/]/.test(lineText[idx - 1]!);
    const after = idx + needle.length >= lineText.length || /[\s,/]/.test(lineText[idx + needle.length]!);
    if (before && after) break;
    idx = upper.indexOf(needle, idx + 1);
  }
  const startChar = idx >= 0 ? idx : nuclide.range.start.character;
  const endChar = idx >= 0 ? idx + needle.length : Math.min(startChar + needle.length, lineText.length);
  return {
    start: { line, character: startChar },
    end: { line, character: endChar },
  };
}

/**
 * Нуклид отсутствует в DEFAULT.PHY:
 * - уже в суммарном изотопе через SI → игнор;
 * - только через SIDEN → warning (лучше явно в SI);
 * - не в сумме → error.
 * SINOT только исключает из суммы и сам по себе покрытие банка не даёт.
 */
export function collectDefaultPhyMissingDiagnostics(
  doc: {
    getText: (r: { start: { line: number; character: number }; end: { line: number; character: number } }) => string;
    lineCount: number;
  },
  ast: DocumentAst
): Diagnostic[] {
  const table = getDefaultPhyTable();
  if (!table?.entryCount) return [];
  const out: Diagnostic[] = [];
  /** Один diag на имя — иначе full-core забивает Problems. */
  const seen = new Set<string>();
  const sumStates = buildSumIsotopeStatesByOffset(
    ast.statements,
    ast.materials.map((m) => m.range.offset),
    ast.constants
  );

  for (const mat of ast.materials) {
    const sumState = sumStates.get(mat.range.offset) ?? {
      listMode: "none" as const,
      list: new Set<string>(),
      siden: null,
    };
    const vars = buildScopedVars(ast.constants, mat.range.offset, "global");

    for (const n of mat.nuclides) {
      const key = n.name.trim().toUpperCase();
      if (seen.has(key)) continue;
      if (getDefaultPhyEntry(n.name)) continue;

      const sum = evaluateSumIsotopeMembership(n, sumState, vars);
      if (sum.kinds.includes("si")) continue;

      const range = locateNuclideTokenRange(doc, n);
      if (!range) continue;
      seen.add(key);

      if (sum.kinds.includes("siden")) {
        out.push({
          severity: DiagnosticSeverity.Warning,
          message:
            `Нуклид ${n.name} отсутствует в DEFAULT.PHY и попал в суммарный изотоп только через SIDEN — ` +
            `лучше явно указать его в карте SI`,
          range,
          code: "phy-missing-siden",
          source: "mcuhelper",
        });
        continue;
      }

      out.push({
        severity: DiagnosticSeverity.Error,
        message:
          `Нуклид ${n.name} отсутствует в DEFAULT.PHY — добавьте запись в банк или в суммарный изотоп (карта SI)`,
        range,
        code: "phy-missing",
        source: "mcuhelper",
      });
    }
  }
  return out;
}
