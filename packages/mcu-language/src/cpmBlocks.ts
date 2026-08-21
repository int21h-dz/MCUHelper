/**
 * CPM / CPMEND — автоматическое размножение блока материалов (UserGuide §8.8).
 * CPM n — число повторений блока; номера MATR повышаются на ширину блока.
 */

import type {
  CpmBlockNode,
  DiagnosticMessage,
  MaterialNode,
  SourceRange,
  StatementNode,
} from "./ast";

/** Формат диапазона / списка размноженных номеров для UI. */
export function formatCpmNumberRange(numbers: readonly number[]): string {
  if (numbers.length === 0) return "";
  if (numbers.length === 1) return String(numbers[0]);
  const sorted = [...numbers].sort((a, b) => a - b);
  let contiguous = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! !== sorted[i - 1]! + 1) {
      contiguous = false;
      break;
    }
  }
  if (contiguous) return `${sorted[0]}–${sorted[sorted.length - 1]}`;
  const step = sorted[1]! - sorted[0]!;
  let arithmetic = step > 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - sorted[i - 1]! !== step) {
      arithmetic = false;
      break;
    }
  }
  if (arithmetic && sorted.length > 3) {
    return `${sorted[0]},${sorted[1]},…,${sorted[sorted.length - 1]}`;
  }
  return sorted.join(",");
}

/** Номера одной шаблонной MATR после n повторений блока. */
export function expandCpmMaterialNumbers(
  baseNumber: number,
  basesInBlock: readonly number[],
  repetitions: number
): number[] {
  if (repetitions < 1 || basesInBlock.length === 0) return [baseNumber];
  const minBase = Math.min(...basesInBlock);
  const maxBase = Math.max(...basesInBlock);
  const delta = Math.max(1, maxBase - minBase + 1);
  const out: number[] = [];
  for (let r = 0; r < repetitions; r++) {
    out.push(baseNumber + r * delta);
  }
  return out;
}

function materialIndexInRange(
  materials: readonly MaterialNode[],
  startOffset: number,
  endOffset: number
): number[] {
  const indexes: number[] = [];
  for (let i = 0; i < materials.length; i++) {
    const off = materials[i]!.range.offset;
    if (off > startOffset && off < endOffset) indexes.push(i);
  }
  return indexes;
}

/**
 * Собирает блоки CPM…CPMEND и диагностирует незакрытые / лишние / битый n.
 */
export function collectCpmBlocks(
  statements: readonly StatementNode[],
  materials: readonly MaterialNode[]
): { blocks: CpmBlockNode[]; diagnostics: DiagnosticMessage[] } {
  const sorted = [...statements].sort((a, b) => a.range.offset - b.range.offset);
  const blocks: CpmBlockNode[] = [];
  const diagnostics: DiagnosticMessage[] = [];
  let open: { repetitions: number; range: SourceRange; offset: number } | null = null;

  for (const stmt of sorted) {
    const label = (stmt.label ?? "").toUpperCase();
    if (label === "CPM") {
      if (open) {
        diagnostics.push({
          severity: "error",
          message: "Вложенный CPM: предыдущий блок не закрыт CPMEND",
          code: "cpm-nested",
          range: stmt.range,
          related: [{ message: "Открывающий CPM", range: open.range }],
        });
      }
      const m = stmt.text.match(/^CPM\s+(\d+)\b/i);
      const repetitions = m ? parseInt(m[1]!, 10) : NaN;
      if (!m || !Number.isFinite(repetitions) || repetitions < 1) {
        diagnostics.push({
          severity: "error",
          message: "CPM: ожидается целое число повторений блока (CPM n)",
          code: "cpm-arg",
          range: stmt.range,
        });
        open = { repetitions: Number.isFinite(repetitions) && repetitions >= 1 ? repetitions : 1, range: stmt.range, offset: stmt.range.offset };
      } else {
        open = { repetitions, range: stmt.range, offset: stmt.range.offset };
      }
      continue;
    }

    if (label === "CPMEND") {
      if (!open) {
        diagnostics.push({
          severity: "error",
          message: "CPMEND без открывающего CPM",
          code: "cpm-orphan-end",
          range: stmt.range,
        });
        continue;
      }
      const materialIndexes = materialIndexInRange(materials, open.offset, stmt.range.offset);
      const bases = materialIndexes.map((i) => materials[i]!.number);
      const expandedSet = new Set<number>();
      for (const base of bases) {
        for (const n of expandCpmMaterialNumbers(base, bases, open.repetitions)) {
          expandedSet.add(n);
        }
      }
      blocks.push({
        kind: "cpmBlock",
        repetitions: open.repetitions,
        range: open.range,
        endRange: stmt.range,
        materialIndexes,
        expandedNumbers: [...expandedSet].sort((a, b) => a - b),
      });
      open = null;
      continue;
    }
  }

  if (open) {
    diagnostics.push({
      severity: "error",
      message: "CPM без закрывающего CPMEND",
      code: "cpm-unclosed",
      range: open.range,
    });
    const endOffset = Number.POSITIVE_INFINITY;
    const materialIndexes = materialIndexInRange(materials, open.offset, endOffset);
    const bases = materialIndexes.map((i) => materials[i]!.number);
    const expandedSet = new Set<number>();
    for (const base of bases) {
      for (const n of expandCpmMaterialNumbers(base, bases, open.repetitions)) {
        expandedSet.add(n);
      }
    }
    blocks.push({
      kind: "cpmBlock",
      repetitions: open.repetitions,
      range: open.range,
      materialIndexes,
      expandedNumbers: [...expandedSet].sort((a, b) => a - b),
    });
  }

  return { blocks, diagnostics };
}

/** Индекс материала → блок CPM (если есть). */
export function cpmBlockByMaterialIndex(
  blocks: readonly CpmBlockNode[]
): Map<number, CpmBlockNode> {
  const map = new Map<number, CpmBlockNode>();
  for (const b of blocks) {
    for (const i of b.materialIndexes) map.set(i, b);
  }
  return map;
}
